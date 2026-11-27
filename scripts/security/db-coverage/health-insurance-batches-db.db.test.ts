// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-batches-db',
  () => runHarness(() => import('../health-insurance-batches-db'), { PORT: '55583' }),
  20 * 60_000,
);
