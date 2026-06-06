/**
 * `pnpm tsx scripts/clean-zombies.ts` — limpa eventos "zumbis" do outbox em DEV.
 *
 * Remove: eventos terminalmente `failed`, eventos com `handler_not_found` (gerados
 * por um worker SEM o código C9 — ex.: app deployado antigo compartilhando o banco
 * de dev) e eventos órfãos (clínica já apagada). SÓ DEV.
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

assertDevContext();

const rows = (await dbAdmin.execute(sql`
  DELETE FROM outbox
   WHERE status = 'failed'
      OR error_code = 'handler_not_found'
      OR clinic_id NOT IN (SELECT id FROM clinics)
  RETURNING id
`)) as unknown as Array<{ id: string }>;

console.log(`[clean-zombies] eventos removidos do outbox: ${rows.length}`);
process.exit(0);
