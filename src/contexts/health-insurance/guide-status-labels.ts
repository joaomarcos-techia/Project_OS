/**
 * Nome de cada etapa da guia como a tela mostra. Módulo sem dependência para servir à leitura
 * (`queries.ts`, que reexporta) e às mensagens das ações (`actions.ts`) sem puxar o banco.
 */
export const GUIDE_STATUS_LABELS: Record<string, string> = {
  pending_data: 'Falta dado',
  ready_for_review: 'Para conferir',
  reviewed: 'Conferida',
  approved: 'Aprovada',
  in_batch: 'Em lote',
  exported: 'XML gerado',
  sent: 'Enviada',
  under_review: 'Em análise',
  paid: 'Paga',
  partially_paid: 'Paga em parte',
  partially_glossed: 'Glosada em parte',
  fully_glossed: 'Glosada',
  closed: 'Conciliada',
  cancelled: 'Cancelada',
  replaced: 'Substituída',
};
