/**
 * Seed canônico de planos/preços/limites (C13). IDEMPOTENTE — re-executável
 * (mesmo conteúdo da migration 0026, para reaplicar/ajustar fora de migration).
 * Preço é "ainda mutável" (§13.18): ajuste de valor aqui mantém grandfather via
 * prices.active_until (não implementado neste seed — só insere o vigente).
 *
 * Uso: `pnpm seed:plans`
 */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

const PLANS = [
  { code: 'solo', name: 'Solo', monthly: '149.00', annual: '1519.80', users: 1, ag: 200, ia: 200 },
  {
    code: 'clinica',
    name: 'Clínica',
    monthly: '349.00',
    annual: '3559.80',
    users: 5,
    ag: 800,
    ia: 800,
  },
  { code: 'pro', name: 'Pro', monthly: '699.00', annual: '7129.80', users: 10, ag: 2500, ia: 2500 },
] as const;

async function main(): Promise<void> {
  for (const p of PLANS) {
    await dbAdmin.execute(
      sql`INSERT INTO plans (code, name) VALUES (${p.code}, ${p.name}) ON CONFLICT (code) DO NOTHING`,
    );
    for (const [cycle, amount] of [
      ['monthly', p.monthly],
      ['annual', p.annual],
    ] as const) {
      await dbAdmin.execute(
        sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle)
            SELECT id, ${amount}, 'BRL', ${cycle} FROM plans WHERE code = ${p.code}
            ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING`,
      );
    }
    for (const [metric, val] of [
      ['users', p.users],
      ['agendamentos', p.ag],
      ['ai_messages', p.ia],
    ] as const) {
      await dbAdmin.execute(
        sql`INSERT INTO plan_limits (plan_id, metric, limit_value)
            SELECT id, ${metric}::plan_limit_metric, ${val} FROM plans WHERE code = ${p.code}
            ON CONFLICT (plan_id, metric) DO NOTHING`,
      );
    }
    console.log(`[seed:plans] OK ${p.code} (${p.name})`);
  }
  console.log('[seed:plans] done.');
  process.exit(0);
}

void main();
