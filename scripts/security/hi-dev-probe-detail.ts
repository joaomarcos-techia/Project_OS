/**
 * Sonda SOMENTE LEITURA da tela de detalhe da solicitação SP/SADT no DEV, com o papel e o
 * contexto de clínica reais do app (withTenant), numa clínica sintética `e2e-hi-*`. Serve para
 * achar a causa de um 500 visto no Preview sem ler log da plataforma.
 *
 *   (ambiente DEV limpo) npx tsx --conditions=react-server scripts/security/hi-dev-probe-detail.ts <requestId>
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

const requestId = process.argv[2];
if (!requestId || !/^[0-9a-f-]{36}$/u.test(requestId)) throw new Error('uso: <requestId>');
if (/(prod|production)/iu.test(new URL(process.env.DATABASE_URL ?? 'postgres://x').hostname)) throw new Error('recusado');

const [row] = (await dbAdmin.execute(sql`
  SELECT r.clinic_id::text AS clinic_id FROM public.hi_sadt_requests r JOIN public.clinics c ON c.id = r.clinic_id
   WHERE r.id = ${requestId}::uuid AND c.slug LIKE 'e2e-hi-%'`)) as unknown as Array<{ clinic_id: string }>;
if (!row) throw new Error('não é solicitação sintética e2e-hi');
const q = await import('../../src/contexts/health-insurance/queries');
for (const [name, fn] of [
  ['getSadtRequestDetail', () => q.getSadtRequestDetail(row.clinic_id, requestId)],
  ['getConveniosCommercialDenial', () => q.getConveniosCommercialDenial(row.clinic_id)],
] as const) {
  try {
    const out = await fn();
    console.log(name, 'ok', out === null ? 'null' : typeof out === 'object' ? Object.keys(out as object).length + ' campos' : String(out));
    if (name === 'getSadtRequestDetail' && process.env.PROBE_OUT) (await import('node:fs')).writeFileSync(process.env.PROBE_OUT, JSON.stringify(out, null, 1));
  } catch (e) {
    const err = e as Error & { cause?: { message?: string; code?: string } };
    console.log(name, 'ERRO:', err.message.split('\n')[0]?.slice(0, 160), '| causa:', err.cause?.code, err.cause?.message);
  }
}
process.exit(0);
