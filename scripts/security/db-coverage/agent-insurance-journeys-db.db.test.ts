// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'agent-insurance-journeys-db',
  () => runHarness(() => import('../agent-insurance-journeys-db'), { PORT: '55641' }),
  20 * 60_000,
);
