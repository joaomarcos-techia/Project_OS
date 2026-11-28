// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  'migration-final-order-db',
  () =>
    runHarness(() => import('../migration-final-order-db'), {
      PORT: '55631',
      PR64_REF: '74823d649d8a9aa6f8842bf6cbfb9f953d0470f2',
      PR59_REF: 'c6e91bf1991fcabe2f30aa67b20914e0ab625a64',
    }),
  20 * 60_000,
);
