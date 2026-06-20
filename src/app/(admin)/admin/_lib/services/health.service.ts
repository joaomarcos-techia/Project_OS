/**
 * HealthService (C15) — DISPONIBILIDADE, não volume de uso (review #6).
 *
 * Cada provider tem um probe ATIVO (liveness reaproveitando endpoints/credenciais
 * existentes, com timeout curto) + `lastSuccessAt` do banco (contexto). O serviço
 * devolve dados estruturados `{status, reason, latencyMs, lastSuccessAt}`; a COR
 * (verde/amarelo/vermelho) é decidida na UI (review #10).
 *
 * Mapeamento de `status` (semântica de saúde, não cor):
 *   - Supabase/Gemini são dependências core → inalcançável = `down`.
 *   - Meta/Asaas seguem a regra existente: erro de envio definitivo = `down`
 *     (ProviderSendError); inalcançável/indeterminado = `degraded`
 *     (ProviderUnreachableError).
 *
 * Não cria serviço/cron novo — só lê o que já existe.
 *
 * Server-only.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

import type { HealthReportDTO, HealthStatus } from '../dto';
import { healthRepository } from '../repositories/health.repo';

const TIMEOUT_MS = 4000;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Probe {
  status: HealthStatus;
  reason: string;
  latencyMs: number | null;
}

async function probeSupabase(): Promise<Probe> {
  const t0 = Date.now();
  try {
    await dbAdmin.execute(sql`SELECT 1`);
    return { status: 'ok', reason: 'Conexão OK', latencyMs: Date.now() - t0 };
  } catch (e) {
    return { status: 'down', reason: msg(e), latencyMs: Date.now() - t0 };
  }
}

async function probeGemini(): Promise<Probe> {
  if (!env.GEMINI_API_KEY) return { status: 'down', reason: 'GEMINI_API_KEY ausente', latencyMs: null };
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const latencyMs = Date.now() - t0;
    if (res.ok) return { status: 'ok', reason: `HTTP ${res.status}`, latencyMs };
    if (res.status >= 500) return { status: 'degraded', reason: `HTTP ${res.status}`, latencyMs };
    return { status: 'down', reason: `HTTP ${res.status} (chave/quota)`, latencyMs };
  } catch (e) {
    // Core dependency inalcançável = offline → down (brief: Gemini offline → vermelho).
    return { status: 'down', reason: `inalcançável: ${msg(e)}`, latencyMs: Date.now() - t0 };
  }
}

async function probeAsaas(): Promise<Probe> {
  if (!env.ASAAS_API_KEY) return { status: 'down', reason: 'ASAAS_API_KEY ausente', latencyMs: null };
  const t0 = Date.now();
  try {
    const res = await fetch(`${env.ASAAS_BASE_URL}/myAccount`, {
      headers: { access_token: env.ASAAS_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Date.now() - t0;
    if (res.ok) return { status: 'ok', reason: `HTTP ${res.status}`, latencyMs };
    if (res.status === 401 || res.status === 403) {
      return { status: 'down', reason: `HTTP ${res.status} (auth)`, latencyMs };
    }
    return { status: 'degraded', reason: `HTTP ${res.status}`, latencyMs };
  } catch (e) {
    // Provider externo indeterminado → degraded (regra ProviderUnreachable).
    return { status: 'degraded', reason: `inalcançável: ${msg(e)}`, latencyMs: Date.now() - t0 };
  }
}

/** Meta: reachability do Graph + regra existente (failed=down, unknown=degraded). */
async function probeMeta(): Promise<Probe> {
  const t0 = Date.now();
  let reachable = true;
  let httpReason = '';
  try {
    const res = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    httpReason = `Graph HTTP ${res.status}`;
  } catch (e) {
    reachable = false;
    httpReason = `Graph inalcançável: ${msg(e)}`;
  }
  const latencyMs = Date.now() - t0;
  const sig = await healthRepository.metaSignals();

  if (sig.failed > 0) {
    return { status: 'down', reason: `${sig.failed} envio(s) falho(s) na última hora`, latencyMs };
  }
  if (!reachable) return { status: 'degraded', reason: httpReason, latencyMs };
  if (sig.unknown > 0) {
    return { status: 'degraded', reason: `${sig.unknown} envio(s) indeterminado(s) (1h)`, latencyMs };
  }
  return { status: 'ok', reason: httpReason, latencyMs };
}

export class HealthService {
  async check(): Promise<HealthReportDTO[]> {
    const checkedAt = new Date().toISOString();
    const [supabase, gemini, asaas, meta, lastSuccess] = await Promise.all([
      probeSupabase(),
      probeGemini(),
      probeAsaas(),
      probeMeta(),
      healthRepository.lastSuccesses(),
    ]);

    return [
      { provider: 'supabase', ...supabase, lastSuccessAt: null, checkedAt },
      { provider: 'gemini', ...gemini, lastSuccessAt: lastSuccess.gemini, checkedAt },
      { provider: 'meta', ...meta, lastSuccessAt: lastSuccess.meta, checkedAt },
      { provider: 'asaas', ...asaas, lastSuccessAt: lastSuccess.asaas, checkedAt },
    ];
  }
}

export const healthService = new HealthService();
