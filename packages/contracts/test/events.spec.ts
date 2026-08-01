import { describe, expect, it } from 'vitest';

import {
  adaptEventCandidate,
  EventPayloadValidationError,
  inspectIngressPayload,
  parseEventCandidates,
} from '../src/events';

describe('event ingestion contracts', () => {
  it('inspects and adapts canonical JSON arrays', () => {
    const text = JSON.stringify([
      {
        eventId: 'source-1',
        eventType: 'authentication.failed',
        occurredAt: '2026-07-31T12:00:00.000Z',
        severity: 'HIGH',
      },
    ]);
    expect(
      inspectIngressPayload('SIMULATOR', 'application/json; charset=utf-8', text),
    ).toMatchObject({ format: 'JSON', recordCount: 1, sourceEventId: 'source-1' });
    const candidate = parseEventCandidates('JSON', text)[0];
    expect(adaptEventCandidate('SIMULATOR', candidate, new Date())).toMatchObject({
      eventType: 'authentication.failed',
      severity: 'HIGH',
    });
  });

  it('parses bounded CSV data into canonical candidates', () => {
    const text = [
      'eventType,occurredAt,severity,actorUser,attribute.source',
      'deployment.completed,2026-07-31T12:00:00.000Z,INFO,user@example.test,ci',
    ].join('\n');
    const inspection = inspectIngressPayload('CSV_IMPORT', 'text/csv', text);
    expect(inspection).toMatchObject({ format: 'CSV', recordCount: 1 });
    expect(
      adaptEventCandidate('CSV_IMPORT', parseEventCandidates('CSV', text)[0], new Date()),
    ).toMatchObject({ eventType: 'deployment.completed' });
  });

  it('rejects content-type confusion and excessively deep JSON', () => {
    expect(() => inspectIngressPayload('SIMULATOR', 'text/csv', '{}')).toThrow(
      EventPayloadValidationError,
    );
    const deep = { eventType: 'test.event', occurredAt: '2026-07-31T12:00:00.000Z' } as Record<
      string,
      unknown
    >;
    let cursor = deep;
    for (let index = 0; index < 8; index += 1) {
      const next: Record<string, unknown> = {};
      cursor['nested'] = next;
      cursor = next;
    }
    expect(() =>
      inspectIngressPayload('SIMULATOR', 'application/json', JSON.stringify(deep)),
    ).toThrow(EventPayloadValidationError);
  });
});
