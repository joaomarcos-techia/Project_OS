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

export default [
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

  prettierConfig,
];
