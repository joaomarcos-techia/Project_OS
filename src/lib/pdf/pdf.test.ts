import { describe, expect, it } from 'vitest';

import {
  renderAtestadoPDF,
  renderEncaminhamentoPDF,
  renderExamePDF,
  renderPrescriptionPDF,
  type PdfBranding,
  type PdfDoctor,
} from './index';

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
  nome: 'Dra. Ana',
  crm: '123456',
  crmUf: 'SP',
  especialidade: 'Clínica',
};

/** PDF começa com o magic header "%PDF". Render é puro (input → Buffer). */
function isPdf(buf: Buffer): boolean {
  return buf.length > 500 && buf.subarray(0, 4).toString('latin1') === '%PDF';
}

describe('PDF engine (funções puras → Buffer)', () => {
  it('renderPrescriptionPDF gera um PDF válido', async () => {
    const buf = await renderPrescriptionPDF(
      {
        patientNome: 'João da Silva',
        medicamentos: [
          { nome: 'Dipirona', dosagem: '500mg', posologia: '1 cp 6/6h' },
          { nome: 'Amoxicilina', dosagem: '500mg', posologia: '1 cp 8/8h por 7 dias' },
          { nome: 'Omeprazol', dosagem: '20mg' },
        ],
        observacoes: 'Retornar se piora.',
        issuedAt: '2026-06-01T12:00:00Z',
        timeZone: 'America/Sao_Paulo',
      },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('renderAtestadoPDF gera um PDF válido', async () => {
    const buf = await renderAtestadoPDF(
      {
        patientNome: 'João da Silva',
        descricao: 'compareceu à consulta',
        dias: 2,
        issuedAt: '2026-06-01T12:00:00Z',
        timeZone: 'America/Sao_Paulo',
      },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('renderExamePDF gera um PDF válido', async () => {
    const buf = await renderExamePDF(
      {
        patientNome: 'João da Silva',
        exames: ['Hemograma', 'Glicemia'],
        issuedAt: '2026-06-01T12:00:00Z',
        timeZone: 'America/Sao_Paulo',
      },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('imprime a data de emissão no dia local da clínica', async () => {
    const buf = await renderAtestadoPDF(
      {
        patientNome: 'João da Silva',
        descricao: 'compareceu à consulta',
        // 22h30 de 01/06 em Brasília; em UTC já é 02/06.
        issuedAt: '2026-06-02T01:30:00Z',
        timeZone: 'America/Sao_Paulo',
      },
      branding,
      doctor,
    );
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    await task.destroy();
    expect(text).toContain('Data: 01/06/2026');
    expect(text).not.toContain('02/06/2026');
  }, 60_000);

  it('renderEncaminhamentoPDF gera um PDF válido', async () => {
    const buf = await renderEncaminhamentoPDF(
      {
        patientNome: 'João da Silva',
        especialidade: 'Cardiologia',
        motivo: 'avaliação de sopro',
        issuedAt: '2026-06-01T12:00:00Z',
        timeZone: 'America/Sao_Paulo',
      },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });
});
