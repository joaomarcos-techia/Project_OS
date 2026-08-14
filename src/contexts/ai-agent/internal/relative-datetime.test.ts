/**
 * Resolvedor de data/hora relativa (F-04 da auditoria 2026-08-14).
 *
 * Âncora fixa em TODOS os casos: 14/08/2026 09:00 em America/Sao_Paulo
 * (= 2026-08-14T12:00:00Z), uma SEXTA-FEIRA. A escolha não é decorativa:
 *   - sexta permite provar que "sexta" dita numa sexta significa a PRÓXIMA;
 *   - 09:00 permite provar que uma hora já vencida ("hoje às 7") não vira
 *     agendamento no passado.
 *
 * Os dois primeiros casos de `contraste` e `ordem dos marcadores` são os bugs
 * PROVADOS na auditoria; se algum deles voltar, o teste cai.
 */
import { describe, expect, it } from 'vitest';

import {
  reconcileRequestedTime,
  resolveRequestedDateTime,
  type ResolvedWhen,
} from './relative-datetime';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-08-14T12:00:00.000Z'); // sexta, 09:00 local

const resolve = (text: string, maxDaysAhead = 30): ResolvedWhen =>
  resolveRequestedDateTime({ text, now: NOW, timeZone: TZ, maxDaysAhead });

const instantOf = (text: string): string | null => {
  const r = resolve(text);
  return r.kind === 'instant' ? r.atIso : null;
};

describe('ordem dos marcadores de data (o bug do dia errado)', () => {
  it('"depois de amanhã" NÃO é "amanhã" — era D+1, tem de ser D+2', () => {
    expect(instantOf('depois de amanhã às 9')).toBe('2026-08-16T12:00:00.000Z');
  });

  it.each([
    ['hoje às 15', '2026-08-14T18:00:00.000Z'],
    ['amanhã às 9', '2026-08-15T12:00:00.000Z'],
    ['amanha as 9h', '2026-08-15T12:00:00.000Z'],
    ['dia 20 às 10', '2026-08-20T13:00:00.000Z'],
  ])('%s → %s', (text, expected) => {
    expect(instantOf(text)).toBe(expected);
  });
});

describe('contraste e correção (o bug do horário sobrescrito)', () => {
  it('"amanhã às 9 não posso, pode ser às 14?" → amanhã 14:00, não 09:00', () => {
    expect(instantOf('amanhã às 9 não posso, pode ser às 14?')).toBe('2026-08-15T17:00:00.000Z');
  });

  it('herda o DIA da primeira metade quando a correção só troca a hora', () => {
    expect(instantOf('ontem falei amanhã as 9 mas mudei, quero as 15')).toBe(
      '2026-08-15T18:00:00.000Z',
    );
  });

  it('a correção pode trocar o dia inteiro', () => {
    expect(instantOf('amanhã às 9, na verdade depois de amanhã às 9')).toBe(
      '2026-08-16T12:00:00.000Z',
    );
  });
});

describe('dias da semana', () => {
  it('"sexta" numa SEXTA significa a próxima, nunca hoje', () => {
    const r = resolve('sexta feira');
    expect(r).toMatchObject({ kind: 'window', fromIso: '2026-08-21T03:00:00.000Z' });
  });

  it('"sábado" resolve para o sábado imediato', () => {
    expect(resolve('sábado de manhã')).toMatchObject({
      kind: 'window',
      fromIso: '2026-08-15T11:00:00.000Z',
      toIso: '2026-08-15T15:00:00.000Z',
    });
  });

  it('"próxima segunda" pula a semana corrente', () => {
    expect(resolve('próxima segunda')).toMatchObject({ fromIso: '2026-08-24T03:00:00.000Z' });
  });

  it('abreviações também resolvem', () => {
    expect(instantOf('seg às 10')).toBe('2026-08-17T13:00:00.000Z');
  });
});

describe('datas numéricas', () => {
  it.each([
    ['20/08', '2026-08-20T03:00:00.000Z'],
    ['20/08/2026', '2026-08-20T03:00:00.000Z'],
    ['2026-08-20', '2026-08-20T03:00:00.000Z'],
  ])('%s → janela do dia %s', (text, from) => {
    expect(resolve(text)).toMatchObject({ kind: 'window', fromIso: from });
  });

  it('dia/mês já vencido no ano resolve para o ano seguinte — e cai fora do horizonte', () => {
    expect(resolve('15/01')).toEqual({ kind: 'none' });
  });

  it('data válida além de maxDaysAhead é recusada, não truncada', () => {
    expect(resolve('20/08 às 10', 2)).toEqual({ kind: 'none' });
  });
});

describe('horas humanas', () => {
  it.each([
    ['hoje às 10:30', '2026-08-14T13:30:00.000Z'],
    ['hoje 9 e meia', '2026-08-14T12:30:00.000Z'],
    ['hoje ao meio dia', '2026-08-14T15:00:00.000Z'],
    ['hoje às 14h', '2026-08-14T17:00:00.000Z'],
    ['hoje as 14 horas', '2026-08-14T17:00:00.000Z'],
    ['hoje 15h30', '2026-08-14T18:30:00.000Z'],
    ['hoje umas 11', '2026-08-14T14:00:00.000Z'],
    ['amanhã 9 da manhã', '2026-08-15T12:00:00.000Z'],
    ['amanhã 3 da tarde', '2026-08-15T18:00:00.000Z'],
  ])('%s → %s', (text, expected) => {
    expect(instantOf(text)).toBe(expected);
  });

  it('hora sozinha já vencida hoje vale para amanhã (nunca agenda no passado)', () => {
    expect(instantOf('9 da manhã')).toBe('2026-08-15T12:00:00.000Z');
    expect(resolve('hoje às 7')).toEqual({ kind: 'none' });
  });
});

describe('ambiguidade — perguntar, nunca chutar', () => {
  it('"às 3" devolve os dois candidatos (15:00 e 03:00), o da tarde primeiro', () => {
    expect(resolve('às 3')).toEqual({
      kind: 'ambiguous',
      candidatesIso: ['2026-08-14T18:00:00.000Z', '2026-08-15T06:00:00.000Z'],
      label: 'no horário informado',
    });
  });

  it('marcador de período desfaz a ambiguidade', () => {
    expect(instantOf('hoje às 3 da tarde')).toBe('2026-08-14T18:00:00.000Z');
  });

  it('hora ≥ 8 nunca é ambígua', () => {
    expect(resolve('hoje às 14').kind).toBe('instant');
  });
});

describe('períodos viram JANELA (a busca de slots desambigua com dados reais)', () => {
  it.each([
    ['amanhã de manhã', '2026-08-15T11:00:00.000Z', '2026-08-15T15:00:00.000Z'],
    ['amanhã cedo', '2026-08-15T10:00:00.000Z', '2026-08-15T13:00:00.000Z'],
    ['amanhã à tarde', '2026-08-15T15:00:00.000Z', '2026-08-15T21:00:00.000Z'],
    ['amanhã à noite', '2026-08-15T21:00:00.000Z', '2026-08-16T00:00:00.000Z'],
  ])('%s → [%s, %s)', (text, fromIso, toIso) => {
    expect(resolve(text)).toMatchObject({ kind: 'window', fromIso, toIso });
  });

  it('"de manhã" sem data usa hoje, mas cortado em AGORA', () => {
    expect(resolve('de manhã')).toMatchObject({
      kind: 'window',
      fromIso: '2026-08-14T12:00:00.000Z', // = agora, não 08:00
      toIso: '2026-08-14T15:00:00.000Z',
    });
  });

  it('período já encerrado hoje rola para amanhã', () => {
    const lateFriday = new Date('2026-08-14T23:00:00.000Z'); // 20:00 local
    expect(
      resolveRequestedDateTime({ text: 'de manhã', now: lateFriday, timeZone: TZ, maxDaysAhead: 30 }),
    ).toMatchObject({ kind: 'window', fromIso: '2026-08-15T11:00:00.000Z' });
  });
});

describe('none é o default — na dúvida o servidor não inventa', () => {
  it.each([
    'quero marcar',
    'pode ser',
    'oi',
    'na próxima semana',
    'qualquer horário',
    'harmonização facial',
    'sim',
  ])('%s → none', (text) => {
    expect(resolve(text)).toEqual({ kind: 'none' });
  });
});

describe('fusos e fronteiras de calendário', () => {
  it('vira o mês corretamente', () => {
    const endOfMonth = new Date('2026-08-31T12:00:00.000Z');
    expect(
      resolveRequestedDateTime({
        text: 'amanhã às 9',
        now: endOfMonth,
        timeZone: TZ,
        maxDaysAhead: 30,
      }),
    ).toMatchObject({ atIso: '2026-09-01T12:00:00.000Z' });
  });

  it('vira o ano corretamente', () => {
    const nye = new Date('2026-12-31T12:00:00.000Z');
    expect(
      resolveRequestedDateTime({ text: 'amanhã às 9', now: nye, timeZone: TZ, maxDaysAhead: 30 }),
    ).toMatchObject({ atIso: '2027-01-01T12:00:00.000Z' });
  });

  it('perto da meia-noite local, "amanhã" é o dia seguinte DA CLÍNICA', () => {
    // 2026-08-15T02:00Z = 14/08 23:00 em São Paulo — ainda é sexta lá.
    expect(
      resolveRequestedDateTime({
        text: 'amanhã às 9',
        now: new Date('2026-08-15T02:00:00.000Z'),
        timeZone: TZ,
        maxDaysAhead: 30,
      }),
    ).toMatchObject({ atIso: '2026-08-15T12:00:00.000Z' });
  });

  it('respeita um fuso diferente do padrão', () => {
    expect(
      resolveRequestedDateTime({
        text: 'amanhã às 9',
        now: NOW,
        timeZone: 'America/Manaus', // UTC-4
        maxDaysAhead: 30,
      }),
    ).toMatchObject({ atIso: '2026-08-15T13:00:00.000Z' });
  });
});

describe('reconcileRequestedTime — precedência servidor × modelo', () => {
  const modelIso = '2026-08-15T17:00:00.000Z';

  it('instante do servidor VENCE o do modelo (o servidor conhece o fuso da clínica)', () => {
    expect(
      reconcileRequestedTime({ resolved: resolve('amanhã às 9'), modelIso }),
    ).toEqual({ mode: 'instant', atIso: '2026-08-15T12:00:00.000Z' });
  });

  it('sem marcador de data, o modelo decide', () => {
    expect(reconcileRequestedTime({ resolved: resolve('quero marcar'), modelIso })).toEqual({
      mode: 'instant',
      atIso: modelIso,
    });
  });

  it('modelo DENTRO da janela do servidor é aceito (melhor dos dois)', () => {
    expect(
      reconcileRequestedTime({ resolved: resolve('amanhã à tarde'), modelIso }),
    ).toEqual({ mode: 'instant', atIso: modelIso });
  });

  it('modelo FORA da janela é descartado — busca dentro da janela', () => {
    expect(reconcileRequestedTime({ resolved: resolve('amanhã de manhã'), modelIso })).toEqual({
      mode: 'search',
      fromIso: '2026-08-15T11:00:00.000Z',
      toIso: '2026-08-15T15:00:00.000Z',
    });
  });

  it('ambiguidade sem apoio do modelo devolve os candidatos para perguntar', () => {
    expect(reconcileRequestedTime({ resolved: resolve('às 3'), modelIso: undefined })).toMatchObject(
      { mode: 'candidates' },
    );
  });

  it('modelo que casa um dos candidatos resolve a ambiguidade', () => {
    expect(
      reconcileRequestedTime({ resolved: resolve('às 3'), modelIso: '2026-08-14T18:00:00.000Z' }),
    ).toEqual({ mode: 'instant', atIso: '2026-08-14T18:00:00.000Z' });
  });

  it('nada de nenhum lado → none (cai no primeiro horário livre)', () => {
    expect(reconcileRequestedTime({ resolved: { kind: 'none' }, modelIso: undefined })).toEqual({
      mode: 'none',
    });
  });

  it('ISO inválido do modelo é ignorado, não propagado', () => {
    expect(
      reconcileRequestedTime({ resolved: { kind: 'none' }, modelIso: 'amanhã de manhã' }),
    ).toEqual({ mode: 'none' });
  });
});
