import { describe, expect, it } from 'vitest';

import { processSystemHealthJob } from '../src/system-health.processor';

describe('processSystemHealthJob', () => {
  it('validates and preserves the correlation id', () => {
    expect(
      processSystemHealthJob({
        correlationId: 'correlation-1234',
        requestedAt: '2026-07-31T12:00:00.000Z',
      }),
    ).toMatchObject({ correlationId: 'correlation-1234', status: 'processed' });
  });

  it('rejects malformed jobs', () => {
    expect(() => processSystemHealthJob({ correlationId: 'short' })).toThrow();
  });
});
