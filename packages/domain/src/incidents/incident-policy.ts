export type IncidentStatusValue =
  'OPEN' | 'TRIAGED' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';
export type IncidentPriorityValue = 'P1' | 'P2' | 'P3' | 'P4';
export type IncidentSeverityValue = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IncidentAnalysis {
  lessonsLearned: string | null;
  rootCause: string | null;
}

export interface IncidentSlaTarget {
  resolutionDueAt: Date;
  responseDueAt: Date;
}

const TRANSITIONS: Readonly<Record<IncidentStatusValue, readonly IncidentStatusValue[]>> = {
  CLOSED: ['INVESTIGATING'],
  CONTAINED: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  OPEN: ['TRIAGED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  TRIAGED: ['INVESTIGATING', 'CLOSED'],
};

const PRIORITY: Readonly<Record<IncidentSeverityValue, IncidentPriorityValue>> = {
  CRITICAL: 'P1',
  HIGH: 'P2',
  INFO: 'P4',
  LOW: 'P4',
  MEDIUM: 'P3',
};

export class IncidentPolicyError extends Error {
  constructor(
    readonly code: 'analysis_required' | 'invalid_sla' | 'invalid_transition',
    message: string,
  ) {
    super(message);
    this.name = 'IncidentPolicyError';
  }
}

export class IncidentLifecyclePolicy {
  assertTransition(
    current: IncidentStatusValue,
    target: IncidentStatusValue,
    analysis: IncidentAnalysis,
  ): void {
    if (!TRANSITIONS[current].includes(target)) {
      throw new IncidentPolicyError(
        'invalid_transition',
        `Incident transition ${current} -> ${target} is not allowed.`,
      );
    }
    if ((target === 'RESOLVED' || target === 'CLOSED') && !hasMeaningfulText(analysis.rootCause)) {
      throw new IncidentPolicyError(
        'analysis_required',
        'Root cause is required before resolving or closing an incident.',
      );
    }
    if (target === 'CLOSED' && !hasMeaningfulText(analysis.lessonsLearned)) {
      throw new IncidentPolicyError(
        'analysis_required',
        'Lessons learned are required before closing an incident.',
      );
    }
  }

  priorityFor(severity: IncidentSeverityValue): IncidentPriorityValue {
    return PRIORITY[severity];
  }

  shouldCreateAutomatically(severity: IncidentSeverityValue, riskScore: number): boolean {
    return severity === 'CRITICAL' || riskScore >= 90;
  }

  slaTarget(
    detectedAt: Date,
    responseMinutes: number,
    resolutionMinutes: number,
  ): IncidentSlaTarget {
    if (
      !Number.isInteger(responseMinutes) ||
      !Number.isInteger(resolutionMinutes) ||
      responseMinutes < 1 ||
      resolutionMinutes <= responseMinutes
    ) {
      throw new IncidentPolicyError('invalid_sla', 'The incident SLA target is invalid.');
    }
    return {
      resolutionDueAt: new Date(detectedAt.getTime() + resolutionMinutes * 60_000),
      responseDueAt: new Date(detectedAt.getTime() + responseMinutes * 60_000),
    };
  }

  isResponseBreached(now: Date, dueAt: Date, firstRespondedAt: Date | null): boolean {
    return firstRespondedAt === null && now.getTime() >= dueAt.getTime();
  }

  isResolutionBreached(now: Date, dueAt: Date, resolvedAt: Date | null): boolean {
    return resolvedAt === null && now.getTime() >= dueAt.getTime();
  }
}

function hasMeaningfulText(value: string | null): boolean {
  return value !== null && value.trim().length >= 10;
}
