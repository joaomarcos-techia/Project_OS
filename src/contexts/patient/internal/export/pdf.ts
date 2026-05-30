/**
 * LGPD export PDF renderer (C5). Pure: takes the assembled export JSON and
 * returns PDF bytes. No DB, no decryption (data arrives already decrypted from
 * the central query). Layout is intentionally minimal — §5.18 lets the PDF
 * layout evolve.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ExportDocument {
  requestId: string;
  patientId: string;
  clinicId: string;
  exportedAt: string;
  sections: Record<string, unknown>;
}

export async function renderExportPdf(doc: ExportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const fontSize = 10;
  const lineHeight = 14;
  let page = pdf.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;

  const ensureSpace = () => {
    if (y < margin + lineHeight) {
      page = pdf.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  };

  const write = (text: string, opts: { bold?: boolean; indent?: number } = {}) => {
    ensureSpace();
    const maxChars = Math.floor((width - margin * 2 - (opts.indent ?? 0)) / (fontSize * 0.5));
    for (const line of wrap(text, Math.max(maxChars, 20))) {
      ensureSpace();
      page.drawText(line, {
        x: margin + (opts.indent ?? 0),
        y,
        size: fontSize,
        font: opts.bold ? bold : font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
  };

  write('ClinicaOS — Exportação de Dados Pessoais (LGPD Art. 18)', { bold: true });
  write(`Solicitação: ${doc.requestId}`);
  write(`Paciente: ${doc.patientId}`);
  write(`Gerado em: ${doc.exportedAt}`);
  y -= lineHeight;

  for (const [sectionKey, value] of Object.entries(doc.sections)) {
    write(sectionKey.toUpperCase(), { bold: true });
    for (const line of stringifyValue(value)) write(line, { indent: 12 });
    y -= lineHeight / 2;
  }

  return pdf.save();
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Flatten a JSON value into human-readable "key: value" lines. */
function stringifyValue(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) return [`${prefix}: —`];
  if (typeof value !== 'object') return [`${prefix}: ${String(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}: (vazio)`];
    return value.flatMap((v, i) => stringifyValue(v, `${prefix}[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    stringifyValue(v, prefix ? `${prefix}.${k}` : k),
  );
}
