/**
 * P2.5 — o contrato do conector com transporte simulado (nenhuma operadora real, nenhum
 * endpoint): sem homologação nada sai; tempo esgotado; retentativa só com transporte
 * idempotente; recusa da operadora não se repete; circuito abre, espera e deixa uma tentativa.
 */
import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_TIMEOUT_MAX_MS,
  createConnector,
  DEFAULT_CONNECTOR_OPTIONS,
  notHomologatedTransport,
  type ConnectorOutcome,
  type ConnectorTransport,
} from './connector';

const req = { insurerId: 'ins-1', xml: new Uint8Array([1]), idempotencyKey: 'lote-1:v1' };
const circuit = { failureThreshold: 2, cooldownMs: 1_000 };

function scripted(outcomes: Array<ConnectorOutcome | 'hang' | 'throw'>, idempotent = true) {
  let calls = 0;
  const transport: ConnectorTransport = {
    idempotent,
    send: (_r, signal) => {
      const next = outcomes[Math.min(calls, outcomes.length - 1)]!;
      calls += 1;
      if (next === 'throw') return Promise.reject(new Error('ECONNRESET'));
      if (next === 'hang')
        return new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve({ kind: 'unavailable', reason: 'network' }),
          ),
        );
      return Promise.resolve(next);
    },
  };
  return { transport, calls: () => calls };
}

describe('conector da operadora (P2.5, sem endpoint real)', () => {
  it('sem homologação: recusa sempre, nunca diz que enviou', async () => {
    const c = createConnector({
      transport: notHomologatedTransport,
      timeoutMs: 50,
      retries: 2,
      circuit,
    });
    expect(await c.submit(req)).toEqual({ kind: 'not_configured' });
    expect(c.circuitOf('ins-1')).toBe('closed');
  });

  it('protocolo da operadora volta como está; recusa dela não é repetida', async () => {
    const ok = scripted([{ kind: 'accepted', protocol: 'P-123' }]);
    expect(
      await createConnector({ transport: ok.transport, timeoutMs: 50, retries: 2, circuit }).submit(
        req,
      ),
    ).toEqual({
      kind: 'accepted',
      protocol: 'P-123',
    });
    const no = scripted([{ kind: 'rejected', code: '5001', message: 'guia duplicada' }]);
    const c = createConnector({ transport: no.transport, timeoutMs: 50, retries: 2, circuit });
    expect((await c.submit(req)).kind).toBe('rejected');
    expect(no.calls()).toBe(1);
  });

  it('tempo esgotado vira "indisponível" e a requisição é abortada', async () => {
    const h = scripted(['hang'], false);
    const c = createConnector({ transport: h.transport, timeoutMs: 20, retries: 2, circuit });
    expect(await c.submit(req)).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(h.calls()).toBe(1);
  });

  it('retentativa só com transporte idempotente; falha de rede vira "indisponível"', async () => {
    const idem = scripted([
      'throw',
      { kind: 'unavailable', reason: 'server_error' },
      { kind: 'accepted', protocol: 'P-9' },
    ]);
    const c1 = createConnector({
      transport: idem.transport,
      timeoutMs: 50,
      retries: 2,
      circuit: { failureThreshold: 9, cooldownMs: 1 },
    });
    expect(await c1.submit(req)).toEqual({ kind: 'accepted', protocol: 'P-9' });
    expect(idem.calls()).toBe(3);
    const notIdem = scripted(['throw', { kind: 'accepted', protocol: 'P-9' }], false);
    const c2 = createConnector({
      transport: notIdem.transport,
      timeoutMs: 50,
      retries: 2,
      circuit,
    });
    expect(await c2.submit(req)).toEqual({ kind: 'unavailable', reason: 'network' });
    expect(notIdem.calls()).toBe(1);
  });

  it('R61: o teto total corta as retentativas; tempo esgotado não ganha nova tentativa', async () => {
    const h = scripted(['hang'], true);
    const c = createConnector({
      transport: h.transport,
      timeoutMs: 40,
      retries: 2,
      totalBudgetMs: 60,
      circuit: { failureThreshold: 9, cooldownMs: 1 },
    });
    const started = Date.now();
    expect(await c.submit(req)).toEqual({ kind: 'unavailable', reason: 'timeout' });
    // 1ª tentativa: 40 ms; sobram ~20 ms (< janela mínima de 40 ms): sem 2ª tentativa.
    expect(h.calls()).toBe(1);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('R61: falha rápida ainda é repetida dentro do teto, e a tentativa usa só o que sobra', async () => {
    const idem = scripted(['throw', 'hang']);
    const c = createConnector({
      transport: idem.transport,
      timeoutMs: 5_000,
      retries: 2,
      totalBudgetMs: 2_500,
      circuit: { failureThreshold: 9, cooldownMs: 1 },
    });
    const started = Date.now();
    expect(await c.submit(req)).toEqual({ kind: 'unavailable', reason: 'timeout' });
    const elapsed = Date.now() - started;
    expect(idem.calls()).toBe(2);
    // A 2ª tentativa terminou no teto total (2,5 s), não no limite por tentativa (5 s).
    expect(elapsed).toBeGreaterThanOrEqual(2_400);
    expect(elapsed).toBeLessThan(4_000);
  });

  it('R61: o padrão do conector tem teto total igual ao teto de uma tentativa', () => {
    expect(DEFAULT_CONNECTOR_OPTIONS.timeoutMs).toBe(CONNECTOR_TIMEOUT_MAX_MS);
    expect(DEFAULT_CONNECTOR_OPTIONS.totalBudgetMs).toBe(CONNECTOR_TIMEOUT_MAX_MS);
  });

  it('circuito: abre com falhas seguidas, recusa sem tentar, deixa UMA tentativa depois do intervalo', async () => {
    let t = 0;
    const f = scripted([{ kind: 'unavailable', reason: 'server_error' }], false);
    const c = createConnector({
      transport: f.transport,
      timeoutMs: 50,
      retries: 0,
      circuit,
      now: () => t,
    });
    await c.submit(req);
    await c.submit(req);
    expect(c.circuitOf('ins-1')).toBe('open');
    expect((await c.submit(req)).kind).toBe('circuit_open');
    expect(f.calls()).toBe(2);
    expect(c.circuitOf('ins-2')).toBe('closed');
    t = 1_000;
    expect(c.circuitOf('ins-1')).toBe('half_open');
    expect((await c.submit(req)).kind).toBe('unavailable');
    expect(f.calls()).toBe(3);
    expect(c.circuitOf('ins-1')).toBe('open');
  });
});
