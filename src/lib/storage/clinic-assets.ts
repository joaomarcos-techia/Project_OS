/**
 * Supabase Storage — assets de marca da clínica (logo do white-label do PDF).
 *
 * Bucket `clinic-logos` é PÚBLICO: logo é marca, não PII, e o @react-pdf busca a
 * URL no render server-side — público dá URL estável sem signed URL por render.
 * Criar via `pnpm seed:logo-bucket` (dev) ou Dashboard (prod). Upload só por
 * Server Action gated (manage:settings); o objeto é namespaced por clinicId.
 *
 * Server-only.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

import { uploadStorageFile } from './clinical';

export const CLINIC_LOGO_BUCKET = 'clinic-logos';
export const CLINIC_LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — cabe foto de celular.
export const CLINIC_LOGO_MAX_LABEL = '5 MB';

/** MIME aceitos → extensão. SVG fica de fora (script-injection + suporte fraco no @react-pdf). */
export const CLINIC_LOGO_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Sobe o logo (upsert no mesmo path por clínica) e devolve a URL pública com
 * cache-bust (`?v`), já que o upsert reescreve o mesmo objeto.
 */
export async function uploadClinicLogoFile(
  clinicId: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
  ext: string,
): Promise<string> {
  const path = `${clinicId}/logo.${ext}`;
  await uploadStorageFile(CLINIC_LOGO_BUCKET, path, bytes, contentType);
  const sb = createAdminClient();
  const { data } = sb.storage.from(CLINIC_LOGO_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
