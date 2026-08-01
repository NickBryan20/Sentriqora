import { Counter, register } from 'prom-client';

const incidents =
  (register.getSingleMetric<'automatic' | 'severity'>('aegisflow_incidents_created_total') as
    Counter<'automatic' | 'severity'> | undefined) ??
  new Counter({
    help: 'Incidents created by severity and creation mode.',
    labelNames: ['severity', 'automatic'] as const,
    name: 'aegisflow_incidents_created_total',
  });

export function recordApiIncidentCreated(severity: string): void {
  incidents.inc({ automatic: 'false', severity });
}
