/**
 * EC-32 — a leitura de `failed_reason` que o painel faz.
 *
 * O ponto que não pode regredir: `unknown`, `pending` e `error` são entrega SEM
 * confirmação, nunca recusa. A tela diz "não chegou" só quando a Meta recusou
 * ou o envio nem saiu.
 */
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_FAILURE_WINDOW_DAYS,
  deliveryFailureWindowStart,
  failureCauseOf,
} from './delivery-failure';

describe('failureCauseOf', () => {
  it('meta_<código> é recusa da Meta com o código', () => {
    expect(failureCauseOf('meta_131042')).toEqual({ kind: 'meta_refused', code: '131042' });
    expect(failureCauseOf('meta_131026')).toEqual({ kind: 'meta_refused', code: '131026' });
    expect(failureCauseOf('meta_1')).toEqual({ kind: 'meta_refused', code: '1' });
  });

  it('meta_failed é recusa sem código (callback sem errorCode ou resposta síncrona)', () => {
    expect(failureCauseOf('meta_failed')).toEqual({ kind: 'meta_refused', code: null });
  });

  it.each(['meta_unknown', 'meta_pending', 'meta_error'])(
    '%s é entrega sem confirmação, não recusa',
    (reason) => {
      expect(failureCauseOf(reason)).toEqual({ kind: 'unconfirmed' });
    },
  );

  it('falhas de configuração mantêm o próprio motivo', () => {
    expect(failureCauseOf('number_not_connected')).toEqual({ kind: 'number_not_connected' });
    expect(failureCauseOf('template_not_configured')).toEqual({
      kind: 'template_not_configured',
    });
  });

  it('payload inválido, motivo vazio ou desconhecido viram defeito interno', () => {
    expect(failureCauseOf('invalid_payload')).toEqual({ kind: 'internal' });
    expect(failureCauseOf(null)).toEqual({ kind: 'internal' });
    expect(failureCauseOf('')).toEqual({ kind: 'internal' });
    expect(failureCauseOf('algo_novo')).toEqual({ kind: 'internal' });
  });

  it('só dígitos contam como código: o formato inesperado não vira código', () => {
    expect(failureCauseOf('meta_13104x')).toEqual({ kind: 'internal' });
    expect(failureCauseOf('meta_12345678901')).toEqual({ kind: 'internal' });
  });
});

describe('deliveryFailureWindowStart', () => {
  it('volta a janela inteira a partir de agora', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    expect(DELIVERY_FAILURE_WINDOW_DAYS).toBe(7);
    expect(deliveryFailureWindowStart(now).toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });
});
