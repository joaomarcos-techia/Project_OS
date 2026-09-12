/**
 * D30 — a constante só resolve o achado se ela e o runbook não puderem divergir.
 *
 * Uma lista versionada que sai de sincronia com a doc operacional é pior que não
 * ter lista: quem refaz o webhook às 3h da manhã lê a doc, e a doc estaria
 * mentindo com a autoridade de estar no repositório.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_WEBHOOK_EVENTS } from './subscription-webhook-events';

const RUNBOOK = 'docs/runbooks/asaas-webhook-assinatura.md';

/** Eventos citados na tabela "Eventos que este webhook DEVE assinar". */
function eventsFromRunbook(): string[] {
  const text = readFileSync(resolve(process.cwd(), RUNBOOK), 'utf8');
  const start = text.indexOf('## Eventos que este webhook DEVE assinar');
  expect(start).toBeGreaterThan(-1);
  // A seção termina no próximo cabeçalho de mesmo nível ou menor.
  const rest = text.slice(start + 1);
  const end = rest.search(/\n#{2,3} /u);
  const section = end === -1 ? rest : rest.slice(0, end);

  const found: string[] = [];
  for (const line of section.split('\n')) {
    // Só linhas de tabela: `| \`EVENTO\` | motivo |`
    const match = /^\|\s*`([A-Z_]+)`\s*\|/u.exec(line);
    if (match) found.push(match[1]!);
  }
  return found;
}

describe('D30 — eventos do webhook de assinatura', () => {
  it('a constante e o runbook listam exatamente os mesmos eventos', () => {
    const runbook = eventsFromRunbook();

    expect(runbook.length).toBeGreaterThan(0);
    expect([...runbook].sort()).toEqual([...SUBSCRIPTION_WEBHOOK_EVENTS].sort());
  });

  it('inclui PAYMENT_RESTORED, sem o qual o cancelamento é irreversível', () => {
    // D54/D55: `cancelled` é terminal na state machine; só a confirmação de que
    // a cobrança voltou a existir reabre. Sem o evento, ninguém avisa.
    expect(SUBSCRIPTION_WEBHOOK_EVENTS).toContain('PAYMENT_RESTORED');
  });

  it('não mistura o webhook de assinatura com o de cobrança de paciente', () => {
    // O de paciente assina CHECKOUT_PAID e a família de chargeback; o de
    // assinatura, não. Trocar um pelo outro no painel silencia o acesso ao
    // produto ou o sinal, dependendo da direção do erro.
    expect(SUBSCRIPTION_WEBHOOK_EVENTS).not.toContain('CHECKOUT_PAID');
    expect(SUBSCRIPTION_WEBHOOK_EVENTS).not.toContain('PAYMENT_CHARGEBACK_REQUESTED');
  });

  it('não tem evento repetido', () => {
    expect(new Set(SUBSCRIPTION_WEBHOOK_EVENTS).size).toBe(SUBSCRIPTION_WEBHOOK_EVENTS.length);
  });
});
