import { createServer, type Server } from 'node:http';
import { Counter, Histogram, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'aegisflow_worker_' });

const alerts = new Counter({
  help: 'Alerts created by the deterministic detection engine.',
  labelNames: ['severity'] as const,
  name: 'aegisflow_alerts_created_total',
});
const executions = new Counter({
  help: 'Idempotent rule executions persisted by outcome.',
  labelNames: ['matched'] as const,
  name: 'aegisflow_rule_executions_total',
});
const batchDuration = new Histogram({
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  help: 'Detection batch processing latency in seconds.',
  name: 'aegisflow_detection_batch_duration_seconds',
});
const incidents = new Counter({
  help: 'Incidents created by severity and creation mode.',
  labelNames: ['severity', 'automatic'] as const,
  name: 'aegisflow_incidents_created_total',
});
const slaBreaches = new Counter({
  help: 'Incident SLA breaches by target kind.',
  labelNames: ['kind'] as const,
  name: 'aegisflow_incident_sla_breaches_total',
});
const notificationDeliveries = new Counter({
  help: 'Incident notification delivery attempts by channel and outcome.',
  labelNames: ['channel', 'outcome'] as const,
  name: 'aegisflow_notification_deliveries_total',
});

export function recordAlertCreated(severity: string): void {
  alerts.inc({ severity });
}
export function recordRuleExecution(matched: boolean): void {
  executions.inc({ matched: String(matched) });
}
export function observeDetectionBatch(seconds: number): void {
  batchDuration.observe(seconds);
}
export function recordIncidentCreated(severity: string, automatic: boolean): void {
  incidents.inc({ automatic: String(automatic), severity });
}
export function recordSlaBreach(kind: string): void {
  slaBreaches.inc({ kind });
}
export function recordNotificationDelivery(channel: string, outcome: string): void {
  notificationDeliveries.inc({ channel, outcome });
}

export function startMetricsServer(port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    void register
      .metrics()
      .then((body) => {
        response.writeHead(200, { 'content-type': register.contentType });
        response.end(body);
      })
      .catch(() => response.writeHead(500).end());
  });
  server.listen(port, '0.0.0.0');
  return server;
}
