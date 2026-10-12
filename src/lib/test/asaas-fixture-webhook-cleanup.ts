/** Remove only the Sandbox webhook created for an isolated Preview E2E clinic. */
const SANDBOX_WEBHOOKS_URL = 'https://api-sandbox.asaas.com/v3/webhooks';
const FIXTURE_WEBHOOK_NAME = 'Qoro — cobranca de paciente';

type FetchWebhook = (url: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function cleanupSandboxFixtureWebhook(input: {
  apiKey: string;
  webhookRef: string;
  previewUrl: string;
  fetcher?: FetchWebhook;
}): Promise<number> {
  if (!input.apiKey || !/^[0-9a-f-]{36}$/i.test(input.webhookRef)) {
    throw new Error('Fixture Asaas sem chave Sandbox ou referência válida.');
  }
  const preview = new URL(input.previewUrl);
  if (preview.protocol !== 'https:' || !preview.hostname.endsWith('.vercel.app')) {
    throw new Error('Cleanup de webhook permitido somente em Preview Vercel.');
  }

  const fetcher = input.fetcher ?? fetch;
  const headers = { access_token: input.apiKey };
  const list = await fetcher(`${SANDBOX_WEBHOOKS_URL}?offset=0&limit=100`, { headers });
  if (!list.ok) throw new Error(`Listagem de webhooks Sandbox falhou (HTTP ${list.status}).`);
  const payload: unknown = await list.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Listagem de webhooks Sandbox retornou formato inválido.');
  }

  const expectedPath = `/api/webhooks/asaas/patient/${input.webhookRef}`;
  const ids: string[] = [];
  for (const item of payload.data) {
    if (!isRecord(item) || item.name !== FIXTURE_WEBHOOK_NAME || typeof item.url !== 'string') {
      continue;
    }
    let configuredUrl: URL;
    try {
      configuredUrl = new URL(item.url);
    } catch {
      continue;
    }
    // APP_BASE_URL may use another Preview alias than E2E_BASE_URL. The fresh
    // fixture ref identifies ownership; require a Vercel Preview, not one host.
    if (
      configuredUrl.protocol !== 'https:' ||
      !configuredUrl.hostname.endsWith('.vercel.app') ||
      configuredUrl.pathname !== expectedPath
    ) {
      continue;
    }
    if (typeof item.id !== 'string' || !item.id) {
      throw new Error('Webhook da fixture sem ID; cleanup não pode prosseguir.');
    }
    ids.push(item.id);
  }

  for (const id of ids) {
    const url = `${SANDBOX_WEBHOOKS_URL}/${encodeURIComponent(id)}`;
    const deleted = await fetcher(url, { method: 'DELETE', headers });
    if (deleted.status !== 200) {
      throw new Error(`Remoção do webhook da fixture falhou (HTTP ${deleted.status}).`);
    }
    const result: unknown = await deleted.json();
    if (!isRecord(result) || result.deleted !== true) {
      throw new Error('Asaas não confirmou a remoção do webhook da fixture.');
    }
    const readback = await fetcher(url, { headers });
    if (readback.status !== 404) {
      throw new Error(`Webhook da fixture persiste após remoção (HTTP ${readback.status}).`);
    }
  }
  return ids.length;
}
