import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string => readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0152_hi_glosses_payments.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; when: number; tag: string }> };
const norm = (s: string): string => s.replace(/public\./gu, '').replace(/\s+/gu, ' ').trim();
const fnBody = (name: string): string => sqlText.match(new RegExp(`FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'u'))![0];

const TABLES = ['hi_glosses', 'hi_gloss_appeals', 'hi_gloss_appeal_items', 'hi_payments', 'hi_payment_allocations', 'hi_account_events'];
const WRITERS = [
  'hi_gloss_record',
  'hi_gloss_transition',
  'hi_gloss_appeal_create',
  'hi_gloss_appeal_file',
  'hi_gloss_appeal_answer',
  'hi_gloss_appeal_cancel',
  'hi_payment_allocate',
  'hi_payment_record',
  'hi_payment_reverse',
  'hi_guide_reconcile',
];

describe('migration 0152 — glosas, recursos, pagamentos e conta da guia (P9.6–P9.8)', () => {
  it('não toca tabela compartilhada nem apaga dado; só troca CHECKs de hi_files', () => {
    expect(noBodies).not.toMatch(/\b(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|DROP\s+(?:TABLE|COLUMN|INDEX))\b/iu);
    expect(noBodies).not.toMatch(/ALTER TABLE public\.(?:appointments|lancamentos|patients|subscriptions|clinics|payment_transactions)\b/u);
    const drops = [...noBodies.matchAll(/ALTER TABLE public\.(\w+) DROP CONSTRAINT (\w+);/gu)].map((m) => `${m[1]}.${m[2]}`);
    expect(drops).toEqual(['hi_files.hi_files_kind_chk', 'hi_files.hi_files_link_chk', 'hi_files.hi_files_media_chk']);
  });

  it('journal: idx 152 contíguo, depois da 0151 (bloqueio comercial), e `when` crescente', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0152_hi_glosses_payments');
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0151_hi_premium_gate', 152]);
    expect(cur.when).toBeGreaterThan(prev.when);
  });

  it.each(TABLES)('%s: RLS literal do defaultTenantPolicy v2', (t) => {
    const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
  });

  it('runtime só lê; toda escrita pelas funções, que conferem a clínica da sessão', () => {
    expect(statements).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*hi_(?:gloss|payment|account)/u);
    expect(statements).toMatch(/GRANT SELECT ON public\.hi_guide_accounts, public\.hi_payment_balances TO authenticated, service_role;/u);
    for (const f of WRITERS) {
      const body = fnBody(f);
      expect(body, f).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/u);
      expect(body, f).toMatch(/hi_session_clinic\(p_clinic_id\)/u);
    }
    // As visões respeitam a RLS de quem consulta.
    expect(statements).toMatch(/CREATE VIEW public\.hi_guide_accounts WITH \(security_invoker = true\)/u);
    expect(statements).toMatch(/CREATE VIEW public\.hi_payment_balances WITH \(security_invoker = true\)/u);
  });

  it('6 estados de glosa; só "definitiva" reduz o devido; decidida não volta', () => {
    expect(statements).toMatch(/'informed', 'under_analysis', 'contested', 'appeal_filed', 'reversed', 'definitive'/u);
    const t = fnBody('hi_gloss_transition');
    expect(t).not.toMatch(/'definitive>|'reversed>/u);
    expect(fnBody('hi_account_settle')).toMatch(/t\.paid_cents = v_guide\.total_value_cents/u);
    // Pendente = faturado − pago − definitiva (glosa em aberto continua devida).
    expect(statements).toMatch(/g\.total_value_cents - coalesce\(p\.paid, 0\) - coalesce\(gl\.definitive_cents, 0\)/u);
  });

  it('sem dupla contagem, idempotência e nada se apaga', () => {
    expect(fnBody('hi_account_assert_capacity')).toMatch(/t\.paid_cents \+ t\.open_cents \+ t\.definitive_cents \+ p_extra > p_guide\.total_value_cents/u);
    expect(statements).toMatch(/CONSTRAINT hi_glosses_idem_uniq UNIQUE \(clinic_id, idempotency_key\)/u);
    expect(statements).toMatch(/CREATE UNIQUE INDEX hi_payments_statement_uniq ON public\.hi_payments \(clinic_id, insurer_id, statement_ref\)/u);
    expect(statements).toMatch(/CREATE UNIQUE INDEX hi_payment_allocations_reversal_uniq/u);
    for (const t of ['hi_account_events', 'hi_payments', 'hi_payment_allocations']) {
      expect(statements).toMatch(new RegExp(`CREATE TRIGGER ${t}_immutable BEFORE UPDATE ON public\\.${t}`, 'u'));
    }
    expect(fnBody('hi_payment_record')).toMatch(/ON CONFLICT ON CONSTRAINT hi_payments_idem_uniq DO NOTHING/u);
  });

  it('decisões sobre dinheiro e o recurso são de uma pessoa', () => {
    expect(fnBody('hi_gloss_transition')).toMatch(/v_actor IS NULL[\s\S]*42501/u);
    expect(fnBody('hi_gloss_appeal_create')).toMatch(/v_actor IS NULL[\s\S]*42501/u);
    expect(fnBody('hi_guide_reconcile')).toMatch(/hi_session_actor\(\) IS NULL[\s\S]*42501/u);
    expect(statements).toMatch(/protocol_number IS NOT NULL OR \(evidence IS NOT NULL AND char_length\(btrim\(evidence\)\) >= 10\)/u);
  });

  it('D24: período vencido fora da carência nega; XML do recurso é preservação', () => {
    const d = fnBody('qoro_premium_denial_for');
    expect(d).toMatch(/RETURN 'period_expired'/u);
    expect(d).toMatch(/v_cancel_at_end OR v_grace IS NULL OR v_grace <= statement_timestamp\(\)/u);
    expect(fnBody('hi_premium_guard')).toMatch(/NEW\.kind NOT IN \('batch_return', 'gloss_appeal_xml'\)/u);
    expect(fnBody('hi_guide_transition')).toMatch(/AND NEW\.status = 'under_review'\)/u);
  });
});
