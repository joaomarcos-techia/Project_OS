/**
 * P2.7 — leitura e normalização da planilha da tabela contratual (CSV ou XLSX), sem banco.
 *
 * Segurança da leitura:
 *   - tamanho e número de linhas limitados ANTES de qualquer trabalho caro;
 *   - XLSX pelo leitor próprio do Qoro (`@/lib/xlsx`, sem dependência), com limites de zip mais
 *     apertados que o padrão; fórmula nunca é executada (só o valor em cache, como texto/número);
 *   - célula de texto que começa com `=`, `+`, `-` ou `@` seguida de letra é recusada (fórmula
 *     disfarçada não vira descrição de guia);
 *   - o conteúdo é DADO: nenhuma célula vira instrução, URL, SQL ou nome de coluna dinâmico.
 *
 * Escopo (decisão explícita): itens de contrato de UMA operadora por planilha — procedimento TUSS
 * (tabela 22), tipo de guia, valor, vigência, plano (que já existe), autorização, coparticipação,
 * retorno e o procedimento do catálogo da clínica. Operadoras, planos, credenciamento e regras
 * NÃO são criados por planilha: continuam na tela, com a validação própria de cada um.
 */
import { excelSerialToIsoDate, readXlsx, ZipFormatError, type XlsxRow } from '@/lib/xlsx';

export const CONTRACT_IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxRows: 2000,
  zip: { maxEntries: 200, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 },
} as const;

/** Colunas aceitas (cabeçalho sem acento, minúsculo, espaços viram `_`). */
export const CONTRACT_IMPORT_COLUMNS = {
  tabela: { required: false, hint: '22 (TUSS procedimentos); vazio = 22' },
  codigo: { required: true, hint: 'código TUSS, só números' },
  descricao: { required: false, hint: 'vazio = descrição oficial da TUSS' },
  tipo_guia: { required: true, hint: 'consulta ou sp_sadt' },
  valor: { required: true, hint: 'valor contratado em R$ (ex.: 150,00)' },
  vigencia_inicio: { required: true, hint: 'dd/mm/aaaa' },
  vigencia_fim: { required: false, hint: 'dd/mm/aaaa; vazio = sem fim' },
  plano: { required: false, hint: 'nome do plano já cadastrado; vazio = todos os planos' },
  exige_autorizacao: { required: false, hint: 'sim ou não (vazio = não)' },
  coparticipacao_tipo: { required: false, hint: 'nenhuma, fixa ou percentual' },
  coparticipacao_valor: { required: false, hint: 'R$ (fixa) ou % (percentual)' },
  retorno_dias: { required: false, hint: '1 a 365; vazio = sem retorno' },
  retorno_faturavel: { required: false, hint: 'sim ou não' },
  procedimento_clinica: { required: true, hint: 'código do procedimento no catálogo da clínica' },
} as const;
export type ContractImportColumn = keyof typeof CONTRACT_IMPORT_COLUMNS;
const COLUMN_NAMES = Object.keys(CONTRACT_IMPORT_COLUMNS) as ContractImportColumn[];

export class ContractImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractImportFileError';
  }
}

export interface RawSheet {
  header: string[];
  rows: Array<{ line: number; cells: string[] }>;
}

/** Modelo para baixar: cabeçalho + uma linha de exemplo (separador `;`, como o Excel em pt-BR). */
export function contractImportTemplateCsv(): string {
  const example = [
    '22',
    '10101012',
    '',
    'consulta',
    '150,00',
    '01/01/2027',
    '',
    '',
    'não',
    'percentual',
    '30',
    '30',
    'não',
    'CONS',
  ];
  return `${COLUMN_NAMES.join(';')}\r\n${example.join(';')}\r\n`;
}

const strip = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/gu, '').trim().toLowerCase().replace(/\s+/gu, '_');

/** CSV (RFC 4180), separador `;` ou `,` detectado pelo cabeçalho; BOM e CRLF aceitos. */
export function parseCsv(text: string): RawSheet {
  const src = text.replace(/^﻿/u, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/u));
  const sep =
    (firstLine.match(/;/gu)?.length ?? 0) >= (firstLine.match(/,/gu)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      if (records.length > CONTRACT_IMPORT_LIMITS.maxRows + 1) {
        throw new ContractImportFileError(
          `A planilha passa de ${CONTRACT_IMPORT_LIMITS.maxRows} linhas. Divida em arquivos menores.`,
        );
      }
    } else field += ch;
  }
  if (quoted) throw new ContractImportFileError('CSV malformado: aspas abertas sem fechar.');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records;
  if (!header) throw new ContractImportFileError('A planilha está vazia.');
  return {
    header: header.map((h) => h.trim()),
    rows: body
      .map((cells, i) => ({ line: i + 2, cells: cells.map((c) => c.trim()) }))
      .filter((r) => r.cells.some((c) => c !== '')),
  };
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxCellText(v: XlsxRow['cells'][string] | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v).trim();
}

/** XLSX: primeira aba; a primeira linha com conteúdo é o cabeçalho. */
export function parseXlsx(bytes: Uint8Array): RawSheet {
  let wb;
  try {
    wb = readXlsx(bytes, CONTRACT_IMPORT_LIMITS.zip);
  } catch (e) {
    if (e instanceof ZipFormatError)
      throw new ContractImportFileError('Arquivo .xlsx inválido ou grande demais.');
    throw e;
  }
  const name = wb.sheetNames[0];
  const sheet = name ? wb.sheet(name) : null;
  if (!sheet || sheet.rows.length === 0)
    throw new ContractImportFileError('A planilha está vazia.');
  if (sheet.rows.length > CONTRACT_IMPORT_LIMITS.maxRows + 1) {
    throw new ContractImportFileError(
      `A planilha passa de ${CONTRACT_IMPORT_LIMITS.maxRows} linhas. Divida em arquivos menores.`,
    );
  }
  const [head, ...body] = sheet.rows;
  const width = Math.max(
    0,
    ...sheet.rows.flatMap((r) => Object.keys(r.cells).map((c) => columnIndex(c) + 1)),
  );
  const toArray = (r: XlsxRow) =>
    Array.from({ length: width }, (_, i) => {
      const letters = Object.keys(r.cells).find((c) => columnIndex(c) === i);
      return letters ? xlsxCellText(r.cells[letters]) : '';
    });
  return {
    header: toArray(head!),
    rows: body
      .map((r) => ({ line: r.index, cells: toArray(r) }))
      .filter((r) => r.cells.some((c) => c !== '')),
  };
}

/** Escolhe o leitor pela extensão E pelo conteúdo (XLSX é zip: começa com `PK`). */
export function readContractSpreadsheet(fileName: string, bytes: Uint8Array): RawSheet {
  if (bytes.byteLength === 0) throw new ContractImportFileError('O arquivo está vazio.');
  if (bytes.byteLength > CONTRACT_IMPORT_LIMITS.maxBytes) {
    throw new ContractImportFileError('O arquivo passa de 2 MB. Divida em arquivos menores.');
  }
  const lower = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (lower.endsWith('.xlsx')) {
    if (!isZip) throw new ContractImportFileError('O arquivo não é um .xlsx de verdade.');
    return parseXlsx(bytes);
  }
  if (lower.endsWith('.csv')) {
    if (isZip) throw new ContractImportFileError('O arquivo .csv parece ser outro formato.');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.includes('\u0000'))
      throw new ContractImportFileError('O arquivo .csv tem conteúdo binário.');
    return parseCsv(text);
  }
  throw new ContractImportFileError(
    'Envie um arquivo .csv ou .xlsx (o modelo está disponível para baixar).',
  );
}

export interface ContractImportRow {
  line: number;
  procedureCode: string;
  description: string | null;
  guideType: 'consulta' | 'sp_sadt';
  unitValueCents: number;
  validFrom: string;
  validUntil: string | null;
  planName: string | null;
  requiresAuthorization: boolean;
  copayKind: 'none' | 'fixed' | 'percentage';
  copayFixedCents: number | null;
  copayPercentage: number | null;
  returnDays: number | null;
  returnBillable: boolean;
  clinicProcedureCode: string;
}

export interface NormalizedSheet {
  missingColumns: ContractImportColumn[];
  unknownColumns: string[];
  rows: ContractImportRow[];
  /** Erros por linha da planilha (a linha não entra na aplicação). */
  errors: Array<{ line: number; messages: string[] }>;
}

/** `150,00`, `150.00`, `R$ 1.234,56`, `1234.5` → centavos; `null` se não for valor. */
export function parseMoneyCents(raw: string): number | null {
  const v = raw.replace(/R\$\s*/iu, '').replace(/\s/gu, '');
  if (!v) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/u.test(v))
    normalized = v.replace(/\./gu, '').replace(',', '.');
  else if (/^\d+(,\d{1,2})$/u.test(v)) normalized = v.replace(',', '.');
  else if (/^\d+(\.\d{1,2})?$/u.test(v)) normalized = v;
  else return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** `dd/mm/aaaa`, `aaaa-mm-dd` ou número serial do Excel → `aaaa-mm-dd` válido; senão `null`. */
export function parseDay(raw: string): string | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  let mm: RegExpMatchArray | null;
  if ((mm = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u)))
    [d, m, y] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = v.match(/^(\d{4})-(\d{2})-(\d{2})$/u)))
    [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if (/^\d{4,6}(\.0+)?$/u.test(v)) return excelSerialToIsoDate(Number(v));
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  if (y < 1990 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

function parseBool(raw: string): boolean | null {
  const v = strip(raw);
  if (v === '') return false;
  if (['sim', 's', 'x', 'true', '1', 'yes'].includes(v)) return true;
  if (['nao', 'n', 'false', '0', 'no'].includes(v)) return false;
  return null;
}

const FORMULA_LIKE = /^[=+\-@][A-Za-z(]/u;

/** Cabeçalho → colunas conhecidas; cada linha → valores tipados ou erros por linha. */
export function normalizeContractSheet(sheet: RawSheet): NormalizedSheet {
  const index = new Map<ContractImportColumn, number>();
  const unknownColumns: string[] = [];
  sheet.header.forEach((h, i) => {
    const key = strip(h) as ContractImportColumn;
    if (!h.trim()) return;
    if ((COLUMN_NAMES as string[]).includes(key) && !index.has(key)) index.set(key, i);
    else unknownColumns.push(h.trim().slice(0, 60));
  });
  const missingColumns = COLUMN_NAMES.filter(
    (c) => CONTRACT_IMPORT_COLUMNS[c].required && !index.has(c),
  );
  const rows: ContractImportRow[] = [];
  const errors: NormalizedSheet['errors'] = [];
  if (missingColumns.length > 0) return { missingColumns, unknownColumns, rows, errors };

  for (const r of sheet.rows) {
    const get = (c: ContractImportColumn) => {
      const i = index.get(c);
      return i === undefined ? '' : (r.cells[i] ?? '').trim();
    };
    const messages: string[] = [];
    for (const c of COLUMN_NAMES) {
      const v = get(c);
      if (v.length > 300) messages.push(`${c}: texto longo demais.`);
      if (FORMULA_LIKE.test(v)) messages.push(`${c}: fórmula não é aceita; use o valor.`);
    }
    const table = get('tabela') || '22';
    if (table !== '22') messages.push('tabela: só a 22 (TUSS procedimentos) nesta versão.');
    const procedureCode = get('codigo').replace(/\D/gu, '');
    if (!/^\d{1,10}$/u.test(procedureCode))
      messages.push('codigo: código TUSS inválido (só números, até 10 dígitos).');
    const guideRaw = strip(get('tipo_guia')).replace(/[/\-]/gu, '_');
    const guideType =
      guideRaw === 'consulta'
        ? 'consulta'
        : guideRaw === 'sp_sadt' || guideRaw === 'spsadt'
          ? 'sp_sadt'
          : null;
    if (!guideType) messages.push('tipo_guia: use consulta ou sp_sadt.');
    const unitValueCents = parseMoneyCents(get('valor'));
    if (unitValueCents === null) messages.push('valor: informe o valor em R$ (ex.: 150,00).');
    const validFrom = parseDay(get('vigencia_inicio'));
    if (!validFrom) messages.push('vigencia_inicio: data inválida (dd/mm/aaaa).');
    const untilRaw = get('vigencia_fim');
    const validUntil = untilRaw ? parseDay(untilRaw) : null;
    if (untilRaw && !validUntil) messages.push('vigencia_fim: data inválida (dd/mm/aaaa).');
    if (validFrom && validUntil && validUntil < validFrom)
      messages.push('vigencia_fim: antes do início.');
    const requiresAuthorization = parseBool(get('exige_autorizacao'));
    if (requiresAuthorization === null) messages.push('exige_autorizacao: use sim ou não.');
    const copayRaw = strip(get('coparticipacao_tipo'));
    const copayKind =
      copayRaw === '' || copayRaw === 'nenhuma' || copayRaw === 'nao'
        ? 'none'
        : copayRaw === 'fixa' || copayRaw === 'fixo'
          ? 'fixed'
          : copayRaw === 'percentual' || copayRaw === '%'
            ? 'percentage'
            : null;
    if (!copayKind) messages.push('coparticipacao_tipo: use nenhuma, fixa ou percentual.');
    const copayValue = get('coparticipacao_valor');
    let copayFixedCents: number | null = null;
    let copayPercentage: number | null = null;
    if (copayKind === 'fixed') {
      copayFixedCents = parseMoneyCents(copayValue);
      if (copayFixedCents === null)
        messages.push('coparticipacao_valor: informe o valor fixo em R$.');
    } else if (copayKind === 'percentage') {
      const p = Number(copayValue.replace('%', '').replace(',', '.').trim());
      if (!copayValue || !Number.isFinite(p))
        messages.push('coparticipacao_valor: informe o percentual.');
      else copayPercentage = p;
    } else if (copayValue) {
      messages.push('coparticipacao_valor: sem coparticipação, deixe vazio.');
    }
    const returnRaw = get('retorno_dias');
    const returnDays = returnRaw ? Number(returnRaw) : null;
    if (returnRaw && !(Number.isInteger(returnDays) && returnDays! >= 1 && returnDays! <= 365)) {
      messages.push('retorno_dias: de 1 a 365.');
    }
    const returnBillable = parseBool(get('retorno_faturavel'));
    if (returnBillable === null) messages.push('retorno_faturavel: use sim ou não.');
    const clinicProcedureCode = get('procedimento_clinica');
    if (!clinicProcedureCode)
      messages.push('procedimento_clinica: informe o código do catálogo da clínica.');
    const description = get('descricao') || null;
    if (description && description.length > 150) messages.push('descricao: até 150 caracteres.');

    if (messages.length > 0) {
      errors.push({ line: r.line, messages });
      continue;
    }
    rows.push({
      line: r.line,
      procedureCode,
      description,
      guideType: guideType!,
      unitValueCents: unitValueCents!,
      validFrom: validFrom!,
      validUntil,
      planName: get('plano') || null,
      requiresAuthorization: requiresAuthorization!,
      copayKind: copayKind!,
      copayFixedCents,
      copayPercentage,
      returnDays: Number.isInteger(returnDays) ? returnDays : null,
      returnBillable: returnBillable!,
      clinicProcedureCode,
    });
  }
  return { missingColumns, unknownColumns, rows, errors };
}
