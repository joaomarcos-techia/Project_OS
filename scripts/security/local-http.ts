/** Exercita o build real em localhost, com IDs Next-Action do próprio build. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';

import {
  supabaseAuthCookieName,
  SUPABASE_SESSION_SELECTOR_COOKIE,
} from '../../src/lib/auth/supabase-session-cookie';

const root = process.cwd();
const output = path.join(root, 'dist/security-local');
const target = path.join(output, 'app');
const base = 'http://localhost:3217';
const manifest = z
  .object({
    node: z.record(
      z.string(),
      z.object({
        workers: z.record(z.string(), z.unknown()),
        filename: z.string().optional(),
        exportedName: z.string().optional(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      await readFile(path.join(target, '.next/server/server-reference-manifest.json'), 'utf8'),
    ),
  );
const env = z
  .object({ NODE_ENV: z.literal('production') })
  .catchall(z.string())
  .parse(JSON.parse(await readFile(path.join(output, 'runtime-env.json'), 'utf8')));
const invalidSessionGeneration = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const invalidSessionCookieName = supabaseAuthCookieName(
  env.NEXT_PUBLIC_SUPABASE_URL,
  invalidSessionGeneration,
);
assert.ok(invalidSessionCookieName, 'runtime env sem nome válido de cookie Supabase');
const invalidSessionCookie = `${SUPABASE_SESSION_SELECTOR_COOKIE}=${invalidSessionGeneration}; ${invalidSessionCookieName}=invalid`;
const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3217', '-H', 'localhost'],
  { cwd: target, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverLog = '';
server.stdout.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
server.stderr.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
interface Observation {
  test: string;
  path: string;
  method: string;
  status: number;
  type: string;
  bytes: number;
  body: string;
  location: string;
  cors: string;
  /** Cabeçalhos de segurança observados na resposta (item 10 da auditoria). */
  csp: string;
  cspReportOnly: string;
}
const observations: Observation[] = [];
async function request(
  test: string,
  route: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body = '',
): Promise<Observation> {
  // node:http preserva /./ e //; fetch/URL normalizariam alguns vetores antes do envio.
  const result = await new Promise<Observation>((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: 3217, path: route, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({
            test,
            path: route,
            method,
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            bytes: Buffer.byteLength(text),
            body: text.slice(0, 700),
            location: String(res.headers.location ?? ''),
            cors: String(res.headers['access-control-allow-origin'] ?? ''),
            csp: String(res.headers['content-security-policy'] ?? ''),
            cspReportOnly: String(res.headers['content-security-policy-report-only'] ?? ''),
          });
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error(`timeout ${test}`)));
    req.on('error', reject);
    req.end(body);
  });
  observations.push(result);
  return result;
}
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('next start timeout')), 60_000);
    const ready = (chunk: Buffer) => {
      if (chunk.toString().includes('Ready in')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', ready);
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`next start exit ${code}: ${serverLog}`));
    });
  });
  for (const [name, headers] of [
    ['baseline', {}],
    [
      'middleware-subrequest',
      {
        'x-middleware-subrequest':
          'middleware:middleware:middleware:middleware:middleware:src/middleware:src/middleware:src/middleware:src/middleware:src/middleware',
      },
    ],
    ['nextjs-data', { 'x-nextjs-data': '1' }],
    ['rsc', { RSC: '1' }],
    ['router-state', { 'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(['', {}])) }],
  ] as const) {
    const response = await request(`health:${name}`, '/api/health', 'GET', headers);
    assert.equal(response.status, 401, `health:${name}`);
    assert.match(response.body, /unauthorized/);
  }
  for (const route of [
    '/api/health/',
    '/api//health',
    '/api/./health',
    '/api%2Fhealth',
    '/api/..%2Fhealth',
  ]) {
    const response = await request('health:path', route);
    assert.ok([307, 308, 400, 401, 403, 404].includes(response.status), JSON.stringify(response));
  }
  assert.equal((await request('health:head', '/api/health', 'HEAD')).status, 401);
  const preflight = await request('csrf:preflight', '/api/health', 'OPTIONS', {
    Origin: 'https://evil.test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Next-Action',
  });
  assert.equal(preflight.cors, ''); // OPTIONS 204 sem ACAO não autoriza um navegador a ler/escrever.

  for (const [id, action] of Object.entries(manifest.node)) {
    const worker = Object.keys(action.workers).find((name) => name.endsWith('/page'));
    if (!worker) continue; // Não existe endpoint de Server Action neste build para worker somente route.ts.
    const route =
      '/' +
      worker
        .split('/')
        .slice(1, -1)
        .filter((part) => !part.startsWith('('))
        .map((part) => (part.startsWith('[') ? '11111111-1111-4111-8111-111111111111' : part))
        .join('/');
    const name = action.exportedName ?? id;
    const headers = { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Origin: base };
    await request(`action:no-cookie:${name}`, route, 'POST', headers, '[]');
    // Cookie deliberadamente inválido atravessa somente o redirecionamento de UX.
    // O guard real deve negar; isto NÃO é uma sessão autenticada de teste.
    await request(
      `action:invalid-cookie:${name}`,
      route,
      'POST',
      { ...headers, Cookie: invalidSessionCookie },
      '[]',
    );
  }
  const action = Object.entries(manifest.node).find(
    ([, entry]) => entry.exportedName === 'loginAction',
  );
  assert.ok(action, 'loginAction ausente do manifesto');
  // O controle nativo de Origin executa antes de ler o payload/sessão da ação.
  // O cookie aqui é inválido: não se declara E2E com usuário autenticado.
  const csrf = await request(
    'csrf:foreign-origin',
    '/login',
    'POST',
    {
      'Next-Action': action[0],
      'Content-Type': 'text/plain',
      Origin: 'https://evil.test',
      Cookie: invalidSessionCookie,
    },
    '[]',
  );
  assert.equal(csrf.status, 500); // Contrato observado do Next 15: erro fechado, sem executar ação.
  assert.match(serverLog, /Invalid Server Actions request|does not match.*origin/is);
  // --- item 10: a CSP que o servidor REALMENTE devolve --------------------
  const recoveryBridge = await fetch(`${base}/cadastro/retomar`);
  assert.equal(recoveryBridge.status, 200);
  assert.equal(recoveryBridge.headers.get('referrer-policy'), 'no-referrer');
  assert.match(recoveryBridge.headers.get('content-security-policy') ?? '', /default-src 'none'/u);
  assert.match(recoveryBridge.headers.get('content-security-policy') ?? '', /script-src 'sha256-/u);
  assert.match(recoveryBridge.headers.get('cache-control') ?? '', /no-store/u);
  // O teste unitário prova a string montada; isto prova o cabeçalho na resposta
  // HTTP de uma página real, servida pelo `next start` deste build.
  const page = await request('headers:login', '/login');
  assert.ok(page.csp, 'resposta sem Content-Security-Policy bloqueante');
  assert.equal(page.cspReportOnly, '', 'CSP voltou a ser servida em Report-Only');
  const cspDirectives = new Map(
    page.csp.split('; ').map((part) => {
      const [name, ...sources] = part.split(' ');
      return [name ?? '', sources];
    }),
  );
  for (const [name, sources] of cspDirectives) {
    // Nenhum esquema solto e nenhum curinga: era assim que `connect-src https:`
    // deixava o prontuário sair para qualquer host TLS.
    assert.ok(!sources.includes('*'), `${name} aceita curinga na resposta real`);
    assert.ok(!sources.includes('https:'), `${name} aceita https: genérico na resposta real`);
    assert.ok(!sources.includes('wss:'), `${name} aceita wss: genérico na resposta real`);
  }
  assert.ok(
    !page.csp.includes('unsafe-eval'),
    "resposta real reintroduziu 'unsafe-eval' em script-src",
  );
  for (const required of [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]) {
    assert.ok(page.csp.includes(required), `resposta real perdeu: ${required}`);
  }

  const failures = observations.filter(
    (item) => item.test.startsWith('action:') && item.status === 200,
  );
  for (const item of failures) {
    const line = item.body.split('\n').find((part) => part.startsWith('1:'));
    assert.ok(line, `200 sem envelope reconhecido: ${item.test}`);
    const result: unknown = JSON.parse(line.slice(2));
    const serializedResult = JSON.stringify(result);
    assert.doesNotMatch(
      serializedResult,
      /Cannot read properties|TypeError|ReferenceError|SyntaxError|ZodError|invalid_type.*expected.*received|\bat .+\(.+:[0-9]+:[0-9]+\)/u,
      `200 revelou detalhe interno antes da negativa: ${item.test}`,
    );
    const denied =
      typeof result === 'object' &&
      result !== null &&
      (('ok' in result && result.ok === false) ||
        ('error' in result && typeof result.error === 'string' && result.error.length > 0) ||
        ('kind' in result && result.kind === 'invalid'));
    assert.ok(denied, `200 sem negativa explícita: ${item.test}`);
  }
  console.log(
    JSON.stringify(
      {
        healthVectors: 12,
        actions: Object.keys(manifest.node).length,
        actionRequests: observations.filter((item) => item.test.startsWith('action:')).length,
        action200WithExplicitDenial: failures.length,
        csrfNativeRejected: true,
        cspEnforced: Boolean(page.csp) && page.cspReportOnly === '',
        cspDirectives: cspDirectives.size,
      },
      null,
      2,
    ),
  );
  // 200 é destacado para análise do envelope: erro de formulário != leitura ou escrita autorizada.
  for (const item of failures) console.log(JSON.stringify(item));
} finally {
  server.kill();
  await writeFile(path.join(output, 'http-results.json'), JSON.stringify(observations, null, 2));
  await writeFile(path.join(output, 'http-server.log'), serverLog);
}
