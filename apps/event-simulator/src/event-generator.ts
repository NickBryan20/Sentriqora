import { canonicalEventSchema, type CanonicalEvent } from '@aegisflow/contracts';
import { randomUUID } from 'node:crypto';

const scenarios = [
  {
    eventType: 'authentication.failed',
    message: 'Rejected login from 203.0.113.42',
    severity: 'MEDIUM',
  },
  {
    eventType: 'authorization.denied',
    message: 'Access denied for user@example.test',
    severity: 'HIGH',
  },
  {
    eventType: 'deployment.completed',
    message: 'Deployment completed successfully',
    severity: 'INFO',
  },
  {
    eventType: 'network.connection',
    message: 'Connection from 198.51.100.8',
    severity: 'LOW',
  },
] as const;

export function generateEvent(index: number, occurredAt = new Date()): CanonicalEvent {
  const scenario = scenarios[index % scenarios.length] ?? scenarios[0];
  return canonicalEventSchema.parse({
    actor: {
      device: `simulator-${(index % 4) + 1}`,
      ip: `203.0.113.${(index % 200) + 1}`,
      user: `simulated-user-${index}@example.test`,
    },
    assetKey: 'simulator-source',
    attributes: {
      apiKey: 'must-never-survive-normalization',
      email: `simulated-user-${index}@example.test`,
      sequence: index,
      sourceIp: `198.51.100.${(index % 200) + 1}`,
    },
    eventId: randomUUID(),
    eventType: scenario.eventType,
    message: scenario.message,
    occurredAt: occurredAt.toISOString(),
    severity: scenario.severity,
  });
}
