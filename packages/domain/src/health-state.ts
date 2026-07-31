export const HEALTH_STATES = ['up', 'degraded', 'down'] as const;

export type HealthStateValue = (typeof HEALTH_STATES)[number];

function isHealthStateValue(value: string): value is HealthStateValue {
  return HEALTH_STATES.some((candidate) => candidate === value);
}

export class HealthState {
  readonly value: HealthStateValue;

  private constructor(value: HealthStateValue) {
    this.value = value;
  }

  static from(value: string): HealthState {
    if (!isHealthStateValue(value)) {
      throw new InvalidHealthStateError(value);
    }

    return new HealthState(value);
  }

  isOperational(): boolean {
    return this.value !== 'down';
  }
}

export class InvalidHealthStateError extends Error {
  constructor(value: string) {
    super(`Invalid health state: ${value}`);
    this.name = 'InvalidHealthStateError';
  }
}
