import { describe, expect, it } from 'vitest';

import { renderExportPdf, type ExportDocument } from './pdf';

/** C7: migração pdf-lib → @react-pdf/renderer. Garante que o export LGPD ainda
 * produz um PDF válido (Buffer começando com o magic header %PDF). */
describe('renderExportPdf (LGPD export — react-pdf)', () => {
  it('gera um PDF válido com seções aninhadas', async () => {
    const doc: ExportDocument = {
      requestId: '11111111-1111-1111-1111-111111111111',
      patientId: '22222222-2222-2222-2222-222222222222',
      clinicId: '33333333-3333-3333-3333-333333333333',
      exportedAt: '2026-06-01T12:00:00Z',
      sections: {
        patient: { nome: 'João da Silva', cpf: '000.000.000-00', enderecos: [{ cidade: 'SP' }] },
        appointments: [],
        consents: { dados_saude: true },
      },
    };
    const buf = await renderExportPdf(doc);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
