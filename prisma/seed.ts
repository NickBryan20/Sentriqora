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
    if (permissionCount !== 30) {
      throw new Error(`Expected 30 platform permissions through phase 6, found ${permissionCount}`);
    }

    const rlsResult = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class
       WHERE relname IN (
         'knowledge_documents', 'knowledge_document_versions', 'knowledge_chunks',
         'ai_recommendations', 'ai_recommendation_sources'
       )
       AND relrowsecurity
       AND relforcerowsecurity`,
    );
    const rlsTableCount = Number(rlsResult.rows[0]?.count ?? 0);
    if (rlsTableCount !== 5) {
      throw new Error(`Expected 5 phase-6 tenant tables with forced RLS, found ${rlsTableCount}`);
    }

    process.stdout.write(
      `${JSON.stringify({ extensions, permissionCount, phase: 6, rlsTableCount, status: 'verified' })}\n`,
    );
  } finally {
    await client.end();
  }
}

void seed();
