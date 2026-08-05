/**
 * Política de resposta manual (ADR-047) — as duas invariantes num único lugar
 * testável, no idiom de scheduling/state-machine.ts.
 *
 * Existe separada da action porque a action é inseparável de auth + banco: sem
 * isto, a regra que decide se um humano pode falar com o paciente só seria
 * exercitada por teste de integração, e a matriz (4 status × 4 posições da
 * janela) nunca seria coberta.
 *
 * Ordem das checagens é deliberada: STATUS antes de JANELA. Quem vê a tela de
 * uma conversa 'active' precisa ouvir "assuma primeiro", não "a janela
 * expirou" — as duas podem ser verdade ao mesmo tempo e a acionável é a
 * primeira.
 */
import { isWindowOpen } from './meta-window';

export type ReplyDenialReason = 'not_handoff' | 'window_closed';

export type ReplyDecision = { allowed: true } | { allowed: false; reason: ReplyDenialReason };

export function canReplyManually(args: {
  status: string;
  lastInboundAt: Date | null;
  now: Date;
}): ReplyDecision {
  // 'active' é o caso perigoso, não um detalhe: o agente ainda responde ao
  // próximo inbound, então humano + IA falariam com o paciente em paralelo.
  // 'closed'/'abandoned' são terminais.
  if (args.status !== 'handoff') return { allowed: false, reason: 'not_handoff' };
  if (!isWindowOpen(args.lastInboundAt, args.now)) {
    return { allowed: false, reason: 'window_closed' };
  }
  return { allowed: true };
}
