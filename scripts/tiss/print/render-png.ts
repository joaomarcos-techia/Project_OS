/**
 * Verificação VISUAL reproduzível (P13.7): renderiza páginas de PDF em PNG com o
 * pdf.js dentro do Chromium do Playwright (o mesmo navegador do E2E), para comparar
 * lado a lado a guia gerada pelo Qoro com o modelo oficial da ANS. Nada sai da
 * máquina; os PDFs são lidos do disco e entregues ao navegador em memória.
 *
 *   npx tsx scripts/tiss/print/render-png.ts <arquivo.pdf> <página> <saída.png> [escala]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const [file, pageArg, out, scaleArg] = process.argv.slice(2);
if (!file || !pageArg || !out) throw new Error('uso: render-png.ts <pdf> <página> <png> [escala]');
const pdfBase64 = readFileSync(file).toString('base64');
const build = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build');
const lib = pathToFileURL(path.join(build, 'pdf.mjs')).href;
const worker = pathToFileURL(path.join(build, 'pdf.worker.mjs')).href;

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(build, 'pdf.mjs.map')).href.replace(/pdf\.mjs\.map$/u, ''));
  const png = await page.evaluate(
    async ({ lib, worker, pdfBase64, pageNo, scale }) => {
      const pdfjs = await import(lib);
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const p = await doc.getPage(pageNo);
      const viewport = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport, canvas }).promise;
      return canvas.toDataURL('image/png').split(',')[1]!;
    },
    { lib, worker, pdfBase64, pageNo: Number(pageArg), scale: Number(scaleArg ?? 1.5) },
  );
  writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`${out}: página ${pageArg}`);
} finally {
  await browser.close();
}
