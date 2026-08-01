import type { AuthPrincipal, EventSeverityValue, IncidentStatusValue } from '@aegisflow/contracts';
import {
  addIncidentCommentSchema,
  assignIncidentSchema,
  completeEvidenceUploadSchema,
  createIncidentSchema,
  requestEvidenceUploadSchema,
  transitionIncidentSchema,
  updateIncidentAnalysisSchema,
  updateSlaPolicySchema,
} from '@aegisflow/contracts';
import { IdempotencyKey, IncidentLifecyclePolicy, IncidentPolicyError } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { ApplicationError } from '../../identity/application/application-error';
import { recordApiIncidentCreated } from '../../metrics/incident.metrics';
import { EVIDENCE_STORAGE_PORT, type EvidenceStoragePort } from './ports/evidence-storage.port';
import {
  INCIDENT_REPOSITORY_PORT,
  type IncidentCursor,
  type IncidentRepositoryPort,
  type MutationResult,
} from './ports/incident-repository.port';

@Injectable()
export class IncidentUseCases {
  private readonly lifecycle = new IncidentLifecyclePolicy();

  constructor(
    @Inject(INCIDENT_REPOSITORY_PORT) private readonly repository: IncidentRepositoryPort,
    @Inject(EVIDENCE_STORAGE_PORT) private readonly storage: EvidenceStoragePort,
  ) {}

  async listIncidents(
    principal: AuthPrincipal,
    organizationId: string,
    query: {
      assignedMembershipId?: string;
      cursor?: string;
      limit?: number;
      search?: string;
      severity?: EventSeverityValue;
      slaBreached?: boolean;
      status?: IncidentStatusValue;
    },
  ) {
    this.assertTenant(principal, organizationId);
    const limit = query.limit ?? 50;
    const incidents = await this.repository.listIncidents(organizationId, principal.userId, {
      limit,
      ...(query.assignedMembershipId === undefined
        ? {}
        : { assignedMembershipId: query.assignedMembershipId }),
      ...(query.cursor === undefined ? {} : { cursor: decodeCursor(query.cursor) }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.severity === undefined ? {} : { severity: query.severity }),
      ...(query.slaBreached === undefined ? {} : { slaBreached: query.slaBreached }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    const last = incidents.at(-1);
    return {
      data: incidents,
      nextCursor:
        incidents.length === limit && last !== undefined
          ? encodeCursor({ id: last.id, updatedAt: new Date(last.updatedAt) })
          : null,
    };
  }

  async getIncident(principal: AuthPrincipal, organizationId: string, incidentId: string) {
    this.assertTenant(principal, organizationId);
    const value = await this.repository.getIncidentDetail(
      organizationId,
      principal.userId,
      incidentId,
    );
    if (value === null) throw notFound('incident');
    return value;
  }

  async getIncidentGraph(principal: AuthPrincipal, organizationId: string, incidentId: string) {
    this.assertTenant(principal, organizationId);
    const value = await this.repository.getIncidentGraph(
      organizationId,
      principal.userId,
      incidentId,
    );
    if (value === null) throw notFound('incident');
    return value;
  }

  createIncident(
    principal: AuthPrincipal,
    organizationId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = createIncidentSchema.parse(candidate);
    return this.repository
      .createIncident({
        alertIds: input.alertIds,
        description: input.description,
        idempotency: this.idempotency(principal.userId, 'incident.create', idempotencyKey, input),
        organizationId,
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        title: input.title,
        userId: principal.userId,
      })
      .then((result) => {
        if (!result.replayed) recordApiIncidentCreated(result.value.severity);
        return result;
      });
  }

  async assign(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = assignIncidentSchema.parse(candidate);
    return this.unwrap(
      await this.repository.assign({
        ...input,
        incidentId,
        organizationId,
        userId: principal.userId,
      }),
      'incident',
    );
  }

  async transition(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = transitionIncidentSchema.parse(candidate);
    const current = await this.repository.findIncident(
      organizationId,
      principal.userId,
      incidentId,
    );
    if (current === null) throw notFound('incident');
    try {
      this.lifecycle.assertTransition(current.status, input.status, {
        lessonsLearned: input.lessonsLearned ?? current.lessonsLearned,
        rootCause: input.rootCause ?? current.rootCause,
      });
    } catch (error) {
      if (error instanceof IncidentPolicyError) {
        throw new ApplicationError('conflict', error.message, 409);
      }
      throw error;
    }
    return this.unwrap(
      await this.repository.transition({
        currentStatus: current.status,
        incidentId,
        organizationId,
        reason: input.reason,
        status: input.status,
        userId: principal.userId,
        version: input.version,
        ...(input.lessonsLearned === undefined ? {} : { lessonsLearned: input.lessonsLearned }),
        ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
      }),
      'incident',
    );
  }

  async updateAnalysis(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    const input = updateIncidentAnalysisSchema.parse(candidate);
    return this.unwrap(
      await this.repository.updateAnalysis({
        incidentId,
        organizationId,
        userId: principal.userId,
        version: input.version,
        ...(input.lessonsLearned === undefined ? {} : { lessonsLearned: input.lessonsLearned }),
        ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
      }),
      'incident',
    );
  }

  addComment(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
  ) {
    this.assertTenant(principal, organizationId);
    const input = addIncidentCommentSchema.parse(candidate);
    return this.repository.addComment({
      body: input.body,
      idempotency: this.idempotency(
        principal.userId,
        `incident.comment:${incidentId}`,
        idempotencyKey,
        input,
      ),
      incidentId,
      organizationId,
      userId: principal.userId,
    });
  }

  async requestEvidenceUpload(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = requestEvidenceUploadSchema.parse(candidate);
    const evidenceId = randomUUID();
    const objectKey = `${organizationId}/incidents/${incidentId}/evidence/${evidenceId}`;
    const record = await this.repository.createEvidence({
      ...input,
      evidenceId,
      idempotency: this.idempotency(
        principal.userId,
        `incident.evidence:${incidentId}`,
        idempotencyKey,
        input,
      ),
      incidentId,
      objectKey,
      organizationId,
      userId: principal.userId,
    });
    const upload = await this.storage.createUploadUrl({
      contentType: record.value.contentType,
      objectKey: record.value.objectKey,
      sha256: record.value.sha256,
      sizeBytes: record.value.sizeBytes,
    });
    return { replayed: record.replayed, upload, value: publicEvidence(record.value) };
  }

  async completeEvidenceUpload(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    evidenceId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = completeEvidenceUploadSchema.parse(candidate);
    const quarantined = this.unwrap(
      await this.repository.beginEvidenceInspection({
        evidenceId,
        incidentId,
        organizationId,
        userId: principal.userId,
        version: input.version,
      }),
      'evidence',
    );
    let inspection;
    try {
      inspection = await this.storage.inspect(quarantined);
    } catch {
      throw new ApplicationError(
        'service_unavailable',
        'The evidence remains quarantined because storage verification is unavailable.',
        503,
      );
    }
    return publicEvidence(
      this.unwrap(
        await this.repository.finalizeEvidence({
          evidenceId,
          incidentId,
          organizationId,
          rejectionReason: inspection.rejectionReason,
          safe: inspection.safe,
          userId: principal.userId,
          version: quarantined.version,
        }),
        'evidence',
      ),
    );
  }

  async getEvidenceDownload(
    principal: AuthPrincipal,
    organizationId: string,
    incidentId: string,
    evidenceId: string,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const evidence = await this.repository.findEvidence(
      organizationId,
      principal.userId,
      incidentId,
      evidenceId,
    );
    if (evidence === null) throw notFound('evidence');
    if (evidence.status !== 'AVAILABLE') {
      throw new ApplicationError('conflict', 'Only verified evidence can be downloaded.', 409);
    }
    return this.storage.createDownloadUrl(evidence.objectKey);
  }

  listSlaPolicies(principal: AuthPrincipal, organizationId: string) {
    this.assertTenant(principal, organizationId);
    return this.repository.listSlaPolicies(organizationId, principal.userId);
  }

  async updateSlaPolicy(
    principal: AuthPrincipal,
    organizationId: string,
    policyId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    this.assertMfa(principal);
    const input = updateSlaPolicySchema.parse(candidate);
    return this.unwrap(
      await this.repository.updateSlaPolicy({
        ...input,
        organizationId,
        policyId,
        userId: principal.userId,
      }),
      'SLA policy',
    );
  }

  listNotifications(principal: AuthPrincipal, organizationId: string, limit = 50) {
    this.assertTenant(principal, organizationId);
    return this.repository.listNotifications(
      organizationId,
      principal.userId,
      Math.min(100, Math.max(1, limit)),
    );
  }

  async markNotificationRead(
    principal: AuthPrincipal,
    organizationId: string,
    notificationId: string,
  ) {
    this.assertTenant(principal, organizationId);
    return this.unwrap(
      await this.repository.markNotificationRead(organizationId, principal.userId, notificationId),
      'notification',
    );
  }

  private idempotency(userId: string, scope: string, rawKey: string | undefined, request: unknown) {
    const key = IdempotencyKey.create(rawKey);
    return {
      actorUserId: userId,
      keyHash: this.hash(key.value),
      requestHash: this.hash(JSON.stringify(request)),
      scope,
    };
  }

  private unwrap<T>(result: MutationResult<T>, resource: string): T {
    if (result.kind === 'not_found') throw notFound(resource);
    if (result.kind === 'conflict') {
      throw new ApplicationError(
        'conflict',
        `The ${resource} was modified by another request.`,
        409,
      );
    }
    return result.value;
  }

  private assertTenant(principal: AuthPrincipal, organizationId: string): void {
    if (principal.organizationId !== organizationId) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
  }

  private assertMfa(principal: AuthPrincipal): void {
    if (!principal.mfaVerified) {
      throw new ApplicationError('forbidden', 'MFA verification is required.', 403);
    }
  }

  private hash(value: string): string {
    const pepper = process.env.AUTH_TOKEN_PEPPER;
    return pepper === undefined
      ? createHash('sha256').update(value).digest('hex')
      : createHmac('sha256', pepper).update(value).digest('hex');
  }
}

function notFound(resource: string): ApplicationError {
  return new ApplicationError('not_found', `The ${resource} was not found.`, 404);
}

function decodeCursor(value: string): IncidentCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      updatedAt?: unknown;
    };
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.id)
    ) {
      throw new Error('invalid');
    }
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new Error('invalid');
    return { id: parsed.id, updatedAt };
  } catch {
    throw new ApplicationError('validation_failed', 'The pagination cursor is invalid.', 400);
  }
}

function encodeCursor(cursor: IncidentCursor): string {
  return Buffer.from(
    JSON.stringify({ id: cursor.id, updatedAt: cursor.updatedAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

function publicEvidence(evidence: {
  contentType: string;
  createdAt: string;
  fileName: string;
  id: string;
  objectKey: string;
  rejectionReason: string | null;
  sha256: string;
  sizeBytes: number;
  status: string;
  version: number;
}) {
  return {
    contentType: evidence.contentType,
    createdAt: evidence.createdAt,
    fileName: evidence.fileName,
    id: evidence.id,
    rejectionReason: evidence.rejectionReason,
    sha256: evidence.sha256,
    sizeBytes: evidence.sizeBytes,
    status: evidence.status,
    version: evidence.version,
  };
}
