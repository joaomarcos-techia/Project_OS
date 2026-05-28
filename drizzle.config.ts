/**
 * drizzle-kit configuration.
 *
 * drizzle-kit runs OUTSIDE the Next.js process — `src/lib/env.ts` is not
 * automatically loaded here. We pull `DATABASE_URL` ourselves via dotenv.
 *
 * Why we don't reuse `src/lib/env.ts`:
 * - That module imports `zod` and validates the WHOLE schema. drizzle-kit
 *   doesn't care about Supabase keys; loading them here adds risk of "schema
 *   tool fails to start because of an unrelated env miss".
 * - drizzle-kit only needs the connection string.
 *
 * SSL: `'require'` aligns with our policy (no plaintext Postgres). Supabase
 * pooler URL already contains `?sslmode=require`, but we belt-and-suspenders.
 */
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js convention is `.env.local` for secrets — not `.env`. Loading it
// explicitly here so drizzle-kit (which runs outside Next) sees the same
// connection string as the app.
loadDotenv({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    '[drizzle.config] DATABASE_URL is required. Check .env.local (loaded by dotenv).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/*',
  out: './drizzle/migrations',
  dbCredentials: {
    url: databaseUrl,
    ssl: 'require',
  },
  strict: true,
  verbose: true,
});
