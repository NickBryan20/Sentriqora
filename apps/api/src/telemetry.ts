import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
const normalizedEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'aegisflow-api',
  traceExporter: new OTLPTraceExporter({ url: `${normalizedEndpoint}/v1/traces` }),
});

sdk.start();

process.once('SIGTERM', () => {
  void sdk.shutdown();
});
