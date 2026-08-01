import { Counter, register } from 'prom-client';

const commands =
  (register.getSingleMetric<'command' | 'outcome'>('aegisflow_detection_commands_total') as
    Counter<'command' | 'outcome'> | undefined) ??
  new Counter({
    help: 'Detection and alert commands handled by the API.',
    labelNames: ['command', 'outcome'] as const,
    name: 'aegisflow_detection_commands_total',
  });

export function recordDetectionCommand(command: string, outcome: 'success' | 'failure'): void {
  commands.inc({ command, outcome });
}
