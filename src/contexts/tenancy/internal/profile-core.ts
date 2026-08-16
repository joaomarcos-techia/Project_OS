import 'server-only';

import { and, eq } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { normalizeCnpj } from '@/lib/validation/cnpj';
import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

import { clinics } from '../schema';

/**
 * DATA-005 — escrita sobre perfil OBSOLETO. Erro dedicado para a UI manter os
 * valores digitados e pedir recarregar, em vez de confirmar um salvamento que
 * foi sobrescrito.
 */
export class StaleClinicProfileError extends Error {
  readonly code = 'stale_clinic_profile';
  readonly httpStatus = 409;
  constructor() {
    super('O perfil foi alterado em outra janela. Recarregue a página e refaça a edição.');
    this.name = 'StaleClinicProfileError';
  }
}
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
  // VAL-002 — canônico (só dígitos) ANTES de cifrar e hashear. Se o hash for
  // calculado sobre a grafia, `12.345.678/0001-95` e `12345678000195` viram
  // registros distintos do mesmo documento e a deduplicação futura quebra.
  // O schema já rejeitou checksum inválido; aqui só normalizamos.
  const cnpjRaw = normalizeCnpj(norm(data.cnpj));
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

    // DATA-005 — compare-and-swap sobre a MESMA allowlist de colunas. O update
    // casava só por `clinicId`: duas abas do owner salvavam CNES diferentes,
    // as duas mostravam "Perfil salvo.", duas auditorias persistiam e um valor
    // sumia. `slug/status/timezone` continuam fora do update.
    const affected = await tx
      .update(clinics)
      .set(after)
      .where(
        data.expectedUpdatedAt
          ? and(eq(clinics.id, clinicId), eq(clinics.updatedAt, new Date(data.expectedUpdatedAt)))
          : eq(clinics.id, clinicId),
      )
      .returning({ id: clinics.id });
    // Zero linhas com versão esperada = o registro mudou entre a leitura e o
    // submit. O throw reverte a tx: o perdedor não deixa auditoria de sucesso.
    if (affected.length === 0 && data.expectedUpdatedAt) {
      throw new StaleClinicProfileError();
    }

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
