// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'auth-password-history-db',
  () => runHarness(() => import('../auth-password-history-db'), { PORT: '55609' }),
  20 * 60_000,
);
