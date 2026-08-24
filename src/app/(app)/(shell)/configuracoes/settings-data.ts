import 'server-only';

import { requireClinicId } from '@/lib/auth/tenant-context';

import { channelStatus, type SettingsStatus } from './settings-status';
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
