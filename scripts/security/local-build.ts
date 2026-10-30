/** Build real em cópia sem arquivos .env e sem credenciais herdadas. */
import { spawn } from 'node:child_process';
import { cp, mkdir, symlink, lstat, writeFile, unlink, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'dist/security-local/app');
const output = path.join(root, 'dist/security-local');
const CI_BUILD_HEAP_MB = 4096;
await mkdir(target, { recursive: true });
// Apaga a saída anterior ANTES de copiar. Sem isto, um build interrompido no
// meio (queda de energia, Ctrl+C) deixa `.next` truncado, o build seguinte o
// considera atualizado pelo cache do webpack e as verificações passam a rodar
// contra um artefato que não corresponde ao source. Observado em 2026-09-11:
// `.next/server/` ficou com 2 manifestos e `/api/health` respondeu 500 em vez
// de 401 — um "achado" que era corrupção de fixture, não do produto.
await rm(path.join(target, '.next'), { recursive: true, force: true });
const copied = [
  'src',
  'scripts/security',
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'postcss.config.mjs',
  'sentry.server.config.ts',
  'sentry.edge.config.ts',
];
for (const entry of copied) {
  // APAGA antes de copiar. `cp` MESCLA: um arquivo removido do `src` continuava
  // vivo na cópia para sempre, e o build isolado passava a compilar um source
  // que não existe mais. Observado em 2026-09-13: três `configuracoes/*/page.tsx`
  // excluídos meses antes quebraram o build com "has no exported member", num
  // repositório em que `pnpm typecheck` estava verde. É o MESMO risco que o
  // comentário do `.next` acima descreve — verificação contra artefato que não
  // corresponde ao source —, só que pela via do código-fonte.
  //
  // Em CI não acontecia (checkout limpo), o que torna o caso pior: só quebra na
  // máquina de quem desenvolve, e parece problema do código.
  await rm(path.join(target, entry), { recursive: true, force: true });
  await cp(path.join(root, entry), path.join(target, entry), { recursive: true });
}
// Copia o config de lint; os plugins são resolvidos pelo pacote eslint-config-next.
const lintConfig = path.join(target, 'eslint.config.mjs');
try {
  await unlink(lintConfig);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
await cp(path.join(root, 'eslint.config.mjs'), lintConfig);
const modules = path.join(target, 'node_modules');
try {
  await lstat(modules);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  await symlink(
    path.join(root, 'node_modules'),
    modules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

// Allowlist do ambiente do SO. Nenhum segredo do shell ou .env.local entra no build.
const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
for (const key of [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'COMSPEC',
  'PATHEXT',
]) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
Object.assign(childEnv, {
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: 'postgres://security:security@127.0.0.1:55439/security?sslmode=require',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55440',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_security',
  NEXT_PUBLIC_SENTRY_DSN: 'http://public@127.0.0.1:55441/1',
  CRON_SECRET: 'local-security-cron-fixture-not-a-real-secret',
  META_APP_SECRET: 'local-security-meta-fixture',
  META_WEBHOOK_VERIFY_TOKEN: 'local-security-meta-verify-fixture',
  ASAAS_WEBHOOK_TOKEN: 'local-security-asaas-fixture',
  SUPABASE_SECRET_KEY: 'security_bundle_canary_supabase_secret',
  GEMINI_API_KEY: 'security_bundle_canary_gemini_secret',
  ASAAS_API_KEY: 'security_bundle_canary_asaas_secret',
  CRYPTO_SECRET_BACKEND: 'env',
  APP_BASE_URL: 'http://localhost:3217',
});
// Somente fixtures públicas/sintéticas; útil para reproduzir next start sem dotenv.
await writeFile(path.join(output, 'runtime-env.json'), JSON.stringify(childEnv, null, 2));
const log: string[] = [];
// O build frio do Next 15.5.28 excede o heap padrão (~2 GB) do Node no runner
// GitHub Actions. Aumenta apenas o heap deste processo filho; o teste, o lint
// e a allowlist de variáveis do build permanecem inalterados.
const buildNodeArgs = process.env.CI === 'true' ? [`--max-old-space-size=${CI_BUILD_HEAP_MB}`] : [];
const proc = spawn(
  process.execPath,
  [...buildNodeArgs, path.join(root, 'node_modules/next/dist/bin/next'), 'build'],
  {
    cwd: target,
    env: childEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
proc.stdout.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  log.push(text);
  process.stdout.write(text);
});
proc.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  log.push(text);
  process.stderr.write(text);
});
proc.on('error', (error) => {
  throw error;
});
const code = await new Promise<number>((resolve) =>
  proc.on('close', (value) => resolve(value ?? 1)),
);
await writeFile(path.join(output, 'build.log'), log.join(''));
// Next 15 pode encerrar com zero mesmo se o carregamento do ESLint falhar.
// Não tratar esse diagnóstico como build inteiramente validado.
const exitCode = code === 0 && /ESLint:/.test(log.join('')) ? 1 : code;
await writeFile(
  path.join(output, 'build-result.json'),
  JSON.stringify({ exitCode, completedAt: new Date().toISOString() }, null, 2),
);
process.exitCode = exitCode;
