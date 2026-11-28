import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ANCHOR_GENESIS,
  AUDIT_ANONYMIZED_KEYS,
  chainDay,
  CLINIC_AUDIT_ANCHOR,
  computeAnchors,
  PLATFORM_AUDIT_ANCHOR,
  verifyAnchors,
  type AnchorQuery,
} from './audit-anchor';

/** Banco de mentira: dia → hashes das linhas (o SQL real é provado no harness de banco). */
function fakeDb(days: Record<string, string[]>): {
  query: AnchorQuery;
  days: Record<string, string[]>;
} {
  return {
    days,
    query: async (_text, params) => (days[String(params[0])] ?? []).map((h) => ({ h })),
  };
}

describe('S5 — ancoragem por hash encadeado', () => {
  it('a lista de chaves anonimizadas é a MESMA do gatilho da 0171 (sem drift)', () => {
    const sql = readFileSync(
      'docs/convenios/migrations/0171_audit_trails_append_only.candidate.sql',
      'utf8',
    );
    const literal = `pii text[] := ARRAY[${AUDIT_ANONYMIZED_KEYS.map((k) => `'${k}'`).join(', ')}]`;
    expect(sql).toContain(literal);
    expect(CLINIC_AUDIT_ANCHOR.canonicalRowSql).toContain("'dataNascimento'");
  });

  it('o canônico cobre todas as colunas, com datas em UTC fixo', () => {
    for (const col of [
      'id',
      'clinic_id',
      'user_id',
      'action',
      'resource_type',
      'resource_id',
      'ip_address',
      'user_agent',
      'request_id',
      'correlation_id',
    ])
      expect(CLINIC_AUDIT_ANCHOR.canonicalRowSql).toContain(col);
    for (const col of ['super_admin_id', 'target_clinic_id', 'payload'])
      expect(PLATFORM_AUDIT_ANCHOR.canonicalRowSql).toContain(col);
    expect(CLINIC_AUDIT_ANCHOR.canonicalRowSql).toContain("AT TIME ZONE 'UTC'");
  });

  it('determinístico, e trilha, dia, ordem e anterior entram no resumo', () => {
    const base = chainDay(ANCHOR_GENESIS, 'clinic_audit', '2026-11-27', ['a', 'b']);
    expect(chainDay(ANCHOR_GENESIS, 'clinic_audit', '2026-11-27', ['a', 'b'])).toBe(base);
    expect(chainDay(ANCHOR_GENESIS, 'platform_audit', '2026-11-27', ['a', 'b'])).not.toBe(base);
    expect(chainDay(ANCHOR_GENESIS, 'clinic_audit', '2026-11-28', ['a', 'b'])).not.toBe(base);
    expect(chainDay(ANCHOR_GENESIS, 'clinic_audit', '2026-11-27', ['b', 'a'])).not.toBe(base);
    expect(chainDay('outro', 'clinic_audit', '2026-11-27', ['a', 'b'])).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encadeia dia a dia (inclusive dia vazio) e confere íntegro', async () => {
    const db = fakeDb({ '2026-11-25': ['x1'], '2026-11-27': ['y1', 'y2'] });
    const anchors = await computeAnchors(db.query, CLINIC_AUDIT_ANCHOR, '2026-11-25', '2026-11-27');
    expect(anchors.map((a) => [a.day, a.count])).toEqual([
      ['2026-11-25', 1],
      ['2026-11-26', 0],
      ['2026-11-27', 2],
    ]);
    expect(anchors[0]!.prev).toBe(ANCHOR_GENESIS);
    expect(anchors[1]!.prev).toBe(anchors[0]!.digest);
    expect(await verifyAnchors(db.query, CLINIC_AUDIT_ANCHOR, anchors)).toEqual([]);
  });

  it('linha alterada, apagada ou inserida depois: acusa o dia (e a quantidade separa os casos)', async () => {
    const db = fakeDb({ '2026-11-25': ['x1'], '2026-11-26': ['z1'], '2026-11-27': ['y1', 'y2'] });
    const anchors = await computeAnchors(db.query, CLINIC_AUDIT_ANCHOR, '2026-11-25', '2026-11-27');
    db.days['2026-11-25'] = ['x1-alterada'];
    db.days['2026-11-26'] = [];
    db.days['2026-11-27'] = ['y1', 'y2', 'retroativa'];
    expect(await verifyAnchors(db.query, CLINIC_AUDIT_ANCHOR, anchors)).toEqual([
      { kind: 'day_changed', day: '2026-11-25', storedCount: 1, currentCount: 1 },
      { kind: 'day_changed', day: '2026-11-26', storedCount: 1, currentCount: 0 },
      { kind: 'day_changed', day: '2026-11-27', storedCount: 2, currentCount: 3 },
    ]);
  });

  it('a sequência guardada editada (dia removido) ou de outra trilha é acusada', async () => {
    const db = fakeDb({ '2026-11-25': ['x1'], '2026-11-26': ['z1'], '2026-11-27': ['y1'] });
    const anchors = await computeAnchors(db.query, CLINIC_AUDIT_ANCHOR, '2026-11-25', '2026-11-27');
    const gap = [anchors[0]!, anchors[2]!];
    expect(await verifyAnchors(db.query, CLINIC_AUDIT_ANCHOR, gap)).toEqual([
      expect.objectContaining({ kind: 'chain_broken', day: '2026-11-27' }),
    ]);
    expect(await verifyAnchors(db.query, PLATFORM_AUDIT_ANCHOR, anchors)).toHaveLength(3);
  });

  it('dia e intervalo inválidos são recusados (nada de SQL com entrada livre)', async () => {
    const db = fakeDb({});
    await expect(
      computeAnchors(db.query, CLINIC_AUDIT_ANCHOR, "2026-11-25'; drop", '2026-11-26'),
    ).rejects.toThrow('intervalo');
    await expect(
      computeAnchors(db.query, CLINIC_AUDIT_ANCHOR, '2026-11-27', '2026-11-25'),
    ).rejects.toThrow();
  });
});
