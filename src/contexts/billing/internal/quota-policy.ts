/**
 * Quota policy (C13 — GAP6). REGRAS separadas da CONTAGEM (que vive no ledger
 * genérico + quota.ts). Aqui: (1) como derivar a chave de dedup por dimensão,
 * (2) o efeito por dimensão (ADR-024).
 *
 * Regra comercial atual:
 *   - agendamento e conversa_ia: apenas métricas, sem limite de plano.
 *   - usuários: trava dura (assertUserQuota, no convite) — fora deste módulo.
 */
export type QuotaType = 'agendamento' | 'conversa_ia';
export type PlanLimitMetric = 'users' | 'agendamentos' | 'ai_messages';

/** Coluna de contador em usage_metrics por dimensão. */
export type UsageColumn = 'agendamentos_count' | 'conversas_ia_count';

export function metricForQuotaType(t: QuotaType): PlanLimitMetric {
  return t === 'agendamento' ? 'agendamentos' : 'ai_messages';
}

export function usageColumnForQuotaType(t: QuotaType): UsageColumn {
  return t === 'agendamento' ? 'agendamentos_count' : 'conversas_ia_count';
}

export interface LedgerKey {
  metric: PlanLimitMetric;
  subjectId: string;
  dedupKey: string;
}

/**
 * Chave de idempotência da contagem:
 *   - agendamento: 1× por appointmentId.
 *   - conversa_ia: chave histórica por (telefone, dia UTC), conservada para
 *     compatibilidade. O consumer de `ai_agent.conversation.completed` implementa
 *     a janela móvel de 24h por paciente/telefone diretamente no ledger.
 */
export function ledgerKeyFor(
  t: QuotaType,
  ctx: { appointmentId?: string; fromNumberHash?: string; dateUtc?: string },
): LedgerKey {
  if (t === 'agendamento') {
    const id = ctx.appointmentId ?? '';
    return { metric: 'agendamentos', subjectId: id, dedupKey: id };
  }
  const num = ctx.fromNumberHash ?? '';
  const day = ctx.dateUtc ?? '';
  return { metric: 'ai_messages', subjectId: num, dedupKey: `${num}:${day}` };
}

export interface QuotaDecision {
  allowed: boolean;
  remaining: number;
  nearLimit: boolean;
}

/** Efeito por dimensão (ADR-024). count = uso atual; limit = teto do plano. */
export function enforce(t: QuotaType, count: number, limit: number): QuotaDecision {
  // Agendamentos e mensagens de IA são apenas métricas. A única trava
  // comercial é `users`, aplicada por `assertUserQuota` no convite.
  void t;
  void count;
  void limit;
  return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, nearLimit: false };
}
