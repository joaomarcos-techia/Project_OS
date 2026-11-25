/**
 * P9.10 — agregação do relatório e CSV seguro (puros). As somas contra o livro da clínica estão em
 * scripts/security/health-insurance-report-db.ts.
 */
import { describe, expect, it } from 'vitest';

import { aggregateReport, csvCell, csvMoney, ReportFilter, reportCsv, type ReportLine } from './insurer-report';

const line = (over: Partial<ReportLine>): ReportLine => ({
  insurerId: 'i1',
  insurerName: 'Operadora Um',
  guideId: 'g',
  guideType: 'consulta',
  guideNumber: '1',
  guideStatus: 'sent',
  batchNumber: 'L1',
  sentOn: '2026-10-01',
  lastPaidOn: null,
  billedCents: 10_000,
  paidCents: 0,
  glossOpenCents: 0,
  glossDefinitiveCents: 0,
  pendingCents: 10_000,
  ...over,
});

describe('CSV seguro', () => {
  it('texto que abriria fórmula vira texto; aspas, ponto e vírgula e quebras vão entre aspas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const s of ['+1', '-1+1', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(s).replace(/^"/u, '').startsWith("'")).toBe(true);
    expect(csvCell('Operadora; Filial')).toBe('"Operadora; Filial"');
    expect(csvCell('linha\nnova')).toBe('"linha\nnova"');
    expect(csvCell('Unimed "Centro"')).toBe('"Unimed ""Centro"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Operadora Comum')).toBe('Operadora Comum');
  });

  it('valores em reais com vírgula e sem perder centavo, inclusive negativos', () => {
    expect([csvMoney(0), csvMoney(5), csvMoney(12_345), csvMoney(-150)]).toEqual(['0,00', '0,05', '123,45', '-1,50']);
  });

  it('BOM, cabeçalho, uma linha por guia, CRLF; sem dado de paciente', () => {
    const csv = reportCsv({ today: '2026-11-18', lines: [line({ insurerName: '=cmd|calc', guideType: 'sp_sadt' })] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('Operadora;Tipo de guia;Guia;')).toBe(true);
    const rows = csv.slice(1).split('\r\n');
    expect(rows).toHaveLength(3); // cabeçalho, uma guia, linha final vazia
    expect(rows[1]).toBe("'=cmd|calc;SP/SADT;1;sent;L1;2026-10-01;;100,00;0,00;0,00;0,00;100,00;48");
    expect(csv).not.toMatch(/paciente|carteirinha|cpf/iu);
  });
});

describe('agregação por operadora', () => {
  it('soma a conta da guia, taxa de glosa, prazo médio só de quem recebeu, atraso e idade do pendente', () => {
    const today = '2026-11-18';
    const lines = [
      // paga integral 20 dias depois do envio
      line({ guideId: 'a', sentOn: '2026-10-01', lastPaidOn: '2026-10-21', paidCents: 10_000, pendingCents: 0 }),
      // parcial: recebeu 6.000 em 40 dias, glosa definitiva 1.000, pendente 3.000 (48 dias de idade)
      line({ guideId: 'b', sentOn: '2026-10-01', lastPaidOn: '2026-11-10', paidCents: 6_000, glossDefinitiveCents: 1_000, pendingCents: 3_000 }),
      // nada recebido, enviada há 8 dias, glosa em aberto (não é perda)
      line({ guideId: 'c', sentOn: '2026-11-10', glossOpenCents: 2_000, pendingCents: 10_000 }),
      // outra operadora, pendente há 100 dias
      line({ guideId: 'd', insurerId: 'i2', insurerName: 'Operadora Dois', sentOn: '2026-08-10', billedCents: 5_000, pendingCents: 5_000 }),
    ];
    const r = aggregateReport(lines, today);
    const [um, dois] = r.insurers;
    expect(um).toMatchObject({
      insurerId: 'i1', guides: 3, billedCents: 30_000, paidCents: 16_000, glossOpenCents: 2_000, glossDefinitiveCents: 1_000,
      pendingCents: 13_000, glossRateBps: 333, averageDaysToPay: 30, overdueCents: 3_000,
      aging: { upTo30: 10_000, d31to60: 3_000, d61to90: 0, over90: 0 },
    });
    // faturado = recebido + glosa definitiva + pendente (a regra da conta da guia)
    expect(um!.billedCents).toBe(um!.paidCents + um!.glossDefinitiveCents + um!.pendingCents);
    expect(dois).toMatchObject({ guides: 1, glossRateBps: 0, averageDaysToPay: null, overdueCents: 5_000, aging: { over90: 5_000 } });
    expect(r.total).toMatchObject({ guides: 4, billedCents: 35_000, paidCents: 16_000, pendingCents: 18_000, overdueCents: 8_000, averageDaysToPay: 30 });
  });

  it('sem linhas: totais zerados, taxa e prazo indefinidos', () => {
    expect(aggregateReport([], '2026-11-18')).toEqual({
      insurers: [],
      total: expect.objectContaining({ guides: 0, billedCents: 0, glossRateBps: null, averageDaysToPay: null }),
    });
  });
});

describe('filtro', () => {
  it('período invertido, maior que 366 dias, data malformada e operadora inválida são recusados', () => {
    expect(ReportFilter.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success).toBe(false);
    expect(ReportFilter.safeParse({ from: '2025-01-01', to: '2026-11-01' }).success).toBe(false);
    expect(ReportFilter.safeParse({ from: '01/11/2026', to: '2026-11-10' }).success).toBe(false);
    expect(ReportFilter.safeParse({ from: '2026-11-01', to: '2026-11-10', insurerId: 'x' }).success).toBe(false);
    expect(ReportFilter.parse({ from: '2026-01-01', to: '2026-11-18' })).toEqual({ from: '2026-01-01', to: '2026-11-18', insurerId: null });
  });
});
