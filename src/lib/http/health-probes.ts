/**
 * Sondas de alcançabilidade das dependências externas (C2).
 *
 * POR QUE existe: os checks de `/api/health` eram `checkConfig(Boolean(env.X))`
 * — perguntavam "a variável está setada?", não "o provedor está no ar?". Um
 * apagão regional da Meta, com o secret configurado, reportava `meta: ok` e o
 * uptime monitor ficava VERDE enquanto as mensagens empilhavam como `failed`.
 * Pior: `runbooks/gemini-down.md` mandava usar `/api/health → gemini: degraded`
 * como sintoma primário — um passo de runbook que nunca dispararia.
 *
 * DESENHO — dois níveis, de propósito:
 *  - RASO (`deep=false`): presença de env, zero rede. É o poll barato de 1-5min.
 *  - PROFUNDO (`deep=true`): alcançabilidade real. É o que o monitor externo usa
 *    (`?strict=1` → deep), com TIMEOUT curto e CACHE por instância, para não
 *    martelar (nem custear) provedor a cada poll.
 *
 * Semântica preservada do slo.md: dependência externa nunca é `down` — só o
 * banco derruba tudo. Provedor inalcançável = `degraded`.
 *
 * Nunca lança: um health check que quebra a si mesmo é pior que não ter.
 */
import 'server-only';

import { env } from '@/lib/env';

export type CheckStatus = 'ok' | 'degraded' | 'down';

export interface ExternalChecks {
  gemini: CheckStatus;
  meta: CheckStatus;
  asaas: CheckStatus;
  redis: CheckStatus;
}

/** Curto de propósito: o health tem de responder rápido mesmo com provedor lento. */
const PING_TIMEOUT_MS = 2_000;
/** TTL do cache por instância — o monitor bate a cada ~3min; isto evita martelar. */
const CACHE_TTL_MS = 60_000;

let cache: { at: number; value: ExternalChecks } | null = null;

const present = (v: string | undefined): CheckStatus => (v ? 'ok' : 'degraded');

/**
 * Um probe HTTP genérico. `accept` decide o que conta como saudável — difere por
 * provedor: a raiz da Graph API responde 4xx sem token e ainda assim PROVA
 * alcançabilidade, enquanto um 401 do Asaas significa credencial inválida.
 */
async function probe(url: string, accept: (res: Response) => boolean, init?: RequestInit) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return accept(res) ? 'ok' : 'degraded';
  } catch {
    // timeout, DNS, TLS, rede — indistinguíveis do ponto de vista do operador:
    // a dependência não está utilizável agora.
    return 'degraded';
  }
}

async function pingGemini(): Promise<CheckStatus> {
  if (!env.GEMINI_API_KEY) return 'degraded';
  return probe(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
    (res) => res.ok,
  );
}

async function pingMeta(): Promise<CheckStatus> {
  if (!env.META_APP_SECRET) return 'degraded';
  // Raiz da Graph API: qualquer resposta < 500 prova que o provedor está de pé.
  // NÃO manda token — este probe checa alcançabilidade, não credencial (o token
  // é per-clínica e vive cifrado no banco; testá-lo aqui seria outro problema).
  return probe(
    `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/`,
    (res) => res.status < 500,
  );
}

async function pingAsaas(): Promise<CheckStatus> {
  if (!env.ASAAS_API_KEY) return 'degraded';
  return probe(`${env.ASAAS_BASE_URL}/myAccount`, (res) => res.ok, {
    headers: { access_token: env.ASAAS_API_KEY },
  });
}

async function pingRedis(): Promise<CheckStatus> {
  // M3: o rate-limit é fail-open — sob outage do Upstash o sistema segue
  // servindo SEM proteção de brute-force e ninguém fica sabendo. Este check é o
  // que torna essa degradação visível.
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return 'degraded';
  return probe(`${env.UPSTASH_REDIS_REST_URL}/ping`, (res) => res.ok, {
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
}

export async function checkExternals(deep: boolean): Promise<ExternalChecks> {
  if (!deep) {
    return {
      gemini: present(env.GEMINI_API_KEY),
      meta: present(env.META_APP_SECRET),
      asaas: present(env.ASAAS_API_KEY),
      redis: present(env.UPSTASH_REDIS_REST_URL),
    };
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const [gemini, meta, asaas, redis] = await Promise.all([
    pingGemini(),
    pingMeta(),
    pingAsaas(),
    pingRedis(),
  ]);
  const value = { gemini, meta, asaas, redis };
  cache = { at: Date.now(), value };
  return value;
}
