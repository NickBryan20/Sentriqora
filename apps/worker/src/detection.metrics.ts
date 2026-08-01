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

export function recordAlertCreated(severity: string): void {
  alerts.inc({ severity });
}
export function recordRuleExecution(matched: boolean): void {
  executions.inc({ matched: String(matched) });
}
export function observeDetectionBatch(seconds: number): void {
  batchDuration.observe(seconds);
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
