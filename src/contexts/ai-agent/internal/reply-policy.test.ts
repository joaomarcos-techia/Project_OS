import { describe, expect, it } from 'vitest';

import { META_WINDOW_MS } from './meta-window';
import { canReplyManually } from './reply-policy';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const RECENT = ago(60_000);

const decide = (status: string, lastInboundAt: Date | null = RECENT) =>
  canReplyManually({ status, lastInboundAt, now: NOW });

describe('canReplyManually — matriz de status (ADR-047 invariante 2)', () => {
  it('handoff + janela aberta → permitido', () => {
    expect(decide('handoff')).toEqual({ allowed: true });
  });

  // O caso que a invariante existe para impedir: em 'active' o agente ainda
  // responde ao próximo inbound e o paciente receberia duas respostas.
  it('active → bloqueado (corrida agente × humano)', () => {
    expect(decide('active')).toEqual({ allowed: false, reason: 'not_handoff' });
  });

  it('closed → bloqueado', () => {
    expect(decide('closed')).toEqual({ allowed: false, reason: 'not_handoff' });
  });

  it('abandoned → bloqueado', () => {
    expect(decide('abandoned')).toEqual({ allowed: false, reason: 'not_handoff' });
  });
});

describe('canReplyManually — janela de 24h (ADR-047 invariante 1)', () => {
  it('handoff + inbound dentro de 24h → permitido', () => {
    expect(decide('handoff', ago(META_WINDOW_MS - 1))).toEqual({ allowed: true });
  });

  it('handoff + inbound exatamente em 24h → bloqueado', () => {
    expect(decide('handoff', ago(META_WINDOW_MS))).toEqual({
      allowed: false,
      reason: 'window_closed',
    });
  });

  it('handoff + inbound fora de 24h → bloqueado', () => {
    expect(decide('handoff', ago(3 * META_WINDOW_MS))).toEqual({
      allowed: false,
      reason: 'window_closed',
    });
  });

  it('handoff + nenhum inbound → bloqueado', () => {
    expect(decide('handoff', null)).toEqual({ allowed: false, reason: 'window_closed' });
  });
});

describe('canReplyManually — precedência', () => {
  // As duas podem ser verdade; a mensagem acionável é "assuma a conversa".
  it('active E janela fechada → reporta not_handoff, não window_closed', () => {
    expect(decide('active', ago(3 * META_WINDOW_MS))).toEqual({
      allowed: false,
      reason: 'not_handoff',
    });
  });
});
