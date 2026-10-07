/**
 * account-store — seam PRIVILEGIADO de ESCRITA da conta de pagamento da clínica.
 *
 * Irmão direto do `lib/messaging/connection-store.ts`, e pela mesma razão: o guard
 * F-01 proíbe `dbAdmin` em `src/contexts/**`, e `clinic_payment_accounts` tem a
 * coluna do segredo FORA do grant de `authenticated` (migration 0081) — ou seja,
 * `withTenant` (que faz `SET LOCAL ROLE authenticated`) **não consegue** escrever
 * aqui, por construção. A escrita do owner mora neste arquivo, e em nenhum outro.
 *
 * Contratos que este módulo mantém:
 *   - **"no audit, no op"**: a escrita e o `audit_events` acontecem na MESMA tx;
 *   - `clinicId` vem SEMPRE de `requireClinicId()` no caller, NUNCA de input do
 *     usuário — e todo comando repete `WHERE clinic_id = ...` como defesa em
 *     profundidade, porque `dbAdmin` ignora RLS;
 *   - a chave chega **já cifrada** (`encryptForTenant` no contexto). Este módulo
 *     nunca vê, nunca loga e nunca devolve o segredo em claro;
 *   - o audit nunca recebe a chave nem o hash — só metadado (provider, nome, versão).
 *
 * SQL cru (não Drizzle) pelo mesmo motivo do connection-store: `src/lib` não pode
 * importar o schema de um context (boundaries/ADR-001).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { decryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { createAsaasClient, type AsaasClient } from './asaas';
import { PAYMENT_ACCOUNT_LOCK_NAMESPACE } from './account-lock';

/** Único provider suportado — single-gateway por desenho (ADR-049 / §13.15). */
export const PAYMENT_PROVIDER = 'asaas' as const;

/**
 * Impede configurar um webhook depois que a desconexão o desativou. O lock fica
 * no pool tenant separado: a operação usa dbAdmin internamente, e segurar
 * uma conexão do próprio dbAdmin aqui poderia esgotá-lo sob concorrência.
 */
export async function withPaymentWebhookLock<T>(
  clinicId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withTenant(clinicId, async (tx: Tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${PAYMENT_ACCOUNT_LOCK_NAMESPACE}, hashtext(${clinicId}::text))`,
    );
    return operation();
  });
}

export interface UpsertPaymentAccountInput {
  clinicId: string;
  userId: string;
  /** JÁ cifrada com `encryptForTenant(clinicId, ...)`. Nunca em claro aqui. */
  apiKeyEncrypted: string;
  /** HMAC de lookup — reconhece reenvio da MESMA chave sem comparar plaintext. */
  apiKeyHash: string;
  /** Nome da conta como o Asaas devolveu. Pode ser nulo. */
  accountName: string | null;
  /** Token do webhook DESTA clínica, já cifrado. Gerado por nós a cada conexão. */
  webhookTokenEncrypted: string;
  requestContext: RequestContext;
}

export interface UpsertPaymentAccountResult {
  id: string;
  /**
   * `false` quando o operador reenviou EXATAMENTE a mesma chave de uma conta já
   * ativa. Nesse caso nada é escrito: sem bump de `key_version` (que invalidaria
   * client em cache à toa) e sem evento de auditoria fantasma sugerindo rotação.
   */
  changed: boolean;
}

/**
 * Conecta ou rotaciona a conta de pagamento da clínica e audita
 * `payments.account.connected` na mesma transação.
 */
export async function upsertPaymentAccount(
  input: UpsertPaymentAccountInput,
): Promise<UpsertPaymentAccountResult> {
  return dbAdmin.transaction(async (tx: Tx) => {
    const existing = await tx.execute<{
      id: string;
      api_key_hash: string | null;
      key_version: number;
      active: boolean;
      accept_new_charges: boolean;
    }>(
      sql`
        SELECT id, api_key_hash, key_version, active, accept_new_charges
        FROM clinic_payment_accounts
        WHERE clinic_id = ${input.clinicId} AND provider = ${PAYMENT_PROVIDER}
        LIMIT 1
        FOR UPDATE
      `,
    );
    const current = existing[0] ?? null;

    if (current?.active && current.api_key_hash === input.apiKeyHash) {
      if (current.accept_new_charges) return { id: current.id, changed: false };
      await tx.execute(sql`
        UPDATE clinic_payment_accounts
        SET accept_new_charges = true, updated_at = now()
        WHERE id = ${current.id} AND clinic_id = ${input.clinicId}
      `);
      await logAudit(tx, {
        clinicId: input.clinicId,
        userId: input.userId,
        action: 'payments.account.resumed',
        resourceType: 'clinic_payment_account',
        resourceId: current.id,
        before: null,
        after: { provider: PAYMENT_PROVIDER, acceptNewCharges: true },
        requestContext: input.requestContext,
      });
      return { id: current.id, changed: true };
    }

    const rows = await tx.execute<{ id: string; key_version: number }>(sql`
      INSERT INTO clinic_payment_accounts
        (clinic_id, provider, api_key_encrypted, api_key_hash, key_version,
         account_name, active, accept_new_charges, connected_at, connected_by, disconnected_at,
         webhook_token_encrypted, webhook_configured_at)
      VALUES
        (${input.clinicId}, ${PAYMENT_PROVIDER}, ${input.apiKeyEncrypted}, ${input.apiKeyHash}, 1,
        ${input.accountName}, true, true, now(), ${input.userId}, NULL,
         ${input.webhookTokenEncrypted}, NULL)
      ON CONFLICT (clinic_id, provider) DO UPDATE SET
        api_key_encrypted = EXCLUDED.api_key_encrypted,
        api_key_hash      = EXCLUDED.api_key_hash,
        -- Token novo a cada conexao, e configured_at volta a NULL: a conta pode
        -- ser outra, e um token velho apontando para a conta anterior aceitaria
        -- webhook de quem nao deveria mais mandar.
        webhook_token_encrypted = EXCLUDED.webhook_token_encrypted,
        webhook_configured_at   = NULL,
        -- Bump SEMPRE que a chave troca: é o sinal de que um client Asaas em
        -- cache (breaker por instância) ficou velho e precisa ser reconstruído.
        key_version       = clinic_payment_accounts.key_version + 1,
        account_name      = EXCLUDED.account_name,
        active            = true,
        accept_new_charges = true,
        connected_at      = now(),
        connected_by      = EXCLUDED.connected_by,
        disconnected_at   = NULL,
        updated_at        = now()
      RETURNING id, key_version
    `);
    const row = rows[0]!;

    await logAudit(tx, {
      clinicId: input.clinicId,
      userId: input.userId,
      action: 'payments.account.connected',
      resourceType: 'clinic_payment_account',
      resourceId: row.id,
      before: null,
      // NUNCA a chave, NUNCA o hash — só o que serve para investigar depois.
      after: {
        provider: PAYMENT_PROVIDER,
        accountName: input.accountName,
        keyVersion: row.key_version,
      },
      requestContext: input.requestContext,
    });

    return { id: row.id, changed: true };
  });
}

/**
 * Primeiro pausa novas reservas de Checkout; a chave e o webhook permanecem
 * enquanto existir qualquer cobrança da clínica. Sem histórico financeiro,
 * desativa o webhook remoto com readback antes de apagar os segredos locais.
 * Falha externa deixa a conta pausada e pronta para nova tentativa.
 */
export async function deactivatePaymentAccount(input: {
  clinicId: string;
  userId: string;
  requestContext: RequestContext;
}): Promise<{ changed: boolean; state: 'paused' | 'disconnected' }> {
  return withPaymentWebhookLock(input.clinicId, async () => {
    const pause = await dbAdmin.transaction(async (tx: Tx) => {
      // Mesmo lock dos claims de Checkout: a pausa vence antes de qualquer POST
      // novo, ou aguarda a intenção que já foi persistida.
      const [account] = await tx.execute<{
        id: string;
        active: boolean;
        accept_new_charges: boolean;
      }>(sql`
      SELECT id, active, accept_new_charges FROM clinic_payment_accounts
      WHERE clinic_id = ${input.clinicId} AND provider = ${PAYMENT_PROVIDER}
      LIMIT 1 FOR UPDATE
    `);
      if (!account?.active) return { changed: false, state: 'disconnected' as const };
      if (!account.accept_new_charges) return { changed: false, state: 'paused' as const };
      await tx.execute(sql`
      UPDATE clinic_payment_accounts SET accept_new_charges = false, updated_at = now()
      WHERE id = ${account.id} AND clinic_id = ${input.clinicId}
    `);
      await logAudit(tx, {
        clinicId: input.clinicId,
        userId: input.userId,
        action: 'payments.account.paused',
        resourceType: 'clinic_payment_account',
        resourceId: account.id,
        before: null,
        after: { provider: PAYMENT_PROVIDER, acceptNewCharges: false },
        requestContext: input.requestContext,
      });
      return { changed: true, state: 'paused' as const };
    });
    if (pause.state === 'disconnected') return pause;

    return dbAdmin.transaction(async (tx: Tx) => {
      const [account] = await tx.execute<{
        id: string;
        active: boolean;
        accept_new_charges: boolean;
        api_key_encrypted: string | null;
        webhook_ref: string;
      }>(sql`
      SELECT id, active, accept_new_charges, api_key_encrypted, webhook_ref::text AS webhook_ref
      FROM clinic_payment_accounts
      WHERE clinic_id = ${input.clinicId} AND provider = ${PAYMENT_PROVIDER}
      LIMIT 1 FOR UPDATE
    `);
      if (!account?.active) return { changed: pause.changed, state: 'disconnected' as const };
      if (account.accept_new_charges) return { changed: pause.changed, state: 'paused' as const };

      // Histórico pago ainda pode produzir estorno/chargeback ou correção de tarifa.
      // A conta permanece pausada e conciliável; nenhuma credencial é perdida.
      const [obligation] = await tx.execute<{ present: number }>(sql`
      SELECT 1 AS present FROM patient_charges
      WHERE clinic_id = ${input.clinicId} LIMIT 1
    `);
      if (obligation) return { changed: pause.changed, state: 'paused' as const };
      if (!account.api_key_encrypted) throw new Error('conta ativa sem credencial cifrada');

      const apiKey = await decryptForTenant(input.clinicId, account.api_key_encrypted);
      const client = createAsaasClient({ apiKey });
      await client.disableWebhook({
        pathname: `/api/webhooks/asaas/patient/${account.webhook_ref}`,
      });

      await tx.execute(sql`
      UPDATE clinic_payment_accounts SET
        active = false, accept_new_charges = false,
        api_key_encrypted = NULL, api_key_hash = NULL,
        webhook_token_encrypted = NULL, webhook_configured_at = NULL,
        disconnected_at = now(), updated_at = now()
      WHERE id = ${account.id} AND clinic_id = ${input.clinicId}
        AND active = true AND accept_new_charges = false
    `);
      await logAudit(tx, {
        clinicId: input.clinicId,
        userId: input.userId,
        action: 'payments.account.disconnected',
        resourceType: 'clinic_payment_account',
        resourceId: account.id,
        before: null,
        after: { provider: PAYMENT_PROVIDER, remoteWebhookDisabled: true },
        requestContext: input.requestContext,
      });
      return { changed: true, state: 'disconnected' as const };
    });
  });
}

// --- leitura da credencial (1.3) ---------------------------------------------

/**
 * Cache de client por clínica.
 *
 * POR QUE existir: o circuit breaker vive NA INSTÂNCIA do client (ver
 * `asaas/index.ts`). Criar um client a cada cobrança zeraria o breaker toda vez e
 * o tornaria decoração — a conta de uma clínica fora do ar seria martelada sem
 * parar. Cachear é o que faz a proteção existir.
 *
 * POR QUE a chave `keyVersion`: rotacionar a credencial incrementa `key_version`
 * (migration 0081). Como toda chamada relê essa coluna, um client com chave velha
 * é descartado na primeira cobrança seguinte — sem invalidação manual, sem
 * pub/sub, sem client zumbi autenticando com credencial revogada.
 *
 * O que fica em memória: a chave DECIFRADA, pelo tempo de vida do processo. É
 * inerente a falar com o gateway; o que se evita é ela ir para disco, log ou
 * resposta.
 */
interface CachedClient {
  keyVersion: number;
  client: AsaasClient;
}
const clientCache = new Map<string, CachedClient>();

/** Teto defensivo: instância serverless não deveria ver tantas clínicas. */
const CLIENT_CACHE_MAX = 200;

interface AccountKeyRow extends Record<string, unknown> {
  api_key_encrypted: string | null;
  key_version: number;
}

/**
 * Client Asaas da clínica, ou `null` quando ela não conectou conta.
 *
 * `null` NÃO é erro: é o estado da maioria das clínicas até conectarem. Quem chama
 * decide o que fazer — no caso do sinal, é simplesmente não cobrar.
 */
export async function getClinicAsaasClient(clinicId: string): Promise<AsaasClient | null> {
  const rows = await dbAdmin.execute<AccountKeyRow>(sql`
    SELECT api_key_encrypted, key_version
    FROM clinic_payment_accounts
    WHERE clinic_id = ${clinicId} AND provider = ${PAYMENT_PROVIDER} AND active = true
    LIMIT 1
  `);
  const row = rows[0];
  if (!row?.api_key_encrypted) return null;

  const cached = clientCache.get(clinicId);
  if (cached && cached.keyVersion === row.key_version) return cached.client;

  const apiKey = await decryptForTenant(clinicId, row.api_key_encrypted);
  const client = createAsaasClient({ apiKey });
  if (clientCache.size >= CLIENT_CACHE_MAX) clientCache.clear();
  clientCache.set(clinicId, { keyVersion: row.key_version, client });
  return client;
}

/** test-only — o cache é global ao módulo; sem isto um teste contamina o outro. */
export const __testing__ = {
  resetClientCache: (): void => clientCache.clear(),
};

// --- webhook de paciente (1.4) ----------------------------------------------

export interface PatientWebhookAccount {
  clinicId: string;
  /** Client já ligado à credencial da clínica (com o cache/breaker do módulo). */
  client: AsaasClient;
  /** Token que ESTA clínica deve enviar no header. Decifrado. */
  webhookToken: string;
}

interface WebhookAccountRow extends Record<string, unknown> {
  clinic_id: string;
  api_key_encrypted: string | null;
  webhook_token_encrypted: string | null;
  key_version: number;
}

/**
 * Resolve a clínica a partir do `ref` da URL do webhook.
 *
 * `null` quando o ref não existe, a conta está inativa, ou falta chave/token —
 * e o caller devolve **404** em todos esses casos, nunca um erro específico:
 * distinguir "ref inexistente" de "conta sem token" transformaria a rota num
 * oráculo para descobrir refs válidos por tentativa e erro.
 *
 * Roda por `dbAdmin` porque webhook não tem sessão: não existe tenant no request
 * até esta consulta resolver qual é.
 */
export async function resolvePatientWebhookAccount(
  webhookRef: string,
): Promise<PatientWebhookAccount | null> {
  const rows = await dbAdmin.execute<WebhookAccountRow>(sql`
    SELECT clinic_id::text AS clinic_id, api_key_encrypted, webhook_token_encrypted, key_version
    FROM clinic_payment_accounts
    WHERE webhook_ref = ${webhookRef}::uuid
      AND provider = ${PAYMENT_PROVIDER}
      AND active = true
    LIMIT 1
  `);
  const row = rows[0];
  if (!row?.api_key_encrypted || !row.webhook_token_encrypted) return null;

  const [webhookToken, client] = await Promise.all([
    decryptForTenant(row.clinic_id, row.webhook_token_encrypted),
    getClinicAsaasClient(row.clinic_id),
  ]);
  if (!client) return null;

  return { clinicId: row.clinic_id, client, webhookToken };
}

export interface WebhookSetupTarget {
  clinicId: string;
  webhookRef: string;
  /** Token em claro — existe só na memória desta operação. */
  webhookToken: string;
  client: AsaasClient;
}

/**
 * Dados para configurar o webhook logo após conectar. Lê o `ref` (gerado pelo
 * banco) e decifra o token que acabou de ser gravado.
 */
export async function getWebhookSetupTarget(clinicId: string): Promise<WebhookSetupTarget | null> {
  const rows = await dbAdmin.execute<
    {
      webhook_ref: string;
      webhook_token_encrypted: string | null;
    } & Record<string, unknown>
  >(sql`
    SELECT webhook_ref::text AS webhook_ref, webhook_token_encrypted
    FROM clinic_payment_accounts
    WHERE clinic_id = ${clinicId} AND provider = ${PAYMENT_PROVIDER} AND active = true
    LIMIT 1
  `);
  const row = rows[0];
  if (!row?.webhook_token_encrypted) return null;

  const client = await getClinicAsaasClient(clinicId);
  if (!client) return null;

  return {
    clinicId,
    webhookRef: row.webhook_ref,
    webhookToken: await decryptForTenant(clinicId, row.webhook_token_encrypted),
    client,
  };
}

/**
 * Marca o webhook como configurado. Só é chamado quando o Asaas confirmou o
 * registro — `webhook_configured_at` nulo é o sinal, para a tela e para o
 * runbook, de que as cobranças serão criadas mas **nunca conciliadas**.
 */
export async function markWebhookConfigured(clinicId: string): Promise<void> {
  await dbAdmin.execute(sql`
    UPDATE clinic_payment_accounts
       SET webhook_configured_at = now(), updated_at = now()
     WHERE clinic_id = ${clinicId} AND provider = ${PAYMENT_PROVIDER} AND active = true
  `);
}
