import { z } from 'zod';

export const KNOWLEDGE_TRUST_LEVELS = ['UNTRUSTED', 'INTERNAL', 'VERIFIED'] as const;
export const KNOWLEDGE_SOURCE_TYPES = ['MANUAL', 'RUNBOOK', 'POLICY', 'VENDOR'] as const;
export const KNOWLEDGE_DOCUMENT_STATUSES = [
  'PENDING',
  'INDEXING',
  'INDEXED',
  'REJECTED',
  'DELETED',
] as const;
export const AI_RECOMMENDATION_STATUSES = [
  'GENERATED',
  'ABSTAINED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_OUTPUT',
] as const;
export const KNOWLEDGE_CONTENT_TYPES = ['text/plain', 'text/markdown'] as const;
export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 256 * 1024;

export const createKnowledgeDocumentSchema = z
  .object({
    content: z.string().trim().min(40).max(MAX_KNOWLEDGE_DOCUMENT_BYTES),
    contentType: z.enum(KNOWLEDGE_CONTENT_TYPES),
    sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
    sourceUri: z.url().max(500).nullable().optional(),
    title: z.string().trim().min(3).max(180),
    trustLevel: z.enum(KNOWLEDGE_TRUST_LEVELS),
  })
  .strict();

export const createKnowledgeVersionSchema = z
  .object({ content: z.string().trim().min(40).max(MAX_KNOWLEDGE_DOCUMENT_BYTES) })
  .strict();

export const requestRecommendationSchema = z
  .object({
    incidentId: z.uuid().nullable().optional(),
    question: z.string().trim().min(8).max(2_000),
  })
  .strict();

export const recommendationOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(6_000),
    citationIds: z.array(z.string().trim().min(1).max(80)).max(8),
    confidence: z.number().min(0).max(1),
    recommendedActions: z.array(z.string().trim().min(1).max(500)).max(8),
    shouldAbstain: z.boolean(),
  })
  .strict();

export type AiRecommendationStatusValue = (typeof AI_RECOMMENDATION_STATUSES)[number];
export type CreateKnowledgeDocumentInput = z.infer<typeof createKnowledgeDocumentSchema>;
export type CreateKnowledgeVersionInput = z.infer<typeof createKnowledgeVersionSchema>;
export type KnowledgeContentTypeValue = (typeof KNOWLEDGE_CONTENT_TYPES)[number];
export type KnowledgeDocumentStatusValue = (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];
export type KnowledgeSourceTypeValue = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export type KnowledgeTrustLevelValue = (typeof KNOWLEDGE_TRUST_LEVELS)[number];
export type RecommendationOutput = z.infer<typeof recommendationOutputSchema>;
export type RequestRecommendationInput = z.infer<typeof requestRecommendationSchema>;
