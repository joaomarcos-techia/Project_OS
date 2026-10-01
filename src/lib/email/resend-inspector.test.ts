import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createResendInboxAlias,
  getSentEmail,
  listReceivedEmails,
  ResendInspectorError,
  waitForResendEmail,
} from './resend-inspector';

const ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';

afterEach(() => vi.unstubAllGlobals());

describe('Resend inspector', () => {
  it('lista e recupera somente payloads validados sem pôr a chave na URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: ID,
                to: ['qoro-e2e@inbound.resend.app'],
                from: 'Qoro <noreply@qoro.test>',
                subject: 'Convite Qoro',
                created_at: '2026-09-28T12:00:00Z',
                last_event: 'delivered',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: ID,
            to: ['qoro-e2e@inbound.resend.app'],
            from: 'Qoro <noreply@qoro.test>',
            subject: 'Convite Qoro',
            created_at: '2026-09-28T12:00:00Z',
            last_event: 'delivered',
            html: '<a href="https://app.qoro.test/join#invite=token">Entrar</a>',
            text: 'Entrar',
            message_id: '<safe@example.test>',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const found = await waitForResendEmail({
      apiKey: 're_test_secret',
      to: 'qoro-e2e@inbound.resend.app',
      subject: 'Convite Qoro',
      sentAfter: new Date('2026-09-28T11:59:00Z'),
      kind: 'sent',
      timeoutMs: 1_000,
      pollMs: 100,
    });

    expect(found.lastEvent).toBe('delivered');
    expect(found.html).toContain('/join#invite=');
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('re_test_secret');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toEqual({
      authorization: 'Bearer re_test_secret',
    });
  });

  it('suporta a API de recebidos e descarta linhas inválidas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'not-an-id', to: [], from: '', subject: '', created_at: '' },
                {
                  id: ID,
                  to: ['inbox@abc.resend.app'],
                  from: 'Qoro <noreply@qoro.test>',
                  subject: 'Teste',
                  created_at: '2026-09-28T12:00:00Z',
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(listReceivedEmails('re_key')).resolves.toHaveLength(1);
  });

  it('continua consultando enquanto o envio ainda não atingiu um evento aceito', async () => {
    const queued = {
      id: ID,
      to: ['qoro-e2e@inbound.resend.app'],
      from: 'Qoro <noreply@qoro.test>',
      subject: 'Teste de entrega',
      created_at: '2026-09-28T12:00:00Z',
      last_event: 'queued',
    };
    const delivered = { ...queued, last_event: 'delivered' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [queued] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [delivered] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...delivered,
            html: '<p>ok</p>',
            text: 'ok',
            message_id: '<safe@test>',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const found = await waitForResendEmail({
      apiKey: 're_key',
      to: 'qoro-e2e@inbound.resend.app',
      subject: 'Teste de entrega',
      sentAfter: new Date('2026-09-28T11:59:00Z'),
      kind: 'sent',
      timeoutMs: 1_000,
      pollMs: 100,
      acceptedLastEvents: ['delivered'],
      rejectedLastEvents: ['bounced'],
    });

    expect(found.lastEvent).toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('não inclui corpo de erro do provedor na exceção', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'restricted_api_key',
              message: 'token e destinatário sensíveis',
            }),
            { status: 403 },
          ),
      ),
    );

    const error = await getSentEmail('re_key', ID).catch((caught) => caught);
    expect(error).toBeInstanceOf(ResendInspectorError);
    expect(String(error)).toContain('restricted_api_key');
    expect(String(error)).not.toContain('destinatário');
  });

  it('gera alias isolado no domínio inbound sem reutilizar o local-part manual', () => {
    expect(createResendInboxAlias('qualquer@abc123.resend.app', 'RUN_2026.09')).toBe(
      'qoro-e2e-run202609@abc123.resend.app',
    );
  });
});
