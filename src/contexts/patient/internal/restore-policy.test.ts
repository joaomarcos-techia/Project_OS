/**
 * PAT-001 — o que pode e o que NUNCA pode voltar.
 *
 * O achado: a UI dizia "remoção definitiva em 30 dias", sugerindo janela de
 * arrependimento, e não existia workflow de restauração — só intervenção direta
 * no banco, sem auditoria.
 *
 * A metade difícil não é restaurar: é recusar. Um registro eliminado por LGPD
 * que reaparece é violação de direito do titular, não conveniência de operação.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PATIENT_RESTORE_WINDOW_DAYS,
  decidePatientRestore,
  describeRestoreRefusal,
  type RestoreCandidate,
} from './restore-policy';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function candidate(over: Partial<RestoreCandidate> = {}): RestoreCandidate {
  return {
    deletedAt: daysAgo(2),
    anonymizedAt: null,
    hasOpenErasureRequest: false,
    ...over,
  };
}

describe('decidePatientRestore — positivo', () => {
  it('remoção recente dentro da janela pode ser desfeita', () => {
    expect(decidePatientRestore(candidate(), NOW)).toEqual({ allowed: true });
  });

  it('a janela é a MESMA do cron de hard-delete', () => {
    expect(PATIENT_RESTORE_WINDOW_DAYS).toBe(30);
    // Último dia ainda vale; um dia depois, não.
    expect(decidePatientRestore(candidate({ deletedAt: daysAgo(30) }), NOW).allowed).toBe(true);
    expect(decidePatientRestore(candidate({ deletedAt: daysAgo(31) }), NOW).allowed).toBe(false);
  });
});

describe('decidePatientRestore — replay', () => {
  it('paciente já ativo é sucesso SEM efeito, não erro', () => {
    // Duplo restore (duplo clique, retry do operador) não pode explodir.
    const decision = decidePatientRestore(candidate({ deletedAt: null }), NOW);
    expect(decision).toEqual({ allowed: false, reason: 'not_deleted', idempotent: true });
  });
});

describe('decidePatientRestore — o que NUNCA volta', () => {
  it('anonimizado: os dados não existem mais', () => {
    expect(decidePatientRestore(candidate({ anonymizedAt: daysAgo(1) }), NOW)).toEqual({
      allowed: false,
      reason: 'anonymized',
    });
  });

  it('anonimizado DENTRO da janela ainda assim é irrecuperável', () => {
    // A ordem das checagens importa: o prazo não "reabre" o irreversível.
    const decision = decidePatientRestore(
      candidate({ deletedAt: daysAgo(1), anonymizedAt: daysAgo(1) }),
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'anonymized' });
  });

  it('eliminação LGPD em andamento bloqueia o restore', () => {
    // Restaurar aqui desfaria um direito do titular exercido formalmente — é
    // outra coisa que um clique errado do operador.
    expect(decidePatientRestore(candidate({ hasOpenErasureRequest: true }), NOW)).toEqual({
      allowed: false,
      reason: 'lgpd_erasure_pending',
    });
  });

  it('fora da janela de retenção não volta', () => {
    expect(decidePatientRestore(candidate({ deletedAt: daysAgo(45) }), NOW)).toEqual({
      allowed: false,
      reason: 'retention_expired',
    });
  });

  it('nenhuma recusa é marcada como idempotente — só o replay é', () => {
    for (const c of [
      candidate({ anonymizedAt: daysAgo(1) }),
      candidate({ hasOpenErasureRequest: true }),
      candidate({ deletedAt: daysAgo(45) }),
    ]) {
      const decision = decidePatientRestore(c, NOW);
      expect(decision.allowed).toBe(false);
      expect('idempotent' in decision && decision.idempotent).toBeFalsy();
    }
  });
});

describe('describeRestoreRefusal — o operador entende o motivo', () => {
  it('cada recusa tem texto próprio, sem jargão interno', () => {
    for (const reason of [
      'not_deleted',
      'retention_expired',
      'anonymized',
      'lgpd_erasure_pending',
    ] as const) {
      const message = describeRestoreRefusal(reason);
      expect(message.length).toBeGreaterThan(15);
      expect(message).not.toMatch(/anonymized_at|deleted_at|lgpd_requests|null/u);
    }
  });
});

describe('restorePatient — contrato da action', () => {
  const actions = readFileSync(resolve(process.cwd(), 'src/contexts/patient/actions.ts'), 'utf8');
  const block = actions.slice(
    actions.indexOf('export async function restorePatient'),
    actions.indexOf('async function liftSuppression'),
  );

  it('exige a MESMA capacidade que removeu, revalidada no banco', () => {
    expect(block).toContain('requireFreshPermission(PERMISSIONS.DELETE_PATIENT)');
  });

  it('é tenant-safe: clinicId do request, nunca de input', () => {
    expect(block).toContain('await requireClinicId()');
    expect(block).toContain('eq(patients.clinicId, clinicId)');
  });

  it('é idempotente e auditada (ator, tenant, paciente, timestamp, ação)', () => {
    expect(block).toContain("idemKey('restore'");
    expect(block).toContain("action: 'patient.core.restored'");
    expect(block).toContain('resourceId: id');
  });

  it('trava a linha: fecha a corrida com o hard-delete e com outro restore', () => {
    expect(block).toContain(".for('update')");
  });

  it('consulta pedido LGPD de eliminação em aberto antes de decidir', () => {
    expect(block).toContain("eq(lgpdRequests.type, 'delete')");
    expect(block).toContain("inArray(lgpdRequests.status, ['pending', 'processing'])");
  });

  it('levanta apenas a supressão da REMOÇÃO — óbito e opt-out permanecem', () => {
    // Sem o filtro por motivo, o paciente voltaria "liberado para mensagens"
    // mesmo tendo óbito registrado ou opt-out próprio.
    expect(block).toContain(
      "liftSuppression(tx, clinicId, row.telefoneHash, row.email, 'patient_deleted')",
    );
    expect(actions).toContain('eq(suppressionList.reason, reason)');
  });
});
