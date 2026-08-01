import { describe, expect, it } from 'vitest';

import { IncidentLifecyclePolicy } from '../src/incidents/incident-policy';

describe('IncidentLifecyclePolicy', () => {
  const policy = new IncidentLifecyclePolicy();

  it('allows the operational lifecycle and rejects bypasses', () => {
    expect(() =>
      policy.assertTransition('TRIAGED', 'INVESTIGATING', {
        lessonsLearned: null,
        rootCause: null,
      }),
    ).not.toThrow();
    expect(() =>
      policy.assertTransition('OPEN', 'RESOLVED', {
        lessonsLearned: null,
        rootCause: 'A sufficiently detailed root cause.',
      }),
    ).toThrowError(/not allowed/u);
  });

  it('requires analysis before resolution and closure', () => {
    expect(() =>
      policy.assertTransition('INVESTIGATING', 'RESOLVED', {
        lessonsLearned: null,
        rootCause: null,
      }),
    ).toThrowError(/Root cause/u);
    expect(() =>
      policy.assertTransition('RESOLVED', 'CLOSED', {
        lessonsLearned: null,
        rootCause: 'A sufficiently detailed root cause.',
      }),
    ).toThrowError(/Lessons learned/u);
  });

  it('maps severity to priority and creates only high-risk automatic incidents', () => {
    expect(policy.priorityFor('CRITICAL')).toBe('P1');
    expect(policy.priorityFor('MEDIUM')).toBe('P3');
    expect(policy.shouldCreateAutomatically('CRITICAL', 50)).toBe(true);
    expect(policy.shouldCreateAutomatically('HIGH', 95)).toBe(true);
    expect(policy.shouldCreateAutomatically('HIGH', 75)).toBe(false);
  });

  it('calculates bounded SLA targets and breach states', () => {
    const detectedAt = new Date('2026-08-01T00:00:00.000Z');
    const target = policy.slaTarget(detectedAt, 15, 240);
    expect(target.responseDueAt.toISOString()).toBe('2026-08-01T00:15:00.000Z');
    expect(target.resolutionDueAt.toISOString()).toBe('2026-08-01T04:00:00.000Z');
    expect(policy.isResponseBreached(target.responseDueAt, target.responseDueAt, null)).toBe(true);
    expect(
      policy.isResolutionBreached(target.resolutionDueAt, target.resolutionDueAt, detectedAt),
    ).toBe(false);
  });
});
