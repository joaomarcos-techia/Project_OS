import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string => readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0153_hi_ledger_bridge.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; when: number; tag: string }> };
const norm = (s: string): string => s.replace(/public\./gu, '').replace(/--.*$/gmu, '').replace(/\s+/gu, ' ').trim();
const fnBody = (text: string, name: string): string =>
  text.match(new RegExp(`FUNCTION public\\.${name}\\([\\s\\S]*?(?:\\$\\$;|END \\$\\$;)`, 'u'))![0];

describe('migration 0153 — ponte da conta da guia com o livro financeiro (R37)', () => {
  it('journal: idx 153 contíguo, depois da 0152, e `when` crescente', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0153_hi_ledger_bridge');
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0152_hi_glosses_payments', 153]);
    expect(cur.when).toBeGreaterThan(prev.when);
  });

  it('em lancamentos só aditiva: colunas novas, CHECKs NOT VALID + VALIDATE, uma troca (origem do automático)', () => {
    expect(noBodies).not.toMatch(/\b(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+public\.\w+\s+SET|DROP\s+(?:TABLE|COLUMN|INDEX|TRIGGER|FUNCTION|VIEW))\b/iu);
    const drops = [...noBodies.matchAll(/ALTER TABLE public\.(\w+) DROP CONSTRAINT IF EXISTS (\w+);/gu)].map((m) => `${m[1]}.${m[2]}`);
    expect(drops).toEqual(['lancamentos.lancamentos_auto_origin_chk']);
    for (const c of ['lancamentos_valor_glosado_chk', 'lancamentos_insurer_receivable_chk', 'lancamentos_auto_origin_chk']) {
      expect(noBodies).toMatch(new RegExp(`ADD CONSTRAINT ${c} CHECK \\([\\s\\S]*?\\) NOT VALID;`, 'u'));
      expect(noBodies).toMatch(new RegExp(`VALIDATE CONSTRAINT ${c};`, 'u'));
    }
    expect(noBodies).toMatch(/ADD COLUMN source_hi_guide_id uuid,\s+ADD COLUMN valor_glosado numeric\(12, 2\) NOT NULL DEFAULT 0;/u);
    expect(noBodies).not.toMatch(/ALTER TABLE public\.(?:appointments|patients|subscriptions|clinics|payment_transactions)\b/u);
  });

  it('origem do automático = a da 0108 + a guia de convênio (nada mais muda para o particular)', () => {
    const c0108 = read('0108_patient_payment_economics.sql').match(/ADD CONSTRAINT lancamentos_auto_origin_chk CHECK \(([\s\S]*?)\),\n/u)![1]!;
    const c0153 = sqlText.match(/ADD CONSTRAINT lancamentos_auto_origin_chk CHECK \(([\s\S]*?)\) NOT VALID;/u)![1]!;
    expect(norm(c0153)).toBe(`${norm(c0108)} OR source_hi_guide_id IS NOT NULL`);
  });

  it('validação do livro: o caminho que não é de convênio é IDÊNTICO ao da 0073', () => {
    const v0073 = fnBody(read('0073_refund_ledger_lock_privilege.sql'), 'validate_payment_transaction_insert');
    const v0153 = fnBody(sqlText, 'validate_payment_transaction_insert')
      .replace(/\n  v_insurer_guide uuid;\n  v_glossed numeric\(12, 2\);/u, '')
      .replace('SELECT clinic_id, valor, source_hi_guide_id, valor_glosado\n    INTO v_lancamento_clinic, v_lancamento_value, v_insurer_guide, v_glossed', 'SELECT clinic_id, valor\n    INTO v_lancamento_clinic, v_lancamento_value')
      .replace(/\n  IF NEW\.kind = 'payment' AND v_insurer_guide IS NOT NULL THEN[\s\S]*?\n    RETURN NEW;\n  END IF;\n/u, '\n');
    expect(norm(v0153)).toBe(norm(v0073));
    // E o ramo do convênio usa o pago LÍQUIDO mais a glosa definitiva.
    expect(fnBody(sqlText, 'validate_payment_transaction_insert')).toMatch(/v_total \+ NEW\.amount \+ v_glossed > v_lancamento_value/u);
  });

  it('recebível de convênio: a receber, sem paciente, sem atendimento, forma "convenio", um por guia', () => {
    expect(noBodies).toMatch(/tipo = 'receber' AND created_via = 'auto' AND appointment_id IS NULL AND patient_id IS NULL/u);
    expect(noBodies).toMatch(/AND payment_method = 'convenio'/u);
    expect(noBodies).toMatch(/CREATE UNIQUE INDEX lancamentos_hi_guide_uniq ON public\.lancamentos \(clinic_id, source_hi_guide_id\)\s+WHERE source_hi_guide_id IS NOT NULL;/u);
    // Glosa (baixa sem caixa) só em recebível de convênio.
    expect(noBodies).toMatch(/valor_glosado = 0 OR source_hi_guide_id IS NOT NULL/u);
  });

  it('a projeção: só glosa DEFINITIVA baixa; o livro de caixa só recebe pagamento e reembolso; idempotente', () => {
    const p = fnBody(sqlText, 'hi_ledger_sync_guide');
    expect(p).toMatch(/g\.status = 'definitive' AND g\.definitive_cents > 0/u);
    expect(p).not.toMatch(/'informed'|'under_analysis'|'contested'|'appeal_filed'/u);
    const kinds = [...p.matchAll(/INSERT INTO public\.payment_transactions[\s\S]*?VALUES \(p_clinic_id, v_lanc\.id, '(\w+)'/gu)].map((m) => m[1]);
    expect(kinds).toEqual(['payment', 'refund']);
    expect(p).toMatch(/original_payment_id/u);
    expect(noBodies).toMatch(/CONSTRAINT hi_ledger_entries_source_uniq UNIQUE \(clinic_id, kind, source_id\)/u);
    expect(noBodies).toMatch(/CREATE TRIGGER hi_ledger_entries_immutable BEFORE UPDATE ON public\.hi_ledger_entries/u);
    // Pagamento parcial nunca quita; quitado = pago + glosa definitiva = faturado.
    expect(p).toMatch(/WHEN v_paid \+ v_glossed >= v_guide\.total_value_cents THEN 'pago'/u);
  });

  it('quem escreve: a projeção não é executável pelo app; o reprocessamento confere a sessão; guardas no livro', () => {
    expect(noBodies).toMatch(/REVOKE ALL ON FUNCTION public\.hi_ledger_sync_guide\(uuid, uuid\) FROM PUBLIC, anon, authenticated, service_role;/u);
    expect(noBodies).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.hi_ledger_sync_guide/u);
    expect(fnBody(sqlText, 'hi_ledger_sync_clinic')).toMatch(/hi_session_clinic\(p_clinic_id\)/u);
    expect(noBodies).toMatch(/CREATE TRIGGER lancamentos_insurer_receivable_guard BEFORE INSERT OR UPDATE ON public\.lancamentos/u);
    expect(noBodies).toMatch(/CREATE TRIGGER payment_transactions_insurer_guard BEFORE INSERT ON public\.payment_transactions/u);
    expect(fnBody(sqlText, 'hi_guard_insurer_payment')).toMatch(/nunca como pagamento no Caixa/u);
    expect(noBodies).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*hi_ledger_entries/u);
  });

  it('hi_ledger_entries: RLS literal do defaultTenantPolicy v2; visões com security_invoker', () => {
    const expected = norm(defaultTenantPolicy('hi_ledger_entries').replace(/^-- GENERATED_BY.*\n/u, ''));
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
    expect(statements).toMatch(/CREATE VIEW public\.hi_ledger_drift WITH \(security_invoker = true\)/u);
    expect(statements).toMatch(/CREATE VIEW public\.hi_insurer_receivables WITH \(security_invoker = true\)/u);
  });
});
