import type { EmbeddingProvider, LlmProvider } from '@aegisflow/ai';

export const EMBEDDING_PROVIDER_PORT = Symbol('EMBEDDING_PROVIDER_PORT');
export const LLM_PROVIDER_PORT = Symbol('LLM_PROVIDER_PORT');

export type { EmbeddingProvider, LlmProvider };
