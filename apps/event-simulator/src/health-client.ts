import { healthResponseSchema, type HealthResponse } from '@aegisflow/contracts';

export async function checkApiHealth(baseUrl: string, timeoutMs = 3_000): Promise<HealthResponse> {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const response = await fetch(`${normalizedBaseUrl}/health/live`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`AegisFlow API health check failed with HTTP ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
