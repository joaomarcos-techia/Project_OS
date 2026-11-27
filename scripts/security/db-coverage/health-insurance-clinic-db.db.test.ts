// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-clinic-db',
  () => runHarness(() => import('../health-insurance-clinic-db'), { PORT: '55585' }),
  20 * 60_000,
);
