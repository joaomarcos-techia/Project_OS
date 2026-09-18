/**
 * O.S — o kill switch do cadastro, provado no NAVEGADOR e no BANCO.
 *
 * O teste de unidade já provava que `/cadastro` renderiza a tela fechada. O que
 * ele não podia provar é o que importa numa emergência: que com a chave
 * desligada **nenhuma linha nasce**. Uma tela fechada com o formulário montado
 * atrás dela continuaria criando `signup_sessions` — e é exatamente esse o
 * cenário que um interruptor de incidente precisa impedir.
 *
 * Por isso aqui há três builds servidos de verdade (o mesmo `.next`, porque as
 * duas chaves são lidas em runtime pelo servidor), um Chromium real e uma
 * contagem de linhas no Postgres antes e depois de cada visita.
 *
 * Variantes:
 *   A  SIGNUP_ENABLED=true  + SIGNUP_IDENTITY_ENABLED=true   → cadastro ABERTO
 *   B  SIGNUP_ENABLED=false                                   → cadastro FECHADO
 *   C  SIGNUP_ENABLED=true  + SIGNUP_IDENTITY_ENABLED=false   → cadastro FECHADO
 *
 * E, em todas: quem já é cliente não pode ser atingido. `/login` continua
 * servindo a tela de entrada e `/dashboard` continua mandando para o login —
 * nunca para a página de cadastro fechado. Um interruptor de cadastro que
 * derrubasse a porta de entrada de quem já paga seria pior que o incidente.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { startScratchSchema } from './scratch-schema';

const PORT_DB = 55481;
const PORT_APP = 3219;
const root = process.cwd();
const base = `http://127.0.0.1:${PORT_APP}`;

const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, status: 'FAIL', detail });
    console.log(`FAIL ${name}: ${detail.split('\n')[0]}`);
  }
}

const cluster = await startScratchSchema({ port: PORT_DB });
const sql = cluster.sql;

/** Fixtures sintéticas: nada aqui alcança serviço externo nenhum. */
const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: cluster.url,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55482',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_killswitch',
  SUPABASE_SECRET_KEY: 'killswitch_local_fixture_secret',
  // 32 caracteres no mínimo — o schema de env recusa menos que isso.
  CRON_SECRET: 'killswitch-local-cron-fixture-not-a-real-secret',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  MAGIC_TOKEN_SECRET: 'killswitch-local-magic-token-fixture',
  LOGIN_HASH_PEPPER: 'killswitch-local-hash-pepper-fixture',
  APP_BASE_URL: base,
  LOG_LEVEL: 'error',
};

async function startApp(overrides: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/next/dist/bin/next'),
      'start',
      '-p',
      String(PORT_APP),
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: root,
      // `NODE_OPTIONS` herdado do shell (--conditions=react-server) muda a
      // resolução de módulos do servidor e o `next start` não sobe com ele.
      env: { ...baseEnv, ...overrides, NODE_OPTIONS: '' },
      stdio: 'pipe',
    },
  );
  let log = '';
  child.stdout?.on('data', (c: Buffer) => (log += c.toString()));
  child.stderr?.on('data', (c: Buffer) => (log += c.toString()));

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`next start nao respondeu em 90s: ${log.slice(-2000)}`);
    }
    try {
      const res = await fetch(`${base}/login`);
      if (res.status < 500) return child;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function stopApp(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((r) => setTimeout(r, 400));
}

async function sessionCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM signup_sessions`;
  return row!.n;
}

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });

interface Variant {
  id: 'A' | 'B' | 'C';
  label: string;
  env: Record<string, string>;
  open: boolean;
}

const VARIANTS: Variant[] = [
  {
    id: 'A',
    label: 'SIGNUP_ENABLED=true + SIGNUP_IDENTITY_ENABLED=true',
    env: { SIGNUP_ENABLED: 'true', SIGNUP_IDENTITY_ENABLED: 'true' },
    open: true,
  },
  {
    id: 'B',
    label: 'SIGNUP_ENABLED=false',
    env: { SIGNUP_ENABLED: 'false', SIGNUP_IDENTITY_ENABLED: 'true' },
    open: false,
  },
  {
    id: 'C',
    label: 'SIGNUP_ENABLED=true + SIGNUP_IDENTITY_ENABLED=false',
    env: { SIGNUP_ENABLED: 'true', SIGNUP_IDENTITY_ENABLED: 'false' },
    open: false,
  },
];

try {
  for (const variant of VARIANTS) {
    let app: ChildProcess | undefined;
    try {
      app = await startApp(variant.env);
      const before = await sessionCount();
      const context = await browser.newContext({ baseURL: base });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await check(`${variant.id} /cadastro no navegador (${variant.label})`, async () => {
        const response = await page.goto('/cadastro', { waitUntil: 'domcontentloaded' });
        assert.ok(response, 'sem resposta de /cadastro');
        assert.equal(response.status(), 200, `status ${response.status()}`);

        // O discriminador é a TELA FECHADA, não a presença das perguntas.
        //
        // `SignupQuestions` nasce em fase `loading` e só chega a `ready` depois
        // de falar com a API — que aqui depende de Turnstile e Redis, ausentes
        // nesta fixture. Exigir os rádios mediria o ambiente, não o interruptor.
        // O que o interruptor controla é se aquele componente é MONTADO, e o
        // sinal disso é o `<SignupClosed>` estar ou não na tela.
        const CLOSED_HEADING = 'Cadastro indisponível no momento';
        const closed = page.getByRole('heading', { name: CLOSED_HEADING });
        const firstHeading = page.getByRole('heading').first();
        await firstHeading.waitFor({ state: 'visible', timeout: 15_000 });
        const headingText = ((await firstHeading.textContent()) ?? '').trim();

        if (variant.open) {
          assert.equal(await closed.count(), 0, 'funil aberto mostrou a tela de fechado');
          assert.notEqual(headingText, CLOSED_HEADING);
          // A tela fechada oferece uma saída própria para o login; o funil não.
          assert.equal(
            await page.getByRole('link', { name: 'Ir para o login' }).count(),
            0,
            'o funil aberto renderizou a saída da tela fechada',
          );
        } else {
          await closed.waitFor({ state: 'visible', timeout: 15_000 });
          assert.equal(headingText, CLOSED_HEADING, `título inesperado: ${headingText}`);
        }
        assert.deepEqual(pageErrors, [], `erro de página: ${pageErrors.join(' | ')}`);
      });

      await check(`${variant.id} nenhuma signup_session indevida`, async () => {
        // A visita é síncrona do ponto de vista do servidor, mas o cliente pode
        // disparar a criação logo após hidratar. Uma janela curta evita medir
        // antes de a escrita acontecer — e um falso PASS é pior que um teste lento.
        //
        // LIMITE HONESTO desta asserção, medido pelo teste de mutação: nesta
        // fixture o funil ABERTO também não cria linha, porque sem Turnstile e
        // Redis ele nunca sai da fase `loading`. Logo ela confirma a invariante
        // ("fechado não escreve") mas NÃO é o que distingue aberto de fechado —
        // quem distingue é a asserção de DOM acima. Removida a condição do
        // `SIGNUP_ENABLED` do gate, esta aqui continuou passando; só a de DOM
        // falhou.
        await page.waitForTimeout(1500);
        const after = await sessionCount();
        if (variant.open) {
          // Aberto NÃO precisa criar linha só por abrir a tela: a criação é do
          // primeiro passo. O que se afirma aqui é o teto, não um piso.
          assert.ok(after >= before, 'contagem regrediu');
        } else {
          assert.equal(after, before, `cadastro fechado criou ${after - before} sessão(ões)`);
        }
      });

      await check(`${variant.id} cliente existente nao e atingido`, async () => {
        const login = await page.goto('/login', { waitUntil: 'domcontentloaded' });
        assert.equal(login?.status(), 200, 'a porta de entrada caiu junto com o cadastro');
        // `waitFor`, não `count()`: `/login` é client component, e contar no
        // instante do `domcontentloaded` mede a hidratação, não o produto.
        await page.locator('#email').waitFor({ state: 'visible', timeout: 15_000 });

        // Sessão ausente manda para o login — nunca para a tela de cadastro
        // fechado. Um redirect errado aqui trancaria quem já paga do lado de fora.
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        assert.match(page.url(), /\/login(?:\?|$)/u, `/dashboard foi parar em ${page.url()}`);
      });

      await context.close();
    } finally {
      if (app) await stopApp(app);
    }
  }
} finally {
  await browser.close();
  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  for (const f of failed) console.log(`\n--- ${f.name}\n${f.detail}`);
  // Nunca lançar daqui: throw no finally substitui a causa real pela do teardown.
  if (failed.length > 0) process.exitCode = 1;
}
