import { describe, expect, it } from 'vitest';

import { scrubEvent } from './sentry-scrub';

describe('scrubEvent', () => {
  it('redige token no caminho de convite e dados estruturados de checkout', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://app.example.test/join/secret-invite-token?token=also-secret',
        data: {
          _1_cardNumber: 'card-number-private',
          _1_cardCvv: '123',
          _1_cpfCnpj: '12345678901',
          _1_password: 'senha-nao-deve-vazar',
          event: 'checkout.failed',
        },
      },
    });

    expect(event.request?.url).toBe('https://app.example.test/join/[REDACTED]?token=[REDACTED]');
    expect(event.request?.data).toBe('[REDACTED_REQUEST_BODY]');
  });

  it('remove por inteiro um body multipart bruto', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        data: 'cardNumber=card-number-private&cardCvv=123',
      },
    });

    expect(event.request?.data).toBe('[REDACTED_REQUEST_BODY]');
  });

  it('remove CPF, nome, convenio, body, cookie e authorization de um evento clinico', () => {
    const secrets = {
      cpf: '123.456.789-00',
      nome: 'Paciente Sintetico Privado',
      convenio: 'Convenio Sintetico Privado',
      body: 'texto clinico sob chave desconhecida',
      cookie: 'session=sessao-sintetica-privada',
      authorization: 'Bearer autorizacao-sintetica-privada',
    };
    const event = scrubEvent({
      type: undefined,
      request: {
        cookies: { session: secrets.cookie },
        headers: { Cookie: secrets.cookie, Authorization: secrets.authorization },
        data: { campoNovo: secrets.body },
      },
      extra: { paciente: [secrets], operation: 'clinical.read.failed' },
      contexts: { clinical: { ...secrets } },
    });

    for (const value of Object.values(secrets)) {
      expect(JSON.stringify(event)).not.toContain(value);
    }
    expect(event.request).not.toHaveProperty('cookies');
    expect(event.request).not.toHaveProperty('headers');
    expect(event.request?.data).toBe('[REDACTED_REQUEST_BODY]');
    expect(event.extra?.operation).toBe('clinical.read.failed');
  });
});
