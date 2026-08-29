import { appendFileSync } from 'node:fs';

const ENABLE_VALUE = 'LOCAL_SCRATCH_ONLY';

if (process.env.LOAD_TEST_META_STUB !== ENABLE_VALUE) {
  throw new Error(
    `[load:meta] LOAD_TEST_META_STUB deve ser exatamente "${ENABLE_VALUE}" para carregar o stub.`,
  );
}

const logPath = process.env.LOAD_TEST_META_LOG;
if (!logPath) throw new Error('[load:meta] LOAD_TEST_META_LOG ausente.');

let sequence = 0;
globalThis.fetch = async (input, init) => {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const url = new URL(rawUrl);
  const method = (
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  ).toUpperCase();

  if (
    url.protocol === 'https:' &&
    url.hostname === 'graph.facebook.com' &&
    /^\/v\d+\.\d+\/[^/]+\/messages$/u.test(url.pathname) &&
    method === 'POST'
  ) {
    sequence += 1;
    const providerMessageId = `wamid.load.${process.pid}.${sequence}`;
    appendFileSync(logPath, `${providerMessageId}\n`, { encoding: 'utf8' });
    return new Response(JSON.stringify({ messages: [{ id: providerMessageId }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    throw new Error(`[load:meta] rede externa bloqueada pelo harness: ${url.origin}`);
  }
  throw new Error(`[load:meta] protocolo não suportado no harness: ${url.protocol}`);
};
