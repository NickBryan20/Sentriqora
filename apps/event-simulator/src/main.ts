import { checkApiHealth } from './health-client';
import { generateEvent } from './event-generator';
import { sendEvent } from './ingestion-client';

const apiUrl = process.env.EVENT_SIMULATOR_API_URL ?? 'http://localhost:3001/api/v1';

async function main(): Promise<void> {
  try {
    const health = await checkApiHealth(apiUrl);
    const apiKey = process.env.EVENT_SIMULATOR_API_KEY;
    const connectorId = process.env.EVENT_SIMULATOR_CONNECTOR_ID;
    const organizationId = process.env.EVENT_SIMULATOR_ORGANIZATION_ID;
    if (!hasValue(apiKey) || !hasValue(connectorId) || !hasValue(organizationId)) {
      process.stdout.write(
        `${JSON.stringify({ apiUrl, mode: 'health-probe', status: health.status })}\n`,
      );
      return;
    }
    const requestedCount = Number(process.env.EVENT_SIMULATOR_COUNT ?? '10');
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 500) {
      throw new Error('EVENT_SIMULATOR_COUNT must be an integer between 1 and 500');
    }
    const receipts = [];
    for (let index = 0; index < requestedCount; index += 1) {
      receipts.push(
        await sendEvent(
          { apiKey, baseUrl: apiUrl, connectorId, organizationId },
          generateEvent(index),
        ),
      );
    }
    process.stdout.write(
      `${JSON.stringify({ accepted: receipts.length, mode: 'event-ingestion', receiptIds: receipts.map((receipt) => receipt.receiptId), status: health.status })}\n`,
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(
      `${JSON.stringify({ apiUrl, error: errorName, mode: 'event-simulator', status: 'failed' })}\n`,
    );
    process.exitCode = 1;
  }
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

void main();
