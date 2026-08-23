import type { VariantProps } from 'class-variance-authority';

import type { badgeVariants } from '@/components/ui/badge';

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Status pronto para exibição — tom do DS + rótulo curto. */
export interface SettingsStatus {
  tone: Tone;
  label: string;
}

/**
 * Tradução domínio → (tom, rótulo) do hub de configurações.
 *
 * Vive aqui, e não em `ui/status-badge.tsx`, porque é uma leitura
 * DELIBERADAMENTE mais grossa do que a das telas de detalhe: o hub responde
 * "preciso olhar isso?" em uma palavra, enquanto `/configuracoes/whatsapp`
 * distingue verificação pendente de canal mudo e a assinatura mostra plano,
 * limites e cobrança pendente. Promover este mapa ao DS criaria duas fontes de
 * verdade para o mesmo estado; deixá-lo ao lado do hub mantém uma só.
 *
 * Nada aqui inventa estado: cada função recebe um valor realmente persistido e
 * devolve `null` quando o dado não existe — a linha simplesmente não mostra
 * status.
 */

/** Espelha `clinic_whatsapp_numbers.connection_status` + `active`. */
export function channelStatus(input: {
  connected: boolean;
  degraded: boolean;
  hasActiveNumber: boolean;
}): SettingsStatus {
  if (input.connected) return { tone: 'green', label: 'Conectado' };
  // META-001: número ativo cujo canal não entrega. A tela de detalhe chama a
  // Meta para saber POR QUÊ; o hub só reporta que existe algo quebrado — e não
  // finge saúde que não verificou.
  if (input.degraded) return { tone: 'red', label: 'Não está recebendo' };
  return { tone: 'gray', label: 'Não conectado' };
}

/** Espelha o enum `subscription_billing_status` (C13). */
export type SubscriptionBillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled';

const SUBSCRIPTION: Record<SubscriptionBillingStatus, SettingsStatus> = {
  trial: { tone: 'blue', label: 'Em teste' },
  active: { tone: 'green', label: 'Ativa' },
  past_due: { tone: 'amber', label: 'Pagamento pendente' },
  cancelled: { tone: 'gray', label: 'Cancelada' },
};

export function subscriptionStatus(
  status: SubscriptionBillingStatus | null,
): SettingsStatus | null {
  return status ? SUBSCRIPTION[status] : null;
}

/**
 * 2FA da conta. `recommended` sai de `shouldPromptMFAEnroll` (ADR-038): gestor e
 * financial recebem opt-in forte, ninguém além de super_admin é obrigado.
 */
export function accountSecurityStatus(input: {
  enrolled: boolean;
  recommended: boolean;
}): SettingsStatus {
  if (input.enrolled) return { tone: 'green', label: '2FA ativo' };
  if (input.recommended) return { tone: 'amber', label: '2FA recomendado' };
  return { tone: 'gray', label: '2FA inativo' };
}
