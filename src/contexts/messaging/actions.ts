'use server';

/**
 * Messaging admin Server Actions (C10) — conectar / desconectar / rotacionar o
 * número WhatsApp de uma clínica. SEM UI (onboarding é concern de plataforma;
 * UI fica p/ C15). Cada ação:
 *   - `superAdminAction(...)` encapsula `requireSuperAdmin` (AAL2/MFA) + `dbAdmin`
 *     (cross-tenant) + grava o evento forense em `super_admin_actions` — é a
 *     auditoria de "número conectado/removido/token atualizado" (1ª#9).
 *   - O token é cifrado com `encryptForTenant` ANTES da tx (CPU puro).
 *
 * `clinic_whatsapp_numbers` é escrito SÓ por aqui (service_role) — `authenticated`
 * não tem grant de escrita; nem lê `token_encrypted` (column-level grant).
 */
import { headers } from 'next/headers';

import { and, eq, sql } from 'drizzle-orm';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { encryptForTenant } from '@/lib/crypto';

import { NumberNotConnectedError } from './errors';
import { clinicWhatsappNumbers } from './schema';
import { ConnectNumberSchema, type ConnectNumberInput } from './types';

async function requestContext() {
  return buildRequestContext(await headers());
}

/**
 * Conecta (ou reconecta) o número de uma clínica. Desativa o número ativo
 * anterior (se houver) e insere o novo como ativo — o partial unique
 * `WHERE active=true` garante 1 número ativo por clínica e permite reconexão.
 */
export async function connectWhatsappNumber(input: ConnectNumberInput): Promise<{ id: string }> {
  const data = ConnectNumberSchema.parse(input);
  const ctx = await requestContext();
  const tokenEncrypted = await encryptForTenant(data.clinicId, data.token);

  return superAdminAction(
    {
      action: 'messaging.number.connected',
      targetClinicId: data.clinicId,
      payload: {
        provider: data.provider,
        phoneNumber: data.phoneNumber,
        metaPhoneId: data.metaPhoneId,
      },
      requestContext: ctx,
    },
    async (tx) => {
      await tx
        .update(clinicWhatsappNumbers)
        .set({ active: false, updatedAt: sql`now()` })
        .where(
          and(
            eq(clinicWhatsappNumbers.clinicId, data.clinicId),
            eq(clinicWhatsappNumbers.active, true),
          ),
        );
      const [row] = await tx
        .insert(clinicWhatsappNumbers)
        .values({
          clinicId: data.clinicId,
          provider: data.provider,
          phoneNumber: data.phoneNumber,
          metaPhoneId: data.metaPhoneId,
          metaBusinessId: data.metaBusinessId ?? null,
          tokenEncrypted,
          verifiedAt: sql`now()`,
          active: true,
        })
        .returning({ id: clinicWhatsappNumbers.id });
      return { id: row!.id };
    },
  );
}

/** Desconecta o número ativo da clínica (active=false; histórico preservado). */
export async function disconnectWhatsappNumber(
  clinicId: string,
): Promise<{ disconnected: boolean }> {
  const ctx = await requestContext();
  return superAdminAction(
    {
      action: 'messaging.number.disconnected',
      targetClinicId: clinicId,
      payload: { clinicId },
      requestContext: ctx,
    },
    async (tx) => {
      const rows = await tx
        .update(clinicWhatsappNumbers)
        .set({ active: false, updatedAt: sql`now()` })
        .where(
          and(eq(clinicWhatsappNumbers.clinicId, clinicId), eq(clinicWhatsappNumbers.active, true)),
        )
        .returning({ id: clinicWhatsappNumbers.id });
      return { disconnected: rows.length > 0 };
    },
  );
}

/** Rotaciona o token do número ativo (bump em token_version — o sender compara). */
export async function rotateWhatsappToken(
  clinicId: string,
  newToken: string,
): Promise<{ tokenVersion: number }> {
  const ctx = await requestContext();
  const tokenEncrypted = await encryptForTenant(clinicId, newToken);
  return superAdminAction(
    {
      action: 'messaging.number.token_rotated',
      targetClinicId: clinicId,
      payload: { clinicId },
      requestContext: ctx,
    },
    async (tx) => {
      const [row] = await tx
        .update(clinicWhatsappNumbers)
        .set({
          tokenEncrypted,
          tokenVersion: sql`${clinicWhatsappNumbers.tokenVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(clinicWhatsappNumbers.clinicId, clinicId), eq(clinicWhatsappNumbers.active, true)),
        )
        .returning({ tokenVersion: clinicWhatsappNumbers.tokenVersion });
      if (!row) throw new NumberNotConnectedError(clinicId);
      return { tokenVersion: Number(row.tokenVersion) };
    },
  );
}
