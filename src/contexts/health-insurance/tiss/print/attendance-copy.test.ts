/**
 * D-5 fase 1 — via de atendimento (assinatura do paciente). O PDF é lido de volta com o pdf.js:
 * não basta a view estar limpa, o ARQUIVO não pode conter valor, fator, indicação clínica,
 * observação nem a carteirinha completa; e a via sai do mesmo snapshot do PDF oficial.
 */
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { consultaGuide, sadtGuide, sadtItem, SYNTHETIC } from '../corpus/fixtures';

import { assertAttendanceCopy, attendanceCopyView, maskCardNumber } from './attendance-copy';
import { ATTENDANCE_COPY_MARK, layoutGuide, type DrawText, type PrintMeta } from './layout';
import { SP_SADT_MODEL } from './official-model';
import type { GuidePrintData } from './print-data';
import { renderGuidePdf } from './render';
import { textWidth } from './text-metrics';
import { consultaPrintView, formatPrintDate, spSadtCobrancaPrintView, type GuidePrintView } from './values';

const PDF_RENDER_TIMEOUT_MS = 90_000;
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
const SNAPSHOT = 'd'.repeat(64);
const meta = (view: GuidePrintView, copy: boolean): PrintMeta => ({
  guideNumber: view.fields[2]!,
  revision: 1,
  snapshotSha256: SNAPSHOT,
  software: { name: 'Qoro', version: 'teste' },
  ...(copy ? { copy: 'attendance' as const } : {}),
});

async function pdfText(pdf: Buffer): Promise<{ text: string[]; title: string }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 }).promise;
  const text: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text.push(...(content.items as Array<{ str: string }>).map((i) => i.str).filter((s) => s.trim()));
  }
  const info = (await doc.getMetadata()).info as { Title?: string };
  return { text, title: info.Title ?? '' };
}

/** Valor em reais no formato do papel (`150,00`, `1.200,00`) e fator (`1,00`). */
const MONEY_OR_FACTOR = /^\d{1,3}(?:\.\d{3})*,\d{2}$/u;
const CLINICAL = 'Paciente com dor torácica há 3 dias';
const NOTE = 'Justificativa: retorno por piora clínica';

describe('via de atendimento (D-5 fase 1)', { timeout: PDF_RENDER_TIMEOUT_MS }, () => {
  it('Consulta: sem valor (22) nem observação (23), carteirinha mascarada; nome, procedimento e data ficam; marca visível', async () => {
    const official = consultaPrintView(consultaGuide(1, { observacao: NOTE }), PRINT);
    expect([official.fields[22], official.fields[23]]).toEqual(['150,00', NOTE]);
    const view = attendanceCopyView(official);
    expect([view.fields[22], view.fields[23], view.fields[4]]).toEqual(['', '', maskCardNumber(SYNTHETIC.carteira)]);

    const { pdf } = await renderGuidePdf(view, meta(view, true));
    const { text, title } = await pdfText(pdf);
    const joined = text.join(' ');
    for (const expected of ['Maria José da Conceição Sintética', '10101012', formatPrintDate(consultaGuide(1).atendimento.dataAtendimento), '************0001', ATTENDANCE_COPY_MARK]) {
      expect(joined, expected).toContain(expected);
    }
    expect(joined).not.toContain('150,00');
    expect(joined).not.toContain(SYNTHETIC.carteira);
    expect(joined).not.toContain(NOTE);
    expect(text.filter((t) => MONEY_OR_FACTOR.test(t.trim()))).toEqual([]);
    expect(title.startsWith('Via de atendimento — Guia de Consulta')).toBe(true);
    expect(joined).toContain('Via de atendimento (sem valores)');
  });

  it('SP/SADT: sem totais, valores e fator dos itens, indicação clínica e observação; quantidade e procedimento ficam', async () => {
    const official = spSadtCobrancaPrintView(
      sadtGuide(1, {
        procedimentos: [sadtItem(1), sadtItem(2, { quantidade: 3 })],
        observacao: NOTE,
        solicitacao: { ...sadtGuide(1).solicitacao, indicacaoClinica: CLINICAL },
      }),
      PRINT,
    );
    expect(official.fields[65]).not.toBe('');
    expect(official.fields[23]).toBe(CLINICAL);
    const view = attendanceCopyView(official);
    for (const f of [23, 58, 59, 60, 61, 62, 63, 64, 65]) expect(view.fields[f], `campo ${f}`).toBe('');
    expect(view.executed.map((r) => [r.quantidade, r.valorUnitario, r.valorTotal, r.fator])).toEqual([
      ['1', '', '', ''],
      ['3', '', '', ''],
    ]);

    const { pdf } = await renderGuidePdf(view, meta(view, true));
    const { text } = await pdfText(pdf);
    const joined = text.join(' ');
    expect(text.filter((t) => MONEY_OR_FACTOR.test(t.trim()))).toEqual([]);
    expect(joined).not.toContain(CLINICAL);
    expect(joined).not.toContain(NOTE);
    expect(joined).not.toContain(SYNTHETIC.carteira);
    expect(joined).toContain('Maria José da Conceição Sintética');
    expect(joined).toContain(ATTENDANCE_COPY_MARK);
  });

  it('a via sai do MESMO snapshot do PDF oficial (mesmo hash no rodapé) e a marca não cobre o modelo nem o rodapé', () => {
    const official = spSadtCobrancaPrintView(sadtGuide(1, { procedimentos: [sadtItem(1)] }), PRINT);
    const copy = layoutGuide(attendanceCopyView(official), meta(official, true));
    const full = layoutGuide(official, meta(official, false));
    const footerOf = (ops: typeof copy.pages[number]) =>
      ops.find((o): o is DrawText => o.t === 'text' && o.text.includes('guia nº'))!;
    const fCopy = footerOf(copy.pages[0]!);
    const fFull = footerOf(full.pages[0]!);
    expect(fCopy.text).toContain(`snapshot ${SNAPSHOT.slice(0, 16)}`);
    expect(fFull.text).toContain(`snapshot ${SNAPSHOT.slice(0, 16)}`);
    expect(fFull.text).not.toContain('Via de atendimento');
    const mark = copy.pages[0]!.find((o): o is DrawText => o.t === 'text' && o.text === ATTENDANCE_COPY_MARK)!;
    expect(mark.x).toBeGreaterThan(fCopy.x + textWidth(fCopy.text, fCopy.size));
    expect(mark.x + textWidth(mark.text, mark.size, true)).toBeLessThanOrEqual(SP_SADT_MODEL.width);
    expect(full.pages[0]!.some((o) => o.t === 'text' && o.text === ATTENDANCE_COPY_MARK)).toBe(false);
  });

  it('carteirinha completa só por opção explícita; máscara mantém o comprimento', () => {
    const official = consultaPrintView(consultaGuide(1), PRINT);
    expect(attendanceCopyView(official, { card: 'full' }).fields[4]).toBe(SYNTHETIC.carteira);
    expect(maskCardNumber('12345678901234567')).toBe('*************4567');
    expect(maskCardNumber('123')).toBe('***');
    expect(maskCardNumber('')).toBe('');
  });

  it('defesa em profundidade: view com valor, fator ou indicação preenchidos é recusada', () => {
    const official = spSadtCobrancaPrintView(sadtGuide(1, { procedimentos: [sadtItem(1)] }), PRINT);
    expect(() => assertAttendanceCopy(official)).toThrow(/campo|valor/u);
    const copy = attendanceCopyView(official);
    expect(() => assertAttendanceCopy({ ...copy, executed: copy.executed.map((r) => ({ ...r, fator: '1,00' })) })).toThrow(/valor de item/u);
    expect(() => assertAttendanceCopy({ ...copy, fields: { ...copy.fields, 23: 'x' } })).toThrow(/campo 23/u);
  });
});
