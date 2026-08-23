import 'server-only';

import { billingApiV1 } from '@/contexts/billing';
import { listFactors } from '@/lib/auth/mfa';
import { shouldPromptMFAEnroll } from '@/lib/auth/policies';
import type { Role } from '@/lib/auth/roles';
import { createServerClient } from '@/lib/auth/supabase-server';
import { requireClinicId } from '@/lib/auth/tenant-context';

import {
  accountSecurityStatus,
  channelStatus,
  subscriptionStatus,
  type SettingsStatus,
} from './settings-status';
import { getClinicWhatsappStatus } from './whatsapp/data';

/**
 * Status reais das configurações, indexados pela rota que os exibe.
 *
 * Três regras governam este módulo:
 *
 * 1. **Só lê o que a pessoa pode ver.** A consulta é feita a partir dos hrefs
 *    que sobreviveram ao filtro de permissão — quem não administra a clínica
 *    não dispara a leitura da conexão nem da assinatura.
 * 2. **Nunca derruba o hub.** Cada leitura é isolada em `allSettled`: uma falha
 *    de rede na Supabase ou um schema de billing ausente remove o badge, não a
 *    página inteira.
 * 3. **Nunca inventa.** Sem dado, sem status. Não há default otimista.
 *
 * Leituras de banco, sem sondagem externa: a verificação do canal na Meta
 * (META-001) custa GETs no Graph e continua sendo responsabilidade da tela de
 * detalhe, que é onde o operador vai agir sobre o resultado.
 */
export type SettingsStatusMap = Record<string, SettingsStatus>;

const WHATSAPP_HREF = '/configuracoes/whatsapp';
const ASSINATURA_HREF = '/configuracoes/assinatura';
const SEGURANCA_HREF = '/account/security';

export async function loadSettingsStatuses(
  visibleHrefs: ReadonlySet<string>,
  role: Role,
): Promise<SettingsStatusMap> {
  const needsClinic = visibleHrefs.has(WHATSAPP_HREF) || visibleHrefs.has(ASSINATURA_HREF);
  const clinicId = needsClinic ? await resolveClinicId() : null;

  const tasks: Array<[string, () => Promise<SettingsStatus | null>]> = [];

  if (clinicId && visibleHrefs.has(WHATSAPP_HREF)) {
    tasks.push([WHATSAPP_HREF, async () => channelStatus(await getClinicWhatsappStatus(clinicId))]);
  }
  if (clinicId && visibleHrefs.has(ASSINATURA_HREF)) {
    tasks.push([
      ASSINATURA_HREF,
      async () => {
        const subscription = await billingApiV1.getSubscription(clinicId);
        return subscriptionStatus(subscription?.billingStatus ?? null);
      },
    ]);
  }
  if (visibleHrefs.has(SEGURANCA_HREF)) {
    tasks.push([
      SEGURANCA_HREF,
      async () => {
        const supabase = await createServerClient();
        const factors = await listFactors(supabase);
        const enrolled = factors.some((factor) => factor.status === 'verified');
        return accountSecurityStatus({
          enrolled,
          recommended: shouldPromptMFAEnroll(role, null),
        });
      },
    ]);
  }

  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const statuses: SettingsStatusMap = {};
  settled.forEach((result, index) => {
    const href = tasks[index]![0];
    if (result.status === 'rejected') {
      console.error(`[configuracoes] status indisponível para ${href}:`, result.reason);
      return;
    }
    if (result.value) statuses[href] = result.value;
  });
  return statuses;
}

/**
 * Sessão sem clínica resolvida (super_admin fora de impersonate) não é erro do
 * hub — é ausência de tenant. Os status de clínica somem; a página continua.
 */
async function resolveClinicId(): Promise<string | null> {
  try {
    return await requireClinicId();
  } catch {
    return null;
  }
}
