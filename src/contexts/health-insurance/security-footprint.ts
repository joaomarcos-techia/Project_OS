/**
 * S1/S3 — rastro TISS de uma clínica para o perfil de segurança: módulo ligado ou QUALQUER dado TISS guardado
 * (desligar o módulo não apaga guia nem carteirinha). Só existência: nenhum conteúdo é lido. Sessão da clínica (RLS).
 */
import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

export async function readClinicTissFootprint(
  clinicId: string,
): Promise<{ moduleEnabled: boolean; hasTissData: boolean }> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        coalesce((SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid), false) AS enabled,
        (EXISTS (SELECT 1 FROM public.hi_guides WHERE clinic_id = ${clinicId}::uuid)
          OR EXISTS (SELECT 1 FROM public.hi_memberships WHERE clinic_id = ${clinicId}::uuid)
          OR EXISTS (SELECT 1 FROM public.hi_authorizations WHERE clinic_id = ${clinicId}::uuid)
          OR EXISTS (SELECT 1 FROM public.hi_batches WHERE clinic_id = ${clinicId}::uuid)
          OR EXISTS (SELECT 1 FROM public.hi_files WHERE clinic_id = ${clinicId}::uuid)) AS has_data
    `)) as unknown as Array<{ enabled: boolean; has_data: boolean }>;
    return { moduleEnabled: rows[0]?.enabled === true, hasTissData: rows[0]?.has_data === true };
  });
}
