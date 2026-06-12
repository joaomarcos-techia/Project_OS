/**
 * Teste 11.6.4 — circuit breaker do LLM: 3 falhas consecutivas (Gemini 503
 * simulado) abrem o circuito; aberto NÃO chama o provider; half-open após
 * 5 min admite uma sonda; sucesso fecha, falha reabre.
 */
import { describe, expect, it } from 'vitest';

import { CircuitOpenError, __testing__ } from './circuit-breaker';
import { AIProviderError } from './provider';

/** Relógio manual injetável. */
function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const fail503 = () => Promise.reject(new AIProviderError('Gemini HTTP 503', 'gemini_server_error', 503));
const ok = () => Promise.resolve('resposta');

describe('AICircuitBreaker (11.6.4)', () => {
  it('abre após 3 falhas consecutivas e NÃO chama o provider quando aberto', async () => {
    const clock = fakeClock();
    const cb = __testing__.create({ clock: clock.now });

    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(fail503)).rejects.toThrow(AIProviderError);
    }
    expect(cb.state()).toBe('open');

    // Aberto: fn NUNCA é invocada.
    let called = false;
    await expect(
      cb.exec(async () => {
        called = true;
        return 'x';
      }),
    ).rejects.toThrow(CircuitOpenError);
    expect(called).toBe(false);
  });

  it('2 falhas + 1 sucesso NÃO abre (contador é de falhas consecutivas)', async () => {
    const cb = __testing__.create({});
    await expect(cb.exec(fail503)).rejects.toThrow();
    await expect(cb.exec(fail503)).rejects.toThrow();
    await expect(cb.exec(ok)).resolves.toBe('resposta');
    await expect(cb.exec(fail503)).rejects.toThrow(AIProviderError); // não CircuitOpen
    expect(cb.state()).toBe('closed');
  });

  it('half-open após 5 min; sonda com sucesso fecha o circuito', async () => {
    const clock = fakeClock();
    const cb = __testing__.create({ clock: clock.now });
    for (let i = 0; i < 3; i++) await expect(cb.exec(fail503)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    clock.advance(5 * 60_000 - 1);
    expect(cb.state()).toBe('open');
    clock.advance(1);
    expect(cb.state()).toBe('half_open');

    await expect(cb.exec(ok)).resolves.toBe('resposta');
    expect(cb.state()).toBe('closed');
  });

  it('sonda half-open que falha REABRE por mais 5 min', async () => {
    const clock = fakeClock();
    const cb = __testing__.create({ clock: clock.now });
    for (let i = 0; i < 3; i++) await expect(cb.exec(fail503)).rejects.toThrow();

    clock.advance(5 * 60_000);
    expect(cb.state()).toBe('half_open');
    await expect(cb.exec(fail503)).rejects.toThrow(AIProviderError);
    expect(cb.state()).toBe('open');

    clock.advance(5 * 60_000);
    expect(cb.state()).toBe('half_open');
  });

  it('metade-aberto admite só UMA sonda concorrente', async () => {
    const clock = fakeClock();
    const cb = __testing__.create({ clock: clock.now });
    for (let i = 0; i < 3; i++) await expect(cb.exec(fail503)).rejects.toThrow();
    clock.advance(5 * 60_000);

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const probe = cb.exec(async () => {
      await gate;
      return 'lenta';
    });
    // Segunda chamada durante a sonda → rejeitada sem invocar.
    await expect(cb.exec(ok)).rejects.toThrow(CircuitOpenError);
    release();
    await expect(probe).resolves.toBe('lenta');
    expect(cb.state()).toBe('closed');
  });
});
