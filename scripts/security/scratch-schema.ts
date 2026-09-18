/**
 * Postgres descartável com o SCHEMA REAL do Qoro.
 *
 * Módulo compartilhado: sobe um cluster próprio sob o TEMP do SO, cria o
 * scaffolding que o Supabase fornece em produção (roles e um `auth` mínimo) e
 * aplica **as migrations de verdade**, em ordem, sem simplificar nenhuma.
 *
 * O ponto é o §42 do plano de execução: provar o sistema verdadeiro, não um
 * simulacro. Um harness que recria `clinics(id, nome)` à mão prova que o teste
 * funciona, não que o produto funciona.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';
import selfsigned from 'selfsigned';

const bin =
  process.env.SECURITY_PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/17/bin'
    : '/usr/lib/postgresql/17/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';

export interface ScratchCluster {
  sql: Sql;
  url: string;
  stop: () => Promise<void>;
}

/**
 * O que o Supabase entrega pronto e as migrations assumem existir.
 *
 * `auth.users` aparece em FKs; `auth.uid()`/`auth.jwt()`/`auth.role()` aparecem
 * em políticas RLS. São stubs de FORMA, não de comportamento: a prova de RLS
 * deste harness roda por GUC, como o runtime real faz via `withTenant`.
 */
const SUPABASE_SCAFFOLD = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  -- NOBYPASSRLS e membro de authenticated: é assim que o runbook
  -- runtime-role-nobypassrls.md descreve a role provisionada em DEV/produção.
  -- Ela não vem das migrations (a 0071 diz isso explicitamente), então é aqui
  -- que precisa ser reproduzida — sem isso o teste de RLS mediria a role errada.
  CREATE ROLE qoro_runtime NOLOGIN NOBYPASSRLS;
  GRANT authenticated TO qoro_runtime;
  CREATE ROLE supabase_auth_admin NOLOGIN;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    email_confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
  $$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, qoro_runtime;
  -- Função de event trigger GERENCIADA PELO SUPABASE: a 0038 faz REVOKE sobre
  -- ela sem nunca criá-la, porque no projeto real ela já existe. Os próprios
  -- db-migrate-prod.ts e db-backup-prod.ts registram isso como ressalva
  -- conhecida. Aqui ela é um stub de forma, só para o REVOKE ter alvo.
  CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
`;

/** Sobe o cluster, aplica o scaffolding e TODAS as migrations em ordem. */
export async function startScratchSchema(options: { port: number }): Promise<ScratchCluster> {
  const cluster = await mkdtemp(path.join(os.tmpdir(), 'qoro-scratch-schema-'));
  const data = path.join(cluster, 'data');

  const init = spawnSync(
    path.join(bin, `initdb${suffix}`),
    ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (init.error) throw init.error;
  assert.equal(init.status, 0, init.stderr);

  // TLS: o `dbAdmin` da aplicação conecta com `ssl: 'require'`, então um
  // cluster sem certificado derruba a conexão com ECONNRESET antes do primeiro
  // SELECT. O certificado é auto-assinado e vive só neste diretório temporário.
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
  });
  await writeFile(path.join(data, 'server.crt'), cert.cert);
  await writeFile(path.join(data, 'server.key'), cert.private, { mode: 0o600 });

  // `spawn` do `postgres` direto, NÃO `pg_ctl start`: no Windows o pg_ctl deixa
  // o pipe do servidor aberto e o `spawnSync` fica esperando para sempre. Foi
  // exatamente esse o travamento na primeira tentativa deste módulo.
  const server = spawn(
    path.join(bin, `postgres${suffix}`),
    [
      '-D',
      data,
      '-p',
      String(options.port),
      '-h',
      '127.0.0.1',
      '-c',
      'ssl=on',
      // Socket Unix no diretório do próprio cluster: o default `/var/run/postgresql`
      // não é gravável no runner do CI. Tudo aqui é TCP em 127.0.0.1.
      '-c',
      `unix_socket_directories=${cluster}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverLog = '';
  server.stderr.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const url = `postgres://postgres@127.0.0.1:${options.port}/postgres?sslmode=require`;
  const sql = postgres(url, {
    ssl: 'require',
    max: 4,
    connect_timeout: 2,
    onnotice: () => undefined,
  });

  const stop = async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
    server.kill('SIGKILL');
    await rm(cluster, { recursive: true, force: true }).catch(() => {});
  };

  // Espera ativa: o servidor aceita conexão quando termina a recuperação.
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    try {
      await sql`SELECT 1`;
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) {
    await stop();
    throw new Error(`postgres nao subiu em 30s:\n${serverLog.slice(-2_000)}`);
  }

  try {
    await sql.unsafe(SUPABASE_SCAFFOLD);
    for (const { file, body } of await readMigrations()) {
      try {
        await sql.unsafe(body);
      } catch (error) {
        throw new Error(
          `migration ${file} falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { sql, url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** As migrations do repositório, em ordem — a ordem é o contrato. */
export async function readMigrations(): Promise<{ file: string; body: string }[]> {
  const dir = path.join(process.cwd(), 'drizzle/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return Promise.all(
    files.map(async (file) => ({ file, body: await readFile(path.join(dir, file), 'utf8') })),
  );
}

/**
 * O schema inteiro como UM script, para quem aplica por `psql` em vez de por
 * driver — hoje o gate de carga, que antes só sabia extrair o schema do DEV.
 *
 * As migrations são a fonte mais fiel que existe: o DEV é um efeito delas, e
 * costuma estar atrás. Um gate de carga que depende de DEV também não roda em
 * CI nem em máquina sem credencial.
 */
export async function buildSchemaSqlFromMigrations(): Promise<string> {
  const migrations = await readMigrations();
  // O cabeçalho por arquivo é o que transforma um erro de `psql` em diagnóstico:
  // sem ele, a falha aponta para uma linha de um script de 20 mil linhas.
  return migrations.map(({ file, body }) => [`-- >>> ${file}`, body, ''].join('\n')).join('\n');
}
