import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0149_hi_billing_gaps.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
const fnBody = (name: string): string =>
  sqlText.match(new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, 'u'))![0];

describe('migration 0149 — pendência "convênio sem guia" (P7.4)', () => {
  it('não toca tabela compartilhada: nenhum DDL em appointments nem lancamentos, nada destrutivo', () => {
    expect(noBodies).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(noBodies).not.toMatch(/ALTER TABLE public\.(?:appointments|lancamentos)\b/u);
    expect(noBodies).not.toMatch(/CREATE (?:UNIQUE )?INDEX [^;]* ON public\.(?:appointments|lancamentos)/u);
    expect(noBodies).not.toMatch(/CREATE TRIGGER [^;]* ON public\.(?:appointments|lancamentos)/u);
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/imu);
  });

  it('journal: idx 149 contíguo, prefixo = posição e `when` estritamente crescente', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0149_hi_billing_gaps');
    expect(i).toBeGreaterThan(0);
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0148_hi_coverage_copay', 149]);
    expect(cur.when).toBeGreaterThan(prev.when);
  });

  it.each(['hi_billing_gaps', 'hi_billing_gap_events'])('%s: RLS literal do defaultTenantPolicy v2', (t) => {
    const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
  });

  it('uma pendência por atendimento; sem dado pessoal (nenhuma coluna de paciente)', () => {
    expect(statements).toMatch(/CONSTRAINT hi_billing_gaps_appointment_uniq UNIQUE \(clinic_id, appointment_id\)/u);
    const table = statements.match(/CREATE TABLE public\.hi_billing_gaps \([\s\S]*?\n\);/u)![0];
    expect(table).not.toMatch(/\bpatient_id\b|\bnome\b|\bcpf\b|card_number/u);
    expect(table).toMatch(/coverage_id uuid REFERENCES public\.hi_appointment_coverages\(id\) ON DELETE SET NULL/u);
  });

  it('fechar exige prova: guia viva pronta, atendimento não concluído, ou decisão humana com motivo', () => {
    expect(statements).toMatch(/resolution = 'guide_ready' AND guide_id IS NOT NULL/u);
    expect(statements).toMatch(/status = 'dismissed' AND resolution = 'dismissed'[\s\S]*?resolved_by IS NOT NULL/u);
    const fn = fnBody('hi_guard_billing_gap');
    expect(fn).toMatch(/v_guide\.status IN \('pending_data', 'cancelled', 'replaced'\)/u);
    expect(fn).toMatch(/NEW\.resolution = 'not_applicable' THEN\s+IF v_appt_status = 'atendido'/u);
    expect(fn).toMatch(/IF v_actor IS NULL THEN\s+RAISE EXCEPTION 'Encerrar sem faturar/u);
    expect(fn).toMatch(/OLD\.status = 'dismissed' AND v_actor IS NULL/u);
    expect(fn).toMatch(/v_appt_mode IS DISTINCT FROM 'convenio'/u);
  });

  it('cobertura depois do atendimento: só com pendência aberta, nota nova e autor = usuário autenticado', () => {
    const fn = fnBody('hi_guard_coverage');
    expect(fn).toMatch(/v_appt_status = 'atendido'\s+AND NEW\.correction_note IS NOT NULL/u);
    expect(fn).toMatch(/g\.status = 'open'/u);
    expect(fn).toMatch(/NEW\.corrected_by IS DISTINCT FROM v_actor/u);
    // As regras da 0148 continuam todas lá.
    expect(fn).toMatch(/A cobertura congela quando o atendimento começa/u);
    expect(fn).toMatch(/Só se registra autorização concedida pela operadora/u);
    expect(fn).toMatch(/Situação "negada" só com a autorização negada pela operadora/u);
  });

  it('runtime: sem DELETE na pendência, histórico só leitura, tentativas de uma em uma', () => {
    expect(statements).toMatch(/GRANT SELECT, INSERT ON public\.hi_billing_gaps TO authenticated, service_role;/u);
    expect(statements).toMatch(/GRANT SELECT ON public\.hi_billing_gap_events TO authenticated, service_role;/u);
    expect(statements).not.toMatch(/GRANT[^;]*DELETE[^;]*hi_billing_gap/u);
    expect(statements).not.toMatch(/GRANT UPDATE \([^)]*\b(?:reopened_count|resolved_by|resolved_at|opened_at|version)\b/u);
    expect(fnBody('hi_billing_gap_attempts')).toMatch(/NEW\.attempts NOT IN \(OLD\.attempts, OLD\.attempts \+ 1\)/u);
  });

  it('funções do banco com search_path fixo e sem EXECUTE para o runtime', () => {
    for (const f of ['hi_guard_billing_gap', 'hi_billing_gap_attempts', 'hi_billing_gap_record_event', 'hi_guard_coverage']) {
      expect(fnBody(f)).toMatch(/SET search_path = public, pg_temp/u);
      expect(statements).toContain(`REVOKE ALL ON FUNCTION public.${f}() FROM PUBLIC, anon, authenticated;`);
    }
  });
});
