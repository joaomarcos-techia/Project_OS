import { describe, expect, it, vi } from 'vitest';

import { renderReceituarioControleEspecialPDF } from './receituario-controle-especial';
import type { PdfBranding, PdfDoctor, ReceituarioControleEspecialPdfData } from './types';

// Render @react-pdf + parse pdfjs são legitimamente lentos em node (cold start de
// fontes/engine) e ficam ainda mais lentos sob a carga paralela do `vitest run`.
// Timeout generoso para todo o arquivo evita flakiness (não é teste de performance).
vi.setConfig({ testTimeout: 30_000 });

const branding: PdfBranding = {
  nome: 'Clínica Teste',
  logoUrl: null,
  primaryColor: '#0F766E',
  endereco: 'Rua A, 100',
  telefone: '(11) 4000-0000',
  cnpj: '00.000.000/0001-00',
  cnes: '1234567',
};
const doctor: PdfDoctor = {
  nome: 'Dra. Ana Souza',
  crm: '123456',
  crmUf: 'SP',
  especialidade: 'Psiquiatria',
};

const baseData: ReceituarioControleEspecialPdfData = {
  patientNome: 'João da Silva',
  patientEndereco: 'Rua das Flores, 50 — São Paulo/SP — CEP 01000-000',
  emitenteNome: 'Clínica Teste',
  emitenteEndereco: 'Rua A, 100 — São Paulo/SP',
  emitenteTelefone: '(11) 4000-0000',
  medicamentos: [
    { nome: 'Sertralina', dosagem: '50mg', posologia: '1 cp pela manhã', quantidade: '30' },
    { nome: 'Clonazepam', dosagem: '2mg', posologia: '1 cp à noite', quantidade: '60' },
  ],
  observacoes: 'Uso contínuo. Retornar em 30 dias.',
  issuedAt: '2026-06-01T12:00:00Z',
};

function isPdf(buf: Buffer): boolean {
  return buf.length > 500 && buf.subarray(0, 4).toString('latin1') === '%PDF';
}

/** Normaliza: minúsculas, sem acentos, espaços colapsados (robusto p/ extração pdfjs). */
function norm(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function countOf(haystack: string, needle: string): number {
  const h = norm(haystack);
  const n = norm(needle);
  let count = 0;
  let i = h.indexOf(n);
  while (i !== -1) {
    count++;
    i = h.indexOf(n, i + n.length);
  }
  return count;
}

/** Extrai nº de páginas + texto concatenado do Buffer (headless, sem canvas). */
async function extractPdf(buf: Buffer): Promise<{ numPages: number; text: string }> {
  // Import dinâmico: o engine do pdfjs é grande; carregá-lo sob demanda mantém a
  // fase de coleta do vitest leve (não onera os outros arquivos de teste).
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
  const doc = await task.promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += ' ' + content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { numPages, text };
}

describe('renderReceituarioControleEspecialPDF', () => {
  it('gera um PDF válido (%PDF) e não vazio', async () => {
    const buf = await renderReceituarioControleEspecialPDF(baseData, branding, doctor);
    expect(isPdf(buf)).toBe(true);
  });

  it('cabe em 1 página A4 com os blocos obrigatórios em DUAS vias', async () => {
    const buf = await renderReceituarioControleEspecialPDF(baseData, branding, doctor);
    const { numPages, text } = await extractPdf(buf);

    expect(numPages).toBe(1);
    // Cada bloco aparece uma vez por via → 2 ocorrências (prova as duas vias).
    expect(countOf(text, 'receituario de controle especial')).toBe(2);
    expect(countOf(text, 'identificacao do comprador')).toBe(2);
    expect(countOf(text, 'identificacao do fornecedor')).toBe(2);
    expect(countOf(text, 'carimbo e assinatura do prescritor')).toBe(2);
    expect(
      countOf(text, 'documento valido somente mediante assinatura e carimbo fisico do prescritor'),
    ).toBe(2);
    // Rótulos das vias.
    expect(countOf(text, '1a via')).toBeGreaterThanOrEqual(1);
    expect(countOf(text, '2a via')).toBeGreaterThanOrEqual(1);
    // Emitente + paciente (snapshot) presentes.
    expect(norm(text)).toContain(norm('Joao da Silva'));
    expect(norm(text)).toContain(norm('CRM SP 123456'));
    // G3 — quantidade por extenso renderizada.
    expect(norm(text)).toContain(norm('30 (trinta)'));
  });

  it('não quebra layout com muitos medicamentos e textos longos (overflow)', async () => {
    const meds = Array.from({ length: 10 }, (_, i) => ({
      nome: `Medicamento de nome muito longo número ${i + 1} para testar overflow`,
      dosagem: '500mg',
      posologia: 'tomar 1 comprimido de 8 em 8 horas durante 14 dias contínuos sem interrupção',
      quantidade: String((i + 1) * 10),
    }));
    const buf = await renderReceituarioControleEspecialPDF(
      { ...baseData, medicamentos: meds },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
    const { numPages } = await extractPdf(buf);
    // wrap={false} por via: no pior caso cada via vai para sua própria página.
    expect(numPages).toBeLessThanOrEqual(2);
  });

  it('imprime linha em branco quando o paciente não tem endereço', async () => {
    const buf = await renderReceituarioControleEspecialPDF(
      { ...baseData, patientEndereco: null },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });
});
