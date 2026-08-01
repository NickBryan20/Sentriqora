import { canonicalEventSchema } from '@aegisflow/contracts';
import { describe, expect, it } from 'vitest';

import { generateEvent } from '../src/event-generator';

describe('generateEvent', () => {
  it('generates canonical events with unique source identifiers', () => {
    const first = generateEvent(0, new Date('2026-07-31T12:00:00.000Z'));
    const second = generateEvent(1, new Date('2026-07-31T12:00:00.000Z'));
    expect(canonicalEventSchema.parse(first)).toEqual(first);
    expect(first.sourceEventId).not.toBe(second.sourceEventId);
  });
});
