/**
 * EC-32 — a copy aprovada em 08/10/2026 para "mensagem automática não
 * entregue": ação primeiro, motivo depois, código da Meta no fim, e nenhuma
 * promessa de reenvio.
 */
import { describe, expect, it } from 'vitest';

import {
  BADGE_LABEL,
  COPY_LINK_LABEL,
  KIND_LABEL,
  LIMITE_DA_LISTA,
  NAO_SERA_REENVIADA,
  actionCopy,
  badgeTitle,
  causeCopy,
  contextCopy,
  quando,
  summaryCopy,
} from './delivery-failure-copy';
import type { AgendaDeliveryFailure } from './delivery-failures';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-10-08T15:00:00.000Z'); // 12:00 em São Paulo

function item(over: Partial<AgendaDeliveryFailure> = {}): AgendaDeliveryFailure {
  return {
    jobId: 'job-1',
    kind: 'deposit_link',
    pacienteNome: 'Maria Souza',
    appointmentId: 'appt-1',
    consultaEm: '2026-10-10T13:00:00.000Z',
    retornoEm: null,
    vagaSeguradaAte: '2026-10-08T21:00:00.000Z',
    acionavel: true,
    linkCopiavel: true,
    causa: { kind: 'meta_refused', code: '131042' },
    ...over,
  };
}

describe('causeCopy — mapa dos códigos da Meta', () => {
  it('131042: pendência de pagamento da conta, sem prometer reenvio', () => {
    expect(causeCopy({ kind: 'meta_refused', code: '131042' })).toEqual({
      motivo:
        'A conta do WhatsApp Business da clínica está com pendência de pagamento na Meta. Enquanto isso, nenhuma mensagem automática sai.',
      correcao: 'Configure a forma de pagamento na WhatsApp Manager.',
      codigo: '131042',
    });
  });

  it('131026, 131047, 131048, 131049 e 131056 têm texto próprio', () => {
    expect(causeCopy({ kind: 'meta_refused', code: '131026' })).toMatchObject({
      motivo: expect.stringContaining('não recebe mensagens pelo WhatsApp'),
      correcao: 'Confirme o número com o paciente.',
    });
    expect(causeCopy({ kind: 'meta_refused', code: '131047' }).motivo).toContain('janela de 24 h');
    expect(causeCopy({ kind: 'meta_refused', code: '131048' })).toMatchObject({
      motivo: expect.stringContaining('marcadas como spam'),
      correcao: 'Veja a qualidade do número na WhatsApp Manager.',
    });
    expect(causeCopy({ kind: 'meta_refused', code: '131049' })).toMatchObject({
      motivo: expect.stringContaining('limitar quantas mensagens'),
      correcao: null,
    });
    expect(causeCopy({ kind: 'meta_refused', code: '131056' }).motivo).toContain(
      'mesmo paciente em pouco tempo',
    );
  });

  it('a família 132xxx é problema de modelo; código fora do mapa fica genérico, com o código', () => {
    for (const code of ['132000', '132001', '132015', '132016']) {
      expect(causeCopy({ kind: 'meta_refused', code })).toMatchObject({
        motivo: expect.stringContaining('O modelo da mensagem está com problema na Meta'),
        correcao: 'Fale com o suporte do Qoro.',
        codigo: code,
      });
    }
    expect(causeCopy({ kind: 'meta_refused', code: '131050' })).toEqual({
      motivo: 'A Meta recusou a mensagem.',
      correcao: null,
      codigo: '131050',
    });
    expect(causeCopy({ kind: 'meta_refused', code: '1320' }).motivo).toBe(
      'A Meta recusou a mensagem.',
    );
  });

  it('recusa sem código, entrega sem confirmação e falhas do Qoro', () => {
    expect(causeCopy({ kind: 'meta_refused', code: null })).toEqual({
      motivo: 'A Meta recusou a mensagem sem informar o motivo.',
      correcao: null,
      codigo: null,
    });
    expect(causeCopy({ kind: 'unconfirmed' })).toEqual({
      motivo: 'Não foi possível confirmar se a mensagem chegou.',
      correcao: 'Confirme com o paciente.',
      codigo: null,
    });
    expect(causeCopy({ kind: 'number_not_connected' }).correcao).toBe(
      'Reconecte em Configurações › WhatsApp.',
    );
    expect(causeCopy({ kind: 'template_not_configured' }).motivo).toBe(
      'O modelo desta mensagem ainda não está configurado no Qoro.',
    );
    expect(causeCopy({ kind: 'internal' }).correcao).toBe('Fale com o suporte do Qoro.');
  });

  it('o título do selo leva o código quando há', () => {
    expect(badgeTitle({ kind: 'meta_refused', code: '131042' })).toMatch(/\(131042\)$/u);
    expect(badgeTitle({ kind: 'number_not_connected' })).toBe(
      'O WhatsApp da clínica não estava conectado.',
    );
  });
});

describe('quando', () => {
  it('hoje só a hora; amanhã por extenso; depois, a data', () => {
    expect(quando('2026-10-08T21:00:00.000Z', TZ, NOW)).toBe('18:00');
    expect(quando('2026-10-09T11:00:00.000Z', TZ, NOW)).toBe('amanhã às 08:00');
    expect(quando('2026-10-10T13:00:00.000Z', TZ, NOW)).toBe('10/10 às 10:00');
  });

  it('o dia é o da clínica, não o UTC', () => {
    // 02:00 UTC do dia 9 ainda é 23:00 do dia 8 em São Paulo.
    expect(quando('2026-10-09T02:00:00.000Z', TZ, NOW)).toBe('23:00');
  });
});

describe('contextCopy e actionCopy', () => {
  it('consulta, vaga ou retorno', () => {
    expect(contextCopy(item(), TZ)).toBe('consulta 10/10 10:00');
    expect(contextCopy(item({ kind: 'waitlist_offer' }), TZ)).toBe('vaga de 10/10 10:00');
    expect(
      contextCopy(item({ kind: 'followup', consultaEm: null, retornoEm: '2026-10-20' }), TZ),
    ).toBe('retorno em 20/10');
    expect(contextCopy(item({ consultaEm: null }), TZ)).toBeNull();
    expect(contextCopy(item({ kind: 'followup', retornoEm: null }), TZ)).toBeNull();
  });

  it('o sinal diz até quando dá para agir', () => {
    expect(actionCopy(item(), TZ, NOW)).toBe(
      'Envie o link ao paciente por outro canal antes de 18:00; depois disso a vaga é liberada.',
    );
    expect(actionCopy(item({ vagaSeguradaAte: null }), TZ, NOW)).toBe(
      'Envie o link ao paciente por outro canal.',
    );
  });

  it('cada tipo tem a sua ação, sempre por outro canal', () => {
    for (const kind of [
      'remainder_link',
      'reminder',
      'no_show_followup',
      'waitlist_offer',
      'followup',
    ] as const) {
      expect(actionCopy(item({ kind, vagaSeguradaAte: null }), TZ, NOW)).toContain(
        'por outro canal',
      );
    }
  });
});

describe('summaryCopy', () => {
  it('um item: quem, o quê e, no sinal, até quando a vaga fica segurada', () => {
    expect(summaryCopy([item()], TZ, NOW)).toBe(
      'O link do sinal não chegou a Maria Souza · vaga segurada até 18:00',
    );
    expect(
      summaryCopy([item({ kind: 'reminder', vagaSeguradaAte: null, pacienteNome: null })], TZ, NOW),
    ).toBe('O lembrete da consulta não chegou ao paciente');
  });

  it('entrega sem confirmação não é dita como recusa', () => {
    expect(summaryCopy([item({ causa: { kind: 'unconfirmed' } })], TZ, NOW)).toBe(
      'O link do sinal para Maria Souza ficou sem confirmação de entrega · vaga segurada até 18:00',
    );
    expect(
      summaryCopy(
        [
          item({
            kind: 'followup',
            causa: { kind: 'unconfirmed' },
            pacienteNome: null,
            vagaSeguradaAte: null,
          }),
        ],
        TZ,
        NOW,
      ),
    ).toBe('O lembrete de retorno ficou sem confirmação de entrega');
  });

  it('vários itens: a contagem, e o primeiro hold (a faixa já vem por prazo)', () => {
    expect(
      summaryCopy(
        [
          item({ jobId: 'a' }),
          item({ jobId: 'b', vagaSeguradaAte: '2026-10-09T11:00:00.000Z' }),
          item({ jobId: 'c', kind: 'reminder', vagaSeguradaAte: null }),
        ],
        TZ,
        NOW,
      ),
    ).toBe(
      '3 mensagens automáticas não chegaram aos pacientes · 2 vagas seguradas, a primeira até 18:00',
    );

    expect(
      summaryCopy(
        [
          item({ jobId: 'a', kind: 'reminder', vagaSeguradaAte: null }),
          item({ jobId: 'b', vagaSeguradaAte: '2026-10-09T11:00:00.000Z' }),
        ],
        TZ,
        NOW,
      ),
    ).toBe(
      '2 mensagens automáticas não chegaram aos pacientes · 1 vaga segurada até amanhã às 08:00',
    );
  });

  it('vários itens sem confirmação, ou misturados, dizem isso', () => {
    const unconfirmed = { kind: 'unconfirmed' } as const;
    expect(
      summaryCopy(
        [
          item({ jobId: 'a', causa: unconfirmed, vagaSeguradaAte: null }),
          item({ jobId: 'b', causa: unconfirmed, vagaSeguradaAte: null }),
        ],
        TZ,
        NOW,
      ),
    ).toBe('2 mensagens automáticas ficaram sem confirmação de entrega');
    expect(
      summaryCopy(
        [
          item({ jobId: 'a', causa: unconfirmed, vagaSeguradaAte: null }),
          item({ jobId: 'b', vagaSeguradaAte: null }),
        ],
        TZ,
        NOW,
      ),
    ).toBe('2 mensagens automáticas não chegaram aos pacientes ou ficaram sem confirmação');
  });

  it('lista vazia não tem frase', () => {
    expect(summaryCopy([], TZ, NOW)).toBe('');
  });
});

describe('rótulos', () => {
  it('cobrem os seis tipos da Agenda; "Copiar link" só no sinal e no saldo', () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual(Object.keys(BADGE_LABEL).sort());
    expect(BADGE_LABEL.deposit_link).toBe('Link não entregue');
    expect(Object.keys(COPY_LINK_LABEL).sort()).toEqual(['deposit_link', 'remainder_link']);
  });

  it('nenhum texto promete reenvio, e o teto usa os números da leitura', () => {
    expect(NAO_SERA_REENVIADA).toBe('Esta mensagem não será reenviada.');
    expect(LIMITE_DA_LISTA).toBe(
      'A lista mostra no máximo 100 mensagens dos últimos 7 dias; pode haver outras.',
    );
  });
});
