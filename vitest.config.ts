import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist'],
    // Baseline env so that src/lib/env.ts (which validates at module load)
    // can be imported by test files. Individual tests override these via
    // `__internal.loadEnv(asEnv(...))`. These values are intentionally
    // fictional and never reach a real Supabase project.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test?sslmode=require',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});
