/** Código do catálogo financeiro para o método comercial escolhido no atendimento. */
export type CommercialPaymentMethod = 'pix' | 'cash' | 'credit_card';

const PAYMENT_METHOD_CODES = {
  pix: 'pix',
  cash: 'dinheiro',
  credit_card: 'cartao_credito',
} as const;

export function catalogPaymentMethodForCommercial(method: string | null): string | null {
  if (method === 'pix') return PAYMENT_METHOD_CODES.pix;
  if (method === 'cash') return PAYMENT_METHOD_CODES.cash;
  if (method === 'credit_card') return PAYMENT_METHOD_CODES.credit_card;
  return null;
}
