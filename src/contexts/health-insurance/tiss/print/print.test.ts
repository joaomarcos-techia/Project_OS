/**
 * Conformidade dos PDFs oficiais (P7.6, P8.5, P13.7) com os modelos impressos da
 * ANS (Conteúdo e Estrutura 202511: Consulta p. 469, SP/SADT p. 520).
 *
 * Não basta "renderizou sem erro": o PDF gerado é lido de volta com o pdf.js e cada
 * rótulo oficial tem de estar no MESMO lugar do modelo; cada valor, dentro da caixa
 * do seu campo; o que só existe no papel (nome do beneficiário) não pode vazar para o
 * XML; nada é cortado em silêncio; nenhum dado pessoal vai para metadados ou logs.
 */
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { consultaGuide, sadtGuide, sadtItem, SADT_TEAM_MEMBER, SYNTHETIC } from '../corpus/fixtures';
import { sadtRequest } from '../corpus/scenarios-c2';
import { consultaGuideElement } from '../guides/consulta';
import { parseVerifiedGuideSnapshot, serializeGuideSnapshot } from '../guides/snapshot';
import { spSadtGuideElement } from '../guides/sp-sadt';
import { serializeDocument } from '../xml/tree';

import { CONSULTA_FIELDS, SP_SADT_FIELDS } from './fields';
import { layoutGuide, type DrawText, type PrintMeta } from './layout';
import { CONSULTA_MODEL, fieldBox, fieldNumber, SAMPLE_TEXTS, SP_SADT_MODEL, type OfficialModel } from './official-model';
import type { GuidePrintData } from './print-data';
import { renderGuidePdf } from './render';
import { textWidth } from './text-metrics';
import {
  consultaPrintView,
  formatPrintDate,
  formatPrintMoney,
  spSadtCobrancaPrintView,
  spSadtSolicitacaoPrintView,
  type GuidePrintView,
} from './values';

let pdfjs: typeof PdfJsModule;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

const PRINT: GuidePrintData = {
  schema: 'qoro.hi.guide-print/1',
  beneficiarioNome: 'Maria José da Conceição Sintética',
  nomeSocial: null,
  contratadoNome: 'Clínica Sintética São João Ltda',
  operadoraNome: 'Operadora Sintética S.A.',
};
const META = (view: GuidePrintView): PrintMeta => ({
  guideNumber: view.fields[2]!,
  revision: 1,
  snapshotSha256: 'c'.repeat(64),
  software: { name: 'Qoro', version: 'teste' },
});

interface PdfText {
  str: string;
  x: number;
  y: number;
  width: number;
}
/**
 * Custo legítimo e medido (P7, 12/11): cada render faz o layout completo do modelo oficial
 * e o pdf.js relê o arquivo. Isolado: 0,3 a 1,0 s por teste. Com a CPU disputada (24
 * processos em 12 núcleos) e cobertura v8, como na suíte completa: 5,6 a 12,9 s por teste
 * (soma 68 s), e o padrão de 30 s estourava. Por isso:
 *  - o mesmo documento é renderizado e lido UMA vez no arquivo (cache pela view);
 *  - só os blocos que renderizam têm limite próprio, PDF_RENDER_TIMEOUT_MS = 90 s; com o cache,
 *    3 rodadas seguidas sob a mesma disputa: 22/22, pior teste 18,5 s (margem de ~4,9×). As
 *    asserções e os demais testes seguem no padrão.
 * Nenhum cenário foi removido nem pulado.
 */
const PDF_RENDER_TIMEOUT_MS = 90_000;
const renders = new Map<string, ReturnType<typeof renderGuidePdf>>();
function render(view: GuidePrintView): ReturnType<typeof renderGuidePdf> {
  const key = JSON.stringify(view);
  let out = renders.get(key);
  if (!out) {
    out = renderGuidePdf(view, META(view));
    renders.set(key, out);
  }
  return out;
}
const reads = new WeakMap<Buffer, Promise<{ pages: PdfText[][]; info: Record<string, unknown>; raw: string }>>();
function readPdf(pdf: Buffer): Promise<{ pages: PdfText[][]; info: Record<string, unknown>; raw: string }> {
  let out = reads.get(pdf);
  if (!out) {
    out = readPdfUncached(pdf);
    reads.set(pdf, out);
  }
  return out;
}
async function readPdfUncached(pdf: Buffer): Promise<{ pages: PdfText[][]; info: Record<string, unknown>; raw: string }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 }).promise;
  const pages: PdfText[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(
      (content.items as Array<{ str: string; transform: number[]; width: number }>)
        .filter((i) => i.str.trim())
        .map((i) => ({ str: i.str, x: i.transform[4]!, y: vp.height - i.transform[5]!, width: i.width })),
    );
  }
  const meta = await doc.getMetadata();
  return { pages, info: meta.info as Record<string, unknown>, raw: pdf.toString('latin1') };
}

/** Rótulos do modelo que o Qoro reproduz (o exemplo "1234…" e o logotipo são trocados pelo dado real). */
function expectedLabels(model: OfficialModel) {
  return model.labels
    .filter((l) => !SAMPLE_TEXTS.has(l.text))
    .map((l) => ({ ...l, text: (l.text.includes('|') ? l.text.slice(0, l.text.indexOf('|')) : l.text).replace(/[\s\-–]+$/u, '').trim() }))
    .filter((l) => l.text);
}

function expectLabelsAt(model: OfficialModel, items: PdfText[], opts: { rowNumbers?: boolean } = {}) {
  for (const l of expectedLabels(model)) {
    // Nas folhas seguintes as linhas continuam a numeração (6–10…), conferida à parte.
    if (opts.rowNumbers === false && /^\d{1,2}$/u.test(l.text)) continue;
    const hit = items.find((i) => i.str.startsWith(l.text) && Math.abs(i.x - l.x) < 0.6 && Math.abs(i.y - l.y) < 0.6)
      ?? items.find((i) => i.str.includes(l.text) && Math.abs(i.y - l.y) < 0.6 && i.x <= l.x + 0.6);
    expect(hit, `rótulo "${l.text}" em (${l.x}, ${l.y})`).toBeDefined();
  }
}

const consultaView = (over: Parameters<typeof consultaGuide>[1] = {}, print: Partial<GuidePrintData> = {}) =>
  consultaPrintView(consultaGuide(1, over), { ...PRINT, ...print });

describe('mapeamento oficial dos campos', () => {
  const numbers = (m: OfficialModel) => {
    const out = new Set<number>();
    for (const l of m.labels) for (const part of l.text.split(/\s(?=\d{1,2}\s*-)/u)) {
      const n = fieldNumber(part.trim());
      if (n !== null && !/\|/u.test(part)) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  };

  it('Consulta: os 28 campos do modelo (1–7 e 9–29) estão no catálogo, sem campo a mais', () => {
    const fromModel = numbers(CONSULTA_MODEL);
    expect(fromModel).toEqual([1, 2, 3, 4, 5, 6, 7, ...Array.from({ length: 21 }, (_, i) => 9 + i)]);
    expect(CONSULTA_FIELDS.map((f) => f.no).sort((a, b) => a - b)).toEqual(fromModel);
  });

  it('SP/SADT: os 71 campos do modelo (1–10, 12–68 e 89–92) estão no catálogo, sem campo a mais', () => {
    const fromModel = numbers(SP_SADT_MODEL);
    const expected = [...Array.from({ length: 10 }, (_, i) => 1 + i), ...Array.from({ length: 57 }, (_, i) => 12 + i), 89, 90, 91, 92];
    expect(fromModel).toEqual(expected);
    expect(SP_SADT_FIELDS.map((f) => f.no).sort((a, b) => a - b)).toEqual(expected);
  });

  it('impresso x XML: nome do beneficiário e do contratado executante vêm do bloco de impressão; assinaturas são manuais', () => {
    const src = (fields: typeof CONSULTA_FIELDS, no: number) => fields.find((f) => f.no === no)!.source;
    expect([7, 10, 26].map((n) => src(CONSULTA_FIELDS, n))).toEqual(['impresso', 'impresso', 'impresso']);
    expect([24, 25, 5].map((n) => src(CONSULTA_FIELDS, n))).toEqual(['manual', 'manual', 'manual']);
    expect([10, 30, 89].map((n) => src(SP_SADT_FIELDS, n))).toEqual(['impresso', 'impresso', 'impresso']);
    expect([20, 57, 66, 67, 68].every((n) => src(SP_SADT_FIELDS, n) === 'manual')).toBe(true);
    for (const f of [...CONSULTA_FIELDS, ...SP_SADT_FIELDS]) {
      if (f.source === 'xml') expect(f.xml, `campo ${f.no}`).toBeTruthy();
      expect(f.qoro.length).toBeGreaterThan(5);
    }
  });

  it('a referência é o PDF oficial da ANS (SHA-256 do zip da B.10)', () => {
    for (const m of [CONSULTA_MODEL, SP_SADT_MODEL]) {
      expect(m.source.zipSha256).toBe('6a720ed27da8397fef584e30d794aa56f18906d253ccdf460c30b1019a3a4d3b');
      expect(m.source.pdfSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect([m.width, m.height]).toEqual([841.9, 595.3]);
    }
    expect([CONSULTA_MODEL.source.page, SP_SADT_MODEL.source.page]).toEqual([469, 520]);
  });
});

describe('formatação do papel', () => {
  it('datas DD/MM/AAAA, valores com vírgula e milhar, sem inventar formato', () => {
    expect(formatPrintDate('2026-11-09')).toBe('09/11/2026');
    expect(formatPrintMoney('150.00')).toBe('150,00');
    expect(formatPrintMoney('1234567.89')).toBe('1.234.567,89');
    expect(formatPrintMoney(null)).toBe('');
    expect(() => formatPrintDate('09/11/2026')).toThrow();
    expect(() => formatPrintMoney('150')).toThrow();
  });
});

describe('Guia de Consulta (P7.6) — o PDF reproduz o modelo da p. 469', { timeout: PDF_RENDER_TIMEOUT_MS }, () => {
  it('cada rótulo oficial no mesmo lugar (< 0,6 pt) e cada valor dentro da caixa do seu campo', async () => {
    const view = consultaView({ observacao: 'Retorno combinado com a operadora.' });
    const { pdf, layout } = await render(view);
    const { pages } = await readPdf(pdf);
    expect(pages).toHaveLength(1);
    expectLabelsAt(CONSULTA_MODEL, pages[0]!);
    for (const op of layout.pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field !== undefined)) {
      expect(op.x + textWidth(op.text, op.size, op.bold), `campo ${op.field}`).toBeLessThanOrEqual(op.maxX! + 0.01);
      if (op.field !== 2) {
        const box = fieldBox(CONSULTA_MODEL, op.field!)!;
        expect(op.y, `campo ${op.field}`).toBeGreaterThan(box.y);
        expect(op.y, `campo ${op.field}`).toBeLessThan(box.y + box.h);
      }
    }
  });

  it('dados corretos do snapshot, nos campos certos; exemplo do modelo não aparece', async () => {
    const view = consultaView();
    const { pdf } = await render(view);
    const text = (await readPdf(pdf)).pages[0]!.map((i) => i.str);
    for (const expected of [
      SYNTHETIC.registroANS,
      'G0000001',
      SYNTHETIC.carteira,
      'Maria José da Conceição Sintética',
      'Clínica Sintética São João Ltda',
      '10101012',
      '150,00',
      formatPrintDate(consultaGuide(1).atendimento.dataAtendimento),
      'Operadora Sintética S.A.',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text.join(' ')).not.toContain('12345678901234567890');
    expect(text.join(' ')).not.toContain('Logo da Empresa');
  });

  it('consistência PDF x XML: o que é do XML bate; o nome do beneficiário está no PDF e NÃO no XML; sem CID', async () => {
    const data = consultaGuide(1);
    const xml = serializeDocument(consultaGuideElement(data));
    const view = consultaPrintView(data, PRINT);
    const { pdf } = await render(view);
    const text = (await readPdf(pdf)).pages[0]!.map((i) => i.str).join(' | ');
    for (const value of [data.registroANS, data.numeroGuiaPrestador, data.beneficiario.numeroCarteira, data.contratado.cnes, data.profissional.numeroConselho, data.profissional.cbo, data.atendimento.procedimento.codigoProcedimento]) {
      expect(xml).toContain(`>${value}<`);
      expect(text).toContain(value);
    }
    expect(xml).toContain(`<ans:valorProcedimento>${data.atendimento.procedimento.valorProcedimento}<`);
    expect(xml).not.toContain(PRINT.beneficiarioNome);
    expect(xml).not.toContain(PRINT.contratadoNome);
    expect(text).not.toMatch(/\bCID\b/u);
  });

  it('P12.11: o rodapé identifica fornecedor, software e versão do build; sem build diz "sem build"', () => {
    const view = consultaView({});
    const footerOf = (software: PrintMeta['software']) =>
      layoutGuide(view, { ...META(view), software })
        .pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.text.startsWith('Gerado por'))
        .map((o) => o.text)
        .join('');
    expect(footerOf({ vendor: 'Qoro', name: 'Qoro Convênios', version: 'a9fa253832aa' })).toContain(
      'Gerado por Qoro Convênios v. a9fa253832aa, fornecedor Qoro',
    );
    expect(footerOf({ vendor: 'Qoro', name: 'Qoro Convênios', version: null })).toContain('Gerado por Qoro Convênios (sem build), fornecedor Qoro');
  });

  it('nada fictício: campo sem dado fica em branco (nome social, guia da operadora, validade da carteira)', () => {
    const view = consultaView({ numeroGuiaOperadora: null });
    expect([view.fields[26], view.fields[3], view.fields[5], view.fields[24], view.fields[25]]).toEqual(['', '', '', '', '']);
    const layout = layoutGuide(view, META(view));
    const filled = new Set(layout.pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field !== undefined).map((o) => o.field));
    for (const no of [3, 5, 24, 25, 26]) expect(filled.has(no), `campo ${no}`).toBe(false);
  });

  it('observação de 500 caracteres cabe no campo 23 sem corte (sem folha de continuação); acentos preservados', async () => {
    const obs = `${'Observação com acentuação e cedilha: ção, ã, é, ü, nº 1. '.repeat(9)}`.slice(0, 500);
    const view = consultaView({ observacao: obs });
    const { pdf, layout } = await render(view);
    expect(layout.continuation).toEqual([]);
    const lines = layout.pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field === 23).map((o) => o.text);
    expect(lines.join(' ').replace(/\s+/gu, ' ')).toBe(obs.replace(/\s+/gu, ' ').trim());
    const text = (await readPdf(pdf)).pages[0]!.map((i) => i.str).join(' ');
    expect(text).toContain('ção, ã, é, ü, nº 1.');
  });

  it('nome com 70 caracteres (máximo TISS) cabe na caixa do campo 7', () => {
    const name = 'Maria Aparecida Conceição Albuquerque Vasconcelos de Souza Magalhães '.slice(0, 70);
    const view = consultaView({}, { beneficiarioNome: name });
    const ops = layoutGuide(view, META(view)).pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field === 7);
    expect(ops.map((o) => o.text).join(' ')).toBe(name.trim());
    for (const o of ops) expect(o.x + textWidth(o.text, o.size)).toBeLessThanOrEqual(o.maxX!);
  });

  it('metadados do PDF sem dado pessoal; nenhum log durante a geração', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const view = consultaView();
    // Geração NOVA (sem o cache): o que se observa aqui é o console durante a geração.
    const { pdf } = await renderGuidePdf(view, META(view));
    const { info, raw } = await readPdfUncached(pdf);
    expect(info.Title).toBe('Guia de Consulta nº G0000001');
    expect(JSON.stringify(info)).not.toContain('Maria');
    expect(JSON.stringify(info)).not.toContain(SYNTHETIC.carteira);
    expect(raw).not.toMatch(/Maria José/u); // o texto vai em fonte codificada, não como metadado
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('Guia SP/SADT (P8.5) — o mesmo modelo da p. 520 para cobrança e solicitação', { timeout: PDF_RENDER_TIMEOUT_MS }, () => {
  afterEach(() => vi.restoreAllMocks());
  const cobranca = (n: number, over: Parameters<typeof sadtGuide>[1] = {}, print: Partial<GuidePrintData> = {}) =>
    spSadtCobrancaPrintView(
      sadtGuide(1, { procedimentos: Array.from({ length: n }, (_, i) => sadtItem(i + 1)), ...over }),
      { ...PRINT, ...print },
    );

  it('cobrança: rótulos oficiais no lugar; itens, totais e autorização do snapshot', async () => {
    const view = cobranca(2);
    const { pdf, layout } = await render(view);
    const { pages } = await readPdf(pdf);
    expect(pages).toHaveLength(1);
    expectLabelsAt(SP_SADT_MODEL, pages[0]!);
    const text = pages[0]!.map((i) => i.str);
    expect(text).toContain('240,00'); // 59 e 65: 2 × 120,00
    expect(text.filter((t) => t === '120,00').length).toBe(4); // 46 e 47 das duas linhas
    expect(text).toContain('Maria José da Conceição Sintética'); // 10
    expect(text).toContain('Clínica Sintética São João Ltda'); // 30
    for (const op of layout.pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field !== undefined)) {
      expect(op.x + textWidth(op.text, op.size, op.bold), `campo ${op.field}`).toBeLessThanOrEqual(op.maxX! + 0.01);
    }
  });

  it('cobrança x XML: totais e itens batem com o XML emitido; o nome do beneficiário não vai ao XML', () => {
    const data = sadtGuide(1, { procedimentos: [sadtItem(1), sadtItem(2)] });
    const xml = serializeDocument(spSadtGuideElement(data));
    const view = spSadtCobrancaPrintView(data, PRINT);
    expect(xml).toContain('<ans:valorTotalGeral>240.00<');
    expect(view.fields[65]).toBe('240,00');
    expect(view.executed.map((r) => r.codigo)).toEqual(data.procedimentos.map((p) => p.codigoProcedimento));
    expect(xml).not.toContain(PRINT.beneficiarioNome);
  });

  it('cobrança sem solicitação vinculada: bloco 24–28 em branco (o executado não vira "solicitado")', () => {
    const view = cobranca(1, {}, { solicitados: null });
    expect(view.requested).toEqual([]);
  });

  it('12 procedimentos: 3 folhas do MESMO modelo, linhas numeradas 1–12, totais só na última', async () => {
    const view = cobranca(12);
    const { pdf, layout } = await render(view);
    const { pages } = await readPdf(pdf);
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => expectLabelsAt(SP_SADT_MODEL, p, { rowNumbers: i === 0 }));
    const rowNumbers = layout.pages.map((ops) =>
      ops.filter((o): o is DrawText => o.t === 'text' && o.label === true && o.x === 59.8 && o.y > 355 && o.y < 405).map((o) => o.text),
    );
    expect(rowNumbers).toEqual([['1', '2', '3', '4', '5'], ['6', '7', '8', '9', '10'], ['11', '12', '13', '14', '15']]);
    const total = layout.pages.map((ops) => ops.some((o) => o.t === 'text' && o.field === 65));
    expect(total).toEqual([false, false, true]);
    expect(pages[0]!.map((i) => i.str).join(' ')).toContain('Folha 1 de 3 — continua na folha seguinte');
    expect(pages[2]!.map((i) => i.str)).toContain('1.440,00');
  });

  it('equipe com mais de 4 profissionais vai para a folha seguinte, com o sequencial do item', () => {
    const team = Array.from({ length: 6 }, (_, i) => ({ ...SADT_TEAM_MEMBER, nome: `Profissional Sintético ${i + 1}` }));
    const view = cobranca(1, { procedimentos: [sadtItem(1, { equipe: team })] });
    const layout = layoutGuide(view, META(view));
    expect(layout.pages).toHaveLength(2);
    const names = layout.pages.map((ops) => ops.filter((o): o is DrawText => o.t === 'text' && o.field === 48 && o.text.startsWith('Profissional')).length);
    expect(names).toEqual([4, 2]);
  });

  it('indicação clínica de 500 caracteres: nada cortado em silêncio (o texto integral vai à folha de continuação)', async () => {
    const indicacao = 'Texto escrito pelo profissional solicitante, com acentuação. '.repeat(10).slice(0, 500);
    const view = spSadtSolicitacaoPrintView(sadtRequest({ indicacaoClinica: indicacao }), PRINT);
    const { pdf, layout } = await render(view);
    const { pages } = await readPdf(pdf);
    if (layout.continuation.length > 0) {
      expect(layout.continuation.map((c) => c.field)).toContain(23);
      expect(pages).toHaveLength(2);
      const cont = pages[1]!.map((i) => i.str).join(' ').replace(/\s+/gu, ' ');
      expect(cont).toContain('FOLHA DE CONTINUAÇÃO');
      expect(cont).toContain(indicacao.slice(0, 120).trim());
      expect(pages[0]!.map((i) => i.str).join(' ')).toContain('continua na folha de continuação, campo 23');
    } else {
      const inBox = layout.pages[0]!.filter((o): o is DrawText => o.t === 'text' && o.field === 23).map((o) => o.text).join(' ');
      expect(inBox.replace(/\s+/gu, ' ')).toBe(indicacao.replace(/\s+/gu, ' ').trim());
    }
  });

  it('solicitação: execução, totais, autorização e quantidade autorizada em branco; itens solicitados preenchidos', () => {
    const view = spSadtSolicitacaoPrintView(sadtRequest(), PRINT);
    for (const no of [4, 5, 6, 7, 32, 33, 59, 65, 91]) expect(view.fields[no], `campo ${no}`).toBe('');
    expect(view.executed).toEqual([]);
    expect(view.requested.map((r) => [r.codigo, r.qtdSolicitada, r.qtdAutorizada])).toEqual([
      ['40301010', '1', ''],
      ['40302016', '2', ''],
    ]);
    // Sem executante definido, o bloco do contratado executante fica em branco.
    expect([view.fields[29], view.fields[30], view.fields[31]]).toEqual(['', '', '']);
  });

  it('solicitação sem indicação clínica: o campo 23 fica vazio (nada vem do prontuário)', () => {
    const view = spSadtSolicitacaoPrintView(sadtRequest({ indicacaoClinica: null }), PRINT);
    expect(view.fields[23]).toBe('');
  });
});

describe('o PDF sai do snapshot emitido, não do cadastro atual', () => {
  it('o bloco de impressão viaja no snapshot (SHA-256 conferido) e fica fora do dado do XML', () => {
    const content = {
      schema: 'qoro.hi.guide-snapshot/1' as const,
      guideType: 'consulta' as const,
      tissVersion: '4.03.00' as const,
      terminologyVersion: '202609',
      data: consultaGuide(1),
      print: PRINT,
    };
    const { json, sha256 } = serializeGuideSnapshot(content);
    const back = parseVerifiedGuideSnapshot(json, sha256);
    expect(back.print).toEqual(PRINT);
    expect(JSON.stringify(back.data)).not.toContain(PRINT.beneficiarioNome);
    expect(() => parseVerifiedGuideSnapshot(json.replace(PRINT.beneficiarioNome, 'Outro Nome Qualquer'), sha256)).toThrow(/SHA-256/u);
  });

  it('bloco de impressão sem nome do beneficiário é recusado (sem PDF "completo" com campo vazio)', () => {
    expect(() => consultaPrintView(consultaGuide(1), { ...PRINT, beneficiarioNome: '  ' })).toThrow(/beneficiarioNome/u);
    const { json, sha256 } = serializeGuideSnapshot({
      schema: 'qoro.hi.guide-snapshot/1',
      guideType: 'consulta',
      tissVersion: '4.03.00',
      terminologyVersion: '202609',
      data: consultaGuide(1),
      print: { ...PRINT, contratadoNome: '' },
    });
    expect(() => parseVerifiedGuideSnapshot(json, sha256)).toThrow(/impressão/u);
  });
});
