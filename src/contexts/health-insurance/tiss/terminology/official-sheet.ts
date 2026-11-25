/**
 * Converte uma aba das planilhas oficiais da TUSS (ANS) em termos normalizados.
 *
 * As abas não têm o mesmo formato. A 22 traz "Descrição Detalhada", a 59 traz
 * "Sigla" e a 87 chama o código de "Código da Tabela". Por isso a linha de
 * cabeçalho é localizada pelo texto, e as colunas são mapeadas pelo nome,
 * nunca pela posição. Colunas desconhecidas vão para `extra`, sem descarte
 * silencioso.
 *
 * O resultado é puro e determinístico: a mesma planilha gera o mesmo artefato.
 */
import { excelSerialToIsoDate, type XlsxCellValue, type XlsxRow } from '@/lib/xlsx';

export interface TerminologyTerm {
  code: string;
  term: string;
  startsOn: string | null;
  endsOn: string | null;
  implantationEndsOn: string | null;
  /** Colunas que não são código, termo nem datas (ex.: `Sigla`, `Descrição Detalhada`). */
  extra?: Record<string, string>;
}

export interface TerminologyTable {
  /** Número da tabela TUSS (`22`, `24`, `87`…). */
  table: string;
  /** Título como aparece na aba (ex.: "Tabela 52 - Terminologia de tipo de consulta"). */
  title: string;
  terms: TerminologyTerm[];
}

export class TerminologySheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminologySheetError';
  }
}

type Field = 'code' | 'term' | 'startsOn' | 'endsOn' | 'implantationEndsOn';

const HEADER_FIELDS: Record<string, Field> = {
  'codigo do termo': 'code',
  'codigo da tabela': 'code',
  codigo: 'code',
  termo: 'term',
  descricao: 'term',
  // Tabela 63 (grupos de procedimentos para envio à ANS) chama o termo de "Grupo".
  grupo: 'term',
  'data de inicio de vigencia': 'startsOn',
  'data de fim de vigencia': 'endsOn',
  'data de fim de implantacao': 'implantationEndsOn',
};

/** Minúsculas, sem acento e com espaços colapsados, para comparar cabeçalhos. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function cellText(value: XlsxCellValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value).replace(/\s+/gu, ' ').trim();
}

/** Data de célula: serial do Excel, ou texto `dd/mm/aaaa` / `aaaa-mm-dd`. */
export function cellDate(value: XlsxCellValue | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number') return excelSerialToIsoDate(value);
  const text = String(value).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  throw new TerminologySheetError(`data não reconhecida: "${text}"`);
}

/** Número da tabela a partir do nome da aba (`Tab 52`, `Tab 22  VERSÃO 202609`, `Tab 87 - Lista…`). */
export function tableNumberFromSheetName(sheetName: string): string | null {
  return /^Tab\s+(\d{2})\b/u.exec(sheetName.trim())?.[1] ?? null;
}

export function parseOfficialSheet(sheetName: string, rows: readonly XlsxRow[]): TerminologyTable {
  const table = tableNumberFromSheetName(sheetName);
  if (!table) throw new TerminologySheetError(`aba "${sheetName}" não é uma tabela TUSS`);

  const headerIndex = rows.findIndex((row) =>
    Object.values(row.cells).some((v) => {
      const h = normalizeHeader(cellText(v));
      return HEADER_FIELDS[h] === 'code';
    }),
  );
  if (headerIndex < 0) {
    throw new TerminologySheetError(`aba "${sheetName}": cabeçalho com o código não encontrado`);
  }

  const header = rows[headerIndex]!;
  const columns = new Map<string, Field | { extra: string }>();
  for (const [column, value] of Object.entries(header.cells)) {
    const label = cellText(value);
    if (!label) continue;
    const field = HEADER_FIELDS[normalizeHeader(label)];
    columns.set(column, field ?? { extra: label });
  }
  const mapped = new Set([...columns.values()].filter((v): v is Field => typeof v === 'string'));
  for (const required of ['code', 'term'] as const) {
    if (!mapped.has(required)) {
      throw new TerminologySheetError(
        `aba "${sheetName}": coluna obrigatória ausente (${required})`,
      );
    }
  }

  const title =
    rows
      .slice(0, headerIndex)
      .flatMap((r) => Object.values(r.cells).map(cellText))
      .find((text) => /^Tabela\s+\d+/u.test(text)) ?? sheetName;

  const terms: TerminologyTerm[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(headerIndex + 1)) {
    let code = '';
    let term = '';
    const dates: Partial<Record<Field, string | null>> = {};
    const extra: Record<string, string> = {};
    for (const [column, target] of columns) {
      const value = row.cells[column];
      if (target === 'code') code = cellText(value);
      else if (target === 'term') term = cellText(value);
      else if (typeof target === 'string') {
        try {
          dates[target] = cellDate(value);
        } catch (error) {
          throw new TerminologySheetError(
            `aba "${sheetName}", linha ${row.index}: ${String(error)}`,
          );
        }
      } else {
        const text = cellText(value);
        if (text) extra[target.extra] = text;
      }
    }
    if (!code) continue; // linhas de rodapé, notas e espaçamento
    if (!term) {
      throw new TerminologySheetError(
        `aba "${sheetName}", linha ${row.index}: código ${code} sem termo`,
      );
    }
    if (seen.has(code)) {
      throw new TerminologySheetError(
        `aba "${sheetName}": código ${code} repetido (linha ${row.index})`,
      );
    }
    seen.add(code);
    terms.push({
      code,
      term,
      startsOn: dates.startsOn ?? null,
      endsOn: dates.endsOn ?? null,
      implantationEndsOn: dates.implantationEndsOn ?? null,
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    });
  }
  if (terms.length === 0) throw new TerminologySheetError(`aba "${sheetName}" sem termos`);
  return { table, title, terms };
}
