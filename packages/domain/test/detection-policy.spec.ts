import { describe, expect, it } from 'vitest';

import { AnomalyScoringPolicy, DetectionRuleFactory } from '../src';

const event = {
  actorUserHash: 'a'.repeat(64),
  assetId: '7ca18aa0-ad40-4d96-a271-c7f06be9822e',
  attributes: { attempts: 7, result: 'denied' },
  eventType: 'authentication.failed',
  fingerprint: 'f'.repeat(64),
  message: 'Multiple failures detected',
  occurredAt: new Date('2026-08-01T12:04:00.000Z'),
  severity: 'HIGH' as const,
  sourceIpHash: 'b'.repeat(64),
};

describe('deterministic detection policy', () => {
  it('evaluates bounded conditions and produces stable window deduplication keys', () => {
    const rule = new DetectionRuleFactory().create({
      condition: {
        attributes: [{ operator: 'GTE', path: 'attempts', value: 5 }],
        eventTypes: ['authentication.failed'],
        severities: ['HIGH', 'CRITICAL'],
      },
      correlationDimensions: ['ACTOR_USER', 'SOURCE_IP'],
      deduplicationWindowSeconds: 900,
      id: 'b327049a-1df5-4253-bd11-48e96e4f7693',
      severity: 'HIGH',
      threshold: 3,
      version: 1,
      windowSeconds: 300,
    });
    expect(rule.matches(event)).toBe(true);
    expect(rule.correlationKey(event)).not.toContain('Multiple failures');
    expect(rule.deduplicationKey(event)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      rule.deduplicationKey({ ...event, occurredAt: new Date('2026-08-01T12:10:00.000Z') }),
    ).toBe(rule.deduplicationKey(event));
  });

  it('calculates z-score, moving average and bounded risk deterministically', () => {
    const policy = new AnomalyScoringPolicy();
    const score = policy.calculate([1, 1, 2, 1, 1, 2], 12);
    expect(score.isAnomalous).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(3);
    expect(score.movingAverage).toBeCloseTo(4 / 3);
    expect(policy.riskScore('CRITICAL', 20, 3, score.score)).toBe(100);
  });
});
