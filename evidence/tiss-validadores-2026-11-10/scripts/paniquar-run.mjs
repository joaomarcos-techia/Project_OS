// Validador A (Paniquar): submete cada arquivo do corpus sintético, um por carregamento de página.
// Registra SHA-256 antes do envio, resultado, captura e requisições com corpo (esperado: nenhuma).
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
for (const s of manifest.scenarios.filter((x) => x.file)) {
  const file = path.join(CORPUS, s.file);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha !== s.sha256) throw new Error(`SHA divergente em ${s.file}`);
  const page = await ctx.newPage();
  await page.goto('https://www.paniquar.com/validador-tiss/', { waitUntil: 'networkidle', timeout: 60000 });
  const withBody = [];
  page.on('request', (r) => { const n = r.postDataBuffer()?.length ?? 0; if (n > 0 || r.method() !== 'GET') withBody.push({ m: r.method(), u: r.url().slice(0, 120), n }); });
  const startedAt = new Date().toISOString();
  await page.setInputFiles('#vt-file', file);
  await page.waitForFunction(() => { const r = document.querySelector('#vt-result'); const l = document.querySelector('#vt-loading'); return r && r.innerText.trim().length > 0 && (!l || l.offsetParent === null); }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const res = document.querySelector('#vt-result');
    return { status: res?.querySelector('.vt-status')?.className ?? null, text: res?.innerText.trim() ?? '' };
  });
  const shot = path.join('shots', `${s.id}.png`);
  await page.locator('#vt-result').screenshot({ path: path.join(OUT, shot) }).catch(async () => page.screenshot({ path: path.join(OUT, shot), fullPage: true }));
  results.push({ id: s.id, file: s.file, sha256: sha, expected: s.expected, startedAt, status: r.status, text: r.text, requestsWithBodyOrNonGet: withBody, screenshot: shot });
  console.log(`${s.id}: ${r.status} | ${r.text.split('\n')[0]}`);
  await page.close();
  await new Promise((res) => setTimeout(res, 1500));
}
writeFileSync(path.join(OUT, 'paniquar-results.json'), JSON.stringify({ validator: 'A — Paniquar', url: 'https://www.paniquar.com/validador-tiss/', browser: `Chromium (Playwright ${require('@playwright/test/package.json').version}), perfil limpo`, results }, null, 2));
await browser.close();
