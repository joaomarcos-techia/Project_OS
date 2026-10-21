/**
 * Seed canônico de planos/preços/limites (C13). IDEMPOTENTE — re-executável
 * (mesmo conteúdo das migrations 0026 e 0119, para reaplicar/ajustar fora de
 * migration). Preço é "ainda mutável" (§13.18): ajuste de valor aqui mantém
 * grandfather via prices.active_until (não implementado neste seed — só insere
 * o vigente).
 *
 *   - Tabela antiga (Solo/Clínica/Pro): só para quem já assina; fora do cadastro.
 *   - Oferta por profissional (ADR-067): Consultório e Clínica de 2 a 10
 *     profissionais, só mensal, preços pela fórmula de `offer-2026.ts`.
 *
 * Uso: `pnpm seed:plans`
 */
import './_env';

import { sql } from 'drizzle-orm';

import {
  OFFER_2026_PLAN_CODES,
  offer2026MonthlyCents,
  offer2026Professionals,
  offer2026StaffLimit,
} from '@/contexts/billing/offer-2026';
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
            ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL AND campaign_code IS NULL
            DO NOTHING`,
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
  for (const code of OFFER_2026_PLAN_CODES) {
    const professionals = offer2026Professionals(code)!;
    const name = professionals === 1 ? 'Consultório' : `Clínica · ${professionals} profissionais`;
    const amount = (offer2026MonthlyCents(professionals)! / 100).toFixed(2);
    const staff = offer2026StaffLimit(professionals);
    await dbAdmin.execute(
      sql`INSERT INTO plans (code, name) VALUES (${code}, ${name}) ON CONFLICT (code) DO NOTHING`,
    );
    await dbAdmin.execute(
      sql`INSERT INTO plan_seat_limits (plan_id, professionals, staff)
          SELECT id, ${professionals}, ${staff} FROM plans WHERE code = ${code}
          ON CONFLICT (plan_id) DO NOTHING`,
    );
    await dbAdmin.execute(
      sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle)
          SELECT id, ${amount}, 'BRL', 'monthly' FROM plans WHERE code = ${code}
          ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL AND campaign_code IS NULL
          DO NOTHING`,
    );
    console.log(`[seed:plans] OK ${code} (${name})`);
  }
  console.log('[seed:plans] done.');
  process.exit(0);
}

void main();
