import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0148_hi_coverage_copay.sql');
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

describe('migration 0148 — modalidade, cobertura e coparticipação (P1.6)', () => {
  it('é aditiva e não trava a agenda: coluna com DEFAULT constante, CHECK NOT VALID e validado depois', () => {
    expect(noBodies).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/imu);
    expect(statements).toContain(
      "ALTER TABLE public.appointments ADD COLUMN billing_mode text NOT NULL DEFAULT 'particular';",
    );
    expect(statements).toMatch(
      /ADD CONSTRAINT appointments_billing_mode_chk\s+CHECK \(billing_mode IN \('particular', 'convenio'\)\) NOT VALID;/u,
    );
    expect(statements).toContain(
      'ALTER TABLE public.appointments VALIDATE CONSTRAINT appointments_billing_mode_chk;',
    );
    // Nenhum índice novo na agenda (CREATE INDEX travaria escrita numa tabela grande).
    expect(statements).not.toMatch(/CREATE (?:UNIQUE )?INDEX [^;]* ON public\.appointments/u);
  });

  it.each(['hi_appointment_coverages', 'hi_copayments'])(
    '%s: RLS literal do defaultTenantPolicy v2',
    (t) => {
      const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
      expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
    },
  );

  it('convênio só com o módulo ligado e só até a chegada (gatilho na agenda, saída cedo para particular)', () => {
    const fn = sqlText.match(
      /FUNCTION public\.hi_guard_appointment_billing_mode\(\)[\s\S]*?\$\$;/u,
    )![0];
    expect(fn).toMatch(/TG_OP = 'INSERT' AND NEW\.billing_mode = 'particular' THEN\s+RETURN NEW;/u);
    expect(fn).toMatch(/hi_clinic_settings s WHERE s\.clinic_id = NEW\.clinic_id AND s\.enabled/u);
    expect(fn).toMatch(/NOT IN \('agendado', 'confirmado', 'chegou'\)/u);
    expect(statements).toMatch(
      /CREATE TRIGGER appointments_billing_mode_guard BEFORE INSERT OR UPDATE OF billing_mode ON public\.appointments/u,
    );
  });

  it('rede de segurança: recebível de atendimento de convênio só até o cobrável confirmado', () => {
    const fn = sqlText.match(
      /FUNCTION public\.hi_guard_convenio_patient_receivable\(\)[\s\S]*?\$\$;/u,
    )![0];
    expect(fn).toMatch(/v_mode IS DISTINCT FROM 'convenio' THEN\s+RETURN NEW;/u);
    expect(fn).toMatch(/c\.status IN \('confirmed', 'charged', 'paid'\)/u);
    expect(fn).toMatch(/round\(NEW\.valor \* 100\) > v_allowed/u);
    expect(statements).toMatch(
      /CREATE TRIGGER lancamentos_convenio_patient_guard\s+BEFORE INSERT OR UPDATE OF valor, appointment_id, tipo ON public\.lancamentos/u,
    );
  });

  it('coparticipação: seis valores separados; etapas com responsável; nada cobrável antes de confirmar', () => {
    for (const col of [
      'expected_cents',
      'calculated_cents',
      'checked_cents',
      'confirmed_cents',
      'chargeable_cents',
      'received_cents',
    ]) {
      expect(statements).toMatch(new RegExp(`\\b${col} bigint`, 'u'));
    }
    expect(statements).toMatch(/chargeable_cents <= confirmed_cents/u);
    expect(statements).toMatch(
      /status IN \('confirmed', 'charged', 'paid', 'refunded'\) OR chargeable_cents IS NULL OR chargeable_cents = 0/u,
    );
    // Motivo obrigatório não aceita NULL (char_length(NULL) passaria).
    expect(statements).toMatch(
      /waive_reason IS NOT NULL AND char_length\(btrim\(waive_reason\)\) BETWEEN 10 AND 500/u,
    );
  });

  it('runtime: sem DELETE; recebido e referência de cobrança fora do UPDATE (só o financeiro, P10.5)', () => {
    expect(statements).not.toMatch(
      /GRANT [^;]*DELETE[^;]*ON public\.hi_(?:appointment_coverages|copayments)/u,
    );
    expect(statements).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/u);
    const copayUpdate = statements.match(/GRANT UPDATE \(([^)]*)\) ON public\.hi_copayments/u)![1]!;
    for (const col of ['received_cents', 'charge_ref', 'confirmed_at', 'checked_at', 'version']) {
      expect(copayUpdate).not.toMatch(new RegExp(`\\b${col}\\b`, 'u'));
    }
  });

  it('journal: idx 148, depois da 0147, versão lógica crescente', () => {
    const e47 = journal.entries.find((e) => e.tag === '0147_hi_guides')!;
    const e48 = journal.entries.find((e) => e.tag === '0148_hi_coverage_copay')!;
    expect(e48.idx).toBe(148);
    expect(e48.when).toBeGreaterThan(e47.when);
  });
});
