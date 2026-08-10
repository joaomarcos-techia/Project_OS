import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendWithResend } from './resend';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const input = {
  to: 'titular@example.com',
  subject: 'Seu arquivo LGPD está pronto',
  html: '<p>Arquivo pronto</p>',
  text: 'Arquivo pronto',
  idempotencyKey: 'lgpd-export/request-1',
};

describe('sendWithResend', () => {
  it('envia conteúdo e chave idempotente sem expor a chave da API no corpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'email_1' }));
    globalThis.fetch = fetchMock;

    await expect(
      sendWithResend(input, { apiKey: 're_secret', from: 'Qoro <privacy@example.com>' }),
    ).resolves.toEqual({
      providerMessageId: 'email_1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer re_secret',
          'Idempotency-Key': 'lgpd-export/request-1',
        }),
        body: JSON.stringify({
          from: 'Qoro <privacy@example.com>',
          to: ['titular@example.com'],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      }),
    );
  });

  it('propaga falha do provedor para o worker retentar', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ name: 'validation_error', message: 'invalid sender' }, { status: 422 }),
      );

    await expect(
      sendWithResend(input, { apiKey: 're_secret', from: 'invalid' }),
    ).rejects.toMatchObject({
      name: 'TransactionalEmailError',
      status: 422,
      message: 'Resend rejected transactional email (422; validation_error)',
    });
  });

  it('does not copy provider error details into the application error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { name: 'validation_error', message: 'sender private@example.com is invalid' },
          { status: 400 },
        ),
      );

    await expect(sendWithResend(input, { apiKey: 're_secret', from: 'invalid' })).rejects.toThrow(
      'Resend rejected transactional email (400; validation_error)',
    );
  });
});
