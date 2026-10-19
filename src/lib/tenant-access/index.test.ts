/**
 * Gate de escrita por status da clínica (ADR-046 §Consequences — dívida fechada).
 *
 * POR QUE: até 2026-07-20 o `requireActiveClinic` existia mas era chamado em SETE
 * lugares, TODOS em `equipe/actions.ts`. Uma clínica `suspended` seguia criando
 * paciente, agendando consulta e escrevendo prontuário — só não convidava
 * funcionário. O "somente leitura" era encenação.
 *
 * O gate agora vive no chokepoint (`idempotentMutation`), então mutação nova
 * nasce protegida. Estes testes congelam as EXCEÇÕES, que são a parte perigosa:
 * bloquear demais tranca o cliente fora da própria regularização.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { assertClinicCanWriteTx, shouldEnforceWriteGate } from './index';

describe('shouldEnforceWriteGate — quem passa pelo gate', () => {
  it('mutação normal de usuário: ENFORCE', () => {
    expect(shouldEnforceWriteGate({ resourceType: 'patient' })).toBe(true);
    expect(shouldEnforceWriteGate({ resourceType: 'appointment' })).toBe(true);
    expect(shouldEnforceWriteGate({ resourceType: 'prontuario' })).toBe(true);
  });

  // ADR-016 invariante 2: worker/outbox é status-AGNÓSTICO. Uma reconciliação
  // financeira não se perde porque o billing venceu — e o AI agent responde no
  // WhatsApp sem sessão de usuário.
  it('ator de sistema (worker/AI agent): NÃO enforce', () => {
    expect(
      shouldEnforceWriteGate({
        resourceType: 'appointment',
        actor: { clinicId: 'c1', userId: null },
      }),
    ).toBe(false);
  });

  // Suporte precisa conseguir agir numa clínica suspensa — senão o "entre em
  // contato com o suporte" do aviso não resolve nada.
  it('super_admin impersonando: NÃO enforce', () => {
    expect(shouldEnforceWriteGate({ resourceType: 'patient', impersonating: true })).toBe(false);
  });

  // LGPD Art. 18: o direito do TITULAR não depende de a clínica estar em dia.
  // Bloquear export/delete por inadimplência transferiria ao paciente a punição
  // de uma disputa comercial da qual ele não participa.
  it('pedido LGPD do titular: NÃO enforce', () => {
    expect(shouldEnforceWriteGate({ resourceType: 'lgpd_request' })).toBe(false);
  });

  it('reativação da assinatura cancelada: NÃO enforce', () => {
    expect(shouldEnforceWriteGate({ resourceType: 'subscription_reactivation' })).toBe(false);
  });

  it('a exceção LGPD é pelo resourceType exato, não por prefixo', () => {
    // Evita que alguém crie `lgpd_request_something` e escape do gate sem querer.
    expect(shouldEnforceWriteGate({ resourceType: 'lgpd_request_x' })).toBe(true);
    expect(shouldEnforceWriteGate({ resourceType: 'subscription_reactivation_x' })).toBe(true);
  });

  it('ator de sistema vence mesmo com resourceType clínico', () => {
    expect(
      shouldEnforceWriteGate({
        resourceType: 'prontuario',
        actor: { clinicId: 'c1', userId: null },
      }),
    ).toBe(false);
  });
});

describe('trial absoluto da nova oferta no gate central', () => {
  const clinicId = '11111111-1111-4111-8111-111111111111';

  it('bloqueia escrita quando o banco diz que o trial estrito terminou', async () => {
    const execute = vi.fn().mockResolvedValue([{ status: 'trial', trial_expired: true }]);
    await expect(assertClinicCanWriteTx({ execute } as unknown as Tx, clinicId)).rejects.toMatchObject(
      { code: 'clinic_write_blocked', status: 'pending_payment' },
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 'trial', trial_expired: false },
    { status: 'active', trial_expired: false },
  ])('preserva o acesso de assinatura vigente: %j', async (row) => {
    const execute = vi.fn().mockResolvedValue([row]);
    await expect(assertClinicCanWriteTx({ execute } as unknown as Tx, clinicId)).resolves.toBeUndefined();
  });
});
