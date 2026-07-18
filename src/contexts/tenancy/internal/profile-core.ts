import 'server-only';

import { eq } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

import { clinics } from '../schema';
import type { ClinicProfileInput } from '../types';

/**
 * ESCRITA tenant-facing do perfil da clínica (S5). `clinics` tem UPDATE
 * `is_super_admin()` only por RLS (0001) — desenhado para edições do tenant
 * roteiarem por dbAdmin + audit (irmão do connection-store de mensageria). Por
 * isso este arquivo está na allowlist de dbAdmin (eslint + arch:db-check).
 *
 * Invariantes de segurança (defesa contra escalonamento/cross-tenant):
 *   - `clinicId` vem SEMPRE do request (requireClinicId/JWT) — NUNCA do input;
 *   - o `.set(...)` lista APENAS as colunas de perfil (nome/endereço/telefone/
 *     cnpj/cnes/logo) — status/plan/slug/timezone/primary_color JAMAIS são
 *     tocados (não há como o tenant mudar billing/lifecycle);
 *   - `WHERE id = clinicId` restringe à própria clínica mesmo com BYPASSRLS;
 *   - tudo audita (before/after) na MESMA tx.
 */
export async function updateClinicProfileCore(
  clinicId: string,
  userId: string,
  data: ClinicProfileInput,
  requestContext: RequestContext,
): Promise<void> {
  const norm = (v: string | undefined): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };
  // A8: CNPJ cifrado + hash. O salt HKDF é o próprio clinicId (que vem do request).
  const cnpjRaw = norm(data.cnpj);
  const after = {
    nome: data.nome.trim(),
    endereco: norm(data.endereco),
    telefone: norm(data.telefone),
    cnpjEncrypted: cnpjRaw ? await encryptForTenant(clinicId, cnpjRaw) : null,
    cnpjHash: cnpjRaw ? await hashForLookup(cnpjRaw) : null,
    cnes: norm(data.cnes),
    logoUrl: norm(data.logoUrl),
  };

  await dbAdmin.transaction(async (tx) => {
    // `before`/`after` do audit carregam o CIPHERTEXT (cnpj_encrypted) — nunca o
    // CNPJ em claro. Sem decrypt aqui: consistente e não reintroduz vazamento.
    const [before] = await tx
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
    if (!before) throw new Error('clínica não encontrada');

    await tx.update(clinics).set(after).where(eq(clinics.id, clinicId));

    await logAudit(tx, {
      clinicId,
      userId,
      action: 'tenancy.clinic.profile_updated',
      resourceType: 'clinic',
      resourceId: clinicId,
      before,
      after,
      requestContext,
    });
  });
}
