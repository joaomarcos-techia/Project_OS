import { describe, expect, it } from 'vitest';

import { renderRelatorioPDF } from './relatorio';

describe('renderRelatorioPDF', () => {
  it('gera um PDF válido (%PDF) com consolidado por profissional', async () => {
    const buf = await renderRelatorioPDF({
      clinicName: 'Clínica Teste',
      periodLabel: 'Últimos 30 dias',
      fromLabel: '03/06/2026',
      toLabel: '03/07/2026',
      generatedAt: '03/07/2026 10:00',
      includeFaturamento: true,
      kpis: {
        faturamento: { recebido: 1234.5, pago: 200, saldo: 1034.5 },
        noShow: { taxa: 0.12, faltou: 3, atendido: 22, total: 28 },
        ocupacao: { taxa: 0.67 },
      },
      porProfissional: [
        {
          doctorId: 'd1',
          nome: 'Dra. Ana Souza',
          total: 18,
          atendidos: 15,
          faltas: 2,
          recebido: 900,
        },
        {
          doctorId: 'd2',
          nome: 'Dr. Bruno Lima',
          total: 10,
          atendidos: 7,
          faltas: 1,
          recebido: 334.5,
        },
      ],
    });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sem view:financial omite faturamento sem quebrar', async () => {
    const buf = await renderRelatorioPDF({
      clinicName: 'Clínica Teste',
      periodLabel: 'Últimos 7 dias',
      fromLabel: '26/06/2026',
      toLabel: '03/07/2026',
      generatedAt: '03/07/2026 10:00',
      includeFaturamento: false,
      kpis: {
        faturamento: null,
        noShow: { taxa: null, faltou: 0, atendido: 0, total: 0 },
        ocupacao: { taxa: null },
      },
      porProfissional: [
        {
          doctorId: 'd1',
          nome: 'Dra. Ana Souza',
          total: 4,
          atendidos: 4,
          faltas: 0,
          recebido: null,
        },
      ],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it.each([null, []])(
    'distingue relatório fora do plano de ausência de movimento: %s',
    async (rows) => {
      const buf = await renderRelatorioPDF({
        clinicName: 'Clínica sintética',
        periodLabel: 'Últimos 7 dias',
        fromLabel: '01/10/2026',
        toLabel: '07/10/2026',
        generatedAt: '07/10/2026 10:00',
        includeFaturamento: false,
        kpis: {
          faturamento: null,
          noShow: { taxa: null, faltou: 0, atendido: 0, total: 0 },
          ocupacao: { taxa: null },
        },
        porProfissional: rows,
      });
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        expect(text).toContain('Ocupação');
        if (rows === null) {
          expect(text).not.toContain('Consolidado por profissional');
          expect(text).not.toContain('Profissional');
        } else {
          expect(text).toContain('Consolidado por profissional');
          expect(text).toContain('Sem atendimentos no período.');
        }
      } finally {
        await task.destroy();
      }
    },
  );
});
