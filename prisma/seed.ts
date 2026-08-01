import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL_LOCAL or DATABASE_URL must be configured');
}

async function seed(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{ extension: string }>(
      `SELECT extname AS extension
       FROM pg_extension
       WHERE extname IN ('pgcrypto', 'vector')
       ORDER BY extname`,
    );
    const extensions = result.rows.map((row) => row.extension);
    if (!extensions.includes('vector')) {
      throw new Error('The vector extension is required before seeding');
    }

    const permissionResult = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM permissions`,
    );
    const permissionCount = Number(permissionResult.rows[0]?.count ?? 0);
    if (permissionCount !== 22) {
      throw new Error(`Expected 22 platform permissions through phase 4, found ${permissionCount}`);
    }

    const rlsResult = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class
       WHERE relname IN (
         'detection_rules', 'detection_rule_versions', 'rule_executions', 'anomaly_scores',
         'alerts', 'alert_events', 'alert_correlation_edges'
       )
       AND relrowsecurity
       AND relforcerowsecurity`,
    );
    const rlsTableCount = Number(rlsResult.rows[0]?.count ?? 0);
    if (rlsTableCount !== 7) {
      throw new Error(`Expected 7 phase-4 tenant tables with forced RLS, found ${rlsTableCount}`);
    }

    process.stdout.write(
      `${JSON.stringify({ extensions, permissionCount, phase: 4, rlsTableCount, status: 'verified' })}\n`,
    );
  } finally {
    await client.end();
  }
}

void seed();
