/**
 * connection-store — seam PRIVILEGIADO de ESCRITA da conexão tenant (F2).
 *
 * Irmão do `number-store` (NÃO o altera): vive em `lib` + `dbAdmin` + SQL cru pela
 * MESMA razão (o guard F-01 proíbe `dbAdmin` em `src/contexts/**`; SQL cru evita
 * importar o schema Drizzle do contexto). É o único ponto onde o fluxo
 * self-service do owner escreve `clinic_whatsapp_numbers` (grant service_role-only)
 * + grava a auditoria em `audit_events` na MESMA tx ("no audit, no op").
 *
 * Diferença para o connect super_admin (`messaging/actions.ts` → superAdminAction):
 *   - ator é o OWNER (audit_events, não super_admin_actions);
 *   - upsert por (clinic_id, meta_phone_id): reconectar o MESMO número faz UPDATE
 *     in-place (sem histórico infinito); número novo desativa o anterior + INSERT.
 *   - `clinicId` vem SEMPRE de requireClinicId() no caller — nunca de input.
 *
 * O `token_encrypted` chega JÁ cifrado (encryptForTenant no contexto); aqui ele é
 * apenas persistido. NUNCA logar/retornar o token.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { dbAdmin } from '@/lib/db';
import type { Tx } from '@/lib/db';
import { maskPhone } from '@/lib/format';

import type { MessagingProviderName } from './provider';

export interface UpsertTenantConnectionInput {
  clinicId: string;
  userId: string;
  provider: MessagingProviderName;
  phoneNumber: string;
  metaPhoneId: string;
  metaBusinessId: string | null;
  /** Token JÁ cifrado (encryptForTenant) — nunca em claro aqui. */
  tokenEncrypted: string;
  requestContext: RequestContext;
}

/**
 * Conecta/reconecta o número da clínica (upsert por clinic+meta_phone_id) e
 * audita `messaging.whatsapp.connected`. Pode lançar o erro de unique parcial
 * `clinic_whatsapp_numbers_meta_phone_active_uniq` (número já ativo em OUTRA
 * clínica) — o caller traduz para um erro amigável.
 */
export async function upsertTenantConnection(
  input: UpsertTenantConnectionInput,
): Promise<{ id: string }> {
  return dbAdmin.transaction(async (tx: Tx) => {
    const existing = await tx.execute<{ id: string }>(sql`
      SELECT id FROM clinic_whatsapp_numbers
      WHERE clinic_id = ${input.clinicId} AND meta_phone_id = ${input.metaPhoneId}
      LIMIT 1
    `);
    const foundId = existing[0]?.id ?? null;

    let id: string;
    if (foundId) {
      // Reconexão do MESMO número → UPDATE in-place + reativa. Bump em
      // token_version para o sender detectar o refresh de credencial (3ª#3).
      await tx.execute(sql`
        UPDATE clinic_whatsapp_numbers SET
          token_encrypted = ${input.tokenEncrypted},
          meta_business_id = ${input.metaBusinessId},
          phone_number = ${input.phoneNumber},
          provider = ${input.provider},
          token_version = token_version + 1,
          verified_at = now(),
          active = true,
          connection_status = 'connected',
          updated_at = now()
        WHERE id = ${foundId}
      `);
      // Desativa QUALQUER outra ativa da clínica (número diferente).
      await tx.execute(sql`
        UPDATE clinic_whatsapp_numbers SET
          active = false, connection_status = 'disconnected', updated_at = now()
        WHERE clinic_id = ${input.clinicId} AND active = true AND id <> ${foundId}
      `);
      id = foundId;
    } else {
      // Número novo → desativa as ativas da clínica + INSERT nova ativa.
      await tx.execute(sql`
        UPDATE clinic_whatsapp_numbers SET
          active = false, connection_status = 'disconnected', updated_at = now()
        WHERE clinic_id = ${input.clinicId} AND active = true
      `);
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO clinic_whatsapp_numbers
          (clinic_id, provider, phone_number, meta_phone_id, meta_business_id,
           token_encrypted, verified_at, active, connection_status)
        VALUES
          (${input.clinicId}, ${input.provider}, ${input.phoneNumber}, ${input.metaPhoneId},
           ${input.metaBusinessId}, ${input.tokenEncrypted}, now(), true, 'connected')
        RETURNING id
      `);
      id = inserted[0]!.id;
    }

    await logAudit(tx, {
      clinicId: input.clinicId,
      userId: input.userId,
      action: 'messaging.whatsapp.connected',
      resourceType: 'whatsapp_number',
      resourceId: id,
      before: null,
      after: { provider: input.provider, phoneNumberMasked: maskPhone(input.phoneNumber) },
      requestContext: input.requestContext,
    });
    return { id };
  });
}

/** Desconecta o número ativo da clínica (active=false) e audita. */
export async function deactivateTenantConnection(input: {
  clinicId: string;
  userId: string;
  requestContext: RequestContext;
}): Promise<{
  disconnected: boolean;
  metaBusinessId: string | null;
  tokenCiphertext: string | null;
}> {
  return dbAdmin.transaction(async (tx: Tx) => {
    const rows = await tx.execute<{
      id: string;
      meta_business_id: string | null;
      token_encrypted: string;
    }>(sql`
      UPDATE clinic_whatsapp_numbers SET
        active = false, connection_status = 'disconnected', updated_at = now()
      WHERE clinic_id = ${input.clinicId} AND active = true
      RETURNING id, meta_business_id, token_encrypted
    `);
    const deactivated = rows[0] ?? null;
    const disconnected = deactivated !== null;
    if (deactivated) {
      await logAudit(tx, {
        clinicId: input.clinicId,
        userId: input.userId,
        action: 'messaging.whatsapp.disconnected',
        resourceType: 'whatsapp_number',
        resourceId: deactivated.id,
        before: null,
        after: null,
        requestContext: input.requestContext,
      });
    }
    return {
      disconnected,
      metaBusinessId: deactivated?.meta_business_id ?? null,
      tokenCiphertext: deactivated?.token_encrypted ?? null,
    };
  });
}

/**
 * Audita uma tentativa de conexão FALHA (sem tocar no número) — observabilidade
 * do lifecycle sem tabela paralela. Best-effort (o caller não deve mascarar o
 * MetaConnectError original por causa de uma falha de auditoria).
 */
export async function recordConnectionFailure(input: {
  clinicId: string;
  userId: string;
  errorCode: string;
  requestContext: RequestContext;
}): Promise<void> {
  await dbAdmin.transaction(async (tx: Tx) => {
    await logAudit(tx, {
      clinicId: input.clinicId,
      userId: input.userId,
      action: 'messaging.whatsapp.connection_failed',
      resourceType: 'whatsapp_number',
      resourceId: null,
      before: null,
      after: { errorCode: input.errorCode },
      requestContext: input.requestContext,
    });
  });
}
