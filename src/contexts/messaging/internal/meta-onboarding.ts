/**
 * Meta Embedded Signup — chamadas Graph do fluxo de CONEXÃO (F2, self-service).
 *
 * Só HTTP (fetch + env), sem DB → vive no contexto (o guard F-01 é sobre
 * `dbAdmin`/service_role, não sobre HTTP de saída; o sender já chama o provider
 * por aqui). NÃO é um `MessagingProvider` (infra C10 congelada) — é um helper
 * dedicado ao onboarding, espelhando o padrão fetch+timeout+erro de
 * `src/lib/messaging/meta-cloud.ts`.
 *
 * Segurança: o `access_token` é segredo. NUNCA logar URLs (a troca de code carrega
 * client_secret na query), corpos crus, nem incluir o token em mensagens de erro.
 * Toda falha vira `MetaConnectError` (code estável `META_AUTH_FAILED`).
 */
import 'server-only';

import { env } from '@/lib/env';
import type { ProactiveTemplateDefinition } from '@/lib/messaging/proactive-template-catalog';

import { MetaConnectError, type MetaConnectFailureStage } from '../errors';
import type { MetaChannelProbe, MetaProbeOutcome } from './channel-health';

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'] as const;

export interface WabaPhone {
  wabaId: string;
  phoneNumberId: string;
  /** display_phone_number normalizado para `+` + dígitos (E.164-ish). */
  phoneNumber: string;
}

function onboardingEnv(): { appId: string; appSecret: string } {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  // Defesa local; o caller já roda assertWhatsappOnboardingReady() na borda.
  if (!appId || !appSecret) {
    throw new MetaConnectError('[meta] configuração de onboarding ausente');
  }
  return { appId, appSecret };
}

/**
 * Fetch genérico ao Graph. `path` NUNCA contém segredo (segredos vão em `query`,
 * que não é logada). Classifica erro como `MetaConnectError` sem vazar token.
 */
async function graphFetch<T>(
  path: string,
  init: {
    method: 'GET' | 'POST' | 'DELETE';
    stage: MetaConnectFailureStage;
    token?: string;
    query?: Record<string, string>;
    // `unknown`: o corpo de template carrega `components` aninhados.
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    const request: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(env.META_HTTP_TIMEOUT_MS),
    };
    if (init.body) request.body = JSON.stringify(init.body);
    res = await fetch(url, request);
  } catch (err) {
    // timeout / abort / reset — não inclui token; `path` é seguro (sem segredo).
    throw new MetaConnectError(`[meta] graph inalcançável (${init.method} ${path})`, {
      cause: err,
      stage: init.stage,
    });
  }

  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // Só o error.code numérico do Meta (não sensível) — nunca o corpo/URL/token.
    const code = (raw as { error?: { code?: number } } | null)?.error?.code;
    throw new MetaConnectError(`[meta] graph HTTP ${res.status}${code ? ` code=${code}` : ''}`, {
      stage: init.stage,
      graphStatus: res.status,
    });
  }
  return raw as T;
}

/** Troca o `code` do Embedded Signup por um access token (server-side). */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const { appId, appSecret } = onboardingEnv();
  const res = await graphFetch<{ access_token?: string }>('oauth/access_token', {
    method: 'GET',
    stage: 'authorization',
    query: { client_id: appId, client_secret: appSecret, code },
  });
  if (!res.access_token) {
    throw new MetaConnectError('[meta] troca de code não retornou access_token', {
      stage: 'authorization',
    });
  }
  return res.access_token;
}

/**
 * Valida que o token é válido e tem os escopos do WhatsApp Business. Evita
 * persistir uma conexão quebrada (sem permissão de gerência/mensageria).
 */
export async function validateTokenScopes(token: string): Promise<void> {
  const { appId, appSecret } = onboardingEnv();
  const res = await graphFetch<{
    data?: { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope?: string }[] };
  }>('debug_token', {
    method: 'GET',
    stage: 'permissions',
    query: { input_token: token, access_token: `${appId}|${appSecret}` },
  });
  const data = res.data;
  if (!data?.is_valid) {
    throw new MetaConnectError('[meta] token inválido (debug_token)', { stage: 'permissions' });
  }
  const scopes = new Set<string>([
    ...(data.scopes ?? []),
    ...(data.granular_scopes ?? [])
      .map((g) => g.scope)
      .filter((s): s is string => typeof s === 'string'),
  ]);
  for (const required of REQUIRED_SCOPES) {
    if (!scopes.has(required)) {
      throw new MetaConnectError(`[meta] escopo ausente: ${required}`, { stage: 'permissions' });
    }
  }
}

/**
 * Resolve `waba_id` + `phone_number_id` + número AUTORITATIVAMENTE pelo que o
 * TOKEN alcança (anti-sequestro: o `hint` do client só vale se o token o acessa).
 * Sem hint válido, fallback robusto businesses → owned WABAs → phone_numbers.
 */
export async function resolveWabaAndPhone(
  token: string,
  hint?: { wabaId?: string | undefined; phoneNumberId?: string | undefined },
): Promise<WabaPhone> {
  if (hint?.wabaId) {
    const phone = await pickPhoneFromWaba(token, hint.wabaId, hint.phoneNumberId);
    if (phone) return { wabaId: hint.wabaId, ...phone };
  }

  const businesses = await graphFetch<{ data?: { id?: string }[] }>('me/businesses', {
    method: 'GET',
    stage: 'account',
    token,
  });
  for (const biz of businesses.data ?? []) {
    if (!biz.id) continue;
    const wabas = await graphFetch<{ data?: { id?: string }[] }>(
      `${encodeURIComponent(biz.id)}/owned_whatsapp_business_accounts`,
      { method: 'GET', stage: 'account', token },
    );
    for (const waba of wabas.data ?? []) {
      if (!waba.id) continue;
      const phone = await pickPhoneFromWaba(token, waba.id, hint?.phoneNumberId);
      if (phone) return { wabaId: waba.id, ...phone };
    }
  }
  throw new MetaConnectError('[meta] nenhum número WhatsApp encontrado para a conta autorizada', {
    stage: 'account',
  });
}

/**
 * Ativa o telefone na WhatsApp Cloud API após a confirmação de posse no
 * Embedded Signup. A confirmação por SMS/voz não substitui este registro: a
 * Meta exige também um PIN próprio de verificação em duas etapas.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  registrationPin: string,
): Promise<void> {
  await graphFetch(`${encodeURIComponent(phoneNumberId)}/register`, {
    method: 'POST',
    stage: 'phone_registration',
    token,
    body: { messaging_product: 'whatsapp', pin: registrationPin },
  });
}

/** Assina o app à WABA (campo `messages`) para receber os webhooks daquele número. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    stage: 'webhook_subscription',
    token,
  });
}

export interface TemplateProvisionOutcome {
  name: string;
  status: 'created' | 'already_exists' | 'failed';
}

/**
 * Garante que os templates proativos existam na WABA do cliente.
 *
 * Com Embedded Signup a WABA é do CLIENTE, e template pertence à WABA — não há
 * como compartilhar um template aprovado entre clínicas. Como o app tem
 * `whatsapp_business_management` na WABA outorgada, ele cria os modelos por API
 * no connect, em vez de alguém cadastrar quatro modelos à mão por clínica.
 *
 * NUNCA lança. O canal funciona para conversa de serviço mesmo sem template
 * aprovado; derrubar o connect porque a Meta recusou um modelo transformaria uma
 * conexão boa em falha. Cada modelo é reportado individualmente para o operador
 * enxergar o que ficou de fora.
 *
 * Idempotente: relê os nomes existentes antes de criar, então reconectar não
 * tenta recriar nem depende de interpretar o subcode de "name already exists".
 */
export async function ensureMessageTemplates(
  wabaId: string,
  token: string,
  definitions: ProactiveTemplateDefinition[],
): Promise<TemplateProvisionOutcome[]> {
  if (definitions.length === 0) return [];

  let existing: Set<string>;
  try {
    const res = await graphFetch<{ data?: Array<{ name?: string }> }>(
      `${encodeURIComponent(wabaId)}/message_templates`,
      { method: 'GET', stage: 'template_provisioning', token, query: { fields: 'name', limit: '250' } },
    );
    existing = new Set((res.data ?? []).map((t) => t.name).filter((n): n is string => !!n));
  } catch {
    // Sem a lista não dá para decidir o que falta. Criar às cegas duplicaria
    // pedidos de revisão na Meta; melhor reportar e deixar o health/retry expor.
    return definitions.map((d) => ({ name: d.name, status: 'failed' as const }));
  }

  const outcomes: TemplateProvisionOutcome[] = [];
  for (const definition of definitions) {
    if (existing.has(definition.name)) {
      outcomes.push({ name: definition.name, status: 'already_exists' });
      continue;
    }
    try {
      await graphFetch(`${encodeURIComponent(wabaId)}/message_templates`, {
        method: 'POST',
        stage: 'template_provisioning',
        token,
        body: {
          name: definition.name,
          language: definition.languageCode,
          category: definition.category,
          components: [
            {
              type: 'BODY',
              text: definition.body,
              ...(definition.example.length > 0
                ? { example: { body_text: [definition.example] } }
                : {}),
            },
          ],
        },
      });
      outcomes.push({ name: definition.name, status: 'created' });
    } catch {
      // Uma recusa não pode impedir as outras: cada modelo é independente.
      outcomes.push({ name: definition.name, status: 'failed' });
    }
  }
  return outcomes;
}

/** Cancela a assinatura do app na WABA (no disconnect — para não receber webhook inútil). */
export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'DELETE',
    stage: 'webhook_subscription',
    token,
  });
}

// ===========================================================================
// META-001 — sondagem READ-ONLY da saúde do canal.
//
// Nenhuma destas funções muta a Meta: só GET. A reinscrição do app continua
// sendo operação externa explícita (`subscribeAppToWaba`), nunca um efeito
// colateral de abrir a tela de configurações.
// ===========================================================================

/** 4xx = o provedor NEGOU (evidência); 5xx/timeout = não sabemos (sem evidência). */
function outcomeFromGraphError(err: unknown): MetaProbeOutcome {
  const status = err instanceof MetaConnectError ? err.graphStatus : null;
  if (status !== null && status >= 400 && status < 500) return 'failed';
  return 'unknown';
}

/**
 * Lê o estado real do canal na Meta: token, escopos, WABA, número e — o que o
 * health antigo não via — se ALGUM app está inscrito para receber os webhooks
 * daquela WABA. Nunca lança: toda falha vira `unknown`/`failed` no `probe`,
 * porque uma sonda que explode não pode derrubar a tela de configurações.
 */
export async function probeMetaChannel(input: {
  token: string;
  wabaId: string | null;
  phoneNumberId: string;
  /** App que DEVE estar inscrito. `null` quando o ambiente não o configurou. */
  expectedAppId: string | null;
}): Promise<MetaChannelProbe> {
  const probe: MetaChannelProbe = {
    token: 'unknown',
    scopes: 'unknown',
    phone: 'unknown',
    waba: 'unknown',
    appSubscription: 'unknown',
    phoneStatus: 'unknown',
    accountReview: 'unknown',
  };

  // 1. Credencial + escopos (app token; não vaza o token do tenant).
  try {
    const { appId, appSecret } = onboardingEnv();
    const res = await graphFetch<{
      data?: { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope?: string }[] };
    }>('debug_token', {
      method: 'GET',
      stage: 'permissions',
      query: { input_token: input.token, access_token: `${appId}|${appSecret}` },
    });
    const data = res.data;
    if (!data?.is_valid) {
      // Token revogado/expirado: os checks seguintes não têm como ser feitos, e
      // o veredito já é `broken` por esta causa raiz.
      probe.token = 'failed';
      return probe;
    }
    probe.token = 'ok';
    const scopes = new Set<string>([
      ...(data.scopes ?? []),
      ...(data.granular_scopes ?? [])
        .map((g) => g.scope)
        .filter((s): s is string => typeof s === 'string'),
    ]);
    probe.scopes = REQUIRED_SCOPES.every((s) => scopes.has(s)) ? 'ok' : 'failed';
  } catch (err) {
    probe.token = outcomeFromGraphError(err);
    return probe;
  }

  // 2. O número persistido ainda é alcançável por esta credencial.
  try {
    const phoneRes = await graphFetch<{ status?: string }>(
      `${encodeURIComponent(input.phoneNumberId)}`,
      { method: 'GET', stage: 'account', token: input.token, query: { fields: 'id,status' } },
    );
    probe.phone = 'ok';
    // Alcançar o número não prova que ele envia. A doc é explícita: só
    // `CONNECTED` envia e recebe pela API. Campo ausente fica `unknown` — não
    // se inventa veredito a partir de uma resposta que não trouxe o dado.
    const status = phoneRes?.status;
    if (typeof status === 'string') {
      probe.phoneStatus = status.toUpperCase() === 'CONNECTED' ? 'ok' : 'failed';
    }
  } catch (err) {
    // `phoneStatus` fica `unknown` de propósito: `phone` já carrega a negativa,
    // e duplicar a causa faria a tela listar dois motivos para um problema só.
    probe.phone = outcomeFromGraphError(err);
  }

  // 3. Assinatura do webhook — a verificação que faltava. Sem `wabaId` local
  // (linhas legadas do connect super_admin, onde a coluna é opcional) não há o
  // que consultar: fica `unknown` e o estado anterior é preservado, em vez de
  // inventar um veredito.
  if (!input.wabaId) return probe;
  try {
    const res = await graphFetch<{
      data?: Array<{ id?: string; whatsapp_business_api_data?: { id?: string } }>;
    }>(`${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
      method: 'GET',
      stage: 'webhook_subscription',
      token: input.token,
    });
    probe.waba = 'ok';
    const apps = (res.data ?? [])
      .map((entry) => entry.whatsapp_business_api_data?.id ?? entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (apps.length === 0) {
      // Exatamente o estado do achado: HTTP 200 com lista vazia. Nenhum app
      // recebe os webhooks desta WABA, independente de qual seja o nosso.
      probe.appSubscription = 'failed';
    } else if (!input.expectedAppId) {
      probe.appSubscription = 'unknown';
    } else {
      probe.appSubscription = apps.includes(input.expectedAppId) ? 'ok' : 'failed';
    }
  } catch (err) {
    probe.waba = outcomeFromGraphError(err);
  }

  // 4. Revisão da conta. Só `REJECTED` é negativa: `PENDING`/`DEFERRED` são
  // estados de fila e a clínica segue atendendo — rebaixá-los marcaria como
  // quebrada uma conexão que funciona.
  //
  // Não existe sonda de método de pagamento: a Meta não expõe esse campo no nó
  // da WABA. Esta é a negativa documentada mais próxima de "a conta não pode
  // mais enviar".
  try {
    const account = await graphFetch<{ account_review_status?: string }>(
      `${encodeURIComponent(input.wabaId)}`,
      {
        method: 'GET',
        stage: 'account',
        token: input.token,
        query: { fields: 'account_review_status' },
      },
    );
    const review = account?.account_review_status;
    probe.accountReview = typeof review === 'string' && review.toUpperCase() === 'REJECTED'
      ? 'failed'
      : 'ok';
  } catch (err) {
    probe.accountReview = outcomeFromGraphError(err);
  }

  return probe;
}

/**
 * Lista os números de uma WABA com o token; escolhe o `preferPhoneId` (hint) ou o
 * primeiro. Retorna null se o token não alcança a WABA (cai no fallback).
 */
async function pickPhoneFromWaba(
  token: string,
  wabaId: string,
  preferPhoneId?: string,
): Promise<{ phoneNumberId: string; phoneNumber: string } | null> {
  let res: { data?: { id?: string; display_phone_number?: string }[] };
  try {
    res = await graphFetch(`${encodeURIComponent(wabaId)}/phone_numbers`, {
      method: 'GET',
      stage: 'account',
      token,
    });
  } catch {
    return null; // token sem acesso a esta WABA — não é a do owner.
  }
  const phones = (res.data ?? []).filter(
    (p): p is { id: string; display_phone_number?: string } => typeof p.id === 'string',
  );
  if (phones.length === 0) return null;
  const chosen = (preferPhoneId && phones.find((p) => p.id === preferPhoneId)) || phones[0]!;
  return {
    phoneNumberId: chosen.id,
    phoneNumber: normalizeDisplayPhone(chosen.display_phone_number ?? ''),
  };
}

/** `+55 11 99999-9999` → `+5511999999999`. */
function normalizeDisplayPhone(display: string): string {
  const digits = display.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}
