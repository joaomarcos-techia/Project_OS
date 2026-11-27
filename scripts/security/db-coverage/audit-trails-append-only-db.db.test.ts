// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'audit-trails-append-only-db',
  () => runHarness(() => import('../audit-trails-append-only-db'), { PORT: '55612' }),
  20 * 60_000,
);
