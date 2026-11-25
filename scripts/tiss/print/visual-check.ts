/**
 * Verificação visual REPRODUZÍVEL dos PDFs oficiais (P13.7). Gera guias com dados
 * sintéticos (Consulta; SP/SADT de cobrança com 2 e com 12 itens; SP/SADT de
 * solicitação; indicação clínica de 500 caracteres), mede cada rótulo contra o
 * modelo oficial da ANS e renderiza as folhas em PNG com o pdf.js no Chromium do
 * Playwright, ao lado da página oficial, num `index.html` de comparação.
 *
 *   TISS_CONTEUDO_PDF="<…>/Padrão TISS_Componente de Conteúdo e Estrutura_202511.pdf" \
 *     npx tsx scripts/tiss/print/visual-check.ts <pasta-de-saída>
 *
 * Sem o PDF oficial, gera só as folhas do Qoro e as medidas (o JSON do modelo
 * versionado basta para medir). Nada sai da máquina.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import { consultaGuide, sadtGuide, sadtItem, SADT_TEAM_MEMBER } from '../../../src/contexts/health-insurance/tiss/corpus/fixtures';
import { sadtRequest } from '../../../src/contexts/health-insurance/tiss/corpus/scenarios-c2';
import { CONSULTA_MODEL, SAMPLE_TEXTS, SP_SADT_MODEL, type OfficialModel } from '../../../src/contexts/health-insurance/tiss/print/official-model';
import type { GuidePrintData } from '../../../src/contexts/health-insurance/tiss/print/print-data';
import { textWidth } from '../../../src/contexts/health-insurance/tiss/print/text-metrics';
import {
  consultaPrintView,
  spSadtCobrancaPrintView,
  spSadtSolicitacaoPrintView,
  type GuidePrintView,
} from '../../../src/contexts/health-insurance/tiss/print/values';

const OUT = process.argv[2];
if (!OUT) throw new Error('uso: visual-check.ts <pasta-de-saída>');
mkdirSync(OUT, { recursive: true });
// O @react-pdf usa o JSX clássico fora do Next.
(globalThis as unknown as { React: unknown }).React = (await import('react')).default;
const { renderGuidePdf } = await import('../../../src/contexts/health-insurance/tiss/print/render');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const PRINT: GuidePrintData = {
  schema: 'qoro.hi.guide-print/1',
  beneficiarioNome: 'Maria José da Conceição Sintética',
  nomeSocial: null,
  contratadoNome: 'Clínica Sintética São João Ltda',
  operadoraNome: 'Operadora Sintética S.A.',
  solicitados: [
    { codigoTabela: '22', codigoProcedimento: '40301010', descricao: '3-metil histidina, pesquisa e/ou dosagem no soro', quantidadeSolicitada: 1, quantidadeAutorizada: 1 },
  ],
};
const cases: Array<{ id: string; model: OfficialModel; view: GuidePrintView }> = [
  { id: 'consulta', model: CONSULTA_MODEL, view: consultaPrintView(consultaGuide(1, { observacao: 'Observação sintética com acentuação: ção, ã, é, ü, nº 1.' }), PRINT) },
  {
    id: 'sadt-cobranca',
    model: SP_SADT_MODEL,
    view: spSadtCobrancaPrintView(sadtGuide(1, { procedimentos: [sadtItem(1, { equipe: [SADT_TEAM_MEMBER] }), sadtItem(2)] }), PRINT),
  },
  {
    id: 'sadt-cobranca-12-itens',
    model: SP_SADT_MODEL,
    view: spSadtCobrancaPrintView(sadtGuide(2, { procedimentos: Array.from({ length: 12 }, (_, i) => sadtItem(i + 1)) }), { ...PRINT, solicitados: null }),
  },
  { id: 'sadt-solicitacao', model: SP_SADT_MODEL, view: spSadtSolicitacaoPrintView(sadtRequest(), { ...PRINT, solicitados: null }) },
  {
    id: 'sadt-solicitacao-indicacao-500',
    model: SP_SADT_MODEL,
    view: spSadtSolicitacaoPrintView(
      sadtRequest({ indicacaoClinica: 'Texto escrito pelo profissional solicitante, com acentuação. '.repeat(10).slice(0, 500) }),
      { ...PRINT, solicitados: null },
    ),
  },
];

const report: Array<Record<string, unknown>> = [];
const pdfs: Array<{ id: string; file: string; pages: number }> = [];
for (const c of cases) {
  const meta = { guideNumber: c.view.fields[2]!, revision: 1, snapshotSha256: 'c'.repeat(64), software: { name: 'Qoro', version: 'verificação visual' } };
  const { pdf, layout } = await renderGuidePdf(c.view, meta);
  const file = path.join(OUT, `${c.id}.pdf`);
  writeFileSync(file, pdf);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const items = ((await page.getTextContent()).items as Array<{ str: string; transform: number[] }>).map((i) => ({
    str: i.str,
    x: i.transform[4]!,
    y: vp.height - i.transform[5]!,
  }));
  let worst = 0;
  let missing = 0;
  for (const l of c.model.labels) {
    if (SAMPLE_TEXTS.has(l.text)) continue;
    const text = (l.text.includes('|') ? l.text.slice(0, l.text.indexOf('|')) : l.text).replace(/[\s\-–]+$/u, '').trim();
    if (!text) continue;
    const hit = items.find((i) => i.str.includes(text) && Math.abs(i.y - l.y) < 2);
    if (!hit) missing += 1;
    else worst = Math.max(worst, Math.abs(hit.y - l.y), hit.str.startsWith(text) ? Math.abs(hit.x - l.x) : 0);
  }
  const overflow = layout.pages
    .flat()
    .filter((o) => o.t === 'text' && o.maxX !== undefined && o.x + textWidth(o.text, o.size, o.bold) > o.maxX + 0.01).length;
  const pages = doc.numPages;
  report.push({ id: c.id, pages, worstLabelDeltaPt: Number(worst.toFixed(2)), missingLabels: missing, valuesOutsideBox: overflow, continuationFields: layout.continuation.map((x) => x.field) });
  pdfs.push({ id: c.id, file, pages });
}

// PNG de cada folha (e das páginas oficiais, quando o PDF da ANS é informado).
const build = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build');
const lib = pathToFileURL(path.join(build, 'pdf.mjs')).href;
const worker = pathToFileURL(path.join(build, 'pdf.worker.mjs')).href;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const toPng = async (pdfFile: string, pageNo: number, out: string) => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(build).href);
  const data = readFileSync(pdfFile).toString('base64');
  const png = await page.evaluate(
    async ({ lib, worker, data, pageNo }) => {
      const pdfjsLib = await import(lib);
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
      const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) }).promise;
      const p = await doc.getPage(pageNo);
      const viewport = p.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport, canvas }).promise;
      return canvas.toDataURL('image/png').split(',')[1]!;
    },
    { lib, worker, data, pageNo },
  );
  writeFileSync(out, Buffer.from(png, 'base64'));
  await page.close();
};
const images: Array<{ id: string; page: number; png: string; official: string | null }> = [];
try {
  const official = process.env.TISS_CONTEUDO_PDF ?? null;
  if (official) {
    await toPng(official, 469, path.join(OUT, 'ans-consulta-p469.png'));
    await toPng(official, 520, path.join(OUT, 'ans-sp-sadt-p520.png'));
  }
  for (const p of pdfs) {
    for (let n = 1; n <= p.pages; n++) {
      const png = `${p.id}-folha-${n}.png`;
      await toPng(p.file, n, path.join(OUT, png));
      images.push({ id: p.id, page: n, png, official: official ? (p.id === 'consulta' ? 'ans-consulta-p469.png' : 'ans-sp-sadt-p520.png') : null });
    }
  }
} finally {
  await browser.close();
}

writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify({ models: { consulta: CONSULTA_MODEL.source, spSadt: SP_SADT_MODEL.source }, cases: report }, null, 2)}\n`);
const rows = images
  .map((i) => `<tr><td><b>${i.id}</b><br>folha ${i.page}</td><td>${i.official ? `<img src="${i.official}">` : '—'}</td><td><img src="${i.png}"></td></tr>`)
  .join('\n');
writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>PDFs TISS — Qoro x modelo ANS</title>
<style>body{font:13px system-ui;margin:16px}img{width:100%;border:1px solid #ccc}td{vertical-align:top;width:47%}td:first-child{width:6%}</style>
<h1>PDFs oficiais TISS: Qoro x modelo ANS (Conteúdo e Estrutura 202511)</h1>
<p>Dados 100% sintéticos. Medidas em <code>report.json</code>.</p>
<table><tr><th></th><th>Modelo oficial (ANS)</th><th>Gerado pelo Qoro</th></tr>${rows}</table>\n`,
);
console.log(JSON.stringify(report, null, 1));
