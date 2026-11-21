import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const m0145 = read('0145_hi_memberships.sql');
const m0144 = read('0144_hi_clinic_setup.sql');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const statements = m0145.replace(/--.*$/gmu, '');
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

describe('migration 0145 — carteirinhas (P1.5)', () => {
  it('é aditiva e não grava linha', () => {
    expect(statements).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(statements).not.toMatch(/INSERT INTO public\.hi_/u);
    expect(m0145).toContain('CREATE TABLE public.hi_memberships (');
  });

  it('número nunca em claro: ciphertext, HMAC hex de 64 e só os últimos 4', () => {
    expect(m0145).toContain("card_number_hash ~ '^[0-9a-f]{64}$'");
    expect(m0145).toContain("card_last4 ~ '^[0-9A-Za-z]{1,4}$'");
    expect(statements).not.toMatch(/\bcard_number\s+text/u);
  });

  it('RLS com a política literal do defaultTenantPolicy v2', () => {
    const expected = norm(
      defaultTenantPolicy('hi_memberships').replace(/^-- GENERATED_BY.*\n/u, ''),
    );
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
  });

  it('operadora, plano e substituição por FK composta; paciente da mesma clínica por gatilho', () => {
    const refs = [
      ...statements.matchAll(/FOREIGN KEY \(([^)]*)\)\s+REFERENCES public\.(hi_\w+) \(([^)]*)\)/gu),
    ];
    expect(refs.map((r) => [r[1], r[2], r[3]])).toEqual([
      ['clinic_id, insurer_id', 'hi_insurers', 'clinic_id, id'],
      ['clinic_id, plan_id', 'hi_plans', 'clinic_id, id'],
      ['clinic_id, replaced_by_id', 'hi_memberships', 'clinic_id, id'],
    ]);
    expect(statements).toMatch(
      /BEFORE INSERT ON public\.hi_memberships\s+FOR EACH ROW EXECUTE FUNCTION public\.hi_assert_patient_in_clinic\(\)/u,
    );
  });

  it('únicos: número ativo por operadora e uma preferencial por paciente', () => {
    expect(statements).toMatch(
      /UNIQUE INDEX hi_memberships_active_card_uniq[\s\S]*?WHERE status = 'active'/u,
    );
    expect(statements).toMatch(
      /UNIQUE INDEX hi_memberships_preferred_uniq[\s\S]*?WHERE is_preferred/u,
    );
  });

  it('runtime sem DELETE (inativar em vez de excluir); anon sem acesso', () => {
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE ON public.hi_memberships TO authenticated;',
    );
    expect(statements).not.toMatch(/GRANT [^;]*DELETE[^;]* TO authenticated/u);
    expect(statements).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/u);
  });

  it('journal: idx 145, depois da 0144, relógio real', () => {
    const e44 = journal.entries.find((e) => e.tag === '0144_hi_clinic_setup')!;
    const e45 = journal.entries.find((e) => e.tag === '0145_hi_memberships')!;
    expect(e45.idx).toBe(145);
    expect(e45.when).toBeGreaterThan(e44.when);
    expect(e45.when).toBeLessThan(Date.UTC(2026, 10, 13));
  });
});

describe('migration 0144 — numeração atômica (P7.1)', () => {
  it('hi_next_counter: INSERT … ON CONFLICT DO UPDATE … RETURNING, SECURITY INVOKER', () => {
    expect(m0144).toMatch(
      /FUNCTION public\.hi_next_counter\(p_clinic_id uuid, p_kind text, p_scope_key text DEFAULT ''\)\s+RETURNS bigint LANGUAGE sql VOLATILE SECURITY INVOKER/u,
    );
    expect(m0144).toMatch(
      /ON CONFLICT \(clinic_id, kind, scope_key\)\s+DO UPDATE SET last_value = c\.last_value \+ 1/u,
    );
    expect(m0144).toContain(
      'REVOKE ALL ON FUNCTION public.hi_next_counter(uuid, text, text) FROM PUBLIC, anon;',
    );
    expect(m0144).toContain(
      'GRANT EXECUTE ON FUNCTION public.hi_next_counter(uuid, text, text) TO authenticated, service_role;',
    );
  });
});
