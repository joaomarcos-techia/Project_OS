/**
 * Diagramação das guias no MODELO OFICIAL (pura: devolve as operações de desenho por
 * folha; `render.tsx` só as passa ao @react-pdf). Separada para que a conformidade
 * (posição dos rótulos, texto dentro da caixa, paginação) seja testada sem PDF.
 *
 * - Caixas, faixas cinzas, título e rótulos: copiados do modelo extraído da ANS.
 * - Valores: dentro da caixa do campo, abaixo do rótulo, com corpo ajustado.
 * - Tabelas da SP/SADT (24–28, 36–47, 48–55): 5, 5 e 4 linhas por folha, como no
 *   modelo; com mais itens, novas folhas do MESMO modelo, numeração das linhas
 *   contínua e totais (59–65) só na última.
 * - Texto que não cabe nem no corpo mínimo: o que cabe fica na caixa com o aviso, e o
 *   texto INTEIRO vai para a folha de continuação (nunca é cortado em silêncio).
 */
import { CONSULTA_FIELDS, SP_SADT_FIELDS } from './fields';
import { CONSULTA_MODEL, fieldBox, fieldNumber, officialLabel, SAMPLE_TEXTS, SP_SADT_MODEL, type OfficialModel } from './official-model';
import { fitText, textWidth } from './text-metrics';
import type { GuidePrintView } from './values';

export interface DrawBox {
  t: 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string | null;
  lineWidth: number;
  fill: string | null;
}
export interface DrawText {
  t: 'text';
  x: number;
  /** Linha de base, a partir do topo. */
  y: number;
  size: number;
  text: string;
  bold?: boolean;
  /** Campo do modelo a que o valor pertence (para teste e conferência). */
  field?: number;
  /** Rótulo do modelo (true) ou valor preenchido (false). */
  label?: boolean;
  /** Limite direito da caixa do valor. */
  maxX?: number;
}
export type DrawOp = DrawBox | DrawText;

export interface PrintMeta {
  guideNumber: string;
  revision: number | null;
  snapshotSha256: string | null;
  software: { name: string; version: string | null };
  /**
   * D-5 fase 1: `attendance` = via de atendimento (assinatura do paciente), sem valores. O PDF
   * leva a marca visível e o rodapé diz que não serve para faturamento.
   */
  copy?: 'attendance';
}

/** Marca da via de atendimento (D-5): visível no papel e no rodapé. */
export const ATTENDANCE_COPY_MARK = 'VIA DE ATENDIMENTO — SEM VALORES — NÃO SERVE PARA FATURAMENTO';

export interface PrintLayout {
  model: OfficialModel;
  title: string;
  pages: DrawOp[][];
  continuation: Array<{ field: number; label: string; text: string }>;
}

const CONT_NOTE = (no: number) => `(continua na folha de continuação, campo ${no})`;

interface Style {
  valueMax: number;
  valueMin: number;
  rowSize: number;
  rowMin: number;
}
const CONSULTA_STYLE: Style = { valueMax: 9, valueMin: 5, rowSize: 0, rowMin: 0 };
const SADT_STYLE: Style = { valueMax: 6.5, valueMin: 4, rowSize: 4.6, rowMin: 3.4 };

/** Linhas das tabelas da SP/SADT (linha de base) e colunas, a partir dos rótulos oficiais. */
const REQ_ROWS = [227.6, 237.1, 246.6, 256.1, 265.4];
const EXEC_ROWS = [360.7, 370.2, 379.7, 390.2, 400.7];
const TEAM_ROWS = [431.4, 440.4, 449.4, 458.4];
const ROWNUM_X = 59.8;
const ROWNUM_SIZE = 3.7;
const HEADER_SIZE = 4.7;

function sadtColumns() {
  const label = (no: number) => officialLabel(SP_SADT_MODEL, no)!;
  const after = (base: { x: number }, prefix: string) => base.x + textWidth(prefix, HEADER_SIZE);
  const l38 = label(38);
  const l43 = label(43);
  const l48 = label(48);
  const x39 = after(l38, '38-Hora Final ');
  const x40 = x39 + textWidth('39-Tabela ', HEADER_SIZE);
  const x44 = after(l43, '43-Via ');
  const x45 = x44 + textWidth('44-Tec. ', HEADER_SIZE);
  const x49 = after(l48, '48-Seq.Ref ');
  const x50 = x49 + textWidth('49-Grau Part. ', HEADER_SIZE);
  const right = 774.6;
  return {
    requested: [
      { key: 'tabela', x: 66, to: label(25).x },
      { key: 'codigo', x: label(25).x, to: label(26).x },
      { key: 'descricao', x: label(26).x, to: label(27).x },
      { key: 'qtdSolicitada', x: label(27).x, to: label(28).x },
      { key: 'qtdAutorizada', x: label(28).x, to: right },
    ],
    executed: [
      { key: 'data', x: label(36).x, to: label(37).x },
      { key: 'horaInicial', x: label(37).x, to: l38.x },
      { key: 'horaFinal', x: l38.x, to: x39 },
      { key: 'tabela', x: x39, to: x40 },
      { key: 'codigo', x: x40, to: label(41).x },
      { key: 'descricao', x: label(41).x, to: label(42).x },
      { key: 'quantidade', x: label(42).x, to: l43.x },
      { key: 'via', x: l43.x, to: x44 },
      { key: 'tecnica', x: x44, to: x45 },
      { key: 'fator', x: x45, to: label(46).x },
      { key: 'valorUnitario', x: label(46).x, to: label(47).x },
      { key: 'valorTotal', x: label(47).x, to: right },
    ],
    team: [
      { key: 'seqRef', x: l48.x, to: x49 },
      { key: 'grau', x: x49, to: x50 },
      { key: 'codigo', x: x50, to: label(51).x },
      { key: 'nome', x: label(51).x, to: label(52).x },
      { key: 'conselho', x: label(52).x, to: label(53).x },
      { key: 'numero', x: label(53).x, to: label(54).x },
      { key: 'uf', x: label(54).x, to: label(55).x },
      { key: 'cbo', x: label(55).x, to: right },
    ],
  } as const;
}

/** Campos de texto longo: o valor começa no topo da área, mesmo quando é uma linha só. */
const LONG_TEXT = { consulta: new Set([23]), sadt: new Set([23, 58]) } as const;

const TABLE_FIELDS = new Set([24, 25, 26, 27, 28, ...Array.from({ length: 20 }, (_, i) => 36 + i), 56, 57]);

/** Rótulo do modelo sem as máscaras de preenchimento à mão (`|___|`). */
function cleanLabel(text: string): string {
  const i = text.indexOf('|');
  return (i >= 0 ? text.slice(0, i) : text).replace(/[\s\-–]+$/u, '').trim();
}

function modelOps(model: OfficialModel, skipRowNumbers: boolean): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const b of model.boxes) {
    const fill = b.paint === 'stroke' || b.fill === '#ffffff' ? null : b.fill;
    const stroke = b.paint === 'fill' ? null : b.stroke;
    if (!fill && !stroke) continue;
    ops.push({ t: 'box', x: b.x, y: b.y, w: b.w, h: b.h, fill, stroke, lineWidth: b.lineWidth });
  }
  for (const l of model.labels) {
    if (SAMPLE_TEXTS.has(l.text)) continue;
    // Números de linha das tabelas e das séries: o renderizador desenha os seus (contínuos entre folhas).
    const text = cleanLabel(l.text);
    if (!text) continue;
    if (skipRowNumbers && /^\d{1,2}$/u.test(text)) continue;
    // Rótulos do modelo oficial são em negrito (Arial Bold no PDF da ANS); números de linha, não.
    const bold = !/^\d{1,2}$/u.test(text);
    ops.push({ t: 'text', x: l.x, y: l.y, size: l.size, text, label: true, ...(bold ? { bold } : {}) });
  }
  return ops;
}

export function layoutGuide(view: GuidePrintView, meta: PrintMeta): PrintLayout {
  const sadt = view.kind !== 'consulta';
  const model = sadt ? SP_SADT_MODEL : CONSULTA_MODEL;
  const style = sadt ? SADT_STYLE : CONSULTA_STYLE;
  const specs = sadt ? SP_SADT_FIELDS : CONSULTA_FIELDS;
  const continuation: PrintLayout['continuation'] = [];
  const fixedOps: DrawOp[] = [];

  // Campos de valor único.
  for (const spec of specs) {
    if (spec.no === 2 || (sadt && TABLE_FIELDS.has(spec.no))) continue;
    const value = view.fields[spec.no] ?? '';
    if (!value) continue;
    const box = fieldBox(model, spec.no);
    const label = officialLabel(model, spec.no);
    if (!box || !label) throw new Error(`campo ${spec.no} sem caixa no modelo oficial`);
    const labelBottom = Math.max(...model.labels.filter((l) => l.x >= box.x - 0.5 && l.x <= box.x + box.w && l.y >= box.y && l.y <= box.y + box.h).map((l) => l.y));
    const area = { x: box.x + 2, top: labelBottom + 1.5, width: box.w - 4, height: box.y + box.h - 1.5 - (labelBottom + 1.5) };
    const fit = fitText(value, area, style.valueMax, style.valueMin);
    let lines = fit.lines;
    if (fit.overflow) {
      continuation.push({ field: spec.no, label: cleanLabel(label.text).replace(/^\d{1,2}\s*[-–]\s*/u, ''), text: value });
      lines = [...lines.slice(0, -1), CONT_NOTE(spec.no)];
    }
    // Uma linha: rente ao pé da caixa; várias: a partir do topo da área.
    const lead = fit.size * 1.15;
    const topAligned = (sadt ? LONG_TEXT.sadt : LONG_TEXT.consulta).has(spec.no);
    const firstBaseline = lines.length === 1 && !topAligned ? box.y + box.h - Math.max(3, (area.height - fit.size) / 2) : area.top + fit.size * 0.95;
    lines.forEach((text, i) =>
      fixedOps.push({ t: 'text', x: area.x, y: firstBaseline + i * lead, size: fit.size, text, field: spec.no, maxX: box.x + box.w }),
    );
  }

  // Campo 2 (nº da guia no prestador) no lugar do exemplo do modelo; nome da operadora no lugar do logotipo.
  const sample = model.labels.find((l) => l.text === '12345678901234567890')!;
  const frameRight = sadt ? 774.6 : 696.6;
  const numberSize = Math.min(sample.size, (frameRight - sample.x - 2) / (textWidth(view.fields[2] || '0', 1) || 1));
  if (view.fields[2]) {
    fixedOps.push({ t: 'text', x: sample.x, y: sample.y, size: numberSize, text: view.fields[2], field: 2, bold: true, maxX: frameRight });
  }
  const logo = model.labels.find((l) => l.text === 'Logo da Empresa')!;
  if (view.operadoraNome) {
    const limit = (sadt ? 239.9 : 289.9) - logo.x - 4;
    const fit = fitText(view.operadoraNome, { width: limit, height: logo.size * 2.4 }, logo.size, logo.size * 0.6);
    fit.lines.forEach((text, i) =>
      fixedOps.push({ t: 'text', x: logo.x, y: logo.y + i * fit.size * 1.15, size: fit.size, text, bold: true, maxX: logo.x + limit }),
    );
  }

  // Tabelas (SP/SADT): folhas necessárias.
  const pageCount = sadt
    ? Math.max(1, Math.ceil(view.requested.length / 5), Math.ceil(view.executed.length / 5), Math.ceil(view.team.length / 4))
    : 1;
  const cols = sadt ? sadtColumns() : null;
  const pages: DrawOp[][] = [];
  for (let page = 0; page < pageCount; page++) {
    const ops: DrawOp[] = [...modelOps(model, sadt), ...fixedOps.filter((op) => !(page < pageCount - 1 && op.t === 'text' && op.field !== undefined && op.field >= 59 && op.field <= 65))];
    if (sadt && cols) {
      const table = <R extends object>(
        rows: readonly R[],
        perPage: number,
        ys: readonly number[],
        columns: ReadonlyArray<{ key: string; x: number; to: number }>,
        field: number,
        numbered: boolean,
      ) => {
        ys.forEach((y, i) => {
          const index = page * perPage + i;
          if (numbered) ops.push({ t: 'text', x: ROWNUM_X, y, size: ROWNUM_SIZE, text: String(index + 1), label: true });
          const row = rows[index] as Record<string, string> | undefined;
          if (!row) return;
          for (const c of columns) {
            const value = row[c.key] ?? '';
            if (!value) continue;
            const width = c.to - c.x - 2;
            const fit = fitText(value, { width, height: style.rowSize * 1.15 }, style.rowSize, style.rowMin);
            let text = fit.lines[0] ?? '';
            if (fit.overflow || fit.lines.length > 1) {
              continuation.push({ field, label: `linha ${index + 1}, ${c.key}`, text: value });
              text = `${wrapToFirst(value, fit.size, width - textWidth(' (cont.)', fit.size))} (cont.)`;
            }
            ops.push({ t: 'text', x: c.x, y, size: fit.size, text, field, maxX: c.to });
          }
        });
      };
      table(view.requested, 5, REQ_ROWS, cols.requested, 24, true);
      table(view.executed, 5, EXEC_ROWS, cols.executed, 36, true);
      table(view.team, 4, TEAM_ROWS, cols.team, 48, false);
      // Números das 10 caixas de procedimentos em série (56/57), preenchidas à mão.
      for (const l of SP_SADT_MODEL.labels) {
        if (l.y > 470 && l.y < 500 && /^\d{1,2}(\s|$)/u.test(l.text)) {
          ops.push({ t: 'text', x: l.x, y: l.y, size: l.size, text: l.text.split(/\s/u)[0]!, label: true });
        }
      }
    }
    if (pageCount > 1) {
      ops.push({
        t: 'text',
        x: sadt ? 618.8 : 600,
        y: sadt ? 31 : 52,
        size: sadt ? 5 : 6.5,
        text: `Folha ${page + 1} de ${pageCount}${page < pageCount - 1 ? ' — continua na folha seguinte' : ''}`,
      });
    }
    ops.push(footer(model, sadt, meta));
    if (meta.copy === 'attendance') ops.push(attendanceMark(sadt));
    pages.push(ops);
  }

  return { model, title: sadt ? SP_SADT_MODEL.title : CONSULTA_MODEL.title, pages, continuation: dedupe(continuation) };
}

function wrapToFirst(text: string, size: number, width: number): string {
  let out = '';
  for (const ch of text) {
    if (textWidth(out + ch, size) > width) break;
    out += ch;
  }
  return out.trimEnd();
}

function dedupe(items: PrintLayout['continuation']): PrintLayout['continuation'] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.field}|${i.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Rastreabilidade (R36/S7): software, guia, revisão e o início do SHA-256 do snapshot emitido. */
function footer(model: OfficialModel, sadt: boolean, meta: PrintMeta): DrawText {
  const parts = [
    meta.copy === 'attendance' ? 'Via de atendimento (sem valores)' : null,
    `Gerado por ${meta.software.name}${meta.software.version ? ` ${meta.software.version}` : ''}`,
    `guia nº ${meta.guideNumber}`,
    meta.revision !== null ? `revisão ${meta.revision}` : null,
    meta.snapshotSha256 ? `snapshot ${meta.snapshotSha256.slice(0, 16)}` : null,
    `modelo ANS: Conteúdo e Estrutura 202511, p. ${model.source.page}`,
  ].filter(Boolean);
  return { t: 'text', x: sadt ? 58.9 : 135.8, y: sadt ? 593 : 524, size: sadt ? 3.8 : 5.5, text: parts.join(' · ') };
}

/**
 * Onde a marca cabe sem cobrir o modelo: na Consulta, a margem acima da primeira caixa (y 54,5);
 * na SP/SADT (o modelo ocupa a folha), na linha do rodapé, alinhada à direita da última caixa.
 */
function attendanceMark(sadt: boolean): DrawText {
  if (!sadt) return { t: 'text', x: 121.1, y: 44, size: 9, bold: true, text: ATTENDANCE_COPY_MARK };
  const size = 5;
  return { t: 'text', x: 800 - textWidth(ATTENDANCE_COPY_MARK, size, true), y: 593, size, bold: true, text: ATTENDANCE_COPY_MARK };
}

/** Número do campo de um rótulo do modelo (reexportado para os testes de conformidade). */
export { fieldNumber };
