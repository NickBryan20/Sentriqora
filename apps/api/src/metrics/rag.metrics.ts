import { Counter, Histogram, register } from 'prom-client';

const queries =
  (register.getSingleMetric<'status'>('aegisflow_rag_queries_total') as
    Counter<'status'> | undefined) ??
  new Counter({
    help: 'RAG queries completed by validated outcome.',
    labelNames: ['status'] as const,
    name: 'aegisflow_rag_queries_total',
  });
const tokens =
  (register.getSingleMetric<'direction'>('aegisflow_rag_tokens_total') as
    Counter<'direction'> | undefined) ??
  new Counter({
    help: 'Approximate RAG input and provider output tokens.',
    labelNames: ['direction'] as const,
    name: 'aegisflow_rag_tokens_total',
  });
const latency =
  (register.getSingleMetric('aegisflow_rag_query_duration_seconds') as Histogram | undefined) ??
  new Histogram({
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    help: 'End-to-end RAG query latency in seconds.',
    name: 'aegisflow_rag_query_duration_seconds',
  });

export function recordRagQuery(
  status: string,
  inputTokens: number,
  outputTokens: number,
  seconds: number,
): void {
  queries.inc({ status });
  tokens.inc({ direction: 'input' }, inputTokens);
  tokens.inc({ direction: 'output' }, outputTokens);
  latency.observe(seconds);
}
