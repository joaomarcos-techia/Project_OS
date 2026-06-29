import 'server-only';

import { eq } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { clinics } from './schema';
import type { ClinicProfile } from './types';

/**
 * Perfil da clínica (leitura). SELECT em `clinics` é tenant-aware por RLS
 * (id = current_clinic), então withTenant basta. A ESCRITA mora no core via
 * dbAdmin (S5 — UPDATE de clinics é super_admin via RLS).
 */
export async function getClinicProfile(clinicId: string): Promise<ClinicProfile | null> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({
        nome: clinics.nome,
        endereco: clinics.endereco,
        telefone: clinics.telefone,
        cnpj: clinics.cnpj,
        cnes: clinics.cnes,
        logoUrl: clinics.logoUrl,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    return r
      ? {
          nome: r.nome,
          endereco: r.endereco ?? null,
          telefone: r.telefone ?? null,
          cnpj: r.cnpj ?? null,
          cnes: r.cnes ?? null,
          logoUrl: r.logoUrl ?? null,
        }
      : null;
  });
}
