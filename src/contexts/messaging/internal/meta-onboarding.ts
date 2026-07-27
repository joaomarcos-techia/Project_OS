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

import { MetaConnectError, type MetaConnectFailureStage } from '../errors';

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
    body?: Record<string, string>;
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

/** Cancela a assinatura do app na WABA (no disconnect — para não receber webhook inútil). */
export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'DELETE',
    stage: 'webhook_subscription',
    token,
  });
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
