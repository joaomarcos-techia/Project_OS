/**
 * Platform Settings reader (server-only) — flags/kill-switches GLOBAIS.
 *
 * Lê `platform_settings` (tabela global-protected, sem dado tenant) via dbAdmin.
 * Hot path (crons + handler da IA leem a cada tick/mensagem): cache em memória
 * por instância com TTL curto (30s).
 *
 * FAIL-SAFE (invariante): qualquer falha de leitura → retorna o `fallback`
 * SEGURO. Config nunca derruba operação (spec). Erros NÃO são cacheados (próxima
 * chamada tenta de novo).
 *
 * Escrita NÃO vive aqui — é exclusivamente via superAdminAction
 * (admin/actions/platform-settings.ts), auditada.
 */
import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { platformSettings, type PlatformSettingRow } from '@/lib/db/schema/infra/platform-settings';

import { coerceAiMode, coerceBool, type AiAgentMode } from './coerce';

export type { AiAgentMode };

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  exp: number;
}
const cache = new Map<string, CacheEntry>();

/** Chaves canônicas de flag (allowlist; a action só aceita estas). */
export const PLATFORM_FLAG_KEYS = {
  proactiveEnabled: 'proactive_jobs.enabled',
  aiAgentMode: 'ai_agent.mode',
} as const;

async function readRaw(key: string): Promise<unknown> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.value;
  const [row] = await dbAdmin
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  const value = row ? row.value : undefined;
  cache.set(key, { value, exp: now + CACHE_TTL_MS });
  return value;
}

/**
 * Lê o valor (jsonb) de uma flag. `fallback` em ausência OU em qualquer erro.
 */
export async function getPlatformSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await readRaw(key);
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

// ---- Wrappers tipados (defaults SEGUROS) --------------------------------

/** Jobs proativos ligados? Default true (não silenciar a clínica por erro). */
export async function isProactiveEnabled(): Promise<boolean> {
  return coerceBool(await getPlatformSetting<unknown>(PLATFORM_FLAG_KEYS.proactiveEnabled, true), true);
}

/** Modo do agente. Default 'normal' (não degradar por erro de config). */
export async function getAiAgentMode(): Promise<AiAgentMode> {
  return coerceAiMode(await getPlatformSetting<unknown>(PLATFORM_FLAG_KEYS.aiAgentMode, 'normal'));
}

/**
 * Leitura COM metadados (value + updatedBy + updatedAt) para o painel admin.
 * Sem cache (admin quer estado fresco). dbAdmin: tabela global, sem dado tenant.
 */
export async function getPlatformSettingsMeta(
  keys: readonly string[],
): Promise<PlatformSettingRow[]> {
  if (keys.length === 0) return [];
  return dbAdmin
    .select()
    .from(platformSettings)
    .where(inArray(platformSettings.key, keys as string[]));
}
