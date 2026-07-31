import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL ?? process.env.DATABASE_URL_LOCAL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL or DATABASE_URL_LOCAL must be configured');
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  schema: 'prisma/schema.prisma',
});
