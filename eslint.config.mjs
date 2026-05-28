// ESLint flat config (ESLint 9).
// Composes:
//   - next/core-web-vitals (via FlatCompat — eslint-config-next is still legacy)
//   - eslint-plugin-boundaries (cross-context isolation — see docs/CONVENTIONS.md)
//   - eslint-config-prettier (turn off formatting rules — Prettier owns those)
//
// Anti-acoplamento contract enforced here:
//   context  -> only lib
//   lib      -> only lib
//   app      -> anything
//   component-> lib + component
//
// Override pontual permitido com:
//   // eslint-disable-next-line boundaries/element-types -- razão obrigatória
import { FlatCompat } from '@eslint/eslintrc';
import boundaries from 'eslint-plugin-boundaries';
import prettierConfig from 'eslint-config-prettier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'context', pattern: 'src/contexts/*', mode: 'folder' },
        { type: 'lib', pattern: 'src/lib/*', mode: 'folder' },
        { type: 'app', pattern: 'src/app/**', mode: 'file' },
        { type: 'component', pattern: 'src/components/*', mode: 'folder' },
      ],
      'boundaries/include': ['src/**/*.{ts,tsx}'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'context', allow: ['lib'] },
            { from: 'lib', allow: ['lib'] },
            { from: 'app', allow: ['context', 'lib', 'component', 'app'] },
            { from: 'component', allow: ['lib', 'component'] },
          ],
        },
      ],
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Tests and config scripts can use console freely.
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/**',
      'vitest.config.ts',
      'next.config.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // C1 db guard #1: `postgres` driver may ONLY be imported by:
  //   - src/lib/db/index.ts (canonical pool factory for the app)
  //   - scripts/db-migrate-prod.ts (needs dedicated 1-shot connection against
  //     DATABASE_URL_PROD to acquire pg_advisory_lock; src/lib/db is bound to
  //     env.DATABASE_URL at boot and can't target a different URL).
  // Anywhere else duplicates the pool -> connection leak + config drift.
  // Mirror this allowlist in scripts/arch-db-check.ts.
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    ignores: ['src/lib/db/index.ts', 'scripts/db-migrate-prod.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message:
                'Direct postgres driver imports are forbidden outside src/lib/db/index.ts. Use { db, dbAdmin } from "@/lib/db" instead.',
            },
          ],
        },
      ],
    },
  },

  // C1 db guard #2: `dbAdmin` is admin-only (will bypass RLS in C2+).
  // Allowed: src/app/(admin)/, src/app/api/admin/, scripts/, src/lib/db/.
  // Forbidden: user-facing contexts, app routes, components, AND user-facing
  // API routes (everything under src/app/api/ that is NOT api/admin/).
  //
  // Coverage discovery (C1 audit): the original glob `src/app/(app)/**` did
  // NOT match route handlers under `src/app/api/...`. That meant a future
  // `src/app/api/patients/route.ts` could import dbAdmin and bypass RLS
  // silently. Added `src/app/api/**` to the block list, with
  // `src/app/api/admin/**` in ignores for the legitimate admin path.
  //
  // IMPORTANT: in ESLint flat config, later rule configs REPLACE earlier
  // ones for the same rule name. Since this block targets a subset of
  // guard #1's glob, we MUST repeat the `postgres` restriction here.
  {
    files: [
      'src/contexts/**/*.{ts,tsx}',
      'src/app/(app)/**/*.{ts,tsx}',
      'src/app/api/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
    ],
    ignores: ['src/app/api/admin/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message:
                'Direct postgres driver imports are forbidden outside src/lib/db/index.ts. Use { db, dbAdmin } from "@/lib/db" instead.',
            },
            {
              name: '@/lib/db',
              importNames: ['dbAdmin'],
              message:
                'dbAdmin bypasses RLS (in C2+). Only use inside scripts/, src/app/api/admin/, or src/app/(admin)/. See docs/runbooks/migrations.md.',
            },
          ],
        },
      ],
    },
  },

  prettierConfig,
];

export default config;
