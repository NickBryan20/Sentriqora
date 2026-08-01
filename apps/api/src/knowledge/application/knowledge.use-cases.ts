import type { EmbeddingProvider, LlmProvider } from '@aegisflow/ai';
import type {
  AuthPrincipal,
  CreateKnowledgeDocumentInput,
  CreateKnowledgeVersionInput,
  RequestRecommendationInput,
} from '@aegisflow/contracts';
import { recommendationOutputSchema } from '@aegisflow/contracts';
import { RagSecurityPolicy } from '@aegisflow/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { ApplicationError } from '../../identity/application/application-error';
import { EMBEDDING_PROVIDER_PORT, LLM_PROVIDER_PORT } from './ports/ai-provider.ports';
import {
  KNOWLEDGE_REPOSITORY_PORT,
  type KnowledgeRepositoryPort,
  type RecommendationValue,
  type RetrievedKnowledgeChunk,
} from './ports/knowledge-repository.port';
import { KNOWLEDGE_STORAGE_PORT, type KnowledgeStoragePort } from './ports/knowledge-storage.port';
import { recordRagQuery } from '../../metrics/rag.metrics';

const PROMPT_VERSION = 'rag-recommendation-v1';

@Injectable()
export class KnowledgeUseCases {
  private readonly policy = new RagSecurityPolicy();
  private readonly logger = new Logger(KnowledgeUseCases.name);
  private activeRecommendations = 0;

  constructor(
    @Inject(KNOWLEDGE_REPOSITORY_PORT) private readonly repository: KnowledgeRepositoryPort,
    @Inject(KNOWLEDGE_STORAGE_PORT) private readonly storage: KnowledgeStoragePort,
    @Inject(EMBEDDING_PROVIDER_PORT) private readonly embeddings: EmbeddingProvider,
    @Inject(LLM_PROVIDER_PORT) private readonly llm: LlmProvider,
  ) {}

  listDocuments(principal: AuthPrincipal, organizationId: string) {
    this.assertTenant(principal, organizationId);
    return this.repository.listDocuments(organizationId);
  }

  async createDocument(
    principal: AuthPrincipal,
    organizationId: string,
    input: CreateKnowledgeDocumentInput,
  ) {
    this.assertTenant(principal, organizationId);
    const sanitized = this.policy.sanitizeContext(input.content).trim();
    if (sanitized.length < 40) {
      throw new ApplicationError(
        'validation_failed',
        'The document has no safe indexable text.',
        400,
      );
    }
    const buffer = Buffer.from(sanitized, 'utf8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const objectKey = `${organizationId}/knowledge/${randomUUID()}/v1.txt`;
    await this.storage.put({
      content: sanitized,
      contentType: input.contentType,
      objectKey,
      sha256,
    });
    try {
      return await this.repository.createDocument({
        actorUserId: principal.userId,
        contentType: input.contentType,
        embeddingModel: this.embeddings.model,
        embeddingProvider: this.embeddings.name,
        objectKey,
        organizationId,
        sha256,
        sizeBytes: buffer.byteLength,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri ?? null,
        title: input.title,
        trustLevel: input.trustLevel,
      });
    } catch (error) {
      await this.storage.delete([objectKey]).catch(() => undefined);
      throw error;
    }
  }

  async createVersion(
    principal: AuthPrincipal,
    organizationId: string,
    documentId: string,
    input: CreateKnowledgeVersionInput,
  ) {
    this.assertTenant(principal, organizationId);
    const sanitized = this.policy.sanitizeContext(input.content).trim();
    const buffer = Buffer.from(sanitized, 'utf8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const objectKey = `${organizationId}/knowledge/${documentId}/${randomUUID()}.txt`;
    await this.storage.put({ content: sanitized, contentType: 'text/plain', objectKey, sha256 });
    try {
      return await this.repository.createVersion({
        actorUserId: principal.userId,
        contentType: 'text/plain',
        documentId,
        embeddingModel: this.embeddings.model,
        embeddingProvider: this.embeddings.name,
        objectKey,
        organizationId,
        sha256,
        sizeBytes: buffer.byteLength,
      });
    } catch (error) {
      await this.storage.delete([objectKey]).catch(() => undefined);
      throw error;
    }
  }

  async deleteDocument(principal: AuthPrincipal, organizationId: string, documentId: string) {
    this.assertTenant(principal, organizationId);
    const objectKeys = await this.repository.deleteDocument({
      actorUserId: principal.userId,
      documentId,
      organizationId,
    });
    await this.storage.delete(objectKeys);
    return { deleted: true };
  }

  listRecommendations(principal: AuthPrincipal, organizationId: string, incidentId?: string) {
    this.assertTenant(principal, organizationId);
    return this.repository.listRecommendations(organizationId, incidentId);
  }

  async requestRecommendation(
    principal: AuthPrincipal,
    organizationId: string,
    input: RequestRecommendationInput,
  ): Promise<RecommendationValue> {
    this.assertTenant(principal, organizationId);
    if (this.activeRecommendations >= 3) {
      throw new ApplicationError('rate_limited', 'The recommendation service is at capacity.', 429);
    }
    this.activeRecommendations += 1;
    const started = Date.now();
    try {
      const question = this.policy.sanitizeContext(input.question).trim();
      const embedded = await this.embeddings.embed([question]);
      const queryVector = embedded.vectors[0];
      if (queryVector === undefined) throw new Error('QueryEmbeddingMissing');
      const retrieved = await this.repository.retrieve({
        embedding: queryVector,
        embeddingModel: this.embeddings.model,
        embeddingProvider: this.embeddings.name,
        organizationId,
        take: this.policy.maximumChunks,
      });
      const confidence = this.policy.confidence(retrieved);
      if (this.policy.shouldAbstain(retrieved)) {
        return await this.persistSafeResult({
          answer:
            'No existe evidencia suficiente y verificable en la base de conocimiento para responder. Se requiere revisión humana.',
          confidence,
          embeddedTokens: embedded.inputTokens,
          input,
          latencyMs: Date.now() - started,
          organizationId,
          outputTokens: 0,
          principal,
          providerRequestId: null,
          question,
          recommendedActions: [],
          retrieved: [],
          status: 'ABSTAINED',
        });
      }
      try {
        const contexts = retrieved.map((chunk, index) => ({
          citationId: `src-${index + 1}`,
          content: this.policy.sanitizeContext(chunk.content).slice(0, 1_200),
          title: chunk.title,
          trustLevel: chunk.trustLevel,
        }));
        const generated = await this.llm.generate({
          contexts,
          question,
          safetyIdentifier: createHash('sha256').update(organizationId).digest('hex'),
          timeoutMs: 15_000,
        });
        const output = recommendationOutputSchema.parse(generated.output);
        const allowedCitations = new Set(contexts.map((item) => item.citationId));
        if (
          output.citationIds.some((citation) => !allowedCitations.has(citation)) ||
          (!output.shouldAbstain && output.citationIds.length === 0) ||
          unsafeModelOutput(output.answer, output.recommendedActions)
        ) {
          throw new Error('UnsafeModelOutput');
        }
        const cited = retrieved.filter((_chunk, index) =>
          output.citationIds.includes(`src-${index + 1}`),
        );
        return await this.persistSafeResult({
          answer: output.shouldAbstain
            ? 'El proveedor no encontró respaldo suficiente en las fuentes recuperadas. Se requiere revisión humana.'
            : output.answer,
          confidence: output.shouldAbstain ? 0 : Math.min(confidence, output.confidence),
          embeddedTokens: embedded.inputTokens,
          input,
          latencyMs: Date.now() - started,
          organizationId,
          outputTokens: generated.outputTokens,
          principal,
          providerRequestId: generated.providerRequestId,
          question,
          recommendedActions: output.shouldAbstain ? [] : output.recommendedActions,
          retrieved: output.shouldAbstain ? [] : cited,
          status: output.shouldAbstain ? 'ABSTAINED' : 'GENERATED',
        });
      } catch (error) {
        const failureKind = classifyProviderFailure(error);
        const invalid = failureKind === 'INVALID_OUTPUT';
        this.logger.warn(`AI recommendation failed safely (${failureKind})`);
        return await this.persistSafeResult({
          answer: invalid
            ? 'La salida del proveedor no superó la validación de seguridad. Se requiere revisión humana.'
            : 'El proveedor de IA no está disponible. La gestión manual del incidente continúa operativa.',
          confidence: 0,
          embeddedTokens: embedded.inputTokens,
          input,
          latencyMs: Date.now() - started,
          organizationId,
          outputTokens: 0,
          principal,
          providerRequestId: null,
          question,
          recommendedActions: [],
          retrieved: [],
          status: invalid ? 'INVALID_OUTPUT' : 'PROVIDER_UNAVAILABLE',
        });
      }
    } finally {
      this.activeRecommendations -= 1;
    }
  }

  private async persistSafeResult(input: {
    answer: string;
    confidence: number;
    embeddedTokens: number;
    input: RequestRecommendationInput;
    latencyMs: number;
    organizationId: string;
    outputTokens: number;
    principal: AuthPrincipal;
    providerRequestId: string | null;
    question: string;
    recommendedActions: readonly string[];
    retrieved: readonly RetrievedKnowledgeChunk[];
    status: 'ABSTAINED' | 'GENERATED' | 'INVALID_OUTPUT' | 'PROVIDER_UNAVAILABLE';
  }) {
    const result = await this.repository.saveRecommendation({
      actorUserId: input.principal.userId,
      answer: stripMarkup(input.answer),
      confidence: input.confidence,
      estimatedCostUsd: 0,
      incidentId: input.input.incidentId ?? null,
      inputTokens:
        input.embeddedTokens +
        Math.ceil(input.retrieved.reduce((sum, chunk) => sum + chunk.content.length, 0) / 4),
      latencyMs: input.latencyMs,
      model: this.llm.model,
      organizationId: input.organizationId,
      outputTokens: input.outputTokens,
      promptVersion: PROMPT_VERSION,
      provider: this.llm.name,
      providerRequestId: input.providerRequestId,
      question: input.question,
      recommendedActions: input.recommendedActions.map(stripMarkup),
      sources: input.retrieved.map((chunk, index) => ({
        chunkId: chunk.id,
        quote: chunk.content.slice(0, 1_200),
        rank: index + 1,
        similarity: chunk.similarity,
      })),
      status: input.status,
    });
    recordRagQuery(input.status, input.embeddedTokens, input.outputTokens, input.latencyMs / 1_000);
    return result;
  }

  private assertTenant(principal: AuthPrincipal, organizationId: string): void {
    if (principal.organizationId !== organizationId) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
  }
}

function unsafeModelOutput(answer: string, actions: readonly string[]): boolean {
  const output = [answer, ...actions].join('\n');
  return /<\/?[a-z][^>]*>|https?:\/\/|```|\b(?:curl|wget|powershell|bash|cmd\.exe|SELECT|INSERT|UPDATE|DELETE)\b/iu.test(
    output,
  );
}

function stripMarkup(value: string): string {
  return value.replace(/[<>]/gu, '').trim();
}

function classifyProviderFailure(error: unknown): 'INVALID_OUTPUT' | 'PROVIDER_UNAVAILABLE' {
  if (!(error instanceof Error)) return 'PROVIDER_UNAVAILABLE';
  if (
    error.name === 'SyntaxError' ||
    error.name === 'ZodError' ||
    error.message === 'UnsafeModelOutput' ||
    error.message === 'OpenAiResponseValidationFailed' ||
    error.message === 'OpenAiStructuredOutputInvalidJson' ||
    error.message === 'OpenAiStructuredOutputMissing'
  ) {
    return 'INVALID_OUTPUT';
  }
  return 'PROVIDER_UNAVAILABLE';
}
