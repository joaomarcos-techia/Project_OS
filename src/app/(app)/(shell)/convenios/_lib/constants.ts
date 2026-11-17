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

/** Texto do alerta da autorização (P6.6), sem dado pessoal. `validUntil` em AAAA-MM-DD. */
export function authorizationAlertText(
  a:
    | { kind: 'password_expiring'; daysLeft: number; validUntil: string }
    | { kind: 'sessions_ending'; remaining: number; authorized: number },
): string {
  if (a.kind === 'password_expiring') {
    const [y, m, d] = a.validUntil.split('-');
    const when = `${d}/${m}/${y}`;
    if (a.daysLeft === 0) return `Senha vence hoje (${when})`;
    return a.daysLeft === 1 ? `Senha vence amanhã (${when})` : `Senha vence em ${a.daysLeft} dias (${when})`;
  }
  return a.remaining === 1
    ? `Resta 1 sessão autorizada de ${a.authorized}`
    : `Restam ${a.remaining} sessões autorizadas de ${a.authorized}`;
}

/** Ação que falhou sem resposta e a sessão não existe mais (o runner de `action-ui.tsx` leva ao login). */
export const SESSION_ENDED_MESSAGE = 'Sua sessão terminou. Entre de novo para continuar.';
/** Ação que falhou sem resposta com a sessão de pé: nunca afirmar sucesso nem fracasso. */
export const UNCONFIRMED_MESSAGE =
  'Não foi possível confirmar com o servidor se a operação foi registrada. Atualize a página para ver a situação mais recente antes de tentar de novo.';

/** P7.5: canal do pedido de cancelamento à operadora. */
export const CANCELLATION_CHANNEL_LABELS: Record<string, string> = {
  portal: 'Portal da operadora',
  webservice: 'Serviço eletrônico',
  email: 'E-mail',
  phone: 'Telefone',
  other: 'Outro canal',
};

/** P7.5: situação do pedido de cancelamento (a partir do recibo da operadora). */
export const CANCELLATION_STATUS_LABELS: Record<string, string> = {
  awaiting_receipt: 'Aguardando a operadora',
  confirmed: 'Cancelada pela operadora',
  refused: 'Não cancelada pela operadora',
  divergent: 'Divergência com a operadora',
};

/** Tabela 46 da TUSS (dm_statusCancelamento), versão 202609. */
export const TABLE_46_LABELS: Record<string, string> = {
  '1': '1 · Cancelado com sucesso',
  '2': '2 · Não cancelado',
  '3': '3 · Guia inexistente',
  '4': '4 · Em processamento',
  '5': '5 · Lote inexistente',
  '6': '6 · Protocolo inexistente',
};

/** P6.6: texto do aviso enviado à clínica (só datas e contagens; nenhum dado de paciente). */
export function sentAlertText(a: { kind: string; detail: Record<string, string | number> }): string {
  const br = (iso: unknown) => {
    const [y, m, d] = String(iso ?? '').split('-');
    return y && m && d ? `${d}/${m}/${y}` : 'data não informada';
  };
  switch (a.kind) {
    case 'password_expiring':
      return authorizationAlertText({ kind: 'password_expiring', daysLeft: Number(a.detail.daysLeft ?? 0), validUntil: String(a.detail.validUntil ?? '') });
    case 'sessions_ending':
      return authorizationAlertText({ kind: 'sessions_ending', remaining: Number(a.detail.remaining ?? 0), authorized: Number(a.detail.authorized ?? 0) });
    case 'password_expired':
      return `Senha vencida em ${br(a.detail.validUntil)}`;
    case 'operator_overdue':
      return `Pedido parado na operadora há ${Number(a.detail.days ?? 0)} dias (pedido em ${br(a.detail.requestedOn)})`;
    default:
      return 'Aviso de autorização';
  }
}
