import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./guide-access', () => ({ readGuideContentAudited: m.read }));

import { consultaGuide, SYNTHETIC } from '../tiss/corpus/fixtures';
import { GUIDE_SNAPSHOT_SCHEMA } from '../tiss/guides/snapshot';
import { GuidePrintError, type GuidePrintData } from '../tiss/print/print-data';

import { renderIssuedGuideAttendanceCopyPdf, renderIssuedGuidePdf } from './guide-pdf';

const PRINT: GuidePrintData = {
  schema: 'qoro.hi.guide-print/1',
  beneficiarioNome: 'Maria José da Conceição Sintética',
  nomeSocial: null,
  contratadoNome: 'Clínica Sintética São João Ltda',
  operadoraNome: 'Operadora Sintética S.A.',
};
const SHA = 'e'.repeat(64);
const readResult = (print: GuidePrintData | null = PRINT) => ({
  guideId: 'g1',
  number: 'G0000001',
  revision: 2,
  status: 'approved',
  contentSha256: SHA,
  auditEventId: 'a1',
  content: {
    schema: GUIDE_SNAPSHOT_SCHEMA,
    guideType: 'consulta' as const,
    tissVersion: '4.03.00' as const,
    terminologyVersion: 't',
    data: consultaGuide(1),
    ...(print ? { print } : {}),
  },
});

beforeEach(() => {
  m.read.mockReset();
  m.read.mockResolvedValue(readResult());
});

describe('via de atendimento a partir da guia emitida (D-5 fase 1)', { timeout: 90_000 }, () => {
  it('lê pela leitura auditada com a operação própria (finalidade via_atendimento), do mesmo snapshot do PDF oficial', async () => {
    const copy = await renderIssuedGuideAttendanceCopyPdf({ clinicId: 'c1', guideId: 'g1', surface: 'tela_guia' });
    expect(m.read).toHaveBeenCalledWith({ clinicId: 'c1', guideId: 'g1', operation: 'guide_attendance_copy', surface: 'tela_guia' });
    expect(copy.fileName).toBe('via-atendimento-consulta-G0000001-r2.pdf');
    expect(copy.snapshotSha256).toBe(SHA);
    const full = await renderIssuedGuidePdf({ clinicId: 'c1', guideId: 'g1', surface: 'tela_guia' });
    expect(m.read.mock.calls[1]![0]).toMatchObject({ operation: 'guide_pdf' });
    expect(full.snapshotSha256).toBe(copy.snapshotSha256);
    // Conteúdo bruto do PDF: o título (metadado) muda; o arquivo não é o mesmo do oficial.
    expect(copy.pdf.equals(full.pdf)).toBe(false);
    expect(copy.pdf.toString('latin1')).not.toContain(SYNTHETIC.carteira);
  });

  it('revisão emitida sem o bloco de impressão: recusa (não lê nome do cadastro atual)', async () => {
    m.read.mockResolvedValueOnce(readResult(null));
    await expect(renderIssuedGuideAttendanceCopyPdf({ clinicId: 'c1', guideId: 'g1', surface: 'tela_guia' })).rejects.toBeInstanceOf(GuidePrintError);
  });

  it('negação da leitura auditada (permissão, outra clínica) propaga sem gerar nada', async () => {
    m.read.mockRejectedValueOnce(new Error('forbidden'));
    await expect(renderIssuedGuideAttendanceCopyPdf({ clinicId: 'c1', guideId: 'g1', surface: 'tela_guia' })).rejects.toThrow('forbidden');
  });
});
