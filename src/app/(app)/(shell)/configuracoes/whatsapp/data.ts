import 'server-only';

import { sql } from 'drizzle-orm';

import { requireClinicId } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { maskPhone } from '@/lib/format';

/**
 * Status da conexão WhatsApp da clínica para a tela /configuracoes/whatsapp.
 * Leitura tenant-scoped via withTenant (RLS): `authenticated` LÊ as colunas não
 * sensíveis do próprio tenant (NUNCA `token_encrypted` — grant service_role-only).
 */
export interface WhatsappStatusDTO {
  connected: boolean;
  phoneNumberMasked: string | null;
  connectionStatus: string | null;
  /** ISO string ou null. */
  verifiedAt: string | null;
}

export async function getClinicWhatsappStatus(clinicId: string): Promise<WhatsappStatusDTO> {
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
    return { connected: false, phoneNumberMasked: null, connectionStatus: null, verifiedAt: null };
  }
  return {
    connected: r.active && r.connection_status === 'connected',
    phoneNumberMasked: maskPhone(r.phone_number),
    connectionStatus: r.connection_status,
    verifiedAt: r.verified_at,
  };
}

/** Açúcar p/ a page: resolve o tenant e devolve o status. */
export async function loadWhatsappStatus(): Promise<WhatsappStatusDTO> {
  const clinicId = await requireClinicId();
  return getClinicWhatsappStatus(clinicId);
}
