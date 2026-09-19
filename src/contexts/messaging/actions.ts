'use server';

/**
 * Messaging admin Server Actions (C10) — conectar / desconectar / rotacionar o
 * número WhatsApp de uma clínica. SEM UI (onboarding é concern de plataforma;
 * UI fica p/ C15). Cada ação:
 *   - `requireSuperAdmin()` (AAL2/MFA) PRIMEIRO — antes de parse/cripto.
 *   - `superAdminAction(...)` re-checa o gate + `dbAdmin` (cross-tenant) + grava o
 *     evento forense em `super_admin_actions` — é a auditoria de "número
 *     conectado/removido/token atualizado" (1ª#9).
 *   - O token é cifrado com `encryptForTenant` ANTES da tx (CPU puro), mas DEPOIS
 *     do gate.
 *
 * B3 (auditoria de APIs) — ordem: o gate morava só dentro de `superAdminAction`, e
 * o Zod + o `encryptForTenant` (HKDF por tenant) rodavam antes dele. Não era bypass
 * de privilégio — o 403 vinha do mesmo jeito —, mas o servidor gastava CPU de
 * derivação de chave a mando de quem ainda não tinha provado nada, e o ZodError
 * voltava antes do 403, revelando o formato do input a não-autorizado. Estas actions
 * são cross-tenant por design (recebem `clinicId` de input, diferente do caminho
 * tenant, onde ele vem de `requireClinicId()`), então a borda tem de ser mais dura.
 * O gate duplicado é barato: `getCurrentUser` é `cache()`-ado por request.
 *
 * `clinic_whatsapp_numbers` é escrito SÓ por aqui (service_role) — `authenticated`
 * não tem grant de escrita; nem lê `token_encrypted` (column-level grant).
 */
import { and, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { requestContext } from '@/lib/audit/request-context-from-headers';
import { listProactiveTemplateDefinitions } from '@/lib/messaging/proactive-template-catalog';
import { superAdminAction } from '@/lib/audit/super-admin';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireClinicId,
  requireFreshPermission,
  requireSuperAdmin,
  requireUser,
} from '@/lib/auth/tenant-context';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import { assertWhatsappOnboardingReady } from '@/lib/env';
import { maskPhone } from '@/lib/format';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import {
  deactivateTenantConnection,
  recordConnectionFailure,
  upsertTenantConnection,
} from '@/lib/messaging';

import { MetaConnectError, NumberNotConnectedError } from './errors';
import {
  exchangeCodeForToken,
  registerPhoneNumber,
  resolveWabaAndPhone,
  ensureMessageTemplates,
  subscribeAppToWaba,
  unsubscribeAppFromWaba,
  validateTokenScopes,
  type WabaPhone,
} from './internal/meta-onboarding';
import { clinicWhatsappNumbers } from './schema';
import { ConnectNumberSchema, type ConnectNumberInput } from './types';

/**
 * B3: `clinicId` vem de INPUT nestas três (cross-tenant por design), então valida
 * formato antes de usar — diferente do caminho tenant, onde vem de `requireClinicId()`.
 */
const ClinicIdSchema = z.string().uuid('clinicId inválido.');

/**
 * Conecta (ou reconecta) o número de uma clínica. Desativa o número ativo
 * anterior (se houver) e insere o novo como ativo — o partial unique
 * `WHERE active=true` garante 1 número ativo por clínica e permite reconexão.
 */
export async function connectWhatsappNumber(input: ConnectNumberInput): Promise<{ id: string }> {
  await requireSuperAdmin(); // B3 — gate ANTES de parse/cripto
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
  clinicIdInput: string,
): Promise<{ disconnected: boolean }> {
  await requireSuperAdmin(); // B3 — gate ANTES de qualquer trabalho
  const clinicId = ClinicIdSchema.parse(clinicIdInput);
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
  clinicIdInput: string,
  newToken: string,
): Promise<{ tokenVersion: number }> {
  await requireSuperAdmin(); // B3 — gate ANTES de parse/cripto
  const clinicId = ClinicIdSchema.parse(clinicIdInput);
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

// ===========================================================================
// F2 — Conexão self-service do WhatsApp pelo OWNER (Meta Embedded Signup).
//
// Diferente do connect super_admin acima: tenant-scoped. O `clinicId` vem SEMPRE
// de requireClinicId() (nunca de input) ⇒ isolamento. A escrita privilegiada do
// número + auditoria em audit_events delega ao seam lib `connection-store` (F-01
// proíbe dbAdmin no contexto). O token NUNCA chega ao client.
// ===========================================================================

/** Input do connect self-service. NÃO há `clinicId` — vem de requireClinicId(). */
const ConnectMyClinicSchema = z.object({
  code: z.string().min(1),
  /** PIN de 2FA da Cloud API; usado uma única vez no Graph e nunca persistido. */
  registrationPin: z.string().regex(/^\d{6}$/, 'O PIN do WhatsApp deve ter 6 dígitos.'),
  /**
   * D78 — ids do evento oficial `WA_EMBEDDED_SIGNUP`. `wabaId` deixou de ser
   * uma sugestão opcional: sem ele não há caminho de menor privilégio para
   * descobrir a WABA. Continua `.optional()` no schema apenas para que a
   * ausência vire `MetaConnectError('signup_incomplete')` — auditada e com
   * mensagem específica — em vez de um `ZodError` genérico na tela.
   */
  wabaId: z.string().min(1).optional(),
  phoneNumberId: z.string().min(1).optional(),
});
export type ConnectMyClinicInput = z.input<typeof ConnectMyClinicSchema>;

function isUniqueViolation(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505'
  );
}

/**
 * Conecta (ou reconecta) o WhatsApp da PRÓPRIA clínica do owner via Embedded
 * Signup: troca code→token (server-side), valida escopos, resolve WABA+número,
 * registra o telefone na Cloud API, assina o webhook e persiste a credencial
 * cifrada. Retorna só dados não-sensíveis.
 */
export async function connectMyClinicWhatsapp(
  input: ConnectMyClinicInput,
): Promise<{ id: string; phoneNumberMasked: string }> {
  assertWhatsappOnboardingReady();
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const data = ConnectMyClinicSchema.parse(input);

  // Fase Meta (sem DB). Falha ⇒ audita connection_failed + lança MetaConnectError;
  // nenhuma escrita no número (Caso 3).
  let meta: { token: string; waba: WabaPhone };
  try {
    // Antes de qualquer chamada à Meta: sem a `waba_id` do evento não existe
    // resolução de menor privilégio (o fallback por portfólio foi removido em D78).
    if (!data.wabaId) {
      throw new MetaConnectError('[meta] Embedded Signup concluiu sem waba_id', {
        stage: 'signup_incomplete',
      });
    }
    const token = await exchangeCodeForToken(data.code);
    const grant = await validateTokenScopes(token);
    const waba = await resolveWabaAndPhone(
      token,
      { wabaId: data.wabaId, phoneNumberId: data.phoneNumberId },
      grant,
    );
    await registerPhoneNumber(waba.phoneNumberId, token, data.registrationPin);
    await subscribeAppToWaba(waba.wabaId, token);
    meta = { token, waba };
  } catch (err) {
    const metaError =
      err instanceof MetaConnectError
        ? err
        : new MetaConnectError('[meta] falha no Embedded Signup', {
            cause: err,
            stage: 'unknown',
          });
    logger.error('messaging.whatsapp.connection_failed', {
      stage: metaError.stage,
      error: metaError,
    });
    await recordConnectionFailure({
      clinicId,
      userId: user.userId,
      errorCode: metaError.code,
      errorStage: metaError.stage,
      requestContext: ctx,
    }).catch(() => {});
    throw metaError;
  }

  // Cifra ANTES da tx (CPU puro). Persiste via seam privilegiado (service_role).
  const tokenEncrypted = await encryptForTenant(clinicId, meta.token);
  try {
    const { id } = await upsertTenantConnection({
      clinicId,
      userId: user.userId,
      provider: 'meta',
      phoneNumber: meta.waba.phoneNumber,
      metaPhoneId: meta.waba.phoneNumberId,
      metaBusinessId: meta.waba.wabaId,
      tokenEncrypted,
      requestContext: ctx,
    });
    // Provisionamento dos templates proativos: roda DEPOIS da resposta. São até
    // cinco chamadas ao Graph e a clínica não pode ficar esperando por elas —
    // a conexão já está válida e persistida neste ponto.
    const { token, waba } = meta;
    after(async () => {
      const outcomes = await ensureMessageTemplates(
        waba.wabaId,
        token,
        listProactiveTemplateDefinitions(),
      );
      const failed = outcomes.filter((o) => o.status === 'failed');
      metrics.emit('messaging.whatsapp.templates_provisioned', {
        created: outcomes.filter((o) => o.status === 'created').length,
        alreadyExists: outcomes.filter((o) => o.status === 'already_exists').length,
        failed: failed.length,
      });
      if (failed.length > 0) {
        // Nome de template não é segredo e é o que o operador precisa para
        // cadastrar o que faltou na WhatsApp Manager daquela clínica.
        logger.error('messaging.whatsapp.template_provision_failed', {
          templates: failed.map((o) => o.name).join(','),
        });
      }
      // D104 — template que a Meta reclassificou continua existindo e sendo
      // aceito no envio, mas passa a valer a régua de opt-in de marketing, que
      // o Qoro não enxerga: o job termina `sent` e a mensagem pode não chegar.
      // Editar não muda categoria; a correção é criar outro, com nome novo.
      const drifted = outcomes.filter((o) => o.categoryDrift);
      if (drifted.length > 0) {
        logger.error('messaging.whatsapp.template_category_drift', {
          templates: drifted
            .map((o) => `${o.name}:${o.categoryDrift!.expected}->${o.categoryDrift!.actual}`)
            .join(','),
        });
      }
    });

    return { id, phoneNumberMasked: maskPhone(meta.waba.phoneNumber) };
  } catch (err) {
    // Unique parcial global: número já ativo em OUTRA clínica (anti-sequestro).
    const metaError =
      err instanceof MetaConnectError
        ? err
        : isUniqueViolation(err)
          ? new MetaConnectError('[meta] este número já está conectado em outra clínica', {
              cause: err,
              stage: 'persistence',
            })
          : new MetaConnectError('[meta] falha ao salvar a conexão', {
              cause: err,
              stage: 'persistence',
            });
    logger.error('messaging.whatsapp.connection_failed', {
      stage: metaError.stage,
      error: metaError,
    });
    await recordConnectionFailure({
      clinicId,
      userId: user.userId,
      errorCode: metaError.code,
      errorStage: metaError.stage,
      requestContext: ctx,
    }).catch(() => {});
    throw metaError;
  }
}

/**
 * Desconecta imediatamente o WhatsApp da própria clínica do owner. A remoção da
 * assinatura Meta é limpeza best-effort e roda após a resposta: ela não pode
 * manter a tela aguardando quando a Meta estiver lenta ou indisponível.
 */
export async function disconnectMyClinicWhatsapp(): Promise<{ disconnected: boolean }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const result = await deactivateTenantConnection({
    clinicId,
    userId: user.userId,
    requestContext: ctx,
  });
  const { metaBusinessId, tokenCiphertext } = result;

  if (metaBusinessId && tokenCiphertext) {
    after(async () => {
      try {
        const token = await decryptForTenant(clinicId, tokenCiphertext);
        await unsubscribeAppFromWaba(metaBusinessId, token);
      } catch {
        // A desconexão local já foi concluída; falhar nesta limpeza não reativa
        // o número nem interrompe a resposta ao usuário.
      }
    });
  }
  return { disconnected: result.disconnected };
}
