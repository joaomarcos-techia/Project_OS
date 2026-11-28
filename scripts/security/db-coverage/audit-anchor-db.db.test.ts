// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'audit-anchor-db',
  () => runHarness(() => import('../audit-anchor-db'), { PORT: '55643' }),
  20 * 60_000,
);
