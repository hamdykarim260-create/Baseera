import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http', // used by drizzle-kit to target D1; actual apply happens via wrangler
} satisfies Config;
