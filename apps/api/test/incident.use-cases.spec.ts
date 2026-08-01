import type { AuthPrincipal } from '@aegisflow/contracts';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { IncidentUseCases } from '../src/incidents/application/incident.use-cases';
import type { EvidenceStoragePort } from '../src/incidents/application/ports/evidence-storage.port';
import type {
  IncidentEvidenceValue,
  IncidentRepositoryPort,
  IncidentSummary,
} from '../src/incidents/application/ports/incident-repository.port';

const organizationId = randomUUID();
const incidentId = randomUUID();
const principal: AuthPrincipal = {
  mfaVerified: true,
  organizationId,
  permissions: ['incident.read', 'incident.manage', 'incident.evidence'],
  sessionId: randomUUID(),
  userId: randomUUID(),
};

function summary(overrides: Partial<IncidentSummary> = {}): IncidentSummary {
  return {
    alertCount: 1,
    assignedMembership: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    firstDetectedAt: '2026-08-01T12:00:00.000Z',
    id: incidentId,
    key: 'INC-019FB917863A',
    primaryAsset: null,
    priority: 'P1',
    resolutionDueAt: '2026-08-01T13:00:00.000Z',
    responseDueAt: '2026-08-01T12:05:00.000Z',
    riskScore: 100,
    severity: 'CRITICAL',
    sla: { resolutionBreached: false, responseBreached: false },
    status: 'OPEN',
    title: 'Critical authentication incident',
    updatedAt: '2026-08-01T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function evidence(overrides: Partial<IncidentEvidenceValue> = {}): IncidentEvidenceValue {
  return {
    contentType: 'application/json',
    createdAt: '2026-08-01T12:00:00.000Z',
    fileName: 'event.json',
    id: randomUUID(),
    objectKey: `${organizationId}/private/evidence`,
    rejectionReason: null,
    sha256: 'a'.repeat(64),
    sizeBytes: 128,
    status: 'PENDING_UPLOAD',
    version: 1,
    ...overrides,
  };
}

function repository(): IncidentRepositoryPort {
  return {
    addComment: vi.fn(async () => ({ replayed: false, value: {} })),
    assign: vi.fn(async () => ({ kind: 'success' as const, value: summary() })),
    beginEvidenceInspection: vi.fn(async () => ({
      kind: 'success' as const,
      value: evidence({ status: 'QUARANTINED', version: 2 }),
    })),
    createEvidence: vi.fn(async () => ({ replayed: false, value: evidence() })),
    createIncident: vi.fn(async () => ({ replayed: false, value: summary() })),
    finalizeEvidence: vi.fn(async () => ({
      kind: 'success' as const,
      value: evidence({ status: 'AVAILABLE', version: 3 }),
    })),
    findEvidence: vi.fn(async () => null),
    findIncident: vi.fn(async () => ({ ...summary(), lessonsLearned: null, rootCause: null })),
    getIncidentDetail: vi.fn(async () => null),
    getIncidentGraph: vi.fn(async () => null),
    listIncidents: vi.fn(async () => []),
    listNotifications: vi.fn(async () => []),
    listSlaPolicies: vi.fn(async () => []),
    markNotificationRead: vi.fn(async () => ({ kind: 'not_found' as const })),
    transition: vi.fn(async () => ({ kind: 'success' as const, value: summary() })),
    updateAnalysis: vi.fn(async () => ({ kind: 'success' as const, value: summary() })),
    updateSlaPolicy: vi.fn(async () => ({ kind: 'success' as const, value: {} })),
  };
}

function storage(): EvidenceStoragePort {
  return {
    createDownloadUrl: vi.fn(async () => ({ expiresInSeconds: 60, url: 'https://download.test' })),
    createUploadUrl: vi.fn(async () => ({
      expiresInSeconds: 300,
      headers: { 'content-type': 'application/json' },
      url: 'https://upload.test',
    })),
    inspect: vi.fn(async () => ({ rejectionReason: null, safe: true })),
  };
}

describe('IncidentUseCases', () => {
  it('rejects cross-tenant reads before reaching persistence', async () => {
    const port = repository();
    const useCases = new IncidentUseCases(port, storage());
    await expect(useCases.listIncidents(principal, randomUUID(), {})).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    expect(port.listIncidents).not.toHaveBeenCalled();
  });

  it('enforces lifecycle transitions and required root-cause analysis', async () => {
    const port = repository();
    const useCases = new IncidentUseCases(port, storage());
    await expect(
      useCases.transition(principal, organizationId, incidentId, {
        reason: 'Skipping the investigation workflow',
        status: 'RESOLVED',
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(port.transition).not.toHaveBeenCalled();

    port.findIncident = vi.fn(async () => ({
      ...summary({ status: 'INVESTIGATING' }),
      lessonsLearned: null,
      rootCause: null,
    }));
    await expect(
      useCases.transition(principal, organizationId, incidentId, {
        reason: 'Investigation and containment are complete',
        status: 'RESOLVED',
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(port.transition).not.toHaveBeenCalled();
  });

  it('rejects unsafe evidence metadata and requires MFA', async () => {
    const port = repository();
    const useCases = new IncidentUseCases(port, storage());
    await expect(
      useCases.requestEvidenceUpload(
        principal,
        organizationId,
        incidentId,
        {
          contentType: 'application/json',
          fileName: '../secret.json',
          sha256: 'a'.repeat(64),
          sizeBytes: 128,
        },
        'evidence-unsafe-001',
      ),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      useCases.requestEvidenceUpload(
        { ...principal, mfaVerified: false },
        organizationId,
        incidentId,
        {
          contentType: 'application/json',
          fileName: 'event.json',
          sha256: 'a'.repeat(64),
          sizeBytes: 128,
        },
        'evidence-mfa-001',
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(port.createEvidence).not.toHaveBeenCalled();
  });

  it('keeps private storage keys out of evidence API responses', async () => {
    const port = repository();
    const evidenceStorage = storage();
    const useCases = new IncidentUseCases(port, evidenceStorage);
    const requested = await useCases.requestEvidenceUpload(
      principal,
      organizationId,
      incidentId,
      {
        contentType: 'application/json',
        fileName: 'event.json',
        sha256: 'a'.repeat(64),
        sizeBytes: 128,
      },
      'evidence-safe-001',
    );
    expect(requested.value).not.toHaveProperty('objectKey');
    expect(requested.upload.url).toBe('https://upload.test');

    const evidenceId = randomUUID();
    const completed = await useCases.completeEvidenceUpload(
      principal,
      organizationId,
      incidentId,
      evidenceId,
      { version: 1 },
    );
    expect(completed).toMatchObject({ status: 'AVAILABLE', version: 3 });
    expect(completed).not.toHaveProperty('objectKey');
    expect(evidenceStorage.inspect).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: expect.any(String), status: 'QUARANTINED' }),
    );
  });
});
