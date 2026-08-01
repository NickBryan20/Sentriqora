import type {
  AiRecommendationStatusValue,
  KnowledgeSourceTypeValue,
  KnowledgeTrustLevelValue,
} from '@aegisflow/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import { ApplicationError } from '../../identity/application/application-error';
import { TenantPrismaExecutor } from '../../identity/infrastructure/prisma/tenant-prisma.executor';
import type {
  KnowledgeDocumentSummary,
  KnowledgeRepositoryPort,
  RecommendationSourceValue,
  RecommendationValue,
  RetrievedKnowledgeChunk,
} from '../application/ports/knowledge-repository.port';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class PrismaKnowledgeRepository implements KnowledgeRepositoryPort {
  constructor(@Inject(TenantPrismaExecutor) private readonly tenant: TenantPrismaExecutor) {}

  createDocument(input: {
    actorUserId: string;
    contentType: string;
    embeddingModel: string;
    embeddingProvider: string;
    objectKey: string;
    organizationId: string;
    sha256: string;
    sizeBytes: number;
    sourceType: KnowledgeSourceTypeValue;
    sourceUri: string | null;
    title: string;
    trustLevel: KnowledgeTrustLevelValue;
  }): Promise<KnowledgeDocumentSummary> {
    return this.tenant.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (tx) => {
        const document = await tx.knowledgeDocument.create({
          data: {
            createdByUserId: input.actorUserId,
            organizationId: input.organizationId,
            sourceType: input.sourceType,
            sourceUri: input.sourceUri,
            title: input.title,
            trustLevel: input.trustLevel,
            versions: {
              create: {
                contentType: input.contentType,
                createdByUserId: input.actorUserId,
                embeddingModel: input.embeddingModel,
                embeddingProvider: input.embeddingProvider,
                objectKey: input.objectKey,
                sha256: input.sha256,
                sizeBytes: input.sizeBytes,
                version: 1,
              },
            },
          },
          include: { _count: { select: { chunks: true } } },
        });
        const version = await tx.knowledgeDocumentVersion.findFirstOrThrow({
          where: { documentId: document.id, organizationId: input.organizationId, version: 1 },
        });
        await this.enqueueIndex(tx, input.organizationId, document.id, version.id, 1);
        await this.audit(tx, input, 'knowledge_document.created', document.id, {
          sourceType: input.sourceType,
          trustLevel: input.trustLevel,
        });
        return documentSummary(document);
      },
    );
  }

  createVersion(input: {
    actorUserId: string;
    contentType: string;
    documentId: string;
    embeddingModel: string;
    embeddingProvider: string;
    objectKey: string;
    organizationId: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<KnowledgeDocumentSummary> {
    return this.tenant.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM knowledge_documents WHERE id = ${input.documentId}::uuid FOR UPDATE`;
        const current = await tx.knowledgeDocument.findFirst({
          where: { deletedAt: null, id: input.documentId, organizationId: input.organizationId },
        });
        if (current === null) throw notFound();
        const version = current.currentVersion + 1;
        const createdVersion = await tx.knowledgeDocumentVersion.create({
          data: {
            contentType: input.contentType,
            createdByUserId: input.actorUserId,
            documentId: input.documentId,
            embeddingModel: input.embeddingModel,
            embeddingProvider: input.embeddingProvider,
            objectKey: input.objectKey,
            organizationId: input.organizationId,
            sha256: input.sha256,
            sizeBytes: input.sizeBytes,
            version,
          },
        });
        const document = await tx.knowledgeDocument.update({
          data: { currentVersion: version, rejectionReason: null, status: 'PENDING' },
          include: { _count: { select: { chunks: true } } },
          where: { id: current.id },
        });
        await this.enqueueIndex(
          tx,
          input.organizationId,
          input.documentId,
          createdVersion.id,
          version,
        );
        await this.audit(tx, input, 'knowledge_document.version_created', input.documentId, {
          version,
        });
        return documentSummary(document);
      },
    );
  }

  deleteDocument(input: {
    actorUserId: string;
    documentId: string;
    organizationId: string;
  }): Promise<readonly string[]> {
    return this.tenant.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (tx) => {
        const document = await tx.knowledgeDocument.findFirst({
          include: { versions: { select: { objectKey: true } } },
          where: { deletedAt: null, id: input.documentId, organizationId: input.organizationId },
        });
        if (document === null) throw notFound();
        await tx.$executeRaw`
          UPDATE knowledge_chunks
          SET content = '[DELETED]', embedding = array_fill(0::real, ARRAY[768])::vector
          WHERE organization_id = ${input.organizationId}::uuid AND document_id = ${input.documentId}::uuid
        `;
        await tx.knowledgeDocument.update({
          data: { deletedAt: new Date(), rejectionReason: null, status: 'DELETED' },
          where: { id: input.documentId },
        });
        await this.audit(tx, input, 'knowledge_document.deleted', input.documentId, {
          versions: document.versions.length,
        });
        return document.versions.map((version) => version.objectKey);
      },
    );
  }

  listDocuments(organizationId: string): Promise<readonly KnowledgeDocumentSummary[]> {
    return this.tenant.run({ organizationId, userId: null }, async (tx) => {
      const documents = await tx.knowledgeDocument.findMany({
        include: { _count: { select: { chunks: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { deletedAt: null, organizationId },
      });
      return documents.map(documentSummary);
    });
  }

  listRecommendations(
    organizationId: string,
    incidentId?: string,
  ): Promise<readonly RecommendationValue[]> {
    return this.tenant.run({ organizationId, userId: null }, async (tx) => {
      const rows = await tx.aIRecommendation.findMany({
        include: {
          sources: {
            include: {
              chunk: { include: { document: { select: { title: true, trustLevel: true } } } },
            },
            orderBy: { rank: 'asc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        where: { organizationId, ...(incidentId === undefined ? {} : { incidentId }) },
      });
      return rows.map(recommendationValue);
    });
  }

  retrieve(input: {
    embedding: readonly number[];
    embeddingModel: string;
    embeddingProvider: string;
    organizationId: string;
    take: number;
  }): Promise<readonly RetrievedKnowledgeChunk[]> {
    return this.tenant.run({ organizationId: input.organizationId, userId: null }, async (tx) => {
      const vector = `[${input.embedding.join(',')}]`;
      const rows = await tx.$queryRawUnsafe<
        {
          content: string;
          document_id: string;
          id: string;
          similarity: number | string;
          title: string;
          trust_level: KnowledgeTrustLevelValue;
        }[]
      >(
        `SELECT chunk.id, chunk.document_id, chunk.content, document.title,
                document.trust_level,
                GREATEST(0, LEAST(1, 1 - (chunk.embedding <=> $1::vector))) AS similarity
         FROM knowledge_chunks AS chunk
         JOIN knowledge_documents AS document
           ON document.id = chunk.document_id AND document.organization_id = chunk.organization_id
         JOIN knowledge_document_versions AS version
           ON version.id = chunk.version_id AND version.organization_id = chunk.organization_id
         WHERE chunk.organization_id = $2::uuid
           AND document.status = 'INDEXED'
           AND document.deleted_at IS NULL
           AND version.version = document.current_version
           AND version.embedding_provider = $3
           AND version.embedding_model = $4
         ORDER BY chunk.embedding <=> $1::vector, chunk.id
         LIMIT $5`,
        vector,
        input.organizationId,
        input.embeddingProvider,
        input.embeddingModel,
        input.take,
      );
      return rows.map((row) => ({
        content: row.content,
        documentId: row.document_id,
        id: row.id,
        similarity: Number(row.similarity),
        title: row.title,
        trustLevel: row.trust_level,
      }));
    });
  }

  saveRecommendation(input: {
    actorUserId: string;
    answer: string;
    confidence: number;
    estimatedCostUsd: number;
    incidentId: string | null;
    inputTokens: number;
    latencyMs: number;
    model: string;
    organizationId: string;
    outputTokens: number;
    promptVersion: string;
    provider: string;
    providerRequestId: string | null;
    question: string;
    recommendedActions: readonly string[];
    sources: readonly { chunkId: string; quote: string; rank: number; similarity: number }[];
    status: AiRecommendationStatusValue;
  }): Promise<RecommendationValue> {
    return this.tenant.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (tx) => {
        if (input.incidentId !== null) {
          const incident = await tx.incident.findFirst({
            select: { id: true },
            where: { id: input.incidentId, organizationId: input.organizationId },
          });
          if (incident === null)
            throw new ApplicationError('not_found', 'Incident not found.', 404);
        }
        const created = await tx.aIRecommendation.create({
          data: {
            answer: input.answer,
            confidence: input.confidence,
            estimatedCostUsd: input.estimatedCostUsd,
            incidentId: input.incidentId,
            inputTokens: input.inputTokens,
            latencyMs: input.latencyMs,
            model: input.model,
            organizationId: input.organizationId,
            outputTokens: input.outputTokens,
            promptVersion: input.promptVersion,
            provider: input.provider,
            providerRequestId: input.providerRequestId,
            question: input.question,
            recommendedActions: [...input.recommendedActions],
            requestedByUserId: input.actorUserId,
            sources: {
              create: input.sources.map((source) => ({
                chunkId: source.chunkId,
                quote: source.quote,
                rank: source.rank,
                similarity: source.similarity,
              })),
            },
            status: input.status,
          },
          include: {
            sources: {
              include: {
                chunk: { include: { document: { select: { title: true, trustLevel: true } } } },
              },
              orderBy: { rank: 'asc' },
            },
          },
        });
        await this.audit(tx, input, 'ai_recommendation.created', created.id, {
          confidence: input.confidence,
          incidentId: input.incidentId,
          model: input.model,
          promptVersion: input.promptVersion,
          provider: input.provider,
          sourceCount: input.sources.length,
          status: input.status,
        });
        return recommendationValue(created);
      },
    );
  }

  private enqueueIndex(
    tx: Transaction,
    organizationId: string,
    documentId: string,
    versionId: string,
    version: number,
  ) {
    return tx.outboxEvent.create({
      data: {
        aggregateId: documentId,
        aggregateType: 'KnowledgeDocument',
        eventType: 'knowledge.document_ready.v1',
        occurredAt: new Date(),
        organizationId,
        payload: { documentId, organizationId, version, versionId },
      },
    });
  }

  private audit(
    tx: Transaction,
    input: { actorUserId: string; organizationId: string },
    action: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return tx.eventRecord.create({
      data: {
        action,
        actorUserId: input.actorUserId,
        correlationId: 'api-secure-rag',
        metadata,
        organizationId: input.organizationId,
        outcome: 'success',
        targetId,
        targetType: action.startsWith('ai_') ? 'ai_recommendation' : 'knowledge_document',
      },
    });
  }
}

function documentSummary(document: {
  _count: { chunks: number };
  createdAt: Date;
  currentVersion: number;
  id: string;
  rejectionReason: string | null;
  sourceType: KnowledgeSourceTypeValue;
  sourceUri: string | null;
  status: KnowledgeDocumentSummary['status'];
  title: string;
  trustLevel: KnowledgeTrustLevelValue;
  updatedAt: Date;
}): KnowledgeDocumentSummary {
  return {
    chunkCount: document._count.chunks,
    createdAt: document.createdAt.toISOString(),
    currentVersion: document.currentVersion,
    id: document.id,
    rejectionReason: document.rejectionReason,
    sourceType: document.sourceType,
    sourceUri: document.sourceUri,
    status: document.status,
    title: document.title,
    trustLevel: document.trustLevel,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function recommendationValue(recommendation: {
  answer: string;
  confidence: unknown;
  createdAt: Date;
  id: string;
  incidentId: string | null;
  model: string;
  provider: string;
  question: string;
  recommendedActions: unknown;
  sources: {
    chunk: {
      document: { title: string; trustLevel: KnowledgeTrustLevelValue };
      documentId: string;
    };
    chunkId: string;
    quote: string;
    rank: number;
    similarity: unknown;
  }[];
  status: AiRecommendationStatusValue;
}): RecommendationValue {
  return {
    answer: recommendation.answer,
    confidence: Number(recommendation.confidence),
    createdAt: recommendation.createdAt.toISOString(),
    id: recommendation.id,
    incidentId: recommendation.incidentId,
    model: recommendation.model,
    provider: recommendation.provider,
    question: recommendation.question,
    recommendedActions: Array.isArray(recommendation.recommendedActions)
      ? recommendation.recommendedActions.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    sources: recommendation.sources.map((source): RecommendationSourceValue => ({
      chunkId: source.chunkId,
      documentId: source.chunk.documentId,
      quote: source.quote,
      rank: source.rank,
      similarity: Number(source.similarity),
      title: source.chunk.document.title,
      trustLevel: source.chunk.document.trustLevel,
    })),
    status: recommendation.status,
  };
}

function notFound(): ApplicationError {
  return new ApplicationError('not_found', 'Knowledge document not found.', 404);
}
