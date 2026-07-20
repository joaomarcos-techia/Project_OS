/**
 * Janela de 24h da Meta (ADR-047).
 *
 * A WhatsApp Cloud API só aceita mensagem de TEXTO LIVRE dentro de 24h desde a
 * ÚLTIMA mensagem enviada PELO PACIENTE (customer service window). Fora dela, só
 * template previamente aprovado. Mensagem livre fora da janela é rejeitada pela
 * Meta — e a rejeição chega DEPOIS, no envio, quando o operador já acredita ter
 * respondido. Por isso a janela é checada ANTES de aceitar a mensagem.
 *
 * Até a ADR-047 essa regra existia só em prosa (docs/VisãoGeral.md) — o código
 * nunca a implementou: o agente sempre mandou texto livre, os proactive-jobs
 * sempre mandaram template. Este módulo é a primeira implementação.
 *
 * Puro de propósito (sem tx, sem Date.now() implícito): a decisão de segurança é
 * testável sem banco e sem relógio. `now` é sempre injetado.
 */

/** 24h em ms — a janela da Meta, contada a partir do último inbound. */
export const META_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A janela está aberta para texto livre?
 *
 * Duas decisões de fronteira, ambas na direção segura (falso-negativo custa um
 * template; falso-positivo custa uma mensagem rejeitada e um operador enganado):
 *
 *   - SEM inbound algum (`null`) → FECHADA. Conversa em que o paciente nunca
 *     escreveu não abriu janela nenhuma.
 *   - EXATAMENTE 24h → FECHADA. A comparação é estrita (`<`), então o instante
 *     lastInbound+24h já está fora. Determinístico: não existe input em que a
 *     resposta dependa de arredondamento.
 */
export function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < META_WINDOW_MS;
}

/** Quando a janela fecha (p/ a UI dizer "expira às ..."). `null` se já fechada. */
export function windowClosesAt(lastInboundAt: Date | null, now: Date): Date | null {
  if (!isWindowOpen(lastInboundAt, now)) return null;
  return new Date(lastInboundAt!.getTime() + META_WINDOW_MS);
}
