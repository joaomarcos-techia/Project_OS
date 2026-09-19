/**
 * D30 — cópia versionada dos eventos que o webhook de ASSINATURA deve assinar.
 *
 * Este é o webhook que governa o acesso ao produto: ele decide se a clínica está
 * paga, vencida ou estornada. A configuração vive no painel do Asaas, feita à
 * mão, e o achado original era exatamente esse — a única cópia da lista estava
 * num painel de terceiro. Painel de terceiro não é memória: se alguém refizer o
 * webhook, precisa de uma fonte para conferir, e ela é esta.
 *
 * NÃO confundir com o webhook de cobrança de PACIENTE, cuja lista vive em
 * `contexts/payments/actions.ts` e tem outro propósito (sinal/restante). Os dois
 * apontam para rotas diferentes e assinam eventos diferentes.
 *
 * Isto **documenta**, não configura: o Asaas não expõe criação deste webhook
 * pelo mesmo caminho do webhook por tenant. O que o repositório garante é que a
 * lista não se perca e que o runbook não divirja dela — há teste para isso.
 *
 * O porquê de cada evento está em `docs/runbooks/asaas-webhook-assinatura.md`;
 * aqui fica só o resumo, para quem lê o código não precisar abrir a doc.
 */
export const SUBSCRIPTION_WEBHOOK_EVENTS = [
  /** Materializa a fatura do ciclo em `invoices`. */
  'PAYMENT_CREATED',
  /** Pago por cartão — confirma antes de liquidar. */
  'PAYMENT_CONFIRMED',
  /** Pago por PIX/boleto. */
  'PAYMENT_RECEIVED',
  /** Move a régua de dunning. */
  'PAYMENT_OVERDUE',
  /** Estorno. */
  'PAYMENT_REFUNDED',
  /** Cobrança removida no painel → a fatura é cancelada. */
  'PAYMENT_DELETED',
  /**
   * Cobrança restaurada. Não é opcional: sem ele o cancelamento vira porta de
   * mão única e a inconsistência é permanente (D54/D55).
   */
  'PAYMENT_RESTORED',
] as const;

export type SubscriptionWebhookEvent = (typeof SUBSCRIPTION_WEBHOOK_EVENTS)[number];
