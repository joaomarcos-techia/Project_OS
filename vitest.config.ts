import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // C7: os renderers de PDF (.tsx) usam o automatic JSX runtime (igual ao Next /
  // tsconfig). Sem isto, o esbuild do vitest cai no classic runtime e quebra com
  // "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist'],
    // Alguns testes de auth (tenant-context/require-any-permission) fazem
    // `vi.resetModules()` + re-import do grafo inteiro por teste (o `authenticate`
    // é cache()-ado — precisa reimportar p/ zerar a memoização). Sob execução
    // paralela, essa recompilação de módulos disputa CPU e estourava o default de
    // 5s de forma FLAKY (passavam isolados em 1s, falhavam por timeout na suíte
    // cheia). Não é hang — é reimport lento sob carga; 30s dá folga sem mascarar
    // travas reais (a suíte inteira roda em ~30s).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}', 'src/lib/test/**'],
      // Re-baseline 2026-08-14 (remediação do agente): 26/38/73/26 → abaixo.
      // A regra é só subir. O piso antigo de branches (73) tinha ~4 branches de
      // folga sobre o real, o que tornava perigoso QUALQUER teste novo que
      // carregasse um módulo antes não instrumentado — o denominador crescia
      // mais rápido que o numerador. Depois da remediação o real é 74,5%;
      // fixar 74 preserva o ganho em vez de deixá-lo evaporar na próxima PR.
      thresholds: {
        lines: 29,
        functions: 41,
        branches: 74,
        statements: 29,
      },
    },
    // Baseline env so that src/lib/env.ts (which validates at module load)
    // can be imported by test files. Individual tests override these via
    // `__internal.loadEnv(asEnv(...))`. These values are intentionally
    // fictional and never reach a real Supabase project.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test?sslmode=require',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      // C11: GeminiProvider chama assertAiRuntimeReady() (lê o snapshot do env
      // singleton). Valor fictício — os testes stubam globalThis.fetch.
      GEMINI_API_KEY: 'test-gemini-key',
      // C15: assina o cookie de impersonate nos testes (≥32 chars). Fictício.
      IMPERSONATION_SECRET: 'test-impersonation-secret-32-chars-min!!',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // `server-only` ships a module that throws when imported outside an RSC
      // bundle. Under vitest (node env) we test server modules directly, so
      // alias it to an empty stub.
      'server-only': path.resolve(process.cwd(), 'src/lib/test/server-only-stub.ts'),
    },
  },
});
