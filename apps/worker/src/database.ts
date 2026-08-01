import { Pool, type PoolClient } from 'pg';

export function createDatabasePool(databaseUrl: string): Pool {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgresql://');
  }
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    statement_timeout: 15_000,
  });
}

export async function withTenantTransaction<T>(
  pool: Pool,
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE aegisflow_app');
    await client.query(
      `SELECT set_config('app.current_organization_id', $1, true),
              set_config('app.current_user_id', '', true)`,
      [organizationId],
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
