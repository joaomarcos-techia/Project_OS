// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-ledger-bridge-db',
  () => runHarness(() => import('../health-insurance-ledger-bridge-db'), { PORT: '55597' }),
  20 * 60_000,
);
