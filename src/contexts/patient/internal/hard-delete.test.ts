/**
 * Regressão F-02 / F-11 (auditoria forense 2026-06-10).
 *
 * - F-11: `anonymizePatientAuditTrail` é a FONTE ÚNICA do strip de PII no audit
 *   (rota cron + script dev). Estes testes congelam o conjunto de chaves PII
 *   removidas — se alguém remover uma chave do UPDATE, o teste quebra.
 * - F-02: `isFkRestrictViolation` decide o caminho anonimização-vs-falha do
 *   hard-delete por paciente; um falso negativo regrediria para o
 *   "lote tudo-ou-nada" que a auditoria condenou.
 *
 * As funções que tocam banco (hardDeletePatients) são cobertas por smoke
 * contra o banco dev (scripts/smoke-c5.ts + runbook de remediação) — aqui só
 * lógica pura/SQL building.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';

import {
  anonymizePatientAuditTrail,
  isFkRestrictViolation,
  PATIENT_PII_AUDIT_KEYS,
} from './hard-delete';

const dialect = new PgDialect();

function render(query: SQL): { text: string; params: unknown[] } {
  const q = dialect.sqlToQuery(query);
  return { text: q.sql, params: q.params };
}

describe('anonymizePatientAuditTrail (F-11 — fonte única de strip de PII)', () => {
  async function capture(ids: string[]): Promise<Array<{ text: string; params: unknown[] }>> {
    const captured: Array<{ text: string; params: unknown[] }> = [];
    const fakeAdmin = {
      execute: (query: SQL) => {
        captured.push(render(query));
        return Promise.resolve([]);
      },
    };
    await anonymizePatientAuditTrail(fakeAdmin, ids);
    return captured;
  }

  it('remove TODAS as chaves PII de before/after em audit_events', async () => {
    const calls = await capture(['11111111-1111-1111-1111-111111111111']);
    const audit = calls.find((c) => c.text.includes('audit_events'));
    expect(audit).toBeDefined();
    for (const key of PATIENT_PII_AUDIT_KEYS) {
      // chave deve ser subtraída dos DOIS jsons (before e after)
      const occurrences = audit!.text.split(`'${key}'`).length - 1;
      expect(occurrences, `chave PII '${key}' deve ser removida de before E after`).toBe(2);
    }
    expect(audit!.text).toContain("resource_type = 'patient'");
  });

  it('congela o conjunto canônico de chaves PII (F-10 da remediação C5)', () => {
    expect([...PATIENT_PII_AUDIT_KEYS]).toEqual([
      'nome',
      'email',
      'dataNascimento',
      'sexo',
      'obitoEm',
    ]);
  });

  it('faz scrub das respostas cacheadas em idempotency_keys', async () => {
    const calls = await capture(['22222222-2222-2222-2222-222222222222']);
    const idem = calls.find((c) => c.text.includes('idempotency_keys'));
    expect(idem).toBeDefined();
    expect(idem!.text).toContain('response = NULL');
  });

  it('ids são SEMPRE bind params (CWE-89), nunca interpolados', async () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const calls = await capture([id]);
    for (const c of calls) {
      expect(c.text).not.toContain(id);
      expect(c.params.flat()).toContain(id);
    }
  });

  it('lista vazia → zero round-trips ao banco', async () => {
    const calls = await capture([]);
    expect(calls).toHaveLength(0);
  });
});

describe('isFkRestrictViolation (F-02 — decide anonimização vs falha)', () => {
  it('detecta 23503 direto (postgres-js)', () => {
    expect(isFkRestrictViolation({ code: '23503' })).toBe(true);
  });

  it('detecta 23503 embrulhado em cause (drizzle wrap)', () => {
    const err = new Error('delete failed');
    (err as Error & { cause: unknown }).cause = { code: '23503' };
    expect(isFkRestrictViolation(err)).toBe(true);
  });

  it('detecta 23503 em cadeia de cause profunda (até 5 níveis)', () => {
    const inner = { code: '23503' };
    const lvl2 = { cause: inner };
    const lvl3 = { cause: lvl2 };
    expect(isFkRestrictViolation({ cause: lvl3 })).toBe(true);
  });

  it('NÃO confunde unique violation (23505) com RESTRICT', () => {
    expect(isFkRestrictViolation({ code: '23505' })).toBe(false);
  });

  it('é fail-closed para erros sem código', () => {
    expect(isFkRestrictViolation(new Error('network'))).toBe(false);
    expect(isFkRestrictViolation(null)).toBe(false);
    expect(isFkRestrictViolation(undefined)).toBe(false);
    expect(isFkRestrictViolation('23503')).toBe(false);
  });
});
