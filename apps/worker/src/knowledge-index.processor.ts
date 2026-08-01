import type { EmbeddingProvider } from '@aegisflow/ai';
import { RagSecurityPolicy } from '@aegisflow/domain';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

import { withTenantTransaction } from './database';
import type { KnowledgeIndexJob } from './outbox-dispatcher';
import { recordKnowledgeIndex } from './detection.metrics';

interface VersionRow {
  current_version: number;
  document_status: string;
  embedding_model: string;
  embedding_provider: string;
  object_key: string;
  sha256: string;
  size_bytes: number;
  version: number;
}

export interface KnowledgeObjectReader {
  read(input: { objectKey: string; sha256: string; sizeBytes: number }): Promise<string>;
}

export class KnowledgeIndexProcessor {
  private readonly policy = new RagSecurityPolicy();

  constructor(
    private readonly pool: Pool,
    private readonly embeddings: EmbeddingProvider,
    private readonly storage: KnowledgeObjectReader,
    private readonly logger: Logger,
  ) {}

  async process(job: KnowledgeIndexJob): Promise<{ chunks: number; indexed: boolean }> {
    const version = await withTenantTransaction(this.pool, job.organizationId, async (client) => {
      const result = await client.query<VersionRow>(
        `SELECT version.version, version.object_key, version.size_bytes, version.sha256,
                version.embedding_provider, version.embedding_model,
                document.current_version, document.status AS document_status
         FROM knowledge_document_versions AS version
         JOIN knowledge_documents AS document
           ON document.id = version.document_id AND document.organization_id = version.organization_id
         WHERE version.organization_id = $1 AND version.id = $2 AND version.document_id = $3
         FOR UPDATE OF document`,
        [job.organizationId, job.versionId, job.documentId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('KnowledgeVersionNotFound');
      if (row.current_version !== job.version || row.version !== job.version) {
        return null;
      }
      if (row.document_status === 'DELETED') return null;
      if (
        row.embedding_provider !== this.embeddings.name ||
        row.embedding_model !== this.embeddings.model
      ) {
        await client.query(
          `UPDATE knowledge_documents
           SET status = 'REJECTED', rejection_reason = 'embedding_provider_mismatch', updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.documentId, job.organizationId],
        );
        throw new Error('EmbeddingProviderMismatch');
      }
      await client.query(
        `UPDATE knowledge_documents
         SET status = 'INDEXING', rejection_reason = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [job.documentId, job.organizationId],
      );
      return row;
    });
    if (version === null) return { chunks: 0, indexed: false };

    try {
      const content = await this.storage.read({
        objectKey: version.object_key,
        sha256: version.sha256,
        sizeBytes: version.size_bytes,
      });
      const chunks = this.policy.chunk(content);
      if (chunks.length === 0) throw new Error('KnowledgeDocumentEmpty');
      const result = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
      if (result.vectors.length !== chunks.length) throw new Error('EmbeddingCountMismatch');
      await withTenantTransaction(this.pool, job.organizationId, async (client) => {
        const current = await client.query<{ current_version: number; status: string }>(
          `SELECT current_version, status FROM knowledge_documents
           WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
          [job.documentId, job.organizationId],
        );
        const document = current.rows[0];
        if (
          document === undefined ||
          document.status === 'DELETED' ||
          document.current_version !== job.version
        ) {
          return;
        }
        await client.query(
          'DELETE FROM knowledge_chunks WHERE organization_id = $1 AND version_id = $2',
          [job.organizationId, job.versionId],
        );
        for (const [index, chunk] of chunks.entries()) {
          const vector = result.vectors[index];
          if (vector === undefined) throw new Error('EmbeddingMissing');
          await client.query(
            `INSERT INTO knowledge_chunks (
               organization_id, document_id, version_id, ordinal, content,
               token_estimate, content_hash, embedding
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
            [
              job.organizationId,
              job.documentId,
              job.versionId,
              chunk.ordinal,
              chunk.content,
              chunk.tokenEstimate,
              createHash('sha256').update(chunk.content).digest('hex'),
              `[${vector.join(',')}]`,
            ],
          );
        }
        await client.query(
          `UPDATE knowledge_document_versions SET indexed_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.versionId, job.organizationId],
        );
        await client.query(
          `UPDATE knowledge_documents
           SET status = 'INDEXED', rejection_reason = NULL, updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.documentId, job.organizationId],
        );
        await client.query(
          `INSERT INTO event_records (
             organization_id, action, target_type, target_id, outcome, correlation_id, metadata
           ) VALUES ($1, 'knowledge_document.indexed', 'knowledge_document', $2,
                     'success', 'worker-secure-rag', $3::jsonb)`,
          [
            job.organizationId,
            job.documentId,
            JSON.stringify({
              chunks: chunks.length,
              embeddingModel: this.embeddings.model,
              embeddingProvider: this.embeddings.name,
              inputTokens: result.inputTokens,
              version: job.version,
            }),
          ],
        );
      });
      recordKnowledgeIndex('indexed', chunks.length, result.inputTokens);
      this.logger.info(
        {
          chunks: chunks.length,
          documentId: job.documentId,
          embeddingModel: this.embeddings.model,
          organizationId: job.organizationId,
          version: job.version,
        },
        'Knowledge document indexed',
      );
      return { chunks: chunks.length, indexed: true };
    } catch (error) {
      await withTenantTransaction(this.pool, job.organizationId, async (client) => {
        await client.query(
          `UPDATE knowledge_documents
           SET status = CASE WHEN status = 'DELETED' THEN status ELSE 'PENDING'::knowledge_document_status END,
               rejection_reason = CASE WHEN status = 'DELETED' THEN rejection_reason ELSE $3 END,
               updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.documentId, job.organizationId, errorName(error).slice(0, 100)],
        );
      });
      recordKnowledgeIndex('failed', 0, 0);
      throw error;
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.message || error.name : 'UnknownError';
}
