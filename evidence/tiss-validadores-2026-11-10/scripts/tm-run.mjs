// Validador B (TISS Manager, plano grátis): o arquivo VAI ao servidor deles. Só corpus sintético.
// Um arquivo por vez, pausa de 6 s, cookies recusados; registra só o que a interface mostra.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire('C:/dev/Qoro_convenios_tiss_20261110/package.json');
const { chromium } = require('@playwright/test');
const CORPUS = 'C:/dev/Qoro_convenios_tiss_20261110/data/tiss/corpus/4.03.00/c1';
const OUT = process.argv[2];
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(CORPUS, 'MANIFEST.json'), 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
const results = [];
const save = () => writeFileSync(path.join(OUT, 'tissmanager-results.json'), JSON.stringify({ validator: 'B — TISS Manager (validador grátis)', url: 'https://tissmanager.com.br/validador-tiss-online', browser: `Chromium (Playwright ${require('@playwright/test/package.json').version}), perfil limpo, cookies recusados`, results }, null, 2));
for (const s of manifest.scenarios.filter((x) => x.file)) {
  const file = path.join(CORPUS, s.file);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha !== s.sha256) throw new Error(`SHA divergente em ${s.file}`);
  const page = await ctx.newPage();
  try {
    await page.goto('https://tissmanager.com.br/validador-tiss-online', { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByRole('button', { name: 'Recusar' }).click({ timeout: 3000 }).catch(() => {});
    const posts = [];
    page.on('requestfinished', async (r) => { if (r.method() !== 'GET') { const res = await r.response(); posts.push({ m: r.method(), host: new URL(r.url()).host, path: new URL(r.url()).pathname.slice(0, 60), status: res?.status() ?? null, sentBytes: r.postDataBuffer()?.length ?? 0 }); } });
    const startedAt = new Date().toISOString();
    await page.setInputFiles('input[type=file]', file);
    await page.getByRole('button', { name: /Validar XML/i }).click();
    await page.getByText('Resultado da Validação').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => { const t = (document.querySelector('main') ?? document.body).innerText; const i = t.indexOf('Resultado da Valida'); const j = t.indexOf('Validar outro arquivo', i); return t.slice(i, j > 0 ? j : i + 8000); });
    const summary = text.match(/Encontramos \d+ erros?[^\n]*|Nenhum erro[^\n]*|Arquivo válido[^\n]*/u)?.[0] ?? null;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const failing = lines.flatMap((l, i) => (lines[i + 1] === 'Corrigir' ? [l.slice(0, 220)] : []));
    const field = (k) => lines[lines.indexOf(k) + 1] ?? null;
    const header = Object.fromEntries(text.split('\n').filter((l) => /^(Versão|Tipo de Transação|Hash|Tipo de Guia|Qtd Guias|Valor Total Informado)\t/u.test(l)).map((l) => l.split('\t')));
    const shot = path.join('shots', `${s.id}.png`);
    await page.getByText('Resultado da Validação').locator('xpath=ancestor::*[self::section or self::div][1]').screenshot({ path: path.join(OUT, shot) }).catch(async () => page.screenshot({ path: path.join(OUT, shot), fullPage: false }));
    results.push({ id: s.id, file: s.file, sha256: sha, expected: s.expected, startedAt, summary, header, failing, text, nonGetRequests: posts, screenshot: shot });
    console.log(`${s.id}: ${summary} | guias=${header['Qtd Guias'] ?? '?'} | falhas=${failing.length}`);
  } catch (e) {
    results.push({ id: s.id, file: s.file, sha256: sha, error: String(e.message).slice(0, 200) });
    console.log(`${s.id}: ERRO ${String(e.message).slice(0, 120)}`);
  }
  save();
  await page.close();
  await new Promise((res) => setTimeout(res, 6000));
}
save();
await browser.close();
console.log('FIM');
