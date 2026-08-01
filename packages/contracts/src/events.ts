import { z } from 'zod';

import type { ConnectorTypeValue } from './resources';

export const EVENT_FORMATS = ['JSON', 'CSV'] as const;
export const EVENT_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const RAW_EVENT_STATUSES = [
  'RECEIVED',
  'QUEUED',
  'PROCESSING',
  'NORMALIZED',
  'REJECTED',
  'FAILED',
] as const;
export const MAX_INGRESS_RECORDS = 500;

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9._-]{1,119}$/u;
const SAFE_ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/u;
const JSON_CONTENT_TYPE_PATTERN = /^application\/(?:[a-z0-9.+-]+\+)?json$/u;

const actorSchema = z
  .object({
    device: z.string().trim().min(1).max(200).optional(),
    ip: z.string().trim().min(2).max(64).optional(),
    user: z.string().trim().min(1).max(254).optional(),
  })
  .strict();

const attributesSchema = z.record(z.string().regex(SAFE_ATTRIBUTE_KEY_PATTERN), z.unknown());

export const canonicalEventSchema = z
  .object({
    actor: actorSchema.optional(),
    assetKey: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9._-]{1,63}$/u)
      .optional(),
    attributes: attributesSchema.default({}),
    eventId: z.string().trim().min(1).max(128).optional(),
    eventType: z.string().trim().toLowerCase().regex(EVENT_TYPE_PATTERN),
    message: z.string().trim().max(2_000).default(''),
    occurredAt: z.iso.datetime({ offset: true }),
    severity: z.enum(EVENT_SEVERITIES).default('INFO'),
    sourceEventId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .transform((value) => ({
    actor: value.actor,
    assetKey: value.assetKey,
    attributes: value.attributes,
    eventType: value.eventType,
    message: value.message,
    occurredAt: value.occurredAt,
    severity: value.severity,
    sourceEventId: value.sourceEventId ?? value.eventId,
  }));

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
export type EventFormatValue = (typeof EVENT_FORMATS)[number];
export type EventSeverityValue = (typeof EVENT_SEVERITIES)[number];
export type RawEventStatusValue = (typeof RAW_EVENT_STATUSES)[number];

export const ingressReceiptSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    receiptId: z.uuid(),
    receivedAt: z.iso.datetime({ offset: true }),
    status: z.enum(RAW_EVENT_STATUSES),
  })
  .strict();
export type IngressReceipt = z.infer<typeof ingressReceiptSchema>;

export interface InspectedIngressPayload {
  format: EventFormatValue;
  recordCount: number;
  sourceEventId: string | null;
  text: string;
}

export class EventPayloadValidationError extends Error {
  constructor(
    readonly code:
      | 'content_type_mismatch'
      | 'invalid_csv'
      | 'invalid_json'
      | 'invalid_text_encoding'
      | 'payload_limits_exceeded',
  ) {
    super('The event payload is invalid.');
    this.name = 'EventPayloadValidationError';
  }
}

export function inspectIngressPayload(
  connectorType: ConnectorTypeValue,
  contentTypeHeader: string,
  text: string,
): InspectedIngressPayload {
  const contentType = contentTypeHeader.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const expectedFormat: EventFormatValue = connectorType === 'CSV_IMPORT' ? 'CSV' : 'JSON';
  if (
    (expectedFormat === 'CSV' && contentType !== 'text/csv') ||
    (expectedFormat === 'JSON' && !JSON_CONTENT_TYPE_PATTERN.test(contentType))
  ) {
    throw new EventPayloadValidationError('content_type_mismatch');
  }

  if (expectedFormat === 'CSV') {
    const records = parseCsvEvents(text);
    return {
      format: 'CSV',
      recordCount: records.length,
      sourceEventId: records.length === 1 ? readSourceEventId(records[0]) : null,
      text,
    };
  }

  const parsed = parseJson(text);
  assertJsonLimits(parsed);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length === 0 || records.length > MAX_INGRESS_RECORDS) {
    throw new EventPayloadValidationError('payload_limits_exceeded');
  }
  if (records.some((record) => !isPlainObject(record))) {
    throw new EventPayloadValidationError('invalid_json');
  }
  return {
    format: 'JSON',
    recordCount: records.length,
    sourceEventId: records.length === 1 ? readSourceEventId(records[0]) : null,
    text,
  };
}

export function parseEventCandidates(format: EventFormatValue, text: string): unknown[] {
  if (format === 'CSV') {
    return parseCsvEvents(text);
  }
  const parsed = parseJson(text);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length === 0 || records.length > MAX_INGRESS_RECORDS) {
    throw new EventPayloadValidationError('payload_limits_exceeded');
  }
  return records;
}

export function adaptEventCandidate(
  connectorType: ConnectorTypeValue,
  candidate: unknown,
  receivedAt: Date,
): CanonicalEvent {
  if (connectorType === 'GITHUB' && isPlainObject(candidate) && !('eventType' in candidate)) {
    const action = typeof candidate['action'] === 'string' ? candidate['action'] : 'event';
    const sender = isPlainObject(candidate['sender']) ? candidate['sender'] : {};
    const repository = isPlainObject(candidate['repository']) ? candidate['repository'] : {};
    return canonicalEventSchema.parse({
      actor: typeof sender['login'] === 'string' ? { user: sender['login'] } : undefined,
      attributes: candidate,
      eventId: typeof candidate['deliveryId'] === 'string' ? candidate['deliveryId'] : undefined,
      eventType: `github.${normalizeEventTypeSegment(action)}`,
      message:
        typeof repository['full_name'] === 'string'
          ? `GitHub ${action} on ${repository['full_name']}`
          : `GitHub ${action}`,
      occurredAt: receivedAt.toISOString(),
      severity: 'INFO',
    });
  }
  return canonicalEventSchema.parse(candidate);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EventPayloadValidationError('invalid_json');
  }
}

function assertJsonLimits(value: unknown): void {
  let properties = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 6) {
      throw new EventPayloadValidationError('payload_limits_exceeded');
    }
    if (typeof candidate === 'string' && candidate.length > 10_000) {
      throw new EventPayloadValidationError('payload_limits_exceeded');
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_INGRESS_RECORDS) {
        throw new EventPayloadValidationError('payload_limits_exceeded');
      }
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (isPlainObject(candidate)) {
      for (const [key, entry] of Object.entries(candidate)) {
        properties += 1;
        if (
          properties > 1_000 ||
          !SAFE_ATTRIBUTE_KEY_PATTERN.test(key) ||
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype'
        ) {
          throw new EventPayloadValidationError('payload_limits_exceeded');
        }
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
}

function parseCsvEvents(text: string): Record<string, unknown>[] {
  const rows = parseCsvRows(text);
  const headers = rows.shift();
  if (headers === undefined || headers.length === 0 || rows.length === 0) {
    throw new EventPayloadValidationError('invalid_csv');
  }
  if (
    rows.length > MAX_INGRESS_RECORDS ||
    headers.length > 50 ||
    headers.some((header) => !SAFE_ATTRIBUTE_KEY_PATTERN.test(header)) ||
    new Set(headers).size !== headers.length
  ) {
    throw new EventPayloadValidationError('payload_limits_exceeded');
  }
  const required = ['eventType', 'occurredAt'];
  if (required.some((header) => !headers.includes(header))) {
    throw new EventPayloadValidationError('invalid_csv');
  }
  return rows.map((row) => {
    if (row.length !== headers.length) {
      throw new EventPayloadValidationError('invalid_csv');
    }
    const record: Record<string, unknown> = {};
    const attributes: Record<string, string> = {};
    for (const [index, header] of headers.entries()) {
      const value = row[index] ?? '';
      if (header.startsWith('attribute.')) {
        attributes[header.slice('attribute.'.length)] = value;
      } else if (header === 'actorUser' || header === 'actorIp' || header === 'actorDevice') {
        const actor = (record['actor'] ?? {}) as Record<string, string>;
        actor[header === 'actorUser' ? 'user' : header === 'actorIp' ? 'ip' : 'device'] = value;
        record['actor'] = actor;
      } else if (value !== '') {
        record[header] = value;
      }
    }
    record['attributes'] = attributes;
    return record;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n') {
      row.push(field.trim());
      if (row.some((entry) => entry.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (quoted) {
    throw new EventPayloadValidationError('invalid_csv');
  }
  row.push(field.trim());
  if (row.some((entry) => entry.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function readSourceEventId(candidate: unknown): string | null {
  if (!isPlainObject(candidate)) {
    return null;
  }
  const value = candidate['sourceEventId'] ?? candidate['eventId'];
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function normalizeEventTypeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
  return normalized.length >= 1 ? normalized.slice(0, 100) : 'event';
}
