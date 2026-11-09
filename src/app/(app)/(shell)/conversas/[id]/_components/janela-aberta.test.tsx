// @vitest-environment happy-dom
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { JanelaAberta } from './conversa-actions';

/**
 * Regressão do mismatch de hidratação da janela de 24 h.
 *
 * O sintoma no Sentry (11/09) foi `+14 / -15` dentro do `<span className=
 * "font-mono …">`: o servidor renderizou "15 min", o cliente hidratou segundos
 * depois e calculou "14 min", e o React descartou a subárvore.
 *
 * A causa era `Date.now()` DURANTE o render. O conserto é calcular o tempo
 * restante só depois da montagem — o que também destrava o segundo defeito, que
 * ninguém tinha notado: o contador ficava congelado no valor do primeiro render.
 */
afterEach(cleanup);

/** Fecha daqui a 2 h 15 min, a partir de um "agora" fixo. */
const AGORA = new Date('2026-09-14T10:00:00Z');
const FECHA = new Date('2026-09-14T12:15:00Z').toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('janela de 24 h', () => {
  it('compara o dia no fuso da clínica', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T20:00:00Z') });

    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt="2026-11-10T03:30:00Z" />);

    expect(screen.getByText(/00:30 de amanhã/)).toBeTruthy();
  });

  it('o horário absoluto sai do PROP — é a parte que o servidor pode escrever', () => {
    // `render` já roda os efeitos, então este teste não consegue observar o
    // primeiro render isolado. O que ele fixa é o outro lado do contrato: o
    // horário de fechamento depende só do prop, é idêntico nos dois ambientes,
    // e por isso permanece no HTML do servidor. O que dependia de "agora" saiu
    // dali — e é disso que os casos seguintes tratam.
    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt={FECHA} />);

    expect(screen.getByText(/fecha às/)).toBeTruthy();
  });

  it('mostra o tempo restante depois de montar', () => {
    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt={FECHA} />);

    expect(screen.getByText(/2 h\s*15 min/)).toBeTruthy();
  });

  it('CONTA: o valor muda sozinho com o passar do tempo', () => {
    // O defeito silencioso: antes o número era calculado uma vez e congelava.
    // Um relógio de janela que não anda é pior que nenhum — o operador decide
    // se ainda dá tempo de escrever olhando para ele.
    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt={FECHA} />);
    expect(screen.getByText(/2 h\s*15 min/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(screen.getByText(/2 h\s*5 min/)).toBeTruthy();
  });

  it('nunca mostra tempo negativo quando a janela já fechou', () => {
    const passado = new Date('2026-09-14T09:00:00Z').toISOString();
    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt={passado} />);

    expect(screen.queryByText(/-\d/)).toBeNull();
    expect(screen.getByText(/0 min/)).toBeTruthy();
  });

  it('sem prazo, não renderiza a linha da janela', () => {
    render(<JanelaAberta timeZone="America/Sao_Paulo" closesAt={null} />);

    expect(screen.queryByText(/Janela de 24 h aberta/)).toBeNull();
  });
});
