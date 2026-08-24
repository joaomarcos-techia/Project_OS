import type { VariantProps } from 'class-variance-authority';

import type { badgeVariants } from '@/components/ui/badge';

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Status de um card — tom do DS + rótulo curto. */
export interface SettingsStatus {
  tone: Tone;
  label: string;
}

/**
 * Espelha `clinic_whatsapp_numbers.connection_status` + `active`.
 *
 * Leitura DELIBERADAMENTE mais grossa que a da tela de detalhe: o card responde
 * "preciso olhar isso?" em uma palavra, enquanto `/configuracoes/whatsapp`
 * distingue verificação pendente de canal mudo. Nada aqui inventa estado.
 */
export function channelStatus(input: { connected: boolean; degraded: boolean }): SettingsStatus {
  if (input.connected) return { tone: 'green', label: 'Conectado' };
  // META-001: número ativo cujo canal não entrega. A tela de detalhe chama a
  // Meta para saber POR QUÊ; o card só reporta que existe algo quebrado — e não
  // finge saúde que não verificou.
  if (input.degraded) return { tone: 'red', label: 'Não está recebendo' };
  return { tone: 'gray', label: 'Não conectado' };
}

/** Espelha o enum `subscription_billing_status` (C13). */
export type SubscriptionBillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled';

const SUBSCRIPTION: Record<SubscriptionBillingStatus, SettingsStatus> = {
  trial: { tone: 'blue', label: 'Em teste' },
  active: { tone: 'green', label: 'Ativa' },
  // past_due pede ação (o pagamento do Qoro falhou) — âmbar, não vermelho: a
  // assinatura ainda não foi cortada, o ciclo de dunning está correndo.
  past_due: { tone: 'amber', label: 'Pagamento pendente' },
  cancelled: { tone: 'gray', label: 'Cancelada' },
};

/**
 * Status da assinatura do Qoro para o card de Gestão.
 *
 * `null` quando a clínica ainda não tem assinatura provisionada — o card
 * simplesmente não mostra selo, em vez de inventar um estado. A tela de detalhe
 * é quem distingue plano, limites e cobrança pendente; aqui é uma palavra.
 */
export function subscriptionStatus(
  status: SubscriptionBillingStatus | null,
): SettingsStatus | null {
  return status ? SUBSCRIPTION[status] : null;
}
