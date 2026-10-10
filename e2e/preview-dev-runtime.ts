import { createHmac, randomBytes } from 'node:crypto';

import { vercelBypassHeaders } from './vercel-bypass';

/** Projeto Supabase DEV em que fixtures de Preview podem escrever. */
export const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';

/**
 * Prova assinada de que o Preview em `baseUrl` usa Auth e banco do projeto DEV.
 * Specs que criam fixture no DEV chamam isto antes de qualquer escrita: um
 * `E2E_BASE_URL` apontando para outro deploy faria a UI escrever em outro banco.
 */
export async function assertPreviewRuntimeIsDev(baseUrl: string): Promise<void> {
  const secret = process.env.MAGIC_TOKEN_SECRET_DEV ?? process.env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('Prova assinada do runtime Preview indisponível.');
  const timestamp = Date.now();
  const nonce = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
    .digest('hex');
  const response = await fetch(new URL('/api/signup/runtime-fingerprint', baseUrl), {
    method: 'POST',
    headers: {
      ...vercelBypassHeaders(),
      'content-type': 'application/json',
      'x-qoro-e2e-signature': signature,
    },
    body: JSON.stringify({ timestamp, nonce }),
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Preview recusou a prova do projeto DEV (${response.status}).`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error(`Preview não devolveu prova JSON (${response.status}).`);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('Preview devolveu prova JSON inválida.');
  }
  if (
    !result ||
    typeof result !== 'object' ||
    !('environment' in result) ||
    !('authProjectRef' in result) ||
    !('databaseProjectRef' in result) ||
    result.environment !== 'preview' ||
    result.authProjectRef !== DEV_PROJECT_REF ||
    result.databaseProjectRef !== DEV_PROJECT_REF
  ) {
    throw new Error('Preview não comprovou Auth e banco no projeto DEV esperado.');
  }
}
