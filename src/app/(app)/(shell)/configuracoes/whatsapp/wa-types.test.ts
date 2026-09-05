import { describe, expect, it } from 'vitest';

import { MetaConnectError } from '@/contexts/messaging/errors';

import { fail } from './wa-types';

describe('fail', () => {
  it('expõe orientação da etapa sem vazar detalhes internos da Meta', () => {
    const result = fail(
      new MetaConnectError('[meta] graph HTTP 400 code=100 com token secreto', {
        stage: 'phone_registration',
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: 'META_AUTH_FAILED',
      message:
        'A Meta recusou a ativação do número. Confirme a verificação por SMS/voz e use um PIN novo de 6 dígitos, diferente do código recebido.',
    });
    if (result.ok) throw new Error('expected Meta connection failure');
    expect(result.message).not.toContain('code=100');
    expect(result.message).not.toContain('secreto');
  });

  // D78 — cada etapa nova precisa pedir uma AÇÃO diferente. Repetir a mensagem
  // de `account` mandaria o operador reconferir a conta durante uma
  // instabilidade da Meta, ou reconfirmar a conta quando falta escolher o número.
  it('separa seleção ambígua de número, indisponibilidade da Meta e falha de conta', () => {
    const messageFor = (stage: 'account' | 'phone_ambiguous' | 'provider_unavailable') => {
      const r = fail(new MetaConnectError('[meta] detalhe interno', { stage }));
      if (r.ok) throw new Error('expected Meta connection failure');
      return r.message;
    };

    const ambiguous = messageFor('phone_ambiguous');
    const unavailable = messageFor('provider_unavailable');
    const account = messageFor('account');

    expect(new Set([ambiguous, unavailable, account]).size).toBe(3);
    expect(ambiguous).toContain('mais de um número');
    expect(unavailable).toContain('Nada foi alterado');
    // Indisponibilidade não manda revisar a conta: não há evidência de recusa.
    expect(unavailable).not.toContain('Confirme a conta');
    for (const message of [ambiguous, unavailable, account]) {
      expect(message).not.toContain('detalhe interno');
    }
  });

  // D78 — a distinção precisa chegar à TELA, não só à auditoria. Rate limit
  // pede espera; resultado desconhecido de mutação não pode prometer que nada
  // mudou nem mandar repetir na hora.
  it('separa rate limit de resultado desconhecido e de indisponibilidade de leitura', () => {
    const messageFor = (
      stage: 'provider_rate_limited' | 'provider_outcome_unknown' | 'provider_unavailable',
    ) => {
      const r = fail(new MetaConnectError('[meta] graph HTTP 429 code=4', { stage }));
      if (r.ok) throw new Error('expected Meta connection failure');
      return r.message;
    };

    const rateLimited = messageFor('provider_rate_limited');
    const unknown = messageFor('provider_outcome_unknown');
    const unavailable = messageFor('provider_unavailable');

    expect(new Set([rateLimited, unknown, unavailable]).size).toBe(3);

    // Rate limit: só se afirma o que é verificável localmente — a conexão não
    // foi salva. NÃO se promete que o POST deixou de ser executado na Meta.
    expect(rateLimited).toContain('a conexão não foi salva');
    expect(rateLimited).toMatch(/[Aa]guarde/u);
    expect(rateLimited).not.toMatch(/[Nn]ada foi alterado/u);

    // Mutação indeterminada: NUNCA promete que nada mudou, e não manda reabrir
    // a tela — sem conexão persistida não há o que sondar ali.
    expect(unknown).not.toMatch(/[Nn]ada foi alterado/u);
    expect(unknown).not.toMatch(/reabra|reabrir/u);
    expect(unknown).toContain('a conexão não foi salva');
    expect(unknown).toContain('WhatsApp Manager');

    // Leitura indeterminada: aí sim é seguro dizer que nada mudou.
    expect(unavailable).toContain('Nada foi alterado');

    for (const message of [rateLimited, unknown, unavailable]) {
      expect(message).not.toContain('429');
      expect(message).not.toContain('code=4');
      expect(message).not.toMatch(/recusou/u);
    }
  });

  it('mantém mensagem genérica para uma etapa não identificada', () => {
    const result = fail(new MetaConnectError('[meta] falha desconhecida'));

    expect(result).toMatchObject({
      ok: false,
      code: 'META_AUTH_FAILED',
      message: 'Não foi possível conectar o WhatsApp. Tente novamente.',
    });
  });
});
