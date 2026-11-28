// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'agent-insurance-tools-db',
  () => runHarness(() => import('../agent-insurance-tools-db'), { PORT: '55642' }),
  20 * 60_000,
);
