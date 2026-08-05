import 'server-only';

import { eq } from 'drizzle-orm';
import { revalidateTag, unstable_cache } from 'next/cache';

import { decryptForTenant } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';

import { clinics } from './schema';
import type { ClinicProfile } from './types';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const CLINIC_SETTINGS_CACHE_KEY = 'clinic-settings';

export interface ClinicSettings {
  name: string;
  timezone: string;
}

function clinicSettingsTag(clinicId: string): string {
  return `${CLINIC_SETTINGS_CACHE_KEY}:${clinicId}`;
}

async function readClinicSettings(clinicId: string): Promise<ClinicSettings> {
  return withTenant(clinicId, async (tx) => {
    const [clinic] = await tx
      .select({ nome: clinics.nome, timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    return {
      name: clinic?.nome?.trim() || 'Qoro',
      timezone: clinic?.timezone ?? DEFAULT_TIMEZONE,
    };
  });
}

/**
 * Dados estáveis da clínica usados em cada request tenant.
 *
 * A chave e a tag incluem o tenant, portanto nunca há compartilhamento entre
 * clínicas. Escritas do perfil invalidam a tag somente depois do commit.
 */
export async function getClinicSettings(clinicId: string): Promise<ClinicSettings> {
  return unstable_cache(() => readClinicSettings(clinicId), [CLINIC_SETTINGS_CACHE_KEY, clinicId], {
    revalidate: false,
    tags: [clinicSettingsTag(clinicId)],
  })();
}

export async function getClinicTimezone(clinicId: string): Promise<string> {
  return (await getClinicSettings(clinicId)).timezone;
}

export function revalidateClinicSettings(clinicId: string): void {
  revalidateTag(clinicSettingsTag(clinicId));
}

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
        cnpjEncrypted: clinics.cnpjEncrypted,
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
          // A8: decifra p/ o form de perfil (salt = clinicId).
          cnpj: r.cnpjEncrypted ? await decryptForTenant(clinicId, r.cnpjEncrypted) : null,
          cnes: r.cnes ?? null,
          logoUrl: r.logoUrl ?? null,
        }
      : null;
  });
}
