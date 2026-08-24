import 'server-only';

import { billingApiV1 } from '@/contexts/billing';
import { requireClinicId } from '@/lib/auth/tenant-context';

import {
  channelStatus,
  subscriptionStatus,
  type SettingsStatus,
  type SubscriptionBillingStatus,
} from './settings-status';
import { getClinicWhatsappStatus } from './whatsapp/data';

/**
 * Status do canal para o card de WhatsApp.
 *
 * Leitura de banco, sem sondagem externa: a verificação do canal na Meta
 * (META-001) custa GETs no Graph e continua sendo responsabilidade da tela de
 * detalhe, que é onde o operador vai agir sobre o resultado.
 *
 * Falha não derruba a categoria — sem status o card simplesmente não mostra
 * selo. Uma indisponibilidade de banco não pode esconder as outras
 * configurações da aba.
 */
export async function loadChannelStatuses(): Promise<Record<string, SettingsStatus>> {
  try {
    const clinicId = await requireClinicId();
    const status = await getClinicWhatsappStatus(clinicId);
    return { '/configuracoes/whatsapp': channelStatus(status) };
  } catch (error) {
    console.error('[configuracoes] status do canal indisponível:', error);
    return {};
  }
}

/**
 * Status dos cards da categoria Gestão. Hoje só a Assinatura reporta estado — a
 * situação de cobrança do Qoro (`subscriptions.billing_status`, C13). Clínica
 * sem assinatura provisionada devolve `null` do mapeamento e o card fica sem
 * selo; nenhuma falha aqui pode esconder Equipe e Financeiro da aba.
 */
export async function loadGestaoStatuses(): Promise<Record<string, SettingsStatus>> {
  try {
    const clinicId = await requireClinicId();
    const subscription = await billingApiV1.getSubscription(clinicId);
    const status = subscriptionStatus(
      (subscription?.billingStatus as SubscriptionBillingStatus) ?? null,
    );
    return status ? { '/configuracoes/assinatura': status } : {};
  } catch (error) {
    console.error('[configuracoes] status da assinatura indisponível:', error);
    return {};
  }
}
