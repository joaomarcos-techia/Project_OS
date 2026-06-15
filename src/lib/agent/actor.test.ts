import { describe, expect, it } from 'vitest';

import { agentIdemKey, agentMutationActor, agentRequestContext } from './actor';

const CONV = '11111111-1111-1111-1111-111111111111';

describe('agentIdemKey (R1 — idempotência por conteúdo, não por eventId)', () => {
  it('é determinística: mesma conversa+intent+args → mesma chave', () => {
    const a = agentIdemKey(CONV, 'schedule_appointment', { doctor: 'd1', at: '2026-07-01T10:00:00Z' });
    const b = agentIdemKey(CONV, 'schedule_appointment', { doctor: 'd1', at: '2026-07-01T10:00:00Z' });
    expect(a).toBe(b);
  });

  it('muda quando os args mudam (operação lógica diferente)', () => {
    const a = agentIdemKey(CONV, 'schedule_appointment', { at: '2026-07-01T10:00:00Z' });
    const b = agentIdemKey(CONV, 'schedule_appointment', { at: '2026-07-01T11:00:00Z' });
    expect(a).not.toBe(b);
  });

  it('muda quando o intent muda', () => {
    expect(agentIdemKey(CONV, 'confirm_appointment', { id: 'x' })).not.toBe(
      agentIdemKey(CONV, 'cancel_appointment', { id: 'x' }),
    );
  });

  it('isola por conversa (não vaza entre pacientes)', () => {
    const other = '22222222-2222-2222-2222-222222222222';
    expect(agentIdemKey(CONV, 'schedule_appointment', { at: 'z' })).not.toBe(
      agentIdemKey(other, 'schedule_appointment', { at: 'z' }),
    );
  });

  it('emite hex compatível com o formato idemKey() dos contextos (^[a-f0-9]{8,}$)', () => {
    expect(agentIdemKey(CONV, 'x', {})).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('agent actor identity (R6)', () => {
  it('ator de sistema: userId null + clinicId do turno (nunca conversationId como id)', () => {
    const actor = agentMutationActor({ clinicId: 'c1', eventId: 'e1', aiRequestId: 'r1' });
    expect(actor).toEqual({ clinicId: 'c1', userId: null });
  });

  it('requestContext usa eventId como correlation e aiRequestId como requestId', () => {
    const rc = agentRequestContext({ clinicId: 'c1', eventId: 'e1', aiRequestId: 'r1' });
    expect(rc.correlationId).toBe('e1');
    expect(rc.requestId).toBe('r1');
    expect(rc.ip).toBeNull();
  });
});
