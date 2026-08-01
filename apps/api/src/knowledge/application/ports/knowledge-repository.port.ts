import type {
  AiRecommendationStatusValue,
  KnowledgeDocumentStatusValue,
  KnowledgeSourceTypeValue,
  KnowledgeTrustLevelValue,
} from '@aegisflow/contracts';

export const KNOWLEDGE_REPOSITORY_PORT = Symbol('KNOWLEDGE_REPOSITORY_PORT');

export interface KnowledgeDocumentSummary {
  chunkCount: number;
  createdAt: string;
  currentVersion: number;
  id: string;
  rejectionReason: string | null;
  sourceType: KnowledgeSourceTypeValue;
  sourceUri: string | null;
  status: KnowledgeDocumentStatusValue;
  title: string;
  trustLevel: KnowledgeTrustLevelValue;
  updatedAt: string;
}

export interface RetrievedKnowledgeChunk {
  content: string;
  documentId: string;
  id: string;
  similarity: number;
  title: string;
  trustLevel: KnowledgeTrustLevelValue;
}

export interface RecommendationSourceValue {
  chunkId: string;
  documentId: string;
  quote: string;
  rank: number;
  similarity: number;
  title: string;
  trustLevel: KnowledgeTrustLevelValue;
}

export interface RecommendationValue {
  answer: string;
  confidence: number;
  createdAt: string;
  id: string;
  incidentId: string | null;
  model: string;
  provider: string;
  question: string;
  recommendedActions: readonly string[];
  sources: readonly RecommendationSourceValue[];
  status: AiRecommendationStatusValue;
}

export interface KnowledgeRepositoryPort {
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
  }): Promise<KnowledgeDocumentSummary>;
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
  }): Promise<KnowledgeDocumentSummary>;
  deleteDocument(input: {
    actorUserId: string;
    documentId: string;
    organizationId: string;
  }): Promise<readonly string[]>;
  listDocuments(organizationId: string): Promise<readonly KnowledgeDocumentSummary[]>;
  listRecommendations(
    organizationId: string,
    incidentId?: string,
  ): Promise<readonly RecommendationValue[]>;
  retrieve(input: {
    embedding: readonly number[];
    embeddingModel: string;
    embeddingProvider: string;
    organizationId: string;
    take: number;
  }): Promise<readonly RetrievedKnowledgeChunk[]>;
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
    sources: readonly Omit<RecommendationSourceValue, 'documentId' | 'title' | 'trustLevel'>[];
    status: AiRecommendationStatusValue;
  }): Promise<RecommendationValue>;
}
