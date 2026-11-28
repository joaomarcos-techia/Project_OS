// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-contract-import-db',
  () => runHarness(() => import('../health-insurance-contract-import-db'), { PORT: '55589' }),
  20 * 60_000,
);
