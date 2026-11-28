/**
 * D-5, fase 1 — VIA DE ATENDIMENTO da guia (assinatura do paciente na recepção), a partir da MESMA
 * view do PDF oficial (portanto do mesmo snapshot emitido). Puro: entrada → view sem o que é de
 * faturamento ou clínico.
 *
 * Sai da via:
 *  - VALORES: Consulta 22; SP/SADT 59–65 (totais) e, por item, valor unitário, valor total e o
 *    fator de redução/acréscimo (multiplicador de preço);
 *  - INDICAÇÃO CLÍNICA: SP/SADT 23;
 *  - OBSERVAÇÃO/JUSTIFICATIVA (Consulta 23, SP/SADT 58): texto livre que costuma levar
 *    justificativa clínica; a via não precisa dele;
 *  - NÚMERO DA CARTEIRINHA (Consulta 4, SP/SADT 8): MASCARADO por padrão (só os 4 últimos).
 *    Completo só com `card: 'full'`, se o fundador decidir que a operadora exige no papel (§10.2).
 *
 * Fica: identificação da guia, beneficiário (nome), contratado e profissional, procedimento,
 * data, quantidade (o que o paciente atesta ao assinar) e os campos de assinatura (manuais).
 *
 * Fase 1 = documento a mais, sem rota nem botão: ninguém ganha nem perde acesso (§10.2).
 */
import { GuidePrintError } from './print-data';
import type { GuidePrintView } from './values';

const VALUE_FIELDS: Record<GuidePrintView['kind'], readonly number[]> = {
  consulta: [22],
  sp_sadt_cobranca: [59, 60, 61, 62, 63, 64, 65],
  sp_sadt_solicitacao: [59, 60, 61, 62, 63, 64, 65],
};
const CLINICAL_OR_FREE_TEXT: Record<GuidePrintView['kind'], readonly number[]> = {
  consulta: [23],
  sp_sadt_cobranca: [23, 58],
  sp_sadt_solicitacao: [23, 58],
};
const CARD_FIELD: Record<GuidePrintView['kind'], number> = { consulta: 4, sp_sadt_cobranca: 8, sp_sadt_solicitacao: 8 };

export interface AttendanceCopyOptions {
  /** Padrão `masked` (minimização). `full` só por decisão registrada (D-5, campos da via). */
  card?: 'masked' | 'full';
}

/** `12345678901234567` → `*************4567` (mesmo comprimento; curto demais = tudo mascarado). */
export function maskCardNumber(card: string): string {
  const c = card.trim();
  if (!c) return '';
  if (c.length <= 4) return '*'.repeat(c.length);
  return `${'*'.repeat(c.length - 4)}${c.slice(-4)}`;
}

export function attendanceCopyView(view: GuidePrintView, opts: AttendanceCopyOptions = {}): GuidePrintView {
  const fields: Record<number, string> = { ...view.fields };
  for (const f of [...VALUE_FIELDS[view.kind], ...CLINICAL_OR_FREE_TEXT[view.kind]]) {
    if (f in fields) fields[f] = '';
  }
  const card = CARD_FIELD[view.kind];
  if ((opts.card ?? 'masked') === 'masked' && fields[card]) fields[card] = maskCardNumber(fields[card]);
  const copy: GuidePrintView = {
    ...view,
    fields,
    executed: view.executed.map((row) => ({ ...row, valorUnitario: '', valorTotal: '', fator: '' })),
    requested: view.requested.map((row) => ({ ...row })),
    team: view.team.map((row) => ({ ...row })),
  };
  assertAttendanceCopy(copy);
  return copy;
}

/** Defesa em profundidade: a via NUNCA sai com valor, fator ou indicação clínica preenchidos. */
export function assertAttendanceCopy(view: GuidePrintView): void {
  for (const f of [...VALUE_FIELDS[view.kind], ...CLINICAL_OR_FREE_TEXT[view.kind]]) {
    if (view.fields[f]) throw new GuidePrintError(`via de atendimento com o campo ${f} preenchido`);
  }
  if (view.executed.some((r) => r.valorUnitario || r.valorTotal || r.fator)) {
    throw new GuidePrintError('via de atendimento com valor de item preenchido');
  }
}
