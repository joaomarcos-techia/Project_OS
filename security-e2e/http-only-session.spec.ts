/** Navegador real contra o build Next isolado de `pnpm security:build`. */
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const runtimeEnv = JSON.parse(
  readFileSync(path.join(process.cwd(), 'dist/security-local/runtime-env.json'), 'utf8'),
) as { NEXT_PUBLIC_SUPABASE_URL: string };
const project = new URL(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (!project) throw new Error('Supabase fixture URL is missing a host');
const LEGACY_COOKIE_NAME = `sb-${project}-auth-token`;
const COOKIE_PREFIX = `sb-${project}-auth-token-v2`;
const SELECTOR_COOKIE_NAME = 'qoro-auth-session';
const GENERATION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ACTIVE_COOKIE_NAME = `${COOKIE_PREFIX}-${GENERATION}`;
const authUrl = new URL(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL);
// A sessão excede um cookie para exercitar a fragmentação real do SDK SSR.
const AUTH_USER_METADATA_PADDING_LENGTH = 5_000;
const TOKENS = {
  legacyAccess: 'synthetic-access-legacy',
  legacyRefresh: 'synthetic-refresh-legacy',
  expiringAccess: 'synthetic-access-expiring',
  expiringRefresh: 'synthetic-refresh-expiring',
  confirmedAccess: 'synthetic-access-confirmed',
  confirmedRefresh: 'synthetic-refresh-confirmed',
  rotatedAccess: 'synthetic-access-rotated',
  rotatedRefresh: 'synthetic-refresh-rotated',
} as const;
let authServer: Server;
let refreshes = 0;
let verifications = 0;

type RefreshOutcome = 'success' | 'failure';
type HeldRefresh = {
  outcome: RefreshOutcome;
  entered: boolean;
  resume: Promise<void>;
  release: () => void;
};
let heldRefresh: HeldRefresh | null = null;

function holdNextRefresh(outcome: RefreshOutcome): HeldRefresh {
  let release: (() => void) | undefined;
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!release) throw new Error('Refresh gate was not initialized');
  const hold = { outcome, entered: false, resume, release };
  heldRefresh = hold;
  return hold;
}

function authUser() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: { fixture_padding: 'x'.repeat(AUTH_USER_METADATA_PADDING_LENGTH) },
    created_at: '2026-09-14T00:00:00Z',
  };
}

function authSession(accessToken: string, refreshToken: string) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: authUser(),
  };
}

function encodedSession(accessToken: string, refreshToken: string, expiresInSeconds: number) {
  return `base64-${Buffer.from(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  ).toString('base64url')}`;
}

type BrowserPayload = { body: string; readError?: never } | { body?: never; readError: string };

function decodedSessionCandidates(value: string): string[] {
  return [...value.matchAll(/base64-([A-Za-z0-9+/_-]+={0,2})/g)].flatMap((match) => {
    const encoded = match[1];
    return encoded ? [Buffer.from(encoded, 'base64url').toString('utf8')] : [];
  });
}

function collectBrowserPayloads(page: Page): {
  bodies: Array<Promise<BrowserPayload>>;
  requests: string[];
} {
  const bodies: Array<Promise<BrowserPayload>> = [];
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    // Redirects e 204 não têm corpo disponível no protocolo do navegador.
    if (
      ['document', 'fetch', 'xhr'].includes(response.request().resourceType()) &&
      !(response.status() >= 300 && response.status() < 400) &&
      response.status() !== 204
    ) {
      bodies.push(
        response.text().then(
          (body) => ({ body }),
          (error: unknown) => ({
            readError: `Não foi possível inspecionar ${new URL(response.url()).pathname}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          }),
        ),
      );
    }
  });
  return { bodies, requests };
}

async function expectNoBearerInBrowser(
  page: Page,
  bodies: Array<Promise<BrowserPayload>>,
): Promise<void> {
  const state = await page.evaluate(async () => {
    const databases = await Promise.all(
      (await indexedDB.databases()).map(async ({ name }) => {
        if (!name) throw new Error('IndexedDB sem nome não pode ser inspecionado');
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Leitura IndexedDB bloqueada'));
        });
        try {
          const stores = await Promise.all(
            Array.from(database.objectStoreNames).map(async (storeName) => {
              const store = database.transaction(storeName, 'readonly').objectStore(storeName);
              const read = <T>(request: IDBRequest<T>) =>
                new Promise<T>((resolve, reject) => {
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
              const [keys, records] = await Promise.all([
                read(store.getAllKeys()),
                read(store.getAll()),
              ]);
              return { name: storeName, keys, records };
            }),
          );
          return { name, stores };
        } finally {
          database.close();
        }
      }),
    );
    return {
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases,
    };
  });
  const payloads = await Promise.all(bodies);
  expect(payloads.flatMap((payload) => (payload.readError ? [payload.readError] : []))).toEqual([]);
  const receivedPayload = payloads.map((payload) => payload.body).join('\n');
  const serializedState = JSON.stringify(state);
  const decodedPayload = decodedSessionCandidates(receivedPayload).join('\n');
  const decodedState = decodedSessionCandidates(serializedState).join('\n');
  for (const token of Object.values(TOKENS)) {
    expect(receivedPayload).not.toContain(token);
    expect(serializedState).not.toContain(token);
    expect(decodedPayload).not.toContain(token);
    expect(decodedState).not.toContain(token);
  }
}

test.beforeAll(async () => {
  authServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', authUrl);
    response.setHeader('Content-Type', 'application/json');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body: unknown = bodyText ? JSON.parse(bodyText) : null;

    if (url.pathname === '/auth/v1/verify') {
      if (
        !body ||
        typeof body !== 'object' ||
        !('token_hash' in body) ||
        body.token_hash !== 'valid-invite' ||
        !('type' in body) ||
        body.type !== 'invite'
      ) {
        response.writeHead(403).end(JSON.stringify({ msg: 'Invalid invite token' }));
        return;
      }
      verifications += 1;
      response.end(JSON.stringify(authSession(TOKENS.confirmedAccess, TOKENS.confirmedRefresh)));
      return;
    }

    if (
      url.pathname === '/auth/v1/token' &&
      url.searchParams.get('grant_type') === 'refresh_token'
    ) {
      if (
        !body ||
        typeof body !== 'object' ||
        !('refresh_token' in body) ||
        body.refresh_token !== TOKENS.expiringRefresh
      ) {
        response.writeHead(401).end(JSON.stringify({ msg: 'Invalid refresh token' }));
        return;
      }
      refreshes += 1;
      const hold = heldRefresh;
      if (hold) {
        heldRefresh = null;
        hold.entered = true;
        await hold.resume;
        if (hold.outcome === 'failure') {
          response.writeHead(400).end(
            JSON.stringify({
              msg: 'Refresh token not found',
              code: 'refresh_token_not_found',
            }),
          );
          return;
        }
      }
      response.end(JSON.stringify(authSession(TOKENS.rotatedAccess, TOKENS.rotatedRefresh)));
      return;
    }

    const bearer = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    if (
      url.pathname === '/auth/v1/user' &&
      (bearer === TOKENS.confirmedAccess || bearer === TOKENS.rotatedAccess)
    ) {
      response.end(JSON.stringify(authUser()));
      return;
    }
    response.writeHead(401).end(JSON.stringify({ msg: 'Invalid token' }));
  });
  await new Promise<void>((resolve) =>
    authServer.listen(Number(authUrl.port), authUrl.hostname, resolve),
  );
});

test.afterAll(async () => {
  authServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    authServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test('cookie legado legível é apagado e exige uma autenticação nova', async ({ page, context }) => {
  // Completa também o prefetch RSC de /cadastro antes de iniciar outra
  // navegação. Chromium invalida o corpo pendente quando a página é trocada.
  // Os testes continuam reprovando TODO corpo ilegível durante o fluxo medido.
  await page.goto('/login', { waitUntil: 'networkidle' });
  const origin = new URL(page.url()).origin;
  const value = encodedSession(TOKENS.legacyAccess, TOKENS.legacyRefresh, 3600);
  const splitAt = Math.floor(value.length / 2);
  await context.addCookies([
    {
      name: `${LEGACY_COOKIE_NAME}.0`,
      value: value.slice(0, splitAt),
      url: origin,
      httpOnly: false,
      sameSite: 'Lax',
    },
    {
      name: `${LEGACY_COOKIE_NAME}.1`,
      value: value.slice(splitAt),
      url: origin,
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
  expect(await page.evaluate(() => document.cookie)).toContain(`${LEGACY_COOKIE_NAME}.0`);

  await page.goto('/dashboard');
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(await page.evaluate(() => document.cookie)).not.toContain(LEGACY_COOKIE_NAME);
  const cookies = await context.cookies(origin);
  expect(cookies.some(({ name }) => name.startsWith(LEGACY_COOKIE_NAME))).toBe(false);
  expect(cookies.some(({ name }) => name.startsWith(COOKIE_PREFIX))).toBe(false);
  expect(cookies.some(({ name }) => name === SELECTOR_COOKIE_NAME)).toBe(false);
});

test('confirmação server-side cria geração HttpOnly sem expor bearer ao browser', async ({
  page,
  context,
}) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const origin = new URL(page.url()).origin;
  const observed = collectBrowserPayloads(page);
  const before = verifications;

  // Destino permitido do OTP; convite não emite grant de recovery nem abre formulário de senha.
  const confirmation = await page.goto(
    '/auth/confirm?token_hash=valid-invite&type=invite&next=%2Freset-password',
  );
  expect(confirmation?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/reset-password');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Link inválido ou expirado',
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(verifications).toBe(before + 1);
  const cookies = await context.cookies(origin);
  const selector = cookies.find(({ name }) => name === SELECTOR_COOKIE_NAME);
  expect(selector?.value).toMatch(/^[a-f0-9]{32}$/);
  expect(selector?.httpOnly).toBe(true);
  expect(selector?.secure).toBe(true);
  expect(selector?.sameSite).toBe('Lax');
  const session = cookies.filter(({ name }) =>
    name.startsWith(`${COOKIE_PREFIX}-${selector?.value ?? 'missing'}`),
  );
  expect(session.length).toBeGreaterThan(1);
  expect(
    session.every((cookie) => cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax'),
  ).toBe(true);
  expect(observed.requests.some((url) => url.startsWith(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL))).toBe(
    false,
  );
  await expectNoBearerInBrowser(page, observed.bodies);
});

test('token na janela crítica é rotacionado uma vez sem loop nem troca de geração', async ({
  page,
  context,
}) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const origin = new URL(page.url()).origin;
  const value = encodedSession(TOKENS.expiringAccess, TOKENS.expiringRefresh, 100);
  await context.addCookies([
    {
      name: SELECTOR_COOKIE_NAME,
      value: GENERATION,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: ACTIVE_COOKIE_NAME,
      value,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const observed = collectBrowserPayloads(page);
  const before = refreshes;

  await page.goto('/login/mfa');
  expect(refreshes).toBe(before + 1);
  const cookies = await context.cookies(origin);
  const selector = cookies.find(({ name }) => name === SELECTOR_COOKIE_NAME);
  expect(selector?.value).toBe(GENERATION);
  const session = cookies.filter(({ name }) => name.startsWith(ACTIVE_COOKIE_NAME));
  expect(session.length).toBeGreaterThan(1);
  expect(
    session.every((cookie) => cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax'),
  ).toBe(true);
  expect(observed.requests.some((url) => url.startsWith(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL))).toBe(
    false,
  );
  await expectNoBearerInBrowser(page, observed.bodies);

  await page.reload();
  expect(refreshes).toBe(before + 1);
  await expectNoBearerInBrowser(page, observed.bodies);
});

for (const outcome of ['success', 'failure'] as const) {
  test(`refresh A atrasado (${outcome}) não substitui nem apaga a sessão OTP B`, async ({
    page,
    context,
  }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
    const origin = new URL(page.url()).origin;
    await context.addCookies([
      {
        name: SELECTOR_COOKIE_NAME,
        value: GENERATION,
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: ACTIVE_COOKIE_NAME,
        value: encodedSession(TOKENS.expiringAccess, TOKENS.expiringRefresh, 100),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    const oldPage = await context.newPage();
    const observedOld = collectBrowserPayloads(oldPage);
    const observedNew = collectBrowserPayloads(page);
    const refreshesBefore = refreshes;
    const verificationsBefore = verifications;
    const hold = holdNextRefresh(outcome);
    const oldNavigation = oldPage.goto('/auth/session-refresh?next=/login/mfa');

    try {
      await expect.poll(() => hold.entered).toBe(true);
      const confirmation = await page.goto(
        '/auth/confirm?token_hash=valid-invite&type=invite&next=%2Freset-password',
      );
      expect(confirmation?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe('/reset-password');
      await expect(page.getByRole('main').getByRole('alert')).toContainText(
        'Link inválido ou expirado',
      );
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      expect(verifications).toBe(verificationsBefore + 1);
      const cookiesAfterOtp = await context.cookies(origin);
      const selectorB = cookiesAfterOtp.find(({ name }) => name === SELECTOR_COOKIE_NAME);
      if (!selectorB) throw new Error('OTP did not establish a selected session');
      expect(selectorB.value).toMatch(/^[a-f0-9]{32}$/);
      expect(selectorB.value).not.toBe(GENERATION);
      const sessionB = cookiesAfterOtp.filter(({ name }) =>
        name.startsWith(`${COOKIE_PREFIX}-${selectorB.value}`),
      );
      expect(sessionB.length).toBeGreaterThan(1);

      hold.release();
      await oldNavigation;
      expect(refreshes).toBe(refreshesBefore + 1);
      expect(new URL(oldPage.url()).pathname).toBe(outcome === 'success' ? '/login/mfa' : '/login');
      const cookiesAfterRefresh = await context.cookies(origin);
      expect(cookiesAfterRefresh.find(({ name }) => name === SELECTOR_COOKIE_NAME)).toEqual(
        selectorB,
      );
      expect(
        cookiesAfterRefresh.filter(({ name }) =>
          name.startsWith(`${COOKIE_PREFIX}-${selectorB.value}`),
        ),
      ).toEqual(sessionB);
      expect(
        [selectorB, ...sessionB].every(
          (cookie) => cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax',
        ),
      ).toBe(true);
      expect(
        [...observedOld.requests, ...observedNew.requests].some((url) =>
          url.startsWith(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL),
        ),
      ).toBe(false);
      await expectNoBearerInBrowser(oldPage, observedOld.bodies);
      await expectNoBearerInBrowser(page, observedNew.bodies);
    } finally {
      heldRefresh = null;
      hold.release();
      await oldNavigation;
      await oldPage.close();
    }
  });
}

test('validador detecta sessão base64 em registro IndexedDB genérico e passa após limpeza', async ({
  page,
}) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const databaseName = 'security-detector-positive-control';
  await page.evaluate(
    async ({ name, value }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Criação IndexedDB bloqueada'));
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('records', 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
          transaction.objectStore('records').put({ value }, 'entry');
        });
      } finally {
        database.close();
      }
    },
    {
      name: databaseName,
      value: encodedSession(TOKENS.legacyAccess, TOKENS.legacyRefresh, 3600),
    },
  );

  try {
    await expect(expectNoBearerInBrowser(page, [])).rejects.toThrow(TOKENS.legacyAccess);
  } finally {
    await page.evaluate(async (name) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Limpeza IndexedDB bloqueada'));
      });
    }, databaseName);
  }
  await expectNoBearerInBrowser(page, []);
});

test('validador reprova bearer no payload e corpo que não pôde ser lido', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const leaked = encodedSession(TOKENS.legacyAccess, TOKENS.legacyRefresh, 3600);
  await expect(expectNoBearerInBrowser(page, [Promise.resolve({ body: leaked })])).rejects.toThrow(
    TOKENS.legacyAccess,
  );
  await expect(
    expectNoBearerInBrowser(page, [Promise.resolve({ readError: 'unreadable-response-control' })]),
  ).rejects.toThrow('unreadable-response-control');
});
