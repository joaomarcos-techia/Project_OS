/**
 * Constantes das telas de Convênios usadas por Server Components E por componentes de cliente.
 * Ficam FORA dos módulos `'use client'`: um valor importado de módulo cliente chega ao servidor
 * como referência de cliente (não como o array/objeto), e `CARE_TYPES.find(...)` na página de
 * detalhe da solicitação derrubava a renderização com 500 no Preview (achado do E2E, 12/11).
 */

/** Tabela 50 (tipo de atendimento) — os usados pela solicitação SP/SADT. */
export const CARE_TYPES: ReadonlyArray<[string, string]> = [
  ['03', 'Outras terapias'],
  ['05', 'Exame ambulatorial'],
  ['04', 'Consulta'],
  ['13', 'Pequeno atendimento'],
  ['02', 'Pequena cirurgia'],
  ['06', 'Atendimento domiciliar'],
];

/** Política de elegibilidade do repasse de convênio (D16). */
export const ELIGIBILITY_LABELS: Record<string, string> = {
  on_receipt: 'No recebimento (sobre o que a operadora pagou)',
  on_approval: 'Na aprovação da guia (faturado menos glosa definitiva)',
  on_completion: 'Na conclusão (antecipa sobre o contratado)',
};

/** Ação que falhou sem resposta e a sessão não existe mais (o runner de `action-ui.tsx` leva ao login). */
export const SESSION_ENDED_MESSAGE = 'Sua sessão terminou. Entre de novo para continuar.';
/** Ação que falhou sem resposta com a sessão de pé: nunca afirmar sucesso nem fracasso. */
export const UNCONFIRMED_MESSAGE =
  'Não foi possível confirmar com o servidor se a operação foi registrada. Atualize a página para ver a situação mais recente antes de tentar de novo.';
