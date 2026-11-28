import { defineConfig } from 'vitest/config';

import base from './vitest.config';

/**
 * Cobertura com os harnesses de banco: a MESMA configuração da suíte unitária (mesmo `coverage.include`, mesmas
 * exclusões, mesmos pisos), com os testes gerados em `scripts/security/db-coverage/` somados ao `include` de TESTES.
 * Uma execução só, um mapa de cobertura só: o código de `src/` que os harnesses executam conta como qualquer outro
 * teste, sem fusão de relatórios nem dupla contagem. Os harnesses só rodam com `SECURITY_PG_BIN` (cada um sobe o
 * próprio Postgres descartável; sem ele, os testes gerados ficam como `skipped`).
 *
 *   SECURITY_PG_BIN="$(pg_config --bindir)" pnpm vitest run --coverage -c vitest.coverage-db.config.ts
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...(base.test?.include ?? []), 'scripts/security/db-coverage/*.db.test.ts'],
  },
});
