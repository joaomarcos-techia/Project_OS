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

// ===========================================================================
// META-001 — leitura/escrita do estado de SAÚDE da conexão.
//
// Mora aqui pela mesma razão do resto do arquivo: `token_encrypted` tem grant
// service_role-only e `dbAdmin` é proibido em `src/contexts/**` (F-01). O
// contexto decide o veredito; este seam só busca a credencial e persiste o
// resultado.
// ===========================================================================

export interface ConnectionForHealth {
  id: string;
  clinicId: string;
  metaPhoneId: string;
  metaBusinessId: string | null;
  /** Ciphertext — o decrypt acontece no contexto, com a chave do tenant. */
  tokenCiphertext: string;
  connectionStatus: string;
}

/** Conexão ATIVA da clínica, com a credencial cifrada, para sondar a Meta. */
export async function loadConnectionForHealth(
  clinicId: string,
): Promise<ConnectionForHealth | null> {
  const rows = await dbAdmin.execute<{
    id: string;
    clinic_id: string;
    meta_phone_id: string;
    meta_business_id: string | null;
    token_encrypted: string;
    connection_status: string;
  }>(sql`
    SELECT id, clinic_id, meta_phone_id, meta_business_id, token_encrypted, connection_status
      FROM clinic_whatsapp_numbers
     WHERE clinic_id = ${clinicId} AND active = true
     LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    clinicId: r.clinic_id,
    metaPhoneId: r.meta_phone_id,
    metaBusinessId: r.meta_business_id,
    tokenCiphertext: r.token_encrypted,
    connectionStatus: r.connection_status,
  };
}

/** Todas as conexões ativas — varredura do cron, para o painel não mentir também. */
export async function listActiveConnectionsForHealth(
  limit: number,
): Promise<ConnectionForHealth[]> {
  const rows = await dbAdmin.execute<{
    id: string;
    clinic_id: string;
    meta_phone_id: string;
    meta_business_id: string | null;
    token_encrypted: string;
    connection_status: string;
  }>(sql`
    SELECT id, clinic_id, meta_phone_id, meta_business_id, token_encrypted, connection_status
      FROM clinic_whatsapp_numbers
     WHERE active = true
     ORDER BY updated_at ASC
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    metaPhoneId: r.meta_phone_id,
    metaBusinessId: r.meta_business_id,
    tokenCiphertext: r.token_encrypted,
    connectionStatus: r.connection_status,
  }));
}

/**
 * Persiste o estado observado do canal. Só escreve quando MUDA — o health roda a
 * cada abertura da tela e a cada passada do cron, e auditar "continua igual"
 * transformaria `audit_events` em log de polling.
 *
 * `active` NÃO é tocado: a conexão continua existindo e sendo a credencial de
 * roteamento; o que mudou é a informação de que ela não está operante. Desativar
 * automaticamente apagaria a única credencial capaz de se reinscrever.
 */
export async function recordConnectionHealth(input: {
  clinicId: string;
  connectionId: string;
  /** `null` = indeterminado; preserva o estado anterior. */
  status: 'connected' | 'failed' | null;
  reasons: readonly string[];
  requestContext: RequestContext;
  /** Ausente na varredura do cron (ator é o sistema). */
  userId?: string | null;
}): Promise<{ changed: boolean }> {
  if (input.status === null) return { changed: false };
  const status = input.status;

  return dbAdmin.transaction(async (tx: Tx) => {
    const rows = await tx.execute<{ connection_status: string }>(sql`
      SELECT connection_status FROM clinic_whatsapp_numbers
       WHERE id = ${input.connectionId} AND clinic_id = ${input.clinicId}
       FOR UPDATE
    `);
    const previous = rows[0]?.connection_status ?? null;
    if (previous === null || previous === status) return { changed: false };

    await tx.execute(sql`
      UPDATE clinic_whatsapp_numbers
         SET connection_status = ${status}, updated_at = now()
       WHERE id = ${input.connectionId} AND clinic_id = ${input.clinicId}
    `);
    await logAudit(tx, {
      clinicId: input.clinicId,
      userId: input.userId ?? null,
      action: 'messaging.whatsapp.health_changed',
      resourceType: 'whatsapp_number',
      resourceId: input.connectionId,
      before: { connectionStatus: previous },
      // `reasons` são códigos estáveis (channel-health), nunca IDs externos.
      after: { connectionStatus: status, reasons: [...input.reasons] },
      requestContext: input.requestContext,
    });
    return { changed: true };
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
  errorStage: string;
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
      after: { errorCode: input.errorCode, errorStage: input.errorStage },
      requestContext: input.requestContext,
    });
  });
}
