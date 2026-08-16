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

import { PURGED_RESPONSE } from '@/lib/idempotency/purged';

import {
  anonymizePatientAuditTrail,
  anonymizePatientOutbox,
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

  it('LGPD-004: o scrub grava o sentinel expurgado, NUNCA NULL', async () => {
    // `response = NULL` já significa "reserva em andamento" no protocolo de
    // idempotência. Usá-lo para apagar PII fazia uma chave CONCLUÍDA parecer
    // in-flight: replay recebia conflito falso, o health contava operação em
    // curso e o trigger recusava o DELETE. O sentinel é não-nulo (terminal),
    // sem PII e reconhecível.
    const calls = await capture(['22222222-2222-2222-2222-222222222222']);
    const idem = calls.find((c) => c.text.includes('idempotency_keys'));
    expect(idem).toBeDefined();
    expect(idem!.text).not.toContain('response = NULL');
    expect(idem!.params).toContain(JSON.stringify(PURGED_RESPONSE));
    // Idempotente: não reescreve o que já foi expurgado.
    expect(idem!.text).toContain("response->>'purged' IS NULL");
  });

  it('ids são SEMPRE bind params (CWE-89), nunca interpolados', async () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const calls = await capture([id]);
    for (const c of calls) {
      expect(c.text).not.toContain(id);
      expect(c.params.flat()).toContain(id);
    }
  });

  it('passa vários ids como text[] válido para ANY', async () => {
    const ids = ['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555'];
    const calls = await capture(ids);
    for (const call of calls) {
      // Os ids continuam sendo bind params num text[]; o índice inicial varia
      // porque o UPDATE de idempotency_keys também vincula o sentinel.
      expect(call.text).toMatch(/ANY\(ARRAY\[\$\d+, \$\d+\]::text\[\]\)/u);
      expect(call.params).toEqual(expect.arrayContaining(ids));
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

describe('anonymizePatientOutbox (LGPD-002)', () => {
  async function capture(
    clinicId: string,
    ids: string[],
  ): Promise<Array<{ text: string; params: unknown[] }>> {
    const captured: Array<{ text: string; params: unknown[] }> = [];
    const fakeAdmin = {
      execute: (query: SQL) => {
        captured.push(render(query));
        return Promise.resolve([]);
      },
    };
    await anonymizePatientOutbox(fakeAdmin, clinicId, ids);
    return captured;
  }

  const CLINIC = '99999999-9999-9999-9999-999999999999';
  const PATIENT = '11111111-1111-1111-1111-111111111111';

  it('remove nome, e-mail e os PSEUDÔNIMOS do payload', async () => {
    // Hash de 64 chars é pseudônimo estável, não dado anônimo: quem tem o CPF
    // confirma a correspondência. Por isso cpfHash/telefoneHash saem junto.
    const [call] = await capture(CLINIC, [PATIENT]);
    for (const key of ['nome', 'email', 'cpfHash', 'telefoneHash', 'telefone', 'cpf']) {
      expect(call!.text).toContain(`- '${key}'`);
    }
  });

  it('só toca eventos TERMINAIS — fila em voo não é reescrita debaixo do handler', async () => {
    const [call] = await capture(CLINIC, [PATIENT]);
    expect(call!.text).toContain("status IN ('processed', 'skipped')");
    expect(call!.text).not.toContain('pending');
    expect(call!.text).not.toContain('processing');
  });

  it('escopa por clínica E paciente — evento de outro tenant fica intacto', async () => {
    const [call] = await capture(CLINIC, [PATIENT]);
    expect(call!.text).toContain('clinic_id =');
    expect(call!.text).toContain("payload->>'patientId' = ANY(");
    expect(call!.params).toEqual(expect.arrayContaining([CLINIC, PATIENT]));
  });

  it('ids nunca são interpolados na string (CWE-89)', async () => {
    const [call] = await capture(CLINIC, [PATIENT]);
    expect(call!.text).not.toContain(PATIENT);
    expect(call!.params).toContain(PATIENT);
  });

  it('lista vazia → zero round-trips', async () => {
    expect(await capture(CLINIC, [])).toHaveLength(0);
  });
});
