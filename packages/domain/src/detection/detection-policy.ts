import { createHash } from 'node:crypto';

export type EventSeverityValue = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CorrelationDimensionValue =
  'ACTOR_USER' | 'SOURCE_IP' | 'ASSET' | 'EVENT_TYPE' | 'FINGERPRINT';
export type DetectionOperatorValue = 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GTE' | 'LTE';
export interface DetectionRuleCondition {
  assetIds?: string[] | undefined;
  attributes: {
    operator: DetectionOperatorValue;
    path: string;
    value: string | number | boolean;
  }[];
  eventTypes?: string[] | undefined;
  messageContains?: string | undefined;
  severities?: EventSeverityValue[] | undefined;
}

export interface DetectionEvent {
  assetId: string | null;
  actorUserHash: string | null;
  attributes: Readonly<Record<string, unknown>>;
  eventType: string;
  fingerprint: string;
  message: string;
  occurredAt: Date;
  severity: EventSeverityValue;
  sourceIpHash: string | null;
}

export interface DetectionRuleDefinition {
  condition: DetectionRuleCondition;
  correlationDimensions: readonly CorrelationDimensionValue[];
  deduplicationWindowSeconds: number;
  id: string;
  severity: EventSeverityValue;
  threshold: number;
  version: number;
  windowSeconds: number;
}

export interface AnomalyResult {
  baselineMean: number;
  baselineStdDev: number;
  isAnomalous: boolean;
  movingAverage: number;
  observedValue: number;
  score: number;
}

const SEVERITY_SCORE: Readonly<Record<EventSeverityValue, number>> = {
  CRITICAL: 95,
  HIGH: 75,
  INFO: 10,
  LOW: 25,
  MEDIUM: 50,
};

export class DetectionRuleFactory {
  create(definition: DetectionRuleDefinition): DeterministicDetectionRule {
    if (definition.threshold < 1 || definition.windowSeconds < 60) {
      throw new Error('InvalidDetectionRule');
    }
    return new DeterministicDetectionRule(definition);
  }
}

export class DeterministicDetectionRule {
  constructor(readonly definition: DetectionRuleDefinition) {}

  matches(event: DetectionEvent): boolean {
    const condition = this.definition.condition;
    return (
      includesOptional(condition.assetIds, event.assetId) &&
      includesOptional(condition.eventTypes, event.eventType) &&
      includesOptional(condition.severities, event.severity) &&
      (condition.messageContains === undefined ||
        event.message
          .toLocaleLowerCase('en-US')
          .includes(condition.messageContains.toLocaleLowerCase('en-US'))) &&
      condition.attributes.every((candidate) =>
        compare(readPath(event.attributes, candidate.path), candidate.operator, candidate.value),
      )
    );
  }

  correlationKey(event: DetectionEvent): string {
    const parts = this.definition.correlationDimensions.map((dimension) =>
      correlationValue(dimension, event),
    );
    return parts.join('|');
  }

  deduplicationKey(event: DetectionEvent): string {
    const windowMilliseconds = this.definition.deduplicationWindowSeconds * 1_000;
    const bucket = Math.floor(event.occurredAt.getTime() / windowMilliseconds);
    return createHash('sha256')
      .update(
        `${this.definition.id}:${this.definition.version}:${this.correlationKey(event)}:${bucket}`,
      )
      .digest('hex');
  }
}

export class AnomalyScoringPolicy {
  calculate(history: readonly number[], observedValue: number): AnomalyResult {
    const values = history.length === 0 ? [0] : history;
    const baselineMean = values.reduce((total, value) => total + value, 0) / values.length;
    const variance =
      values.reduce((total, value) => total + (value - baselineMean) ** 2, 0) / values.length;
    const baselineStdDev = Math.sqrt(variance);
    const rawScore =
      baselineStdDev === 0
        ? observedValue > baselineMean
          ? 5
          : 0
        : (observedValue - baselineMean) / baselineStdDev;
    const score = Math.max(0, Math.min(10, rawScore));
    return {
      baselineMean,
      baselineStdDev,
      isAnomalous: score >= 3,
      movingAverage:
        values.slice(-6).reduce((total, value) => total + value, 0) / Math.min(6, values.length),
      observedValue,
      score,
    };
  }

  riskScore(
    severity: EventSeverityValue,
    observedCount: number,
    threshold: number,
    anomaly: number,
  ): number {
    return Math.min(
      100,
      (SEVERITY_SCORE[severity] ?? 0) +
        Math.min(15, Math.max(0, observedCount - threshold) * 3) +
        Math.min(10, anomaly * 2),
    );
  }
}

function includesOptional<T>(values: readonly T[] | undefined, value: T | null): boolean {
  return values === undefined || (value !== null && values.includes(value));
}

function readPath(value: Readonly<Record<string, unknown>>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    return Object.prototype.hasOwnProperty.call(current, segment)
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, value);
}

function compare(
  actual: unknown,
  operator: DetectionOperatorValue,
  expected: string | number | boolean,
): boolean {
  if (operator === 'EQUALS') return actual === expected;
  if (operator === 'NOT_EQUALS') return actual !== expected;
  if (operator === 'CONTAINS') {
    return (
      typeof actual === 'string' &&
      actual.toLocaleLowerCase('en-US').includes(String(expected).toLocaleLowerCase('en-US'))
    );
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  return operator === 'GTE' ? actual >= expected : actual <= expected;
}

function correlationValue(dimension: CorrelationDimensionValue, event: DetectionEvent): string {
  switch (dimension) {
    case 'ACTOR_USER':
      return `user:${event.actorUserHash ?? 'unknown'}`;
    case 'ASSET':
      return `asset:${event.assetId ?? 'unknown'}`;
    case 'EVENT_TYPE':
      return `type:${event.eventType}`;
    case 'FINGERPRINT':
      return `fingerprint:${event.fingerprint}`;
    case 'SOURCE_IP':
      return `ip:${event.sourceIpHash ?? 'unknown'}`;
    default:
      throw new Error('UnsupportedCorrelationDimension');
  }
}
