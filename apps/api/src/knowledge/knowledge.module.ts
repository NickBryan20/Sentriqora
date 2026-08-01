import { createEmbeddingProvider, createLlmProvider } from '@aegisflow/ai';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Environment } from '../configuration';
import { IdentityModule } from '../identity/identity.module';
import { KnowledgeUseCases } from './application/knowledge.use-cases';
import { EMBEDDING_PROVIDER_PORT, LLM_PROVIDER_PORT } from './application/ports/ai-provider.ports';
import { KNOWLEDGE_REPOSITORY_PORT } from './application/ports/knowledge-repository.port';
import { KNOWLEDGE_STORAGE_PORT } from './application/ports/knowledge-storage.port';
import { MinioKnowledgeStorageAdapter } from './infrastructure/minio-knowledge-storage.adapter';
import { PrismaKnowledgeRepository } from './infrastructure/prisma-knowledge.repository';
import { KnowledgeController } from './presentation/knowledge.controller';

@Module({
  controllers: [KnowledgeController],
  imports: [IdentityModule],
  providers: [
    KnowledgeUseCases,
    PrismaKnowledgeRepository,
    MinioKnowledgeStorageAdapter,
    { provide: KNOWLEDGE_REPOSITORY_PORT, useExisting: PrismaKnowledgeRepository },
    { provide: KNOWLEDGE_STORAGE_PORT, useExisting: MinioKnowledgeStorageAdapter },
    {
      inject: [ConfigService],
      provide: EMBEDDING_PROVIDER_PORT,
      useFactory: (config: ConfigService<Environment, true>) =>
        createEmbeddingProvider(providerConfiguration(config)),
    },
    {
      inject: [ConfigService],
      provide: LLM_PROVIDER_PORT,
      useFactory: (config: ConfigService<Environment, true>) =>
        createLlmProvider(providerConfiguration(config)),
    },
  ],
})
export class KnowledgeModule {}

function providerConfiguration(config: ConfigService<Environment, true>) {
  return {
    ollamaBaseUrl: config.get('OLLAMA_BASE_URL', { infer: true }),
    ollamaEmbeddingModel: config.get('OLLAMA_EMBEDDING_MODEL', { infer: true }),
    ollamaModel: config.get('OLLAMA_MODEL', { infer: true }),
    openAiApiKey: config.get('OPENAI_API_KEY', { infer: true }),
    openAiBaseUrl: config.get('OPENAI_BASE_URL', { infer: true }),
    openAiEmbeddingModel: config.get('OPENAI_EMBEDDING_MODEL', { infer: true }),
    openAiModel: config.get('OPENAI_MODEL', { infer: true }),
    provider: config.get('AI_PROVIDER', { infer: true }),
  };
}
