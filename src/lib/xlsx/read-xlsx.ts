/**
 * Leitura de planilhas .xlsx sem dependência externa.
 *
 * Cobre o que importa para importar dados tabulares:
 * - abas pelo nome;
 * - textos compartilhados e em linha;
 * - números, booleanos e valores em cache de fórmula.
 *
 * Não interpreta estilos: uma data chega como o número serial do Excel, e
 * quem conhece a coluna faz a conversão (`excelSerialToIsoDate`).
 */
import { DEFAULT_ZIP_LIMITS, ZipArchive, ZipFormatError, type ZipLimits } from './zip';

export type XlsxCellValue = string | number | boolean;

export interface XlsxRow {
  /** Número da linha na planilha (1-based, como o Excel mostra). */
  index: number;
  /** Valores por letra de coluna (`A`, `B`, …). Células vazias ficam de fora. */
  cells: Record<string, XlsxCellValue>;
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
}

export interface XlsxWorkbook {
  sheetNames: string[];
  /** Lê a aba pelo nome exato; `null` se não existir. */
  sheet(name: string): XlsxSheet | null;
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decodifica entidades XML e os escapes `_xHHHH_` que o Excel usa para caracteres de controle. */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&(lt|gt|amp|quot|apos);/gu, (_, name: string) => ENTITY[name] ?? '')
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/_x([0-9A-Fa-f]{4})_/gu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/gu)) out[m[1]!] = decodeXmlText(m[2]!);
  return out;
}

/** Concatena todos os `<t>` de um fragmento (texto simples ou rico). */
function textRuns(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/gu)) {
    out += decodeXmlText(m[1] ?? '');
  }
  return out;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/gu)].map((m) => textRuns(m[1] ?? ''));
}

function parseRows(xml: string, shared: readonly string[]): XlsxRow[] {
  const rows: XlsxRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
    const rowAttrs = attributes(rowMatch[1] ?? '');
    const index = Number(rowAttrs.r);
    const cells: Record<string, XlsxCellValue> = {};
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu,
    )) {
      const attrs = attributes(cellMatch[1] ?? '');
      const column = (attrs.r ?? '').replace(/[0-9]+$/u, '');
      if (!column) continue;
      const body = cellMatch[2] ?? '';
      const rawValue = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      let value: XlsxCellValue | undefined;
      switch (attrs.t) {
        case 's':
          if (rawValue !== undefined) value = shared[Number(rawValue)] ?? '';
          break;
        case 'inlineStr':
          value = textRuns(/<is>([\s\S]*?)<\/is>/u.exec(body)?.[1] ?? '');
          break;
        case 'str':
        case 'e':
          if (rawValue !== undefined) value = decodeXmlText(rawValue);
          break;
        case 'b':
          if (rawValue !== undefined) value = rawValue === '1';
          break;
        default:
          if (rawValue !== undefined && rawValue !== '') {
            const n = Number(rawValue);
            value = Number.isFinite(n) ? n : decodeXmlText(rawValue);
          }
      }
      if (value !== undefined && value !== '') cells[column] = value;
    }
    rows.push({ index: Number.isFinite(index) ? index : rows.length + 1, cells });
  }
  return rows;
}

function resolveTarget(target: string): string {
  const clean = target.replace(/^\/+/u, '');
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

/** Abre uma planilha .xlsx a partir dos bytes. Lança `ZipFormatError` se o arquivo for inválido. */
export function readXlsx(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): XlsxWorkbook {
  const zip = new ZipArchive(Buffer.from(data.buffer, data.byteOffset, data.byteLength), limits);
  const text = (name: string): string | null => zip.read(name)?.toString('utf8') ?? null;

  const workbookXml = text('xl/workbook.xml');
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw new ZipFormatError('arquivo não é uma planilha .xlsx');

  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/gu)) {
    const attrs = attributes(m[1] ?? '');
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, resolveTarget(attrs.Target));
  }
  const sheets = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/gu)) {
    const attrs = attributes(m[1] ?? '');
    const target = attrs['r:id'] ? targets.get(attrs['r:id']) : undefined;
    if (attrs.name && target) sheets.set(attrs.name, target);
  }

  let shared: string[] | null = null;
  return {
    sheetNames: [...sheets.keys()],
    sheet(name) {
      const target = sheets.get(name);
      if (!target) return null;
      const xml = text(target);
      if (xml === null) throw new ZipFormatError(`aba ${name} sem conteúdo`);
      shared ??= parseSharedStrings(text('xl/sharedStrings.xml'));
      return { name, rows: parseRows(xml, shared) };
    },
  };
}

/** Converte o número serial de data do Excel (sistema 1900) em `YYYY-MM-DD`. */
export function excelSerialToIsoDate(serial: number): string | null {
  // 1 = 1900-01-01; 2958465 = 9999-12-31. Fora disso não é data de planilha.
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  // O Excel conta 29/02/1900 (que não existe); a época 1899-12-30 compensa
  // para todas as datas a partir de 01/03/1900, que são as que importam aqui.
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
