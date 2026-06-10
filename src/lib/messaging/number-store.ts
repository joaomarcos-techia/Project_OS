/**
 * number-store — seam PRIVILEGIADO ÚNICO de mensageria (C10).
 *
 * Superfície CONGELADA (3ª#6) — EXATAMENTE três funções:
 *   - resolveClinicByPhoneId  : roteamento de tenant pré-JWT (webhook).
 *   - loadActiveNumberForSend : leitura da credencial (token service_role-only).
 *   - quarantineOrphan        : não-perda de mensagens de número não-provisionado.
 * Qualquer nova operação vai para o CONTEXTO messaging (`withTenant`), não aqui.
 *
 * Por que vive em `lib` e usa `dbAdmin` + SQL cru:
 *   - O webhook NÃO tem tenant resolvido → precisa de leitura cross-tenant
 *     (`dbAdmin`/service_role), proibida em `src/contexts/**` pelo guard F-01.
 *   - SQL cru evita importar o schema Drizzle do contexto (boundaries lib→context).
 *   - Centralizar TODO acesso ao `token_encrypted` num módulo auditável é uma
 *     feature de segurança (um lugar para revisar). `token_encrypted` é
 *     service_role-only no grant; `authenticated` nunca lê o token.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { payloadHash } from '@/lib/idempotency/hash';
import { metrics } from '@/lib/observability/metrics';

import type { MessagingProviderName } from './provider';

/**
 * Escopo HKDF de plataforma para cifrar payloads órfãos (sem tenant resolvido).
 * Constante OFICIAL (2ª#1) — nunca espalhar a string literal. Documentado em
 * ADR-020 ("Platform Encryption Scope"): é um pseudo-tenant deliberado passado a
 * `encryptForTenant`; quem alterar o crypto do C5 assumindo tenantId=UUID precisa
 * preservar este contrato.
 */
export const PLATFORM_ORPHAN_SCOPE = '__orphan__';

export interface ActiveNumber {
  clinicId: string;
  provider: MessagingProviderName;
  metaPhoneId: string;
  metaBusinessId: string | null;
  phoneNumber: string;
  tokenCiphertext: string;
  tokenVersion: number;
}

/** Resolve a clínica dona de um `meta_phone_id` ativo (roteamento de tenant). */
export async function resolveClinicByPhoneId(metaPhoneId: string): Promise<string | null> {
  const rows = await dbAdmin.execute<{ clinic_id: string }>(sql`
    SELECT clinic_id
    FROM clinic_whatsapp_numbers
    WHERE meta_phone_id = ${metaPhoneId} AND active = true
    LIMIT 1
  `);
  return rows[0]?.clinic_id ?? null;
}

/** Carrega número + credencial ativos de uma clínica (token cifrado). */
export async function loadActiveNumberForSend(clinicId: string): Promise<ActiveNumber | null> {
  const rows = await dbAdmin.execute<{
    clinic_id: string;
    provider: MessagingProviderName;
    meta_phone_id: string;
    meta_business_id: string | null;
    phone_number: string;
    token_encrypted: string;
    token_version: number;
  }>(sql`
    SELECT clinic_id, provider, meta_phone_id, meta_business_id, phone_number,
           token_encrypted, token_version
    FROM clinic_whatsapp_numbers
    WHERE clinic_id = ${clinicId} AND active = true
    LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    clinicId: r.clinic_id,
    provider: r.provider,
    metaPhoneId: r.meta_phone_id,
    metaBusinessId: r.meta_business_id,
    phoneNumber: r.phone_number,
    tokenCiphertext: r.token_encrypted,
    tokenVersion: Number(r.token_version),
  };
}

/**
 * Quarentena de webhook cujo `phone_id` não resolveu uma clínica (8ª gap):
 * em vez de descartar (perda permanente), grava o corpo cru CIFRADO num log
 * global (super_admin-only). Dedup por `(provider, payload_hash)` (3ª#2) tolera
 * reenvios da Meta. Sem clinic_id → cifra com `PLATFORM_ORPHAN_SCOPE`.
 */
export async function quarantineOrphan(
  provider: MessagingProviderName,
  toPhoneId: string,
  rawBody: string,
): Promise<void> {
  const hash = hashRawBody(rawBody);
  const payloadEncrypted = await encryptForTenant(PLATFORM_ORPHAN_SCOPE, rawBody);
  await dbAdmin.execute(sql`
    INSERT INTO inbound_messages_orphaned
      (provider, to_phone_id, payload_hash, payload_encrypted)
    VALUES (${provider}, ${toPhoneId}, ${hash}, ${payloadEncrypted})
    ON CONFLICT (provider, payload_hash) DO NOTHING
  `);
  metrics.emit('messaging.webhook.orphaned', { provider, toPhoneId });
}

/**
 * Hash de dedup: canônico via `payloadHash` (semântico, não byte-for-byte — 4ª#1)
 * quando o corpo é JSON parseável; senão sha256 dos bytes crus (fallback
 * documentado para corpos inválidos).
 */
function hashRawBody(rawBody: string): string {
  try {
    return payloadHash(JSON.parse(rawBody));
  } catch {
    return createHash('sha256').update(rawBody, 'utf8').digest('hex');
  }
}
