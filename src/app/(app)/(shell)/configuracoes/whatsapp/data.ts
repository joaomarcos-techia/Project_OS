import 'server-only';

import { sql } from 'drizzle-orm';

import {
  checkClinicChannelHealth,
  describeChannelHealthReason,
  type ChannelHealthVerdict,
} from '@/contexts/messaging';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { maskPhone } from '@/lib/format';

/**
 * Status da conexão WhatsApp da clínica para a tela /configuracoes/whatsapp.
 * Leitura tenant-scoped via withTenant (RLS): `authenticated` LÊ as colunas não
 * sensíveis do próprio tenant (NUNCA `token_encrypted` — grant service_role-only).
 */
export interface WhatsappHealthDTO {
  verdict: ChannelHealthVerdict;
  /** Frases prontas para o operador — sem WABA id, app id, token ou corpo Graph. */
  messages: string[];
}

export interface WhatsappStatusDTO {
  connected: boolean;
  /** Existe número ativo, independentemente de o canal estar operante. */
  hasActiveNumber: boolean;
  /**
   * META-001 — número ativo cujo canal a Meta NÃO consegue entregar. É o estado
   * que o pentest encontrou exibido como "conectado".
   */
  degraded: boolean;
  phoneNumberMasked: string | null;
  connectionStatus: string | null;
  /** ISO string ou null. */
  verifiedAt: string | null;
  health: WhatsappHealthDTO;
}

const UNKNOWN_HEALTH: WhatsappHealthDTO = { verdict: 'indeterminate', messages: [] };

export async function getClinicWhatsappStatus(
  clinicId: string,
  health: WhatsappHealthDTO = UNKNOWN_HEALTH,
): Promise<WhatsappStatusDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`
      SELECT phone_number, active, connection_status, verified_at
      FROM clinic_whatsapp_numbers
      WHERE active = true
      LIMIT 1`),
  )) as unknown as Array<{
    phone_number: string;
    active: boolean;
    connection_status: string;
    verified_at: string | null;
  }>;
  const r = rows[0];
  if (!r) {
    return {
      connected: false,
      hasActiveNumber: false,
      degraded: false,
      phoneNumberMasked: null,
      connectionStatus: null,
      verifiedAt: null,
      health: UNKNOWN_HEALTH,
    };
  }
  const connected = r.active && r.connection_status === 'connected';
  return {
    connected,
    hasActiveNumber: r.active,
    // Sem `hasActiveNumber` a tela cairia no estado "nunca conectado" e
    // ofereceria um signup novo, escondendo que existe uma conexão quebrada.
    degraded: r.active && !connected,
    phoneNumberMasked: maskPhone(r.phone_number),
    connectionStatus: r.connection_status,
    verifiedAt: r.verified_at,
    health,
  };
}

/**
 * Açúcar p/ a page: resolve o tenant, VERIFICA o canal na Meta e devolve o
 * status já reconciliado.
 *
 * META-001 — a verificação precede a leitura de propósito. Antes, a tela lia um
 * booleano do banco que ninguém revalidava; a WABA podia estar sem app inscrito
 * há dias e a página continuaria dizendo "Ativo". Rodar a sonda aqui custa
 * alguns GETs read-only numa tela administrativa de baixo tráfego, e é o único
 * jeito de o que está escrito na tela ter relação com a realidade.
 */
export async function loadWhatsappStatus(): Promise<WhatsappStatusDTO> {
  const clinicId = await requireClinicId();
  const user = await requireUser();
  const health = await checkClinicChannelHealth(clinicId, user.userId);
  return getClinicWhatsappStatus(clinicId, {
    verdict: health.verdict,
    messages: health.reasons.map(describeChannelHealthReason),
  });
}
