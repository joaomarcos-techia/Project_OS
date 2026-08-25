/**
 * Tradução de erro → mensagem da tela de pagamentos.
 *
 * Cobre a distinção que muda o comportamento do operador (chave errada vs Asaas
 * fora do ar) e a regra de não vazamento: erro não mapeado vira mensagem
 * genérica, nunca a mensagem original — numa tela de credencial de terceiro,
 * detalhe de exceção é dica para quem estiver do outro lado.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PaymentCredentialRejectedError,
  PaymentProviderUnavailableError,
} from '@/contexts/payments';

import { fail, ok } from './pagamentos-types';

afterEach(() => vi.restoreAllMocks());

describe('fail', () => {
  it('distingue chave recusada de provedor indisponível', () => {
    const rejected = fail(new PaymentCredentialRejectedError(['invalid_apiKey']));
    const unavailable = fail(new PaymentProviderUnavailableError());

    expect(rejected.ok).toBe(false);
    expect(unavailable.ok).toBe(false);
    expect(rejected).not.toEqual(unavailable);
    expect(!rejected.ok && rejected.code).toBe('payment_credential_rejected');
    expect(!unavailable.ok && unavailable.code).toBe('payment_provider_unavailable');
  });

  it('traduz falta de permissão sem expor internals', () => {
    const result = fail(Object.assign(new Error('nope'), { name: 'AuthError' }));
    expect(!result.ok && result.code).toBe('forbidden');
    expect(!result.ok && result.message).not.toContain('nope');
  });

  it('erro não mapeado: mensagem genérica na tela, detalhe só no log', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = fail(new Error('detalhe interno com $aact_chave'));

    expect(!result.ok && result.code).toBe('error');
    expect(!result.ok && result.message).toBe('Não foi possível concluir a ação. Tente novamente.');
    expect(!result.ok && result.message).not.toContain('$aact_chave');
    expect(spy).toHaveBeenCalled();
  });
});

describe('ok', () => {
  it('embrulha o dado sem alterá-lo', () => {
    expect(ok({ hasApiKey: true })).toEqual({ ok: true, data: { hasApiKey: true } });
  });
});
