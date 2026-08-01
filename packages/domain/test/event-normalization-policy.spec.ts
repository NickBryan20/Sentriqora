import { describe, expect, it } from 'vitest';

import { EventNormalizationError, EventNormalizationPolicy } from '../src';

const policy = new EventNormalizationPolicy();
const hash = (value: string) =>
  Array.from({ length: 64 }, (_, index) =>
    ((value.charCodeAt(index % value.length) + index) % 16).toString(16),
  ).join('');

describe('EventNormalizationPolicy', () => {
  it('masks secrets, email and IP while preserving useful correlation hashes', () => {
    const normalized = policy.normalize(
      {
        actor: { device: 'workstation-7', ip: '203.0.113.25', user: 'alice@example.test' },
        assetKey: 'payments-api',
        attributes: {
          authorization: 'Bearer sensitive-token',
          nested: { clientIp: '198.51.100.9', email: 'bob@example.test' },
        },
        eventType: 'authentication.failed',
        message: 'Login for alice@example.test from 203.0.113.25 token=secret-value',
        occurredAt: '2026-07-31T12:00:00.000Z',
        severity: 'HIGH',
        sourceEventId: 'event-001',
      },
      0,
      new Date('2026-07-31T12:00:01.000Z'),
      hash,
    );

    expect(normalized.actorUserHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(normalized.sourceIpHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(normalized.attributes).toMatchObject({ authorization: '[REDACTED]' });
    expect(JSON.stringify(normalized)).not.toContain('alice@example.test');
    expect(JSON.stringify(normalized)).not.toContain('203.0.113.25');
    expect(JSON.stringify(normalized)).not.toContain('sensitive-token');
  });

  it('creates the same fingerprint for the same semantic event', () => {
    const input = {
      attributes: { result: 'denied' },
      eventType: 'authentication.failed',
      message: 'Denied',
      occurredAt: '2026-07-31T12:00:00.000Z',
      severity: 'MEDIUM' as const,
    };
    const first = policy.normalize(input, 0, new Date('2026-07-31T12:00:01.000Z'), hash);
    const second = policy.normalize(input, 1, new Date('2026-07-31T12:00:01.000Z'), hash);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('rejects events outside the accepted time window', () => {
    expect(() =>
      policy.normalize(
        {
          attributes: {},
          eventType: 'system.clock-skew',
          message: '',
          occurredAt: '2027-01-01T00:00:00.000Z',
          severity: 'INFO',
        },
        0,
        new Date('2026-07-31T12:00:00.000Z'),
        hash,
      ),
    ).toThrow(EventNormalizationError);
  });
});
