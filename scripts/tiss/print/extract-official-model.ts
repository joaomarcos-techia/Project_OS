/**
 * Extrai do PDF OFICIAL da ANS (Componente de Conteúdo e Estrutura 202511) o layout
 * dos modelos impressos da Guia de Consulta (p. 469) e da Guia SP/SADT (p. 520):
 * rótulos dos campos com posição e as caixas (retângulos) da página, em pontos,
 * origem no canto superior esquerdo. O resultado fica versionado em
 * `src/contexts/health-insurance/tiss/print/models/` e é a referência dos testes de conformidade do PDF
 * gerado pelo Qoro (P7.6/P8.5/P13.7): nada de "parecido com o padrão".
 *
 * O PDF não é versionado (é da ANS, ~7 MB); o SHA-256 dele e do zip oficial ficam no
 * JSON e na B.10 do plano. Uso:
 *   TISS_CONTEUDO_PDF="<…>/Padrão TISS_Componente de Conteúdo e Estrutura_202511.pdf" \
 *     npx tsx scripts/tiss/print/extract-official-model.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PDF = process.env.TISS_CONTEUDO_PDF;
if (!PDF) throw new Error('defina TISS_CONTEUDO_PDF com o PDF oficial do Conteúdo e Estrutura 202511');
const ZIP_SHA256 = '6a720ed27da8397fef584e30d794aa56f18906d253ccdf460c30b1019a3a4d3b'; // B.10
const OUT = path.join(process.cwd(), 'src/contexts/health-insurance/tiss/print/models');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const bytes = new Uint8Array(readFileSync(PDF));
const pdfSha256 = createHash('sha256').update(bytes).digest('hex');
const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: true }).promise;

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const r1 = (n: number) => Math.round(n * 10) / 10;

async function extract(pageNo: number, name: string, title: string) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const labels = (text.items as Array<{ str: string; transform: number[]; width: number; height: number }>)
    .filter((i) => i.str.trim() && !/^[|_ ,/:\-a]+$/u.test(i.str.trim()))
    .map((i) => ({ text: i.str.trim(), x: r1(i.transform[4]!), y: r1(vp.height - i.transform[5]!), size: r1(i.height) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const ops = await page.getOperatorList();
  const boxes: Array<{ x: number; y: number; w: number; h: number; paint: 'stroke' | 'fill' | 'both' | 'none'; fill: string | null; stroke: string | null; lineWidth: number }> = [];
  let fillColor: string | null = '#000000';
  let strokeColor: string | null = '#000000';
  let lineWidth = 1;
  const PAINT: Record<number, 'stroke' | 'fill' | 'both' | 'none'> = {
    [pdfjs.OPS.stroke]: 'stroke', [pdfjs.OPS.closeStroke]: 'stroke',
    [pdfjs.OPS.fill]: 'fill', [pdfjs.OPS.eoFill]: 'fill',
    [pdfjs.OPS.fillStroke]: 'both', [pdfjs.OPS.eoFillStroke]: 'both',
    [pdfjs.OPS.closeFillStroke]: 'both', [pdfjs.OPS.closeEOFillStroke]: 'both',
    [pdfjs.OPS.endPath]: 'none',
  };
  const hex = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const seen = new Set<string>();
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === pdfjs.OPS.setFillRGBColor) fillColor = hex(args[0]);
    else if (fn === pdfjs.OPS.setStrokeRGBColor) strokeColor = hex(args[0]);
    else if (fn === pdfjs.OPS.setLineWidth) lineWidth = Number(args[0]);
    if (fn === pdfjs.OPS.save) stack.push([...ctm] as M);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, args as M);
    else if (fn === pdfjs.OPS.constructPath) {
      const mm = (args[2] ?? args[args.length - 1]) as ArrayLike<number> | undefined;
      if (!mm || mm.length < 4) continue;
      const pt = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]] as const;
      const a = pt(mm[0]!, mm[1]!);
      const b = pt(mm[2]!, mm[3]!);
      // A pintura vem na operação seguinte (ou na própria constructPath, no pdfjs 6).
      const inline = (args[0] as number | undefined);
      const paint = PAINT[typeof inline === 'number' && PAINT[inline] ? inline : (ops.fnArray[i + 1] as number)] ?? 'none';
      const geom = {
        x: r1(Math.min(a[0], b[0])),
        y: r1(vp.height - Math.max(a[1], b[1])),
        w: r1(Math.abs(b[0] - a[0])),
        h: r1(Math.abs(b[1] - a[1])),
      };
      const key = JSON.stringify(geom);
      if ((geom.w < 0.5 && geom.h < 0.5) || paint === 'none') continue;
      const prev = boxes.find((bx) => JSON.stringify({ x: bx.x, y: bx.y, w: bx.w, h: bx.h }) === key);
      if (prev) {
        if (prev.paint !== paint) prev.paint = 'both';
        if (paint !== 'stroke') prev.fill = fillColor;
        if (paint !== 'fill') { prev.stroke = strokeColor; prev.lineWidth = r1(lineWidth); }
        continue;
      }
      seen.add(key);
      boxes.push({ ...geom, paint, fill: paint === 'stroke' ? null : fillColor, stroke: paint === 'fill' ? null : strokeColor, lineWidth: r1(lineWidth) });
    }
  }
  boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  const out = {
    source: {
      document: 'Padrão TISS — Componente de Conteúdo e Estrutura 202511',
      zipSha256: ZIP_SHA256,
      pdfSha256,
      page: pageNo,
    },
    title,
    width: r1(vp.width),
    height: r1(vp.height),
    labels,
    boxes,
  };
  writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${name}: p. ${pageNo}, ${labels.length} rótulos, ${boxes.length} caixas`);
}

await extract(469, 'consulta-p469', 'GUIA DE CONSULTA');
await extract(520, 'sp-sadt-p520', 'GUIA DE SERVIÇO PROFISSIONAL / SERVIÇO AUXILIAR DE DIAGNÓSTICO E TERAPIA - SP/SADT');
console.log(`PDF oficial SHA-256 ${pdfSha256}`);
