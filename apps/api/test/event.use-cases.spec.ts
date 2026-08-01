import type { AuthPrincipal } from '@aegisflow/contracts';
import { describe, expect, it, vi } from 'vitest';

import { EventUseCases } from '../src/events/application/event.use-cases';
import type { EventRepositoryPort } from '../src/events/application/ports/event-repository.port';

const organizationId = '019fb917-863a-7742-95a9-b269bfd51066';
const principal: AuthPrincipal = {
  mfaVerified: true,
  organizationId,
  permissions: ['event.read'],
  sessionId: '019fb917-863a-7742-95a9-b269bfd51067',
  userId: '019fb917-863a-7742-95a9-b269bfd51068',
};

describe('EventUseCases', () => {
  it('produces and consumes a stable opaque cursor', async () => {
    const listEvents = vi.fn().mockResolvedValueOnce([
      {
        asset: null,
        attributes: {},
        connector: {
          id: '019fb917-863a-7742-95a9-b269bfd51069',
          key: 'source',
          name: 'Source',
        },
        eventType: 'test.event',
        fingerprint: 'f'.repeat(64),
        id: '019fb917-863a-7742-95a9-b269bfd51070',
        message: '',
        occurredAt: '2026-07-31T12:00:00.000Z',
        receivedAt: '2026-07-31T12:00:01.000Z',
        severity: 'INFO',
        sourceEventId: null,
      },
    ]);
    const repository = { findReceipt: vi.fn(), listEvents } as unknown as EventRepositoryPort;
    const useCases = new EventUseCases(repository);
    const first = await useCases.listEvents(principal, organizationId, { limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    if (first.nextCursor === null) throw new Error('Expected a pagination cursor');
    listEvents.mockResolvedValueOnce([]);
    await useCases.listEvents(principal, organizationId, {
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(listEvents).toHaveBeenLastCalledWith(
      organizationId,
      principal.userId,
      expect.objectContaining({
        cursor: {
          id: '019fb917-863a-7742-95a9-b269bfd51070',
          occurredAt: new Date('2026-07-31T12:00:00.000Z'),
        },
      }),
    );
  });

  it('rejects invalid cursors and query windows longer than 31 days', async () => {
    const repository = {
      findReceipt: vi.fn(),
      listEvents: vi.fn(),
    } as unknown as EventRepositoryPort;
    const useCases = new EventUseCases(repository);
    await expect(
      useCases.listEvents(principal, organizationId, { cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      useCases.listEvents(principal, organizationId, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-03-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
