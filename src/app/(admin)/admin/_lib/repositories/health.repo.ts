/**
 * HealthRepository (C15) — sinais de "último sucesso" por provider, no banco.
 *
 * Complementa o probe ATIVO do HealthService (review #6): o probe mede
 * disponibilidade agora; `lastSuccessAt` distingue "provider morto" de "ninguém
 * usou". Janela de 7 dias: ausência = sem sucesso recente (sinal, não erro).
 * Único ponto que toca dbAdmin para esta área.
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { aiMessages } from '@/contexts/ai-agent/schema';
import { paymentAttempts } from '@/contexts/billing/schema';
import { outboundMessages } from '@/contexts/messaging/schema';
import { dbAdmin } from '@/lib/db';

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const int = (raw: unknown): number => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export interface ProviderLastSuccess {
  gemini: string | null;
  meta: string | null;
  asaas: string | null;
}

/** Sinais de envio Meta na última hora (regra existente: failed vs unknown). */
export interface MetaSignals {
  failed: number;
  unknown: number;
  accepted: number;
}

export class HealthRepository {
  async lastSuccesses(): Promise<ProviderLastSuccess> {
    const recent = sql`now() - interval '7 days'`;

    const [g] = await dbAdmin
      .select({ at: sql<string | null>`MAX(${aiMessages.createdAt})` })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.direction, 'out'),
          sql`${aiMessages.model} IS NOT NULL`,
          sql`${aiMessages.createdAt} >= ${recent}`,
        ),
      );

    const [m] = await dbAdmin
      .select({ at: sql<string | null>`MAX(${outboundMessages.sentAt})` })
      .from(outboundMessages)
      .where(and(eq(outboundMessages.status, 'accepted'), sql`${outboundMessages.sentAt} >= ${recent}`));

    const [a] = await dbAdmin
      .select({ at: sql<string | null>`MAX(${paymentAttempts.createdAt})` })
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.status, 'confirmed'), sql`${paymentAttempts.createdAt} >= ${recent}`));

    return { gemini: iso(g?.at ?? null), meta: iso(m?.at ?? null), asaas: iso(a?.at ?? null) };
  }

  /** Contagens de status de envio Meta na última hora (regra de saúde existente). */
  async metaSignals(): Promise<MetaSignals> {
    const [r] = await dbAdmin
      .select({
        failed: sql<number>`(COUNT(*) FILTER (WHERE ${outboundMessages.status} = 'failed'))::int`,
        unknown: sql<number>`(COUNT(*) FILTER (WHERE ${outboundMessages.status} = 'unknown'))::int`,
        accepted: sql<number>`(COUNT(*) FILTER (WHERE ${outboundMessages.status} = 'accepted'))::int`,
      })
      .from(outboundMessages)
      .where(sql`${outboundMessages.createdAt} >= now() - interval '1 hour'`);
    return { failed: int(r?.failed), unknown: int(r?.unknown), accepted: int(r?.accepted) };
  }
}

export const healthRepository = new HealthRepository();
