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
  cnpj: '00.000.000/0001-00',
  cnes: '1234567',
};
const doctor: PdfDoctor = { nome: 'Dra. Ana', crm: '123456', crmUf: 'SP', especialidade: 'Clínica' };

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
      },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('renderAtestadoPDF gera um PDF válido', async () => {
    const buf = await renderAtestadoPDF(
      { patientNome: 'João da Silva', descricao: 'compareceu à consulta', dias: 2, issuedAt: '2026-06-01T12:00:00Z' },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('renderExamePDF gera um PDF válido', async () => {
    const buf = await renderExamePDF(
      { patientNome: 'João da Silva', exames: ['Hemograma', 'Glicemia'], issuedAt: '2026-06-01T12:00:00Z' },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });

  it('renderEncaminhamentoPDF gera um PDF válido', async () => {
    const buf = await renderEncaminhamentoPDF(
      { patientNome: 'João da Silva', especialidade: 'Cardiologia', motivo: 'avaliação de sopro', issuedAt: '2026-06-01T12:00:00Z' },
      branding,
      doctor,
    );
    expect(isPdf(buf)).toBe(true);
  });
});
