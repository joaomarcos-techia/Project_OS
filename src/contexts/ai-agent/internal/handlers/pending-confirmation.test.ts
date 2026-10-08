/**
 * O "SIM" a uma ação preparada é executado pelo servidor (08/10/2026). Ao vivo,
 * o modelo respondeu a um "SIM" chamando a tool errada, e o paciente recebeu
 * "um atendente vai te responder" depois de confirmar. Aqui: o texto que o
 * servidor devolve em cada desfecho, e a garantia de que o handler decide pela
 * pendência + confirmação explícita, sem consultar o modelo.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pendingConfirmationFailureReply, pendingConfirmationReply } from './inbound-received';

const TZ = 'America/Sao_Paulo';
// 10:00 em São Paulo.
const AT = '2026-10-12T13:00:00.000Z';

describe('pendingConfirmationReply — o que o paciente lê depois do SIM', () => {
  it.each([
    ['schedule_appointment', 'Pronto! Consulta agendada para 12/10/2026 às 10:00.'],
    ['reschedule_appointment', 'Pronto! Consulta reagendada para 12/10/2026 às 10:00.'],
    ['confirm_appointment', 'Pronto! Presença confirmada na consulta de 12/10/2026 às 10:00.'],
    ['cancel_appointment', 'Pronto! A consulta de 12/10/2026 às 10:00 foi cancelada.'],
  ] as const)('%s → horário no fuso da clínica', (action, expected) => {
    expect(pendingConfirmationReply({ action, scheduledAt: AT }, TZ)).toBe(expected);
  });

  it('com sinal previsto, diz que o horário só se confirma com o sinal pago pelo link (08/10/2026)', () => {
    expect(
      pendingConfirmationReply({ action: 'schedule_appointment', scheduledAt: AT, depositAmount: 75 }, TZ),
    ).toBe(
      'Pronto! Consulta agendada para 12/10/2026 às 10:00. Para confirmar o horário, pague o sinal de R$ 75,00 pelo link que vou te enviar por aqui. O horário fica reservado por até 24 horas.',
    );
  });

  it('sem horário no resultado, não inventa um', () => {
    expect(pendingConfirmationReply({ action: 'cancel_appointment' }, TZ)).toBe(
      'Pronto! A consulta foi cancelada.',
    );
  });
});

describe('pendingConfirmationFailureReply — falha explicada, nunca sucesso inventado', () => {
  it('pendência expirada pede um novo resumo', () => {
    expect(
      pendingConfirmationFailureReply(
        new Error('a confirmação expirou; peça um novo resumo da ação'),
      ),
    ).toContain('expirou');
  });

  it('horário tomado entre o resumo e o SIM pede outro horário', () => {
    const conflict = Object.assign(new Error('horário ocupado para este médico'), {
      name: 'SchedulingConflictError',
    });
    expect(pendingConfirmationFailureReply(conflict)).toContain('acabou de ser ocupado');
  });

  it('identidade ou política mudou: não confirma e pede novo resumo', () => {
    expect(
      pendingConfirmationFailureReply(
        new Error('a identidade do contato mudou desde a preparação; prepare novamente'),
      ),
    ).toContain('novo resumo');
  });

  it('falha desconhecida → null (o handler cai no fallback operacional)', () => {
    expect(pendingConfirmationFailureReply(new Error('connection reset'))).toBeNull();
  });
});

describe('o handler decide pela pendência + confirmação explícita, sem o modelo', () => {
  const source = readFileSync(new URL('./inbound-received.ts', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('let serverConfirmationReply'),
    source.indexOf('!serverConfirmationReply &&'),
  );

  it('confere a confirmação contra a AÇÃO preparada (verbo contraditório não confirma)', () => {
    expect(block).toContain('findPendingActionSummary(tx, clinicId, conversation.id)');
    expect(block).toContain('classifyConfirmation(turnText, pending.actionName).confirmed');
    expect(block).toContain('executePendingAction(toolContext(tx))');
  });

  it('o modelo só é chamado quando o servidor não respondeu', () => {
    expect(source).toMatch(
      /!serverConfirmationReply &&\s+!fallback\s+\) \{\s+try \{\s+result = await aiCircuit/,
    );
  });
});
