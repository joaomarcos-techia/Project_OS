// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'hi-r38-ledger-equivalence-db',
  () => runHarness(() => import('../hi-r38-ledger-equivalence-db'), { PORT: '55604' }),
  20 * 60_000,
);
