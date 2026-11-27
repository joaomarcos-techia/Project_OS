// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'login-attempts-retention-db',
  () => runHarness(() => import('../login-attempts-retention-db'), { PORT: '55607' }),
  20 * 60_000,
);
