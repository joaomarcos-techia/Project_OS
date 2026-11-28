#!/usr/bin/env node
/**
 * Roda LOCALMENTE os passos `run:` de um workflow do GitHub Actions, sem GitHub Actions e sem custo.
 *
 * Fonte única: o próprio YAML do workflow (nada de lista paralela de comandos). Para cada passo:
 *   - `uses:` é pulado (checkout, setup-node, upload de artefato);
 *   - "Install dependencies" e a instalação do Playwright são pulados (o node_modules local já existe; o
 *     fundador pediu para não reinstalar à toa) — use --with-install para não pular;
 *   - `pnpm exec X` vira `npx X` e `pnpm <script>` vira o comando do package.json (rodar `pnpm <script>` numa
 *     worktree tenta purgar o node_modules compartilhado);
 *   - o env do workflow, do job e do passo é aplicado; `if:` é ignorado (todo passo roda, como `!cancelled()`);
 *   - cada passo tem o próprio código de saída e log (nunca encadeado por pipe).
 *
 * Saída: um log por passo e `resumo.json` + `resumo.md` (comando, código, duração) no diretório de evidência.
 *
 *   node scripts/ci/run-workflow-local.mjs .github/workflows/ci.yml --out evidence/local/ci [--only regex] [--skip regex]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const wf = args[0];
if (!wf) throw new Error('uso: run-workflow-local.mjs <workflow.yml> --out <dir> [--only re] [--skip re] [--with-install]');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = path.resolve(opt('--out') ?? path.join('evidence', 'local', path.basename(wf, '.yml')));
const only = opt('--only') ? new RegExp(opt('--only'), 'u') : null;
const skip = opt('--skip') ? new RegExp(opt('--skip'), 'u') : null;
const withInstall = args.includes('--with-install');

function loadYaml() {
  const pnpmDir = path.join(root, 'node_modules', '.pnpm');
  const dir = readdirSync(pnpmDir).find((d) => /^js-yaml@4\./u.test(d));
  if (!dir) throw new Error('js-yaml não encontrado no node_modules');
  const req = createRequire(path.join(pnpmDir, dir, 'node_modules', 'js-yaml', 'package.json'));
  return req('js-yaml');
}
const yaml = loadYaml();
const doc = yaml.load(readFileSync(wf, 'utf8'));
const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};

/** `pnpm exec X` → `npx X`; `pnpm <script> [args]` → o comando do package.json. */
function translate(cmd) {
  return cmd
    .split('\n')
    .map((line) =>
      line
        .replace(/\bpnpm exec\s+/gu, 'npx ')
        .replace(/\bpnpm (?!audit\b|install\b|exec\b)([a-z][\w:.-]*)/gu, (m, name) => {
          const s = scripts[name];
          if (!s) return m;
          return s.replace(/^cross-env\s+/u, 'npx cross-env ').replace(/^(tsx|tsc|vitest|eslint|madge|playwright|next)\b/u, 'npx $1');
        }),
    )
    .join('\n');
}

mkdirSync(out, { recursive: true });
const results = [];
const started = Date.now();
for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
  let n = 0;
  for (const step of job.steps ?? []) {
    n += 1;
    const name = step.name ?? step.uses ?? `passo ${n}`;
    if (!step.run) continue;
    if (!withInstall && /^Install dependencies$|Install Playwright/u.test(name)) {
      results.push({ job: jobId, step: name, status: 'SKIPPED (instalação local já presente)', code: null, seconds: 0 });
      continue;
    }
    if (/^Upload /u.test(name)) continue;
    if (only && !only.test(name)) continue;
    if (skip && skip.test(name)) {
      results.push({ job: jobId, step: name, status: 'SKIPPED (--skip)', code: null, seconds: 0 });
      continue;
    }
    const env = { ...process.env, ...(doc.env ?? {}), ...(job.env ?? {}), ...(step.env ?? {}), CI: '' };
    for (const [k, v] of Object.entries(env)) if (typeof v !== 'string') env[k] = String(v);
    const cmd = translate(step.run);
    const t0 = Date.now();
    const r = spawnSync('bash', ['-e', '-c', cmd], { cwd: root, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const file = `${String(results.length + 1).padStart(2, '0')}-${name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}.log`;
    writeFileSync(path.join(out, file), `$ ${cmd}\n\n${r.stdout ?? ''}\n${r.stderr ?? ''}\n`);
    const status = r.status === 0 ? 'PASS' : 'FAIL';
    results.push({ job: jobId, step: name, status, code: r.status, seconds, log: file });
    console.log(`${status.padEnd(4)} ${String(seconds).padStart(5)}s  ${name}`);
  }
}
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const summary = { workflow: wf, sha, startedAt: new Date(started).toISOString(), totalSeconds: Math.round((Date.now() - started) / 1000), results };
writeFileSync(path.join(out, 'resumo.json'), JSON.stringify(summary, null, 1));
writeFileSync(
  path.join(out, 'resumo.md'),
  [`# ${wf} — execução LOCAL (sem GitHub Actions)`, '', `SHA \`${sha}\` · ${summary.startedAt} · ${summary.totalSeconds}s`, '', '| Passo | Resultado | Código | Duração | Log |', '| --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.step} | ${r.status} | ${r.code ?? '-'} | ${r.seconds}s | ${r.log ?? '-'} |`)].join('\n') + '\n',
);
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.filter((r) => r.status === 'PASS').length} PASS, ${failed.length} FAIL, ${results.filter((r) => r.status.startsWith('SKIPPED')).length} SKIPPED em ${summary.totalSeconds}s → ${path.relative(root, out)}`);
if (!existsSync(out)) process.exit(2);
process.exit(failed.length ? 1 : 0);
