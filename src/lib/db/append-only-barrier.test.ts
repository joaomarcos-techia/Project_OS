import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CLINIC_AUDIT_BARRIER,
  CLINIC_AUDIT_FUNCTION_SHA256,
  type CatalogQuery,
  inspectAppendOnlyBarrier,
  requiredMonths,
  sealAuditPartitionsIfInstalled,
} from './append-only-barrier';

const CANDIDATE = 'docs/convenios/migrations/0171_audit_trails_append_only.candidate.sql';

/** Corpo entre `AS $$` e `$$;` — é o que o Postgres guarda em `pg_proc.prosrc`. */
function functionBody(sqlText: string, qualified: string): string {
  const i = sqlText.indexOf(`CREATE OR REPLACE FUNCTION ${qualified}()`);
  if (i < 0) throw new Error(`${qualified} não está na candidata`);
  const open = sqlText.indexOf('AS $$', i) + 'AS $$'.length;
  return sqlText.slice(open, sqlText.indexOf('$$;', open));
}

describe('append-only-barrier (S5)', () => {
  it('os hashes fixados batem com os corpos das funções da candidata 0171 (mudar um exige mudar o outro)', () => {
    const text = readFileSync(CANDIDATE, 'utf8');
    for (const [fn, expected] of Object.entries(CLINIC_AUDIT_FUNCTION_SHA256)) {
      expect(createHash('sha256').update(functionBody(text, fn), 'utf8').digest('hex'), fn).toBe(
        expected,
      );
    }
  });

  it('a spec da clínica cobre os nomes que a candidata cria', () => {
    const text = readFileSync(CANDIDATE, 'utf8');
    expect(text).toContain(`VALUES ('${CLINIC_AUDIT_BARRIER.schemaVersion}')`);
    for (const t of CLINIC_AUDIT_BARRIER.trails) {
      expect(text).toContain(`CREATE TRIGGER ${t.rowTrigger}`);
      expect(text).toContain(`TRIGGER ${t.stmtTrigger}`);
    }
  });

  it('requiredMonths: mês corrente e anteriores, sem descer abaixo do primeiro mês da trilha', () => {
    expect(requiredMonths(new Date('2026-11-27T03:00:00Z'), 6, '2026-05')).toEqual([
      '2026_11',
      '2026_10',
      '2026_09',
      '2026_08',
      '2026_07',
      '2026_06',
    ]);
    expect(requiredMonths(new Date('2026-07-01T00:00:00Z'), 6, '2026-05')).toEqual([
      '2026_07',
      '2026_06',
      '2026_05',
    ]);
    expect(requiredMonths(new Date('2027-01-15T00:00:00Z'), 2, '2026-05')).toEqual([
      '2027_01',
      '2026_12',
    ]);
  });

  it('sem a barreira aplicada (_schema_version sem a versão): nada a exigir, nenhuma outra consulta', async () => {
    const calls: string[] = [];
    const query: CatalogQuery = async (text) => {
      calls.push(text);
      return [{ installed: false }];
    };
    await expect(inspectAppendOnlyBarrier(query, CLINIC_AUDIT_BARRIER)).resolves.toEqual({
      id: 'clinic_audit',
      installed: false,
      ok: true,
      relationsChecked: 0,
      findings: [],
    });
    expect(calls).toHaveLength(1);
  });

  it('o UPDATE do service_role só é aceito no PAI de audit_events; na partição, é achado', async () => {
    const single = { ...CLINIC_AUDIT_BARRIER, trails: [CLINIC_AUDIT_BARRIER.trails[0]!] };
    const query: CatalogQuery = async (text) => {
      if (text.includes('_schema_version')) return [{ installed: true }];
      if (text.includes('from pg_proc'))
        return Object.entries(CLINIC_AUDIT_FUNCTION_SHA256).map(([fn, h]) => ({ fn, h }));
      if (text.includes('from pg_trigger')) {
        return ['public.audit_events', 'public.audit_events_2026_11'].flatMap((rel) =>
          ['audit_events_append_only_row', 'audit_events_append_only_stmt'].map((tg) => ({
            rel,
            tg,
            st: 'A',
            fn: 'clinic_audit_append_only',
          })),
        );
      }
      if (text.includes('has_table_privilege')) {
        return [
          { rel: 'public.audit_events', is_parent: true, role: 'service_role', priv: 'UPDATE' },
          {
            rel: 'public.audit_events_2026_11',
            is_parent: false,
            role: 'service_role',
            priv: 'UPDATE',
          },
        ];
      }
      return [
        { rel: 'public.audit_events', name: 'audit_events', is_parent: true },
        { rel: 'public.audit_events_2026_11', name: 'audit_events_2026_11', is_parent: false },
      ];
    };
    const r = await inspectAppendOnlyBarrier(query, single, new Date('2026-11-27T00:00:00Z'));
    expect(r.ok).toBe(false);
    expect(r.findings).toContainEqual({
      kind: 'privilege_granted',
      table: 'public.audit_events_2026_11',
      role: 'service_role',
      privilege: 'UPDATE',
    });
    expect(r.findings).not.toContainEqual(
      expect.objectContaining({ table: 'public.audit_events', kind: 'privilege_granted' }),
    );
    // só a de novembro anexada: os 5 meses anteriores faltam
    expect(
      r.findings
        .filter((f) => f.kind === 'partition_missing')
        .map((f) => (f as { month: string }).month),
    ).toEqual(['2026_10', '2026_09', '2026_08', '2026_07', '2026_06']);
  });

  it('sealAuditPartitionsIfInstalled: sem a função da barreira não chama nada; com ela, devolve quantas selou', async () => {
    const none: CatalogQuery = async () => [{ ok: false }];
    await expect(sealAuditPartitionsIfInstalled(none)).resolves.toBeNull();
    const calls: string[] = [];
    const some: CatalogQuery = async (text) => {
      calls.push(text);
      return text.includes('to_regprocedure') ? [{ ok: true }] : [{ sealed: 14 }];
    };
    await expect(sealAuditPartitionsIfInstalled(some)).resolves.toBe(14);
    expect(calls[1]).toContain('public.clinic_audit_seal_partitions()');
  });
});
