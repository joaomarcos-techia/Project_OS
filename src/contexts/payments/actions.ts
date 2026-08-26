'use server';

/**
 * Server Actions do Payments — conectar/desconectar a conta Asaas DA CLÍNICA
 * (ADR-049, Modelo B: o dinheiro do paciente vai direto para a clínica).
 *
 * Ordem obrigatória, e o porquê de cada passo vir antes do próximo:
 *
 *   requireUser → permissões → Zod → VALIDA no Asaas → cifra → grava+audita
 *
 *   1. Gate ANTES de parse e antes de qualquer cripto: nada de gastar CPU (ou de
 *      tocar no segredo) para um chamador que não podia estar aqui.
 *   2. **Valida a chave no Asaas ANTES de gravar.** Chave errada guardada não dá
 *      erro hoje — dá cobrança falhando daqui a três semanas, na frente do
 *      paciente. Se o Asaas estiver fora do ar, NÃO grava: guardar uma chave não
 *      verificada é exatamente o estado que este passo existe para impedir.
 *   3. Só então cifra (per-tenant) e delega a escrita ao seam privilegiado
 *      `lib/payments/account-store` — que grava e audita na mesma transação.
 *
 * Permissão: `manage:financial`, e SÓ ela. Conectar esta conta é decidir para onde
 * vai o dinheiro do paciente — é a mesma classe de `manage:financial`, que já
 * autoriza lançamento e movimentação de caixa.
 *
 * POR QUE não exigir também `manage:settings`: o `pageGate` do repo avalia
 * permissões como **ANY**, e ele é quem carrega a regra do super_admin com AAL2.
 * Uma action com AND + uma página com ANY produz o pior dos estados — tela
 * visível, ação recusada — e a alternativa (reimplementar o gate aqui) forkaria
 * a lógica de RBAC por causa de uma única tela. Gate coerente vale mais do que
 * uma permissão extra: página e action exigem exatamente a mesma coisa.
 */
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { auditedMutation } from '@/lib/audit/mutation';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { metrics } from '@/lib/observability/metrics';
import {
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
  createAsaasClient,
} from '@/lib/payments/asaas';
import {
  deactivatePaymentAccount,
  getWebhookSetupTarget,
  markWebhookConfigured,
  upsertPaymentAccount,
} from '@/lib/payments/account-store';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';

import { PaymentCredentialRejectedError, PaymentProviderUnavailableError } from './errors';
import { getDepositPolicy, getPaymentAccountStatus } from './queries';
import { clinicDepositPolicy } from './schema';
import {
  ConnectPaymentAccountSchema,
  SaveDepositPolicySchema,
  type ConnectPaymentAccountResult,
  type ConnectPaymentAccountInput,
  type DepositPolicyDTO,
  type PaymentAccountStatusDTO,
  type PaymentWebhookConfigurationIssue,
  type SaveDepositPolicyInput,
} from './types';

async function requirePaymentAdmin(): Promise<void> {
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
}

/**
 * Prova que a chave abre a conta. `attempts: 1` de propósito: o operador está
 * olhando para a tela, e três tentativas × timeout do Asaas viram meio minuto de
 * espera. Falha indeterminada aqui vira "tente de novo", nunca uma gravação.
 */
async function validateCredential(
  apiKey: string,
): Promise<{ accountName: string | null; accountEmail: string | null }> {
  const client = createAsaasClient({ apiKey });
  try {
    const account = await client.getMyAccount({ attempts: 1 });
    return { accountName: account.name, accountEmail: account.email };
  } catch (err) {
    if (err instanceof BillingProviderError) {
      // 4xx = o Asaas entendeu e recusou. Decisão do operador.
      throw new PaymentCredentialRejectedError(err.providerErrorCodes);
    }
    if (err instanceof BillingProviderUnreachableError || err instanceof BillingCircuitOpenError) {
      // Indeterminado: pode ser rede, pode ser o Asaas. Não sabemos se a chave
      // presta, então não gravamos.
      throw new PaymentProviderUnavailableError();
    }
    throw err;
  }
}

/**
 * Token do webhook: NOSSO segredo, gerado a cada conexão e nunca reaproveitado.
 * 32 bytes de entropia; o Asaas devolve só um indicador de que existe, então não
 * há de onde relê-lo depois.
 *
 * O laço existe por uma regra REAL do Asaas, descoberta ao vivo em 2026-08-24:
 * *"o token não pode conter mais de 4 caracteres iguais consecutivos"*. Um token
 * aleatório viola isso raramente — o que é pior do que violar sempre: a conexão
 * de uma clínica falharia de vez em quando, sem padrão, e pareceria instabilidade
 * do gateway. Gerar de novo é mais barato que investigar isso depois.
 */
function generateWebhookToken(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomBytes(32).toString('base64url');
    if (!/(.){4,}/.test(candidate)) return candidate;
  }
  // 8 tentativas seguidas com repetição é indistinguível de RNG quebrado.
  throw new Error('[payments] não foi possível gerar um token de webhook válido');
}

/** Eventos de pagamento que interessam ao sinal. Nada de assinatura/transferência. */
const WEBHOOK_EVENTS = [
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REFUNDED',
  'PAYMENT_OVERDUE',
] as const;

function buildPatientWebhookUrl(baseUrl: string, webhookRef: string): string | null {
  const url = new URL(
    buildApplicationUrl(baseUrl, `/api/webhooks/asaas/patient/${webhookRef}`, {
      allowInsecureLocalhost: env.NODE_ENV !== 'production',
    }),
  );

  if (env.VERCEL_ENV === 'preview') {
    // Preview protegido rejeita o Asaas na borda antes de a rota validar o token
    // por clínica. Ausente, falha visível (webhookConfigured=false) em vez de
    // registrar no provider uma URL condenada a entrar em penalty loop.
    if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) return null;
    url.searchParams.set('x-vercel-protection-bypass', env.VERCEL_AUTOMATION_BYPASS_SECRET);
  }

  return url.toString();
}

/**
 * Registra o webhook na conta da clínica.
 *
 * **Best-effort de propósito, e a falha NÃO é silenciosa.** Se o registro falhar,
 * `webhook_configured_at` fica nulo — e é esse nulo que a tela mostra e o runbook
 * manda checar. Derrubar a conexão inteira por causa disso seria pior: a chave é
 * válida, e a clínica ficaria sem conseguir conectar. O estado ruim de verdade
 * seria o intermediário invisível: conectado, cobrando, e nunca conciliando.
 */
async function tryConfigureWebhook(
  clinicId: string,
  accountEmail: string | null,
): Promise<{ ok: true; issue: null } | { ok: false; issue: PaymentWebhookConfigurationIssue }> {
  const fail = (
    issue: PaymentWebhookConfigurationIssue,
    error?: unknown,
  ): { ok: false; issue: PaymentWebhookConfigurationIssue } => {
    metrics.emit('payments.webhook.configure_failed', {
      clinicId,
      code: issue.code,
      location: issue.location,
      ...(error === undefined ? {} : { error }),
    });
    return { ok: false, issue };
  };

  const baseUrl = env.APP_BASE_URL;
  if (!baseUrl) {
    return fail({
      code: 'qoro_missing_app_base_url',
      location: 'Configuração do Qoro, antes de chamar o Asaas',
      message: 'APP_BASE_URL não está disponível no runtime deste deploy.',
    });
  }
  // O Asaas exige um e-mail de contato para o webhook. Sem ele não dá para
  // registrar — e forjar um endereço nosso na conta de um cliente seria pior.
  if (!accountEmail) {
    return fail({
      code: 'asaas_missing_account_email',
      location: 'Conta Asaas, após GET /myAccount e antes de POST /webhooks',
      message: 'A conta Asaas não retornou o e-mail de contato exigido para registrar o webhook.',
    });
  }

  let target: Awaited<ReturnType<typeof getWebhookSetupTarget>>;
  try {
    target = await getWebhookSetupTarget(clinicId);
  } catch (error) {
    return fail(
      {
        code: 'qoro_webhook_unexpected',
        location: 'Banco/criptografia do Qoro, ao preparar o webhook',
        message: 'O Qoro não conseguiu reler a conta e o token recém-salvos.',
      },
      error,
    );
  }
  if (!target) {
    return fail({
      code: 'qoro_payment_account_unavailable',
      location: 'Banco do Qoro, antes de chamar o Asaas',
      message: 'A conta recém-salva não pôde ser preparada para o registro do webhook.',
    });
  }

  if (env.VERCEL_ENV === 'preview' && !env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return fail({
      code: 'qoro_missing_preview_bypass',
      location: 'Configuração do Qoro, antes de chamar o Asaas',
      message: 'VERCEL_AUTOMATION_BYPASS_SECRET não está disponível no runtime deste Preview.',
    });
  }

  let webhookUrl: string;
  try {
    webhookUrl = buildPatientWebhookUrl(baseUrl, target.webhookRef)!;
  } catch (error) {
    return fail(
      {
        code: 'qoro_invalid_app_base_url',
        location: 'Configuração do Qoro, antes de chamar o Asaas',
        message: 'APP_BASE_URL deste deploy não é uma origem HTTPS válida.',
      },
      error,
    );
  }

  try {
    await target.client.createWebhook({
      name: 'Qoro — cobranca de paciente',
      // `buildApplicationUrl` e nao template string: `APP_BASE_URL` com barra no
      // fim gerava `https://host//api/webhooks/...`, e o webhook nascia apontando
      // para um caminho que nao existe. O sintoma seria o pior possivel — conexao
      // "bem-sucedida", cobrancas criadas, e NENHUMA conciliada.
      url: webhookUrl,
      email: accountEmail,
      authToken: target.webhookToken,
      events: WEBHOOK_EVENTS,
    });
    await markWebhookConfigured(clinicId);
    metrics.emit('payments.webhook.configured', { clinicId });
    return { ok: true, issue: null };
  } catch (error) {
    if (error instanceof BillingProviderError) {
      const providerCodes = error.providerErrorCodes.slice(0, 5);
      const details = [
        error.httpStatus === null ? null : `HTTP ${error.httpStatus}`,
        providerCodes.length === 0 ? null : `código(s): ${providerCodes.join(', ')}`,
      ]
        .filter((part): part is string => part !== null)
        .join('; ');
      return fail(
        {
          code: 'asaas_webhook_rejected',
          location: 'API do Asaas, durante POST /webhooks',
          message: `O Asaas recusou o registro do webhook${details ? ` (${details})` : ''}. A chave já havia sido aceita em GET /myAccount.`,
        },
        error,
      );
    }
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      return fail(
        {
          code: 'asaas_webhook_unavailable',
          location: 'Comunicação Qoro → Asaas, durante POST /webhooks',
          message:
            'O Asaas não confirmou o registro por indisponibilidade, timeout ou falha de rede.',
        },
        error,
      );
    }
    return fail(
      {
        code: 'qoro_webhook_unexpected',
        location: 'Qoro, durante a confirmação de POST /webhooks',
        message: 'O registro falhou de forma inesperada. Use o código abaixo para localizar o log.',
      },
      error,
    );
  }
}

/**
 * Conecta (ou rotaciona) a conta Asaas da clínica.
 *
 * Retorna o mesmo DTO da tela — sem a chave, por construção: o valor em claro
 * existe apenas como parâmetro desta função e não é escrito em log, métrica,
 * auditoria ou resposta.
 */
export async function connectPaymentAccount(
  input: ConnectPaymentAccountInput,
): Promise<ConnectPaymentAccountResult> {
  const user = await requireUser();
  await requirePaymentAdmin();
  const data = ConnectPaymentAccountSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const { accountName, accountEmail } = await validateCredential(data.apiKey);

  const webhookToken = generateWebhookToken();

  const [apiKeyEncrypted, apiKeyHash, webhookTokenEncrypted] = await Promise.all([
    encryptForTenant(clinicId, data.apiKey),
    hashForLookup(data.apiKey),
    encryptForTenant(clinicId, webhookToken),
  ]);

  const result = await upsertPaymentAccount({
    clinicId,
    userId: user.userId,
    apiKeyEncrypted,
    apiKeyHash,
    accountName,
    webhookTokenEncrypted,
    requestContext: ctx,
  });

  // Reenviar a MESMA chave com webhook já confirmado é um no-op real. Além de
  // poupar uma chamada, impede criar webhooks duplicados com o mesmo token.
  const unchangedStatus = result.changed ? null : await getPaymentAccountStatus(clinicId);
  const webhookResult = unchangedStatus?.webhookConfigured
    ? { ok: true as const, issue: null }
    : await tryConfigureWebhook(clinicId, accountEmail);

  // Sem chave, sem hash, sem nome de conta: só o suficiente para ver adoção e
  // investigar volume. `changed:false` = reenvio da mesma chave.
  metrics.emit('payments.account.connected', { clinicId, changed: result.changed });

  const status = unchangedStatus?.webhookConfigured
    ? unchangedStatus
    : await getPaymentAccountStatus(clinicId);
  return { ...status, webhookConfigurationIssue: webhookResult.issue };
}

/**
 * Desconecta a conta. A chave é APAGADA (não escondida) — ver `account-store`.
 * Idempotente: desconectar o que já estava desconectado não é erro.
 */
export async function disconnectPaymentAccount(): Promise<PaymentAccountStatusDTO> {
  const user = await requireUser();
  await requirePaymentAdmin();
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const result = await deactivatePaymentAccount({
    clinicId,
    userId: user.userId,
    requestContext: ctx,
  });
  metrics.emit('payments.account.disconnected', { clinicId, changed: result.changed });

  return getPaymentAccountStatus(clinicId);
}

// --- política de sinal (1.2) -------------------------------------------------

/**
 * Grava a política de sinal da clínica.
 *
 * Caminho TENANT (`auditedMutation` → `withTenant` → RLS), diferente do connect da
 * credencial: aqui não há segredo, então quem isola é a RLS e não um seam
 * privilegiado. O `dbAdmin` fica reservado a quem guarda chave.
 *
 * `before` carrega a política anterior de propósito — é regra de DINHEIRO. Meses
 * depois, "por que esse paciente foi cobrado 50%?" se responde pelo audit, não por
 * memória de quem mexeu.
 */
export async function saveDepositPolicy(input: SaveDepositPolicyInput): Promise<DepositPolicyDTO> {
  const user = await requireUser();
  await requirePaymentAdmin();
  const data = SaveDepositPolicySchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getDepositPolicy(clinicId);

  await auditedMutation(
    {
      action: 'payments.deposit_policy.updated',
      resourceType: 'clinic_deposit_policy',
      resourceId: clinicId,
      before,
      requestContext: ctx,
    },
    async (tx) => {
      await tx
        .insert(clinicDepositPolicy)
        .values({
          clinicId,
          enabled: data.enabled,
          percent: data.percent,
          cancellationWindowHours: data.cancellationWindowHours,
          appliesToFirstVisit: data.appliesToFirstVisit,
          appliesToReturn: data.appliesToReturn,
          updatedBy: user.userId,
        })
        .onConflictDoUpdate({
          target: clinicDepositPolicy.clinicId,
          set: {
            enabled: data.enabled,
            percent: data.percent,
            cancellationWindowHours: data.cancellationWindowHours,
            appliesToFirstVisit: data.appliesToFirstVisit,
            appliesToReturn: data.appliesToReturn,
            updatedBy: user.userId,
            updatedAt: sql`now()`,
          },
        });
      return data;
    },
  );

  metrics.emit('payments.deposit_policy.updated', {
    clinicId,
    enabled: data.enabled,
    percent: data.percent,
  });

  return getDepositPolicy(clinicId);
}
