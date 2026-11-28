/**
 * PDF oficial da guia EMITIDA (P7.6/P8.5), gerado em memória a partir do snapshot
 * aprovado e versionado — nunca do cadastro atual do paciente, do profissional ou do
 * contrato.
 *
 * Fluxo: leitura AUDITADA do conteúdo emitido (`guide_pdf`, finalidade
 * `impressao_guia`, permissão de leitura financeira; o SHA-256 do snapshot é
 * conferido na leitura) → valores do modelo oficial (`tiss/print/values`) → PDF.
 * Snapshot emitido antes do bloco de impressão (12/11) não gera PDF: a guia é
 * reemitida, em vez de o nome do beneficiário ser lido do cadastro de hoje.
 *
 * Ler e imprimir o que já foi emitido não é operação nova: não passa pelo gate
 * comercial (D24), para que a clínica com assinatura suspensa continue tendo acesso
 * aos próprios documentos. Persistir o PDF (hi_files + armazenamento privado) e a
 * rota de download são da P12.7.
 */
import 'server-only';

import { attendanceCopyView, type AttendanceCopyOptions } from '../tiss/print/attendance-copy';
import { GuidePrintError } from '../tiss/print/print-data';
import { renderGuidePdf } from '../tiss/print/render';
import { consultaPrintView, spSadtCobrancaPrintView } from '../tiss/print/values';

import { readGuideContentAudited } from './guide-access';
import { softwareIdentity } from '@/lib/software-identity';

/** P12.11: sem a identificação passada pela rota, a do build (nunca um nome sem versão inventado). */
const defaultSoftware = () => {
  const id = softwareIdentity();
  return { vendor: id.vendor, name: id.name, version: id.version };
};

export interface IssuedGuidePdf {
  pdf: Buffer;
  fileName: string;
  guideNumber: string;
  revision: number;
  /** SHA-256 do snapshot de onde o PDF saiu. */
  snapshotSha256: string;
  pages: number;
}

export async function renderIssuedGuidePdf(args: {
  clinicId: string;
  guideId: string;
  /** Tela ou rota que pediu (auditoria). */
  surface: string;
  software?: { name: string; version: string | null; vendor?: string };
}): Promise<IssuedGuidePdf> {
  const read = await readGuideContentAudited({
    clinicId: args.clinicId,
    guideId: args.guideId,
    operation: 'guide_pdf',
    surface: args.surface,
  });
  const c = read.content;
  if (!c.print) {
    throw new GuidePrintError(
      'esta revisão foi emitida sem os dados do impresso; reemita a guia para gerar o PDF oficial',
    );
  }
  const view = c.guideType === 'consulta' ? consultaPrintView(c.data, c.print) : spSadtCobrancaPrintView(c.data, c.print);
  const { pdf, layout } = await renderGuidePdf(view, {
    guideNumber: read.number,
    revision: read.revision,
    snapshotSha256: read.contentSha256,
    software: args.software ?? defaultSoftware(),
  });
  return {
    pdf,
    fileName: `guia-${c.guideType === 'consulta' ? 'consulta' : 'sp-sadt'}-${read.number}-r${read.revision}.pdf`,
    guideNumber: read.number,
    revision: read.revision,
    snapshotSha256: read.contentSha256,
    pages: layout.pages.length + (layout.continuation.length > 0 ? 1 : 0),
  };
}

/**
 * D-5 fase 1: VIA DE ATENDIMENTO (assinatura do paciente), do MESMO snapshot emitido e pela mesma
 * leitura auditada, com a finalidade própria (`via_atendimento`). Sem valores, fator, indicação
 * clínica nem observação; carteirinha mascarada por padrão (`attendance-copy.ts`). Só em memória:
 * não grava em hi_files. Fase 2: rota `/financeiro/convenios/guias/:id/via` e botão na guia.
 */
export async function renderIssuedGuideAttendanceCopyPdf(args: {
  clinicId: string;
  guideId: string;
  surface: string;
  card?: AttendanceCopyOptions['card'];
  software?: { name: string; version: string | null; vendor?: string };
}): Promise<IssuedGuidePdf> {
  const read = await readGuideContentAudited({
    clinicId: args.clinicId,
    guideId: args.guideId,
    operation: 'guide_attendance_copy',
    surface: args.surface,
  });
  const c = read.content;
  if (!c.print) {
    throw new GuidePrintError('esta revisão foi emitida sem os dados do impresso; reemita a guia para gerar a via');
  }
  const official = c.guideType === 'consulta' ? consultaPrintView(c.data, c.print) : spSadtCobrancaPrintView(c.data, c.print);
  const view = attendanceCopyView(official, args.card ? { card: args.card } : {});
  const { pdf, layout } = await renderGuidePdf(view, {
    guideNumber: read.number,
    revision: read.revision,
    snapshotSha256: read.contentSha256,
    software: args.software ?? defaultSoftware(),
    copy: 'attendance',
  });
  return {
    pdf,
    fileName: `via-atendimento-${c.guideType === 'consulta' ? 'consulta' : 'sp-sadt'}-${read.number}-r${read.revision}.pdf`,
    guideNumber: read.number,
    revision: read.revision,
    snapshotSha256: read.contentSha256,
    pages: layout.pages.length + (layout.continuation.length > 0 ? 1 : 0),
  };
}
