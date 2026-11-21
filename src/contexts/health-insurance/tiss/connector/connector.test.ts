/**
 * P2.5 — o contrato do conector com transporte simulado (nenhuma operadora real, nenhum
 * endpoint): sem homologação nada sai; tempo esgotado; retentativa só com transporte
 * idempotente; recusa da operadora não se repete; circuito abre, espera e deixa uma tentativa.
 */
import { describe, expect, it } from 'vitest';

import {
  createConnector,
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
