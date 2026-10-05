import { describe, expect, it } from 'vitest';

import { cleanupSandboxFixtureWebhook } from './asaas-fixture-webhook-cleanup';

const REF = '11111111-1111-4111-8111-111111111111';
const PREVIEW = 'https://qoro-preview.vercel.app';
const TARGET = `${PREVIEW}/api/webhooks/asaas/patient/${REF}`;
const NAME = 'Qoro — cobranca de paciente';

function input(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  return { apiKey: 'sandbox-fixture-key', webhookRef: REF, previewUrl: PREVIEW, fetcher };
}

describe('cleanupSandboxFixtureWebhook', () => {
  it('remove apenas a ref da fixture e exige readback 404', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${new URL(url).pathname}`);
      if (url.includes('?offset=')) {
        return Response.json({
          data: [
            { id: 'own', name: NAME, url: `${TARGET}?x-vercel-protection-bypass=masked` },
            {
              id: 'other-ref',
              name: NAME,
              url: `${PREVIEW}/api/webhooks/asaas/patient/${crypto.randomUUID()}`,
            },
            {
              id: 'rotated-preview',
              name: NAME,
              url: TARGET.replace('qoro-preview', 'old-preview'),
            },
            {
              id: 'production-host',
              name: NAME,
              url: TARGET.replace('qoro-preview.vercel.app', 'app.qoro.dev'),
            },
          ],
        });
      }
      if (method === 'DELETE') return Response.json({ deleted: true });
      return new Response('not found', { status: 404 });
    };

    await expect(cleanupSandboxFixtureWebhook(input(fetcher))).resolves.toBe(2);
    expect(calls).toEqual([
      'GET /v3/webhooks',
      'DELETE /v3/webhooks/own',
      'GET /v3/webhooks/own',
      'DELETE /v3/webhooks/rotated-preview',
      'GET /v3/webhooks/rotated-preview',
    ]);
  });

  it('não remove webhooks quando o alvo da fixture está malformado', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string): Promise<Response> => {
      calls.push(url);
      return Response.json({ data: [{ name: NAME, url: TARGET }] });
    };
    await expect(cleanupSandboxFixtureWebhook(input(fetcher))).rejects.toThrow('sem ID');
    expect(calls).toHaveLength(1);
  });

  it('falha se a remoção não for confirmada pelo Asaas', async () => {
    const fetcher = async (url: string): Promise<Response> =>
      url.includes('?offset=')
        ? Response.json({ data: [{ id: 'own', name: NAME, url: TARGET }] })
        : Response.json({ deleted: false });
    await expect(cleanupSandboxFixtureWebhook(input(fetcher))).rejects.toThrow('não confirmou');
  });

  it('falha se o webhook ainda existir no readback', async () => {
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('?offset=')) {
        return Response.json({ data: [{ id: 'own', name: NAME, url: TARGET }] });
      }
      if (init?.method === 'DELETE') return Response.json({ deleted: true });
      return Response.json({ id: 'own' });
    };
    await expect(cleanupSandboxFixtureWebhook(input(fetcher))).rejects.toThrow('persiste');
  });

  it('recusa origem fora de Preview antes de chamar o provider', async () => {
    let called = false;
    const fetcher = async (): Promise<Response> => {
      called = true;
      return Response.json({ data: [] });
    };
    await expect(
      cleanupSandboxFixtureWebhook({ ...input(fetcher), previewUrl: 'https://app.qoro.dev' }),
    ).rejects.toThrow('somente em Preview');
    expect(called).toBe(false);
  });
});
