import { checkApiHealth } from './health-client';

const apiUrl = process.env.EVENT_SIMULATOR_API_URL ?? 'http://localhost:3001/api/v1';

async function main(): Promise<void> {
  try {
    const health = await checkApiHealth(apiUrl);
    process.stdout.write(
      `${JSON.stringify({ apiUrl, mode: 'phase-0-health-probe', status: health.status })}\n`,
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(
      `${JSON.stringify({ apiUrl, error: errorName, mode: 'phase-0-health-probe', status: 'failed' })}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
