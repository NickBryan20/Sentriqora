import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkApiHealth } from '../src/health-client';

describe('checkApiHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates the API response contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            service: 'aegisflow-api',
            status: 'up',
            timestamp: '2026-07-31T12:00:00.000Z',
            version: '0.1.0',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(checkApiHealth('http://localhost:3001/api/v1')).resolves.toMatchObject({
      status: 'up',
    });
  });
});
