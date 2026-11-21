import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0147_hi_guides.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const TABLES = [
  'hi_guides',
  'hi_guide_snapshots',
  'hi_guide_items',
  'hi_guide_events',
  'hi_files',
] as const;
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

describe('migration 0147 — guias TISS (P1.8)', () => {
  it('é aditiva, sem seed, sem BEGIN/COMMIT', () => {
    expect(noBodies).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/iu);
    expect(noBodies).not.toMatch(/INSERT INTO public\.hi_/u);
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/imu);
    // Os ALTER TABLE só acrescentam UNIQUE (chaves das FKs compostas) ou a FK do snapshot.
    for (const [stmt] of noBodies.matchAll(/ALTER TABLE public\.\w+ (?!ENABLE|FORCE)[^;]*;/gu)) {
      expect(stmt).toMatch(/ADD CONSTRAINT \w+ (?:UNIQUE|FOREIGN KEY)/u);
    }
  });

  it.each(TABLES)('%s: RLS literal do defaultTenantPolicy v2', (t) => {
    const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
    expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
  });

  it('FKs entre tabelas do convênio começam pela clínica; operadora e tipo de guia entram na chave', () => {
    const refs = [
      ...statements.matchAll(/FOREIGN KEY \(([^)]*)\)\s+REFERENCES public\.(hi_\w+) \(([^)]*)\)/gu),
    ];
    expect(refs.length).toBeGreaterThanOrEqual(15);
    for (const [, cols, , target] of refs) {
      expect(cols!.startsWith('clinic_id, ')).toBe(true);
      expect(target!.startsWith('clinic_id, ')).toBe(true);
    }
    expect(statements).toMatch(
      /FOREIGN KEY \(clinic_id, membership_id, insurer_id\)\s+REFERENCES public\.hi_memberships \(clinic_id, id, insurer_id\)/u,
    );
    expect(statements).toMatch(
      /FOREIGN KEY \(clinic_id, authorization_id, insurer_id, guide_type\)\s+REFERENCES public\.hi_authorizations \(clinic_id, id, insurer_id, guide_type\)/u,
    );
    expect(statements).toMatch(
      /FOREIGN KEY \(clinic_id, guide_id, guide_type, live\)\s+REFERENCES public\.hi_guides \(clinic_id, id, guide_type, live\) ON UPDATE CASCADE/u,
    );
  });

  it('sem cobrança dupla, com a SP/SADT agrupada permitida', () => {
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX hi_guide_items_live_billing_uniq\s+ON public\.hi_guide_items \(clinic_id, appointment_id, table_code, procedure_code\)\s+WHERE live AND appointment_id IS NOT NULL;/u,
    );
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX hi_guide_items_live_consulta_uniq\s+ON public\.hi_guide_items \(clinic_id, appointment_id\)\s+WHERE live AND guide_type = 'consulta'/u,
    );
    // Nenhum UNIQUE de "uma guia por atendimento" na guia: impediria o agrupamento.
    expect(statements).not.toMatch(/ON public\.hi_guides \([^)]*appointment/u);
    expect(statements).toMatch(
      /CONSTRAINT hi_guides_number_uniq UNIQUE \(clinic_id, insurer_id, number\)/u,
    );
    expect(statements).toMatch(
      /CONSTRAINT hi_guides_idem_uniq UNIQUE \(clinic_id, idempotency_key\)/u,
    );
  });

  it('valor só do contrato e total com a conta do builder (sadtItemTotalCents)', () => {
    expect(sqlText).toContain('NEW.unit_value_cents <> v_contract.unit_value_cents');
    expect(statements).toContain(
      'total_value_cents = (quantity::bigint * unit_value_cents * factor_hundredths + 50) / 100',
    );
  });

  it('transições não editoriais só para o código do banco com dono; gatilho de estado é INVOKER', () => {
    const fn = sqlText.match(
      /CREATE OR REPLACE FUNCTION public\.hi_guide_transition\(\)[\s\S]*?\$\$;/u,
    )![0];
    expect(fn).not.toMatch(/SECURITY DEFINER/u);
    expect(fn).toMatch(/current_user = pg_get_userbyid\(c\.relowner\)/u);
    expect(fn).toMatch(/ELSIF v_owner AND \(/u);
    expect(fn).toMatch(/'approved>in_batch'/u);
    // Os demais gatilhos são DEFINER com search_path fixo e sem EXECUTE para o runtime.
    for (const name of [
      'hi_guide_refs',
      'hi_guide_apply_replacement',
      'hi_guide_record_event',
      'hi_guard_guide_item',
      'hi_guard_guide_snapshot',
      'hi_guard_file',
    ]) {
      expect(sqlText).toMatch(
        new RegExp(
          `FUNCTION public\\.${name}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`,
          'u',
        ),
      );
      expect(sqlText).toContain(
        `REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;`,
      );
    }
  });

  it('snapshot cifrado; arquivo só referência opaca e SHA-256 (sem bytes no banco)', () => {
    expect(statements).not.toMatch(/\bbytea\b/u);
    expect(statements).toMatch(/content_encrypted text NOT NULL/u);
    expect(statements).not.toMatch(/\bcontent\s+(?:text|jsonb)\b/u);
    expect(statements).toContain("CHECK (storage_ref ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$')");
  });

  it('runtime: histórico só SELECT; snapshot e arquivo só SELECT/INSERT; nunca DELETE de guia; anon nunca', () => {
    expect(statements).toContain(
      'GRANT SELECT ON public.hi_guide_events TO authenticated, service_role;',
    );
    expect(statements).toContain(
      'GRANT SELECT, INSERT ON public.hi_guide_snapshots, public.hi_files TO authenticated, service_role;',
    );
    expect(statements).not.toMatch(/GRANT [^;]*DELETE[^;]*ON public\.hi_guides\b/u);
    expect(statements).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/u);
    // Horários de conferência, aprovação e cancelamento são do banco, não do cliente.
    const guideUpdate = statements.match(/GRANT UPDATE \(([^)]*)\) ON public\.hi_guides/u)![1]!;
    for (const col of ['reviewed_at', 'approved_at', 'cancelled_at', 'live', 'version', 'number']) {
      expect(guideUpdate).not.toMatch(new RegExp(`\\b${col}\\b`, 'u'));
    }
  });

  it('CHECK de motivo não aceita NULL (char_length(NULL) passaria)', () => {
    expect(statements).toMatch(
      /cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL\s+AND char_length\(btrim\(cancel_reason\)\)/u,
    );
    expect(read('0146_hi_authorizations.sql')).toMatch(
      /OR \(overrun_reason IS NOT NULL AND char_length\(btrim\(overrun_reason\)\) BETWEEN 10 AND 500/u,
    );
  });

  it('journal: idx 147, depois da 0146, versão lógica crescente', () => {
    const e46 = journal.entries.find((e) => e.tag === '0146_hi_authorizations')!;
    const e47 = journal.entries.find((e) => e.tag === '0147_hi_guides')!;
    expect(e47.idx).toBe(147);
    expect(e47.when).toBeGreaterThan(e46.when);
  });
});
