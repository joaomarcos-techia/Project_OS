import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0146_hi_authorizations.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const TABLES = [
  'hi_authorizations',
  'hi_authorization_items',
  'hi_authorization_consumptions',
  'hi_authorization_attachments',
  'hi_authorization_events',
] as const;
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

describe('migration 0146 — autorizações (P1.7)', () => {
  it('é aditiva, sem seed, sem BEGIN/COMMIT', () => {
    expect(noBodies).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(noBodies).not.toMatch(/INSERT INTO public\.hi_/u);
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/imu);
  });

  it.each(TABLES)('%s: RLS literal do defaultTenantPolicy v2', (t) => {
    const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
  });

  it('toda referência entre tabelas do convênio é FK composta por clínica', () => {
    const refs = [
      ...statements.matchAll(/FOREIGN KEY \(([^)]*)\)\s+REFERENCES public\.(hi_\w+) \(([^)]*)\)/gu),
    ];
    expect(refs.length).toBe(8);
    for (const [, cols, , target] of refs) {
      expect(cols!.startsWith('clinic_id, ')).toBe(true);
      expect(target).toBe('clinic_id, id');
    }
  });

  it('nenhuma autorização fictícia: estado autorizado exige evidência da operadora', () => {
    expect(sqlText).toMatch(/CONSTRAINT hi_authorizations_evidence_chk CHECK/u);
    expect(sqlText).toMatch(/authorized_on IS NOT NULL\s+AND recorded_by IS NOT NULL/u);
    expect(sqlText).toMatch(/origin <> 'connector' OR connector_receipt IS NOT NULL/u);
  });

  it('senha só cifrada; comprovante só referência e SHA-256 (sem bytes no banco)', () => {
    expect(statements).not.toMatch(/\bpassword\s+text/u);
    expect(statements).toMatch(/password_encrypted text/u);
    expect(statements).not.toMatch(/\bbytea\b/u);
    expect(sqlText).toContain("content_sha256 ~ '^[0-9a-f]{64}$'");
  });

  it('consumo: trava do item, idempotência antes do saldo, exceção explícita, estorno único', () => {
    expect(sqlText).toMatch(/FOR UPDATE;/u);
    expect(sqlText).toMatch(/idempotency_key = NEW\.idempotency_key[\s\S]*?ERRCODE = '23505'/u);
    expect(sqlText).toMatch(
      /overrun_approved_by IS NULL THEN\s+RAISE EXCEPTION 'Consumo acima do autorizado/u,
    );
    expect(statements).toMatch(
      /CONSTRAINT hi_authorization_consumptions_reverse_once UNIQUE \(reverses_id\)/u,
    );
  });

  it('runtime: consumo, anexos e histórico só SELECT/INSERT; consumido sem UPDATE direto; anon nunca', () => {
    expect(statements).toMatch(
      /GRANT SELECT, INSERT ON public\.hi_authorization_consumptions, public\.hi_authorization_attachments,\s+public\.hi_authorization_events TO authenticated;/u,
    );
    expect(statements).toContain(
      'GRANT UPDATE (quantity_requested, quantity_authorized) ON public.hi_authorization_items TO authenticated;',
    );
    expect(statements).not.toMatch(/GRANT [^;]*DELETE[^;]* TO authenticated/u);
    expect(statements).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/u);
  });

  it('journal: idx 146, depois da 0145, relógio real', () => {
    const e45 = journal.entries.find((e) => e.tag === '0145_hi_memberships')!;
    const e46 = journal.entries.find((e) => e.tag === '0146_hi_authorizations')!;
    expect(e46.idx).toBe(146);
    expect(e46.when).toBeGreaterThan(e45.when);
    expect(e46.when).toBeLessThan(Date.UTC(2026, 10, 13));
  });
});
