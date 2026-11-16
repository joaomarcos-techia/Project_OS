// Executa o pedido de E2E no Preview (e2e/preview-run.json) no runner remoto.
//
// O pacote `PREVIEW_E2E_BUNDLE` (base64 de JSON) traz { base, files: { nome: conteúdo } }:
// a URL do Preview e os arquivos
// da fixture (contas SINTÉTICAS e ids). Os arquivos vão para um diretório temporário fora do
// repositório; a saída do Playwright é filtrada (e-mails e senhas das contas viram ***).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const request = JSON.parse(readFileSync('e2e/preview-run.json', 'utf8'));
if (!Array.isArray(request.specs) || request.specs.length === 0) throw new Error('pedido sem specs');
for (const s of request.specs) {
  if (!/^e2e\/convenios-[a-z0-9-]+\.spec\.ts$/u.test(s)) throw new Error(`spec fora do escopo de Convênios: ${s}`);
}
const raw = process.env.PREVIEW_E2E_BUNDLE;
if (!raw) throw new Error('PREVIEW_E2E_BUNDLE ausente');
if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET) throw new Error('bypass do Preview ausente');
const bundle = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(bundle.base)) throw new Error('base do pacote não é um Preview da Vercel');

const dir = mkdtempSync(join(tmpdir(), 'hi-e2e-'));
const secrets = new Set();
for (const [name, content] of Object.entries(bundle.files ?? {})) {
  if (!/^[a-z0-9-]+\.json$/u.test(name)) throw new Error(`arquivo inesperado no pacote: ${name}`);
  writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  const walk = (v) => {
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'password' || k === 'email') && typeof x === 'string') secrets.add(x);
        else walk(x);
      }
    }
  };
  walk(typeof content === 'string' ? JSON.parse(content) : content);
}

const env = { ...process.env, E2E_BASE_URL: bundle.base };
if (!env.MAGIC_TOKEN_SECRET_DEV) throw new Error('segredo da prova assinada ausente');
delete env.PREVIEW_E2E_BUNDLE;
for (const [key, file] of Object.entries(request.env ?? {})) {
  if (!/^E2E_HI_[A-Z0-9_]+$/u.test(key)) throw new Error(`variável fora do escopo: ${key}`);
  env[key] = /\.json$/u.test(String(file)) ? join(dir, String(file)) : String(file);
}

const args = ['exec', 'playwright', 'test', ...request.specs, '--project=chromium', '--reporter=list', '--workers=1', '--retries=0'];
if (request.grep) args.push('-g', String(request.grep));
const r = spawnSync('pnpm', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
for (const s of secrets) out = out.split(s).join('***');
for (const s of [process.env.VERCEL_AUTOMATION_BYPASS_SECRET, process.env.MAGIC_TOKEN_SECRET_DEV]) out = out.split(s).join('***');
mkdirSync('preview-e2e-output', { recursive: true });
writeFileSync('preview-e2e-output/playwright.txt', out);
process.stdout.write(out);
process.exit(r.status ?? 1);
