import { describe, expect, it } from 'vitest';

import {
  addDaysToYmd,
  ageOnDate,
  clinicDayRange,
  isYmd,
  resolveTimeZone,
  startOfDayInTimeZone,
  todayInTimeZone,
  yearInTimeZone,
  ymdInTimeZone,
} from './clinic-calendar';

const SP = 'America/Sao_Paulo';
const FORTALEZA = 'America/Fortaleza';
const at = (iso: string) => new Date(iso);

describe('todayInTimeZone: o "hoje" é o da clínica, não o do servidor', () => {
  it.each([
    // 20h59 em Brasília ainda é dia 16; 21h já é dia 17 em UTC, mas não na clínica.
    ['antes das 21h', '2026-08-16T23:59:00.000Z', SP, '2026-08-16'],
    ['às 21h', '2026-08-17T00:00:00.000Z', SP, '2026-08-16'],
    ['depois das 21h', '2026-08-17T02:30:00.000Z', SP, '2026-08-16'],
    ['meia-noite em Brasília', '2026-08-17T03:00:00.000Z', SP, '2026-08-17'],
    ['UTC no mesmo instante', '2026-08-17T00:00:00.000Z', 'UTC', '2026-08-17'],
    [
      'Fortaleza (UTC-3, sem horário de verão)',
      '2026-08-17T02:59:59.999Z',
      FORTALEZA,
      '2026-08-16',
    ],
    ['virada de mês', '2026-09-01T01:00:00.000Z', SP, '2026-08-31'],
    ['virada de ano', '2027-01-01T02:00:00.000Z', SP, '2026-12-31'],
    ['29/02 de ano bissexto', '2028-03-01T01:00:00.000Z', SP, '2028-02-29'],
  ])('%s', (_case, iso, zone, expected) => {
    expect(todayInTimeZone(zone, at(iso))).toBe(expected);
  });

  it('não depende do fuso do processo ou do navegador', () => {
    // O resultado é o mesmo para qualquer TZ de processo: Intl recebe o fuso.
    expect(ymdInTimeZone(at('2026-08-17T00:30:00.000Z'), 'Asia/Tokyo')).toBe('2026-08-17');
    expect(ymdInTimeZone(at('2026-08-17T00:30:00.000Z'), SP)).toBe('2026-08-16');
  });
});

describe('yearInTimeZone: ano do rodapé', () => {
  it('31/12 às 22h em Brasília continua no ano velho, mesmo com UTC no ano novo', () => {
    expect(yearInTimeZone(SP, at('2027-01-01T01:00:00.000Z'))).toBe(2026);
    expect(yearInTimeZone('UTC', at('2027-01-01T01:00:00.000Z'))).toBe(2027);
  });
});

describe('startOfDayInTimeZone e clinicDayRange', () => {
  it('o dia civil começa à meia-noite da clínica', () => {
    expect(startOfDayInTimeZone('2026-08-16', SP).toISOString()).toBe('2026-08-16T03:00:00.000Z');
    expect(startOfDayInTimeZone('2026-08-16', 'UTC').toISOString()).toBe(
      '2026-08-16T00:00:00.000Z',
    );
    expect(startOfDayInTimeZone('2026-08-16', FORTALEZA).toISOString()).toBe(
      '2026-08-16T03:00:00.000Z',
    );
  });

  it('respeita o horário de verão histórico de Brasília (meia-noite que não existiu)', () => {
    // 15/10/2017 o relógio pulou de 00:00 para 01:00 (UTC-2): o dia começou 03:00Z.
    expect(startOfDayInTimeZone('2017-10-15', SP).toISOString()).toBe('2017-10-15T03:00:00.000Z');
    // Em pleno verão (UTC-2), o dia começa às 02:00Z.
    expect(startOfDayInTimeZone('2018-01-10', SP).toISOString()).toBe('2018-01-10T02:00:00.000Z');
    // 18/02/2018 o relógio voltou de 00:00 para 23:00 do dia 17: o dia 18 começou 03:00Z.
    expect(startOfDayInTimeZone('2018-02-18', SP).toISOString()).toBe('2018-02-18T03:00:00.000Z');
  });

  it('a faixa cobre o primeiro e o último dia inteiros no fuso da clínica', () => {
    const range = clinicDayRange('2026-08-01', '2026-08-16', SP)!;
    expect(range.from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    // 23h59min59,999 de 16/08 em Brasília = 02:59:59.999Z do dia 17.
    expect(range.to.toISOString()).toBe('2026-08-17T02:59:59.999Z');
  });

  it('inclui o evento das 23h30 do último dia, que a faixa em UTC deixava de fora', () => {
    const range = clinicDayRange('2026-08-16', '2026-08-16', SP)!;
    const lateEvent = at('2026-08-17T02:30:00.000Z'); // 23h30 de 16/08 em Brasília
    const previousNight = at('2026-08-16T01:00:00.000Z'); // 22h de 15/08 em Brasília
    expect(lateEvent >= range.from && lateEvent <= range.to).toBe(true);
    expect(previousNight >= range.from && previousNight <= range.to).toBe(false);
  });

  it('virada de mês e de ano', () => {
    expect(clinicDayRange('2026-08-31', '2026-08-31', SP)!.to.toISOString()).toBe(
      '2026-09-01T02:59:59.999Z',
    );
    expect(clinicDayRange('2026-12-31', '2026-12-31', SP)!.to.toISOString()).toBe(
      '2027-01-01T02:59:59.999Z',
    );
  });

  it.each([
    ['vazio', '', '2026-08-16'],
    ['nulo', null, '2026-08-16'],
    ['formato errado', '16/08/2026', '2026-08-16'],
    ['dia que não existe', '2026-02-30', '2026-03-01'],
    ['29/02 fora de ano bissexto', '2027-02-29', '2027-03-01'],
    ['instante no lugar de data', '2026-08-16T00:00:00Z', '2026-08-17'],
  ])('entrada inválida (%s) vira null', (_case, from, to) => {
    expect(clinicDayRange(from, to, SP)).toBeNull();
  });
});

describe('addDaysToYmd e isYmd', () => {
  it('soma dias pelo calendário, atravessando mês, ano e 29/02', () => {
    expect(addDaysToYmd('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToYmd('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToYmd('2026-03-01', -30)).toBe('2026-01-30');
  });

  it('valida o dia contra o calendário', () => {
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });
});

describe('ageOnDate: nascimento é data civil', () => {
  it.each([
    ['dia anterior ao aniversário', '1984-06-04', '2026-06-03', 41],
    ['dia exato do aniversário', '1984-06-04', '2026-06-04', 42],
    ['depois do aniversário', '1984-06-04', '2026-06-05', 42],
    ['virada de ano', '1990-01-01', '2026-12-31', 36],
    ['nascido em 29/02, em 28/02 de ano comum', '2000-02-29', '2026-02-28', 25],
    ['nascido em 29/02, em 01/03 de ano comum', '2000-02-29', '2026-03-01', 26],
    ['nascido em 29/02, no 29/02 de ano bissexto', '2000-02-29', '2028-02-29', 28],
    ['nasceu hoje', '2026-06-04', '2026-06-04', 0],
  ])('%s', (_case, birth, today, expected) => {
    expect(ageOnDate(birth, today)).toBe(expected);
  });

  it('a véspera do aniversário depois das 21h ainda não conta o ano novo', () => {
    // 03/06 às 22h em Brasília = 04/06 01:00Z. Em UTC já seria aniversário.
    const today = todayInTimeZone(SP, at('2026-06-04T01:00:00.000Z'));
    expect(today).toBe('2026-06-03');
    expect(ageOnDate('1984-06-04', today)).toBe(41);
  });

  it.each([null, undefined, '', 'abc', '2026-02-30', '2999-01-01', '1500-01-01'])(
    'nascimento inválido ou fora de faixa (%s) vira null',
    (birth) => {
      expect(ageOnDate(birth, '2026-06-04')).toBeNull();
    },
  );
});

describe('resolveTimeZone', () => {
  it('fuso inválido cai no padrão das clínicas em vez de quebrar', () => {
    expect(resolveTimeZone('Fuso/Inexistente')).toBe('America/Sao_Paulo');
    expect(resolveTimeZone(null)).toBe('America/Sao_Paulo');
    expect(resolveTimeZone(FORTALEZA)).toBe(FORTALEZA);
  });
});
