// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'health-insurance-copay-charge-db',
  () => runHarness(() => import('../health-insurance-copay-charge-db'), { PORT: '55590' }),
  20 * 60_000,
);
