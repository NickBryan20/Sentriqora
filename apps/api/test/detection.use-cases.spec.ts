import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { DetectionUseCases } from '../src/detection/application/detection.use-cases';
import type { DetectionRepositoryPort } from '../src/detection/application/ports/detection-repository.port';

const organizationId = randomUUID();
const principal = {
  mfaVerified: true,
  organizationId,
  permissions: ['detection-rule.read', 'detection-rule.manage', 'alert.read', 'alert.triage'],
  sessionId: randomUUID(),
  userId: randomUUID(),
};

function repository(): DetectionRepositoryPort {
  return {
    createRule: vi.fn(async (input) => ({
      replayed: false,
      value: {
        ...input.rule,
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    })),
    findAlert: vi.fn(async () => null),
    getAlertGraph: vi.fn(async () => null),
    listAlerts: vi.fn(async () => []),
    listRules: vi.fn(async () => []),
    setRuleEnabled: vi.fn(async () => ({ kind: 'not_found' as const })),
    suppressAlert: vi.fn(async () => ({ kind: 'not_found' as const })),
    triageAlert: vi.fn(async () => ({ kind: 'not_found' as const })),
    updateRule: vi.fn(async () => ({ kind: 'not_found' as const })),
  };
}

describe('DetectionUseCases', () => {
  it('creates a bounded rule with persistent idempotency context', async () => {
    const port = repository();
    const useCases = new DetectionUseCases(port);
    const result = await useCases.createRule(
      principal,
      organizationId,
      {
        condition: { attributes: [], eventTypes: ['authentication.failed'] },
        correlationDimensions: ['ACTOR_USER'],
        key: 'auth-failure-burst',
        name: 'Authentication failure burst',
        severity: 'HIGH',
        threshold: 5,
        windowSeconds: 300,
      },
      'detection-create-001',
      { correlationId: 'correlation-001', ipAddress: '203.0.113.5' },
    );
    expect(result.value).toMatchObject({ enabled: false, threshold: 5 });
    expect(port.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency: expect.objectContaining({ scope: 'detection-rule.create' }),
        organizationId,
      }),
    );
  });

  it('rejects cross-tenant reads before reaching the repository', async () => {
    const port = repository();
    const useCases = new DetectionUseCases(port);
    await expect(useCases.listAlerts(principal, randomUUID(), {})).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    expect(port.listAlerts).not.toHaveBeenCalled();
  });

  it('limits alert suppression to thirty days and requires a reason', async () => {
    const port = repository();
    const useCases = new DetectionUseCases(port);
    await expect(
      useCases.suppressAlert(principal, organizationId, randomUUID(), {
        reason: 'Approved maintenance window',
        suppressedUntil: new Date(Date.now() + 31 * 24 * 60 * 60_000).toISOString(),
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(port.suppressAlert).not.toHaveBeenCalled();
  });

  it('maps optimistic concurrency failures to Problem Details-compatible conflicts', async () => {
    const port = repository();
    port.setRuleEnabled = vi.fn(async () => ({ kind: 'conflict' as const }));
    const useCases = new DetectionUseCases(port);
    await expect(
      useCases.setRuleEnabled(principal, organizationId, randomUUID(), {
        enabled: true,
        version: 2,
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });
});
