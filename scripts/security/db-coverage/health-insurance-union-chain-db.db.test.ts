// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-union-chain-db',
  () => runHarness(() => import('../health-insurance-union-chain-db'), { PORT: '55602' }),
  20 * 60_000,
);
