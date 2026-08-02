'use server';

/**
 * Tenancy Server Actions (tenant-facing). Hoje: editar o PERFIL da clínica
 * (dados do documento + logo/cor do PDF — ADR-028). Pipeline: requireUser →
 * requireFreshPermission(manage:settings) → Zod → core (dbAdmin + audit). O
 * clinicId vem do request (NUNCA do input) — ver profile-core (S5).
 */
import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import {
  CLINIC_LOGO_MAX_BYTES,
  CLINIC_LOGO_MAX_LABEL,
  CLINIC_LOGO_MIME,
  uploadClinicLogoFile,
} from '@/lib/storage/clinic-assets';

import { updateClinicProfileCore } from './internal/profile-core';
import { revalidateClinicSettings } from './queries';
import { ClinicProfileSchema, type ClinicProfileInput } from './types';

export async function updateClinicProfile(
  input: ClinicProfileInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
    const clinicId = await requireClinicId();
    const data = ClinicProfileSchema.parse(input);
    const ctx = buildRequestContext(await headers());
    await updateClinicProfileCore(clinicId, user.userId, data, ctx);
    revalidateClinicSettings(clinicId);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Erro ao salvar.' };
  }
}

/**
 * Upload do logo (white-label do PDF). Gated por manage:settings; clinicId do
 * REQUEST (namespaceia o objeto). Valida MIME (png/jpeg/webp) + tamanho (≤512 KB)
 * server-side. Só HOSPEDA o arquivo e devolve a URL pública — a persistência em
 * clinics.logo_url ocorre no Salvar (updateClinicProfile), via o caminho seguro.
 */
export async function uploadClinicLogo(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
    const clinicId = await requireClinicId();

    const file = formData.get('file');
    if (!(file instanceof File)) return { ok: false, message: 'Arquivo inválido.' };
    const ext = CLINIC_LOGO_MIME[file.type];
    if (!ext) return { ok: false, message: 'Formato inválido. Use PNG, JPG ou WEBP.' };
    if (file.size > CLINIC_LOGO_MAX_BYTES) {
      return { ok: false, message: `Imagem muito grande (máx. ${CLINIC_LOGO_MAX_LABEL}).` };
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const url = await uploadClinicLogoFile(clinicId, bytes, file.type, ext);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Erro no upload.' };
  }
}
