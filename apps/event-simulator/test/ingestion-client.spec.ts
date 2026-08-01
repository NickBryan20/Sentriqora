import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateEvent } from '../src/event-generator';
import { sendEvent } from '../src/ingestion-client';

describe('sendEvent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends authenticated canonical JSON without leaking the API key in the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          duplicate: false,
          receiptId: '019fb917-863a-7742-95a9-b269bfd51068',
          receivedAt: '2026-07-31T12:00:00.000Z',
          status: 'RECEIVED',
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const receipt = await sendEvent(
      {
        apiKey: 'private-test-api-key',
        baseUrl: 'http://localhost:3001/api/v1',
        connectorId: '019fb917-863a-7742-95a9-b269bfd51067',
        organizationId: '019fb917-863a-7742-95a9-b269bfd51066',
      },
      generateEvent(0, new Date('2026-07-31T12:00:00.000Z')),
    );
    expect(receipt.receiptId).toBe('019fb917-863a-7742-95a9-b269bfd51068');
    expect(JSON.stringify(receipt)).not.toContain('private-test-api-key');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
