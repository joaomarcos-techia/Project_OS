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
  loginPage: boolean;
  location: string;
  cors: string;
  /** Cabeçalhos de segurança observados na resposta (item 10 da auditoria). */
  csp: string;
  cspReportOnly: string;
}
const observations: Observation[] = [];
/**
 * Corpo inteiro da resposta, para quem precisa ler o JSON: o relatório (`observations`)
 * guarda só os 700 primeiros caracteres, e um JSON maior que isso não se lê do `body`.
 */
const fullBodies = new WeakMap<Observation, string>();
const fullBody = (o: Observation): string => fullBodies.get(o) ?? o.body;
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
          const observation: Observation = {
            test,
            path: route,
            method,
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            bytes: Buffer.byteLength(text),
            body: text.slice(0, 700),
            loginPage: text.includes('Entrar · Qoro'),
            location: String(res.headers.location ?? ''),
            cors: String(res.headers['access-control-allow-origin'] ?? ''),
            csp: String(res.headers['content-security-policy'] ?? ''),
            cspReportOnly: String(res.headers['content-security-policy-report-only'] ?? ''),
          };
          fullBodies.set(observation, text);
          resolve(observation);
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
    // Next 16 canonicalizes RSC requests before the route handler. The
    // canonical URL must remain the same protected endpoint and deny access.
    if (name === 'rsc' && response.status === 307) {
      assert.equal(response.location, '/api/health?_rsc');
      const canonical = await request('health:rsc:canonical', response.location, 'GET', headers);
      assert.equal(canonical.status, 401, 'health:rsc:canonical');
      assert.match(canonical.body, /unauthorized/);
    } else {
      assert.equal(response.status, 401, `health:${name}`);
      assert.match(response.body, /unauthorized/);
    }
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

  // P9.2 — validador XSD TISS no MESMO build que vai para a Vercel: sem credencial, 401;
  // com o Bearer do monitoramento, o autoteste (válido aceito, inválido e hostil
  // recusados) roda no worker do xmllint-wasm a partir do `.next` deste build.
  assert.equal((await request('tiss-xsd:anon', '/api/health/tiss-xsd')).status, 401);
  const xsdCheck = await request('tiss-xsd:monitoring', '/api/health/tiss-xsd', 'GET', {
    Authorization: `Bearer ${env.CRON_SECRET}`,
  });
  const xsdReport = z
    .object({
      status: z.literal('ok'),
      engine: z.literal('xmllint-wasm@5.3.0'),
      schemaVersion: z.literal('4.03.00'),
      schemaSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      failure: z.null(),
      checks: z.object({ validAccepted: z.literal(true), invalidRejected: z.literal(true), hostileRejected: z.literal(true) }),
      ms: z.object({ valid: z.number(), invalid: z.number(), total: z.number() }),
      rssMb: z.number(),
    })
    .parse(JSON.parse(fullBody(xsdCheck)));
  assert.equal(xsdCheck.status, 200);
  // Sonda de limites no build real: namespace, lote grande, timeout, teto de memória e fila.
  const limitsCheck = await request('tiss-xsd:limits', '/api/health/tiss-xsd?probe=limits', 'GET', {
    Authorization: `Bearer ${env.CRON_SECRET}`,
  });
  const limitsReport = z
    .object({
      limits: z.object({
        status: z.literal('ok'),
        checks: z.object({
          namespaceRejected: z.literal(true),
          largeBatchAccepted: z.literal(true),
          timeoutEnforced: z.literal(true),
          memoryLimitEnforced: z.literal(true),
          queueEnforced: z.literal(true),
        }),
        ms: z.object({ largeBatch: z.number(), total: z.number() }).passthrough(),
      }),
    })
    .parse(JSON.parse(fullBody(limitsCheck)));
  assert.equal(limitsCheck.status, 200);
  // O rastreamento de arquivos (o que a Vercel empacota na função) inclui o worker, o
  // `.wasm` e os XSD: a rota não depende de arquivo fora do bundle.
  const trace = z
    .object({ files: z.array(z.string()) })
    .parse(JSON.parse(await readFile(path.join(target, '.next/server/app/api/health/tiss-xsd/route.js.nft.json'), 'utf8')));
  for (const needed of ['xmllint-wasm/xmllint.wasm', 'xmllint-wasm/xmllint-node.js', 'xmllint-wasm/package.json', 'schemas/4.03.00/MANIFEST.json', 'schemas/4.03.00/tissV4_03_00.xsd', 'schemas/4.03.00/tissSimpleTypesV4_03_00.xsd']) {
    assert.ok(trace.files.some((f) => f.replaceAll('\\', '/').endsWith(needed)), `bundle da rota tiss-xsd sem ${needed}`);
  }
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
  const loginRedirects = failures.filter(
    (item) => item.test.endsWith(':switchAccountAction') && item.loginPage,
  );
  for (const item of failures) {
    // This action deliberately clears the local MFA session and redirects to
    // login. Next 16 renders that destination as a 200 RSC response.
    if (loginRedirects.includes(item)) {
      assert.equal(item.type, 'text/x-component');
      continue;
    }
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
        tissXsd: { engine: xsdReport.engine, validMs: xsdReport.ms.valid, totalMs: xsdReport.ms.total, rssMb: xsdReport.rssMb, tracedFiles: 6, limitsLargeBatchMs: limitsReport.limits.ms.largeBatch, limitsTotalMs: limitsReport.limits.ms.total },
        actions: Object.keys(manifest.node).length,
        actionRequests: observations.filter((item) => item.test.startsWith('action:')).length,
        action200WithExplicitDenial: failures.length - loginRedirects.length,
        action200LoginRedirect: loginRedirects.length,
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
