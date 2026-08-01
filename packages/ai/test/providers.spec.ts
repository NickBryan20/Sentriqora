import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeterministicProvider,
  EMBEDDING_DIMENSIONS,
  OllamaProvider,
  OpenAiProvider,
} from '../src';

afterEach(() => vi.unstubAllGlobals());

describe('DeterministicProvider', () => {
  it('produces stable normalized vectors with the configured pgvector dimensions', async () => {
    const provider = new DeterministicProvider();
    const first = await provider.embed(['rotate exposed credentials']);
    const second = await provider.embed(['rotate exposed credentials']);
    expect(first.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(first.vectors[0]).toEqual(second.vectors[0]);
  });

  it('emits only supplied citations and never generates executable commands', async () => {
    const provider = new DeterministicProvider();
    const result = await provider.generate({
      contexts: [
        {
          citationId: 'src-1',
          content: 'Rotate the compromised credential and invalidate active sessions.',
          title: 'Runbook',
          trustLevel: 'VERIFIED',
        },
      ],
      question: 'How should this incident be contained?',
      safetyIdentifier: 'tenant-hash',
      timeoutMs: 1_000,
    });
    expect(result.output).toMatchObject({ citationIds: ['src-1'], shouldAbstain: false });
    expect(JSON.stringify(result.output)).not.toContain('curl ');
  });
});

describe('external provider contracts', () => {
  it('uses bounded OpenAI embedding dimensions and Responses structured output', async () => {
    const requests: { body: Record<string, unknown>; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ body, url: String(url) });
        return new Response(
          JSON.stringify(
            String(url).endsWith('/embeddings')
              ? {
                  data: [{ embedding: Array.from<number>({ length: 768 }).fill(0) }],
                  usage: { prompt_tokens: 4 },
                }
              : {
                  id: 'resp-test',
                  output: [
                    {
                      content: [
                        {
                          text: JSON.stringify({
                            answer: 'Rotate the credential [src-1].',
                            citationIds: ['src-1'],
                            confidence: 0.8,
                            recommendedActions: ['Rotate the credential.'],
                            shouldAbstain: false,
                          }),
                          type: 'output_text',
                        },
                      ],
                      type: 'message',
                    },
                  ],
                  usage: { output_tokens: 10 },
                },
          ),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }),
    );
    const provider = new OpenAiProvider({
      openAiApiKey: 'test-key-never-used-outside-unit-tests',
      provider: 'openai',
    });
    const embedding = await provider.embeddingProvider().embed(['credential response']);
    const generated = await provider.generate({
      contexts: [
        { citationId: 'src-1', content: 'Rotate it.', title: 'Runbook', trustLevel: 'VERIFIED' },
      ],
      question: 'What is the response?',
      safetyIdentifier: 'tenant-hash',
      timeoutMs: 1_000,
    });
    expect(embedding.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(requests[0]?.body).toMatchObject({ dimensions: 768, encoding_format: 'float' });
    expect(requests[1]?.body).toMatchObject({
      model: 'gpt-5.6-sol',
      safety_identifier: 'tenant-hash',
      store: false,
    });
    expect(generated.output).toMatchObject({ citationIds: ['src-1'] });
  });

  it('rejects an Ollama embedding model with an incompatible vector space', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ embeddings: [[0, 1, 2]] }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    const provider = new OllamaProvider({ provider: 'ollama' }).embeddingProvider();
    await expect(provider.embed(['bounded input'])).rejects.toThrow(
      'EmbeddingDimensionMismatch:768',
    );
  });
});
