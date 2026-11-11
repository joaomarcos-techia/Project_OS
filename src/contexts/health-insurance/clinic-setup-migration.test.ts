import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0144_hi_clinic_setup.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const TABLES = [
  'hi_clinic_settings',
  'hi_counters',
  'hi_insurers',
  'hi_insurer_credentials',
  'hi_plans',
  'hi_professional_profiles',
  'hi_credentials',
  'hi_contract_imports',
  'hi_procedure_contracts',
] as const;
/** SQL sem comentários: o cabeçalho cita o rollback (DROP/DELETE) de propósito. */
const statements = migration.replace(/--.*$/gmu, '');
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

describe('migration 0144 — configuração de convênios por clínica (P1.4)', () => {
  it('é aditiva: cria tabelas, sem DROP, TRUNCATE, DELETE, UPDATE nem BEGIN/COMMIT', () => {
    expect(statements).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/imu);
    for (const table of TABLES) expect(migration).toContain(`CREATE TABLE public.${table} (`);
  });

  it('não liga nada: sem linha inserida em tabela hi_*, flag nasce desligada', () => {
    expect(statements).not.toMatch(/INSERT INTO public\.hi_/u);
    expect(migration).toMatch(/enabled boolean NOT NULL DEFAULT false/u);
  });

  it.each(TABLES)(
    '%s: RLS ENABLE + FORCE com a política literal do defaultTenantPolicy v2',
    (t) => {
      const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
      expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
    },
  );

  it.each(TABLES)('%s: clinic_id obrigatório e ligado a clinics com CASCADE', (t) => {
    const body = new RegExp(`CREATE TABLE public\\.${t} \\(([\\s\\S]*?)\\n\\);`, 'u').exec(
      migration,
    )![1]!;
    expect(body).toMatch(
      /clinic_id uuid (?:PRIMARY KEY|NOT NULL) REFERENCES public\.clinics\(id\) ON DELETE CASCADE/u,
    );
  });

  it('toda referência a operadora, plano, importação ou contrato é FK composta por clínica', () => {
    const refs = [
      ...statements.matchAll(/FOREIGN KEY \(([^)]*)\)\s+REFERENCES public\.(hi_\w+) \(([^)]*)\)/gu),
    ];
    expect(refs.length).toBe(9);
    for (const [, cols, , target] of refs) {
      expect(cols!.startsWith('clinic_id, '), cols).toBe(true);
      expect(target).toBe('clinic_id, id');
    }
    // nenhuma FK simples para tabela hi_* (atalho que permitiria cruzar clínicas)
    expect(statements).not.toMatch(/\w+_id uuid[^,\n]*REFERENCES public\.hi_/u);
  });

  it('privilégios: anon nunca; contratos só SELECT e INSERT para o runtime (append-only)', () => {
    expect(statements).toMatch(/REVOKE ALL ON [\s\S]*?FROM PUBLIC, anon, authenticated;/u);
    expect(statements).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/u);
    expect(statements).toMatch(
      /GRANT SELECT, INSERT ON public\.hi_procedure_contracts TO authenticated;/u,
    );
    const grantsAll =
      /GRANT SELECT, INSERT, UPDATE, DELETE ON ([^;]*?) TO authenticated, service_role;/u.exec(
        statements,
      )![1]!;
    expect(grantsAll).not.toContain('hi_procedure_contracts');
    expect(statements).toMatch(
      /BEFORE UPDATE ON public\.hi_procedure_contracts\s+FOR EACH ROW EXECUTE FUNCTION public\.hi_block_contract_update\(\)/u,
    );
  });

  it('funções de gatilho são SECURITY DEFINER com search_path fixo e sem EXECUTE público', () => {
    for (const fn of ['hi_assert_professional_in_clinic', 'hi_block_contract_update']) {
      expect(migration).toMatch(
        new RegExp(
          `FUNCTION public\\.${fn}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`,
          'u',
        ),
      );
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`,
      );
    }
  });

  it('regras de domínio no banco: ANS 6 dígitos, valores no limite TISS, vigência coerente', () => {
    expect(migration).toContain("registro_ans ~ '^[0-9]{6}$'");
    expect(migration).toContain('unit_value_cents >= 0 AND unit_value_cents <= 9999999999');
    expect(migration).toContain('valid_until IS NULL OR valid_until >= valid_from');
    expect(migration).toContain("provider_id_value ~ '^[A-Z0-9]{12}[0-9]{2}$'");
    expect(migration).toMatch(/hi_credentials_no_overlap EXCLUDE USING gist/u);
  });

  it('journal: idx = prefixo, when depois da 0143 e sem valor no futuro distante (D19)', () => {
    const e0143 = journal.entries.find((e) => e.tag === '0143_tiss_catalog')!;
    const e0144 = journal.entries.find((e) => e.tag === '0144_hi_clinic_setup')!;
    expect(e0144.idx).toBe(144);
    expect(e0144.when).toBeGreaterThan(e0143.when);
    // criado com o relógio real de 11/11/2026; nunca um valor "redondo" no futuro
    expect(e0144.when).toBeLessThan(Date.UTC(2026, 10, 12));
  });
});
