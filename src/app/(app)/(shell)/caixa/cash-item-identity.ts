import type { CaixaItem } from '@/contexts/financial/types';

type Identificavel = Pick<
  CaixaItem,
  'tipo' | 'descricao' | 'pacienteNome' | 'snapshotProcedureName'
>;

export const SEM_PACIENTE = 'Sem paciente vinculado';

/**
 * UX-015 — o que identifica um lançamento na fila do Caixa.
 *
 * Título: o paciente, quando o lançamento tem um; senão, a descrição dele (o que
 * ele é — obrigatória no banco). Antes, sem paciente, o título era a própria
 * ausência ("Sem paciente vinculado") e a descrição ia para a linha de baixo,
 * cortada. A ausência agora é complemento (`cashItemDetail`).
 *
 * Nada aqui associa paciente a lançamento: só se mostra o que ele já tem.
 */
export function cashItemTitle(item: Identificavel): string {
  if (item.tipo === 'pagar') return item.descricao;
  return item.pacienteNome ?? item.descricao;
}

/** Linha de apoio do título: o procedimento, ou "Sem paciente vinculado" quando falta. */
export function cashItemDetail(item: Identificavel): string {
  if (item.tipo === 'pagar') return 'Conta a pagar';
  if (item.pacienteNome) return item.snapshotProcedureName ?? item.descricao;
  return item.snapshotProcedureName && item.snapshotProcedureName !== item.descricao
    ? `${item.snapshotProcedureName} · ${SEM_PACIENTE}`
    : SEM_PACIENTE;
}
