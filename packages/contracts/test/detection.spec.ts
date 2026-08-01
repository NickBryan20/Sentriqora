import { describe, expect, it } from 'vitest';

import { createDetectionRuleSchema, suppressAlertSchema } from '../src';

describe('detection contracts', () => {
  it('accepts deterministic bounded rule definitions', () => {
    expect(
      createDetectionRuleSchema.parse({
        condition: {
          attributes: [{ operator: 'EQUALS', path: 'result', value: 'denied' }],
          eventTypes: ['authentication.failed'],
        },
        correlationDimensions: ['ACTOR_USER'],
        key: 'authentication.failed-burst',
        name: 'Authentication failure burst',
        severity: 'HIGH',
        threshold: 5,
        windowSeconds: 300,
      }),
    ).toMatchObject({ deduplicationWindowSeconds: 900, enabled: false });
  });

  it('rejects empty rules and unbounded suppression input', () => {
    expect(() =>
      createDetectionRuleSchema.parse({
        condition: { attributes: [] },
        key: 'empty-rule',
        name: 'Empty rule',
        severity: 'LOW',
      }),
    ).toThrow();
    expect(() =>
      suppressAlertSchema.parse({ reason: 'x', suppressedUntil: 'invalid', version: 1 }),
    ).toThrow();
  });
});
