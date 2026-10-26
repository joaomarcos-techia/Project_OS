import { createServer, type Server } from 'node:http';

import { expect, test } from '@playwright/test';

import { installVercelBypassForOrigin } from './vercel-bypass';

async function serve(): Promise<{
  server: Server;
  origin: string;
  headers: Array<string | undefined>;
}> {
  const headers: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    const bypass = request.headers['x-vercel-protection-bypass'];
    headers.push(Array.isArray(bypass) ? bypass.join(',') : bypass);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>probe</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor do probe sem porta');
  return { server, origin: `http://127.0.0.1:${address.port}`, headers };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('bypass da Vercel alcança somente o origin do Preview', async ({ browser }) => {
  const original = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const marker = 'fake-vercel-bypass-for-local-test';
  const preview = await serve();
  const thirdParty = await serve();
  const context = await browser.newContext();
  try {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = marker;
    await installVercelBypassForOrigin(context, preview.origin);
    const page = await context.newPage();
    await page.goto(preview.origin);
    await page.goto(thirdParty.origin);
    expect(preview.headers).toEqual([marker]);
    expect(thirdParty.headers).toEqual([undefined]);
  } finally {
    if (original === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = original;
    await context.close();
    await close(preview.server);
    await close(thirdParty.server);
  }
});
