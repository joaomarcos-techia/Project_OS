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
import { metrics } from '@/lib/observability/metrics';

export type CheckStatus = 'ok' | 'degraded' | 'down';

export interface ExternalChecks {
  gemini: CheckStatus;
  meta: CheckStatus;
  asaas: CheckStatus;
  redis: CheckStatus;
  /**
   * Por que cada provedor não está `ok`. Vazio quando tudo certo.
   *
   * POR QUE existe (incidente 2026-07-20): a 1ª versão deste módulo devolvia só
   * `degraded` e engolia a causa no catch. Em produção isso rendeu
   * `asaas: degraded` sem NADA no Sentry e sem forma de distinguir timeout,
   * 401 ou env ausente — um swallow silencioso, a mesma classe do achado M2 que
   * esta própria remediação fechou. "O quê" sem "por quê" não é observabilidade.
   */
  reasons: Record<string, string>;
}

/** Causa legível e de baixa cardinalidade (vira label de métrica). */
type Reason = string;

/** Curto de propósito: o health tem de responder rápido mesmo com provedor lento. */
const PING_TIMEOUT_MS = 2_000;
/** TTL do cache por instância — o monitor bate a cada ~3min; isto evita martelar. */
const CACHE_TTL_MS = 60_000;

let cache: { at: number; value: ExternalChecks } | null = null;

const present = (v: string | undefined): Outcome =>
  v ? { status: 'ok' } : { status: 'degraded', reason: 'not_configured' };

interface Outcome {
  status: CheckStatus;
  reason?: Reason;
}

/**
 * Um probe HTTP genérico. `accept` decide o que conta como saudável — difere por
 * provedor: a raiz da Graph API responde 4xx sem token e ainda assim PROVA
 * alcançabilidade, enquanto um 401 do Asaas significa credencial inválida.
 *
 * Sempre devolve a CAUSA junto do status. `http_<código>` distingue "credencial
 * recusada" (401/403) de "provedor doente" (5xx) — incidentes com runbooks
 * completamente diferentes, que a versão anterior colapsava em `degraded`.
 */
async function probe(
  url: string,
  accept: (res: Response) => boolean,
  init?: RequestInit,
): Promise<Outcome> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return accept(res) ? { status: 'ok' } : { status: 'degraded', reason: `http_${res.status}` };
  } catch (err) {
    // `AbortSignal.timeout` lança TimeoutError; o resto é DNS/TLS/conexão.
    // Separar os dois importa: timeout costuma ser saturação/latência do
    // provedor; `network` costuma ser DNS ou saída bloqueada.
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
    return { status: 'degraded', reason };
  }
}

async function pingGemini(): Promise<Outcome> {
  if (!env.GEMINI_API_KEY) return present(undefined);
  return probe(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
    (res) => res.ok,
  );
}

async function pingMeta(): Promise<Outcome> {
  if (!env.META_APP_SECRET) return present(undefined);
  // Raiz da Graph API: qualquer resposta < 500 prova que o provedor está de pé.
  // NÃO manda token — este probe checa alcançabilidade, não credencial (o token
  // é per-clínica e vive cifrado no banco; testá-lo aqui seria outro problema).
  return probe(
    `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/`,
    (res) => res.status < 500,
  );
}

async function pingAsaas(): Promise<Outcome> {
  if (!env.ASAAS_API_KEY) return present(undefined);
  // `/myAccount` responde 401 sem credencial válida e 2xx com — verificado
  // contra a API real (a auditoria sugeriu este caminho SEM confirmá-lo).
  // Diferente do Meta, aqui o 2xx é exigido de propósito: uma key de billing
  // recusada é degradação real, não só "provedor no ar". O `reason` diz qual
  // dos dois é — sem ele, `sandbox×prod trocado` fica indistinguível de outage.
  return probe(`${env.ASAAS_BASE_URL}/myAccount`, (res) => res.ok, {
    headers: { access_token: env.ASAAS_API_KEY },
  });
}

async function pingRedis(): Promise<Outcome> {
  // M3: o rate-limit é fail-open — sob outage do Upstash o sistema segue
  // servindo SEM proteção de brute-force e ninguém fica sabendo. Este check é o
  // que torna essa degradação visível.
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return present(undefined);
  return probe(`${env.UPSTASH_REDIS_REST_URL}/ping`, (res) => res.ok, {
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
}

function assemble(entries: Array<[string, Outcome]>): ExternalChecks {
  const reasons: Record<string, string> = {};
  for (const [name, o] of entries) {
    if (o.reason) reasons[name] = o.reason;
  }
  const byName = Object.fromEntries(entries.map(([n, o]) => [n, o.status]));
  return { ...(byName as unknown as ExternalChecks), reasons };
}

export async function checkExternals(deep: boolean): Promise<ExternalChecks> {
  if (!deep) {
    return assemble([
      ['gemini', present(env.GEMINI_API_KEY)],
      ['meta', present(env.META_APP_SECRET)],
      ['asaas', present(env.ASAAS_API_KEY)],
      ['redis', present(env.UPSTASH_REDIS_REST_URL)],
    ]);
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const [gemini, meta, asaas, redis] = await Promise.all([
    pingGemini(),
    pingMeta(),
    pingAsaas(),
    pingRedis(),
  ]);
  const entries: Array<[string, Outcome]> = [
    ['gemini', gemini],
    ['meta', meta],
    ['asaas', asaas],
    ['redis', redis],
  ];

  // Emite SÓ na medição fresca (o cache hit não re-emite) e SÓ para quem está
  // degradado. Sem isto, o operador vê `degraded` no corpo do health e não tem
  // série temporal nenhuma para responder "desde quando?" nem "é intermitente?".
  for (const [provider, o] of entries) {
    if (o.status !== 'ok') {
      metrics.emit('health.external.degraded', { provider, reason: o.reason ?? 'unknown' });
    }
  }

  const value = assemble(entries);
  cache = { at: Date.now(), value };
  return value;
}
