import { describe, expect, it } from 'vitest';

import { HealthState, InvalidHealthStateError } from '../src';

describe('HealthState', () => {
  it('marks up and degraded services as operational', () => {
    expect(HealthState.from('up').isOperational()).toBe(true);
    expect(HealthState.from('degraded').isOperational()).toBe(true);
  });

  it('rejects unknown states', () => {
    expect(() => HealthState.from('unknown')).toThrow(InvalidHealthStateError);
  });
});
