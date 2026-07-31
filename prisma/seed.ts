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

    process.stdout.write(
      `${JSON.stringify({ extensions, phase: 0, seededRecords: 0, status: 'verified' })}\n`,
    );
  } finally {
    await client.end();
  }
}

void seed();
