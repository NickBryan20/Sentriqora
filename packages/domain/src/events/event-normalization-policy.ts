const SECRET_KEY_PATTERN =
  /(api.?key|authorization|cookie|credential|password|private.?key|recovery|secret|session|token)/iu;
const USER_KEY_PATTERN = /(email|login|user|username)/iu;
const IP_KEY_PATTERN = /(^|[._-])(client.?ip|ip|remote.?address|source.?ip)($|[._-])/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const TOKEN_VALUE_PATTERN =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|(?:token|password|secret)\s*[:=]\s*\S+)/giu;

export interface EventCandidateForNormalization {
  actor?:
    { device?: string | undefined; ip?: string | undefined; user?: string | undefined } | undefined;
  assetKey?: string | undefined;
  attributes: Record<string, unknown>;
  eventType: string;
  message: string;
  occurredAt: string;
  severity: 'CRITICAL' | 'HIGH' | 'INFO' | 'LOW' | 'MEDIUM';
  sourceEventId?: string | undefined;
}

export interface NormalizedEventValue {
  actorUserHash: string | null;
  assetKey: string | null;
  attributes: Record<string, unknown>;
  eventType: string;
  fingerprint: string;
  message: string;
  occurredAt: Date;
  recordIndex: number;
  severity: EventCandidateForNormalization['severity'];
  sourceEventId: string | null;
  sourceIpHash: string | null;
}

export class EventNormalizationError extends Error {
  constructor(readonly code: 'invalid_event_time' | 'unsafe_event_attribute') {
    super('The event could not be normalized.');
    this.name = 'EventNormalizationError';
  }
}

export class EventNormalizationPolicy {
  normalize(
    candidate: EventCandidateForNormalization,
    recordIndex: number,
    receivedAt: Date,
    pseudonymize: (value: string) => string,
  ): NormalizedEventValue {
    const occurredAt = new Date(candidate.occurredAt);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.getTime() > receivedAt.getTime() + 5 * 60_000 ||
      occurredAt.getTime() < receivedAt.getTime() - 400 * 24 * 60 * 60_000
    ) {
      throw new EventNormalizationError('invalid_event_time');
    }
    const actorUserHash =
      candidate.actor?.user === undefined
        ? null
        : pseudonymize(`event-user:${candidate.actor.user.trim().toLowerCase()}`);
    const sourceIpHash =
      candidate.actor?.ip === undefined
        ? null
        : pseudonymize(`event-ip:${candidate.actor.ip.trim().toLowerCase()}`);
    const attributes = this.maskObject(candidate.attributes, pseudonymize, 0);
    if (candidate.actor?.device !== undefined) {
      attributes['actorDevice'] = this.maskString(candidate.actor.device, pseudonymize);
    }
    const message = this.maskString(candidate.message, pseudonymize).slice(0, 2_000);
    const sourceEventId = candidate.sourceEventId ?? null;
    const fingerprint = pseudonymize(
      stableStringify({
        actorUserHash,
        attributes,
        eventType: candidate.eventType,
        occurredAt: occurredAt.toISOString(),
        sourceEventId,
        sourceIpHash,
      }),
    );
    return {
      actorUserHash,
      assetKey: candidate.assetKey ?? null,
      attributes,
      eventType: candidate.eventType,
      fingerprint,
      message,
      occurredAt,
      recordIndex,
      severity: candidate.severity,
      sourceEventId,
      sourceIpHash,
    };
  }

  private maskObject(
    candidate: Record<string, unknown>,
    pseudonymize: (value: string) => string,
    depth: number,
  ): Record<string, unknown> {
    if (depth > 6) {
      throw new EventNormalizationError('unsafe_event_attribute');
    }
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(candidate)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new EventNormalizationError('unsafe_event_attribute');
      }
      if (SECRET_KEY_PATTERN.test(key)) {
        masked[key] = '[REDACTED]';
      } else if (USER_KEY_PATTERN.test(key) && typeof value === 'string') {
        masked[key] = `user:${pseudonymize(`event-user:${value.toLowerCase()}`).slice(0, 16)}`;
      } else if (IP_KEY_PATTERN.test(key) && typeof value === 'string') {
        masked[key] = `ip:${pseudonymize(`event-ip:${value.toLowerCase()}`).slice(0, 16)}`;
      } else {
        masked[key] = this.maskValue(value, pseudonymize, depth + 1);
      }
    }
    return masked;
  }

  private maskValue(
    value: unknown,
    pseudonymize: (value: string) => string,
    depth: number,
  ): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return this.maskString(value, pseudonymize);
    }
    if (Array.isArray(value)) {
      if (depth > 6 || value.length > 500) {
        throw new EventNormalizationError('unsafe_event_attribute');
      }
      return value.map((entry) => this.maskValue(entry, pseudonymize, depth + 1));
    }
    if (typeof value === 'object') {
      return this.maskObject(value as Record<string, unknown>, pseudonymize, depth);
    }
    throw new EventNormalizationError('unsafe_event_attribute');
  }

  private maskString(value: string, pseudonymize: (value: string) => string): string {
    return value
      .replace(TOKEN_VALUE_PATTERN, '[REDACTED]')
      .replace(
        EMAIL_PATTERN,
        (email) => `email:${pseudonymize(`event-email:${email}`).slice(0, 16)}`,
      )
      .replace(IPV4_PATTERN, (ip) => `ip:${pseudonymize(`event-ip:${ip}`).slice(0, 16)}`)
      .slice(0, 10_000);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}
