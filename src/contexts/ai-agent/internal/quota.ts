/**
 * Teto de custo do agente por clínica (auditoria 2026-09-10, item 11).
 *
 * ===================================================================
 * O que existia antes
 * ===================================================================
 * Este arquivo era um placeholder declarado: `checkQuota` devolvia
 * `blocked: false` e `limitUsd: Infinity`, e — pior — NENHUM caller no
 * repositório inteiro o invocava. Os tetos existentes do agente
 * (`MAX_TOOL_ROUNDS`, `MAX_MUTATIONS_PER_TURN`, `MAX_PROMPT_CHARS`) limitam
 * UM turno; nada limitava a soma dos turnos. Um loop de integração, um
 * reprocessamento em rajada do outbox ou um contato hostil mandando mensagem
 * em série gastavam sem piso, sem alerta e sem parada — o limite prático era
 * a fatura no fim do mês.
 *
 * ===================================================================
 * O que passa a valer
 * ===================================================================
 * Janela deslizante de 60 minutos por clínica, somada de `ai_messages.cost_usd`
 * — a MESMA coluna que o turno grava, então o teto mede o gasto real, não uma
 * estimativa paralela que envelhece. Estourou: o turno responde o fallback
 * operacional SEM chamar o provider (custo zero) e o handler emite
 * `ai_agent.quota.blocked`.
 *
 * Três decisões que valem explicação:
 *
 *  1. O TETO É ARQUITETURA, NÃO PREFERÊNCIA. Igual aos outros orçamentos do
 *     ADR-022: constante em `limits.ts`, mudança por commit. Configurável por
 *     clínica, um teto de gasto vira o primeiro campo que alguém sobe às 3h
 *     para "destravar o cliente" — e aí não é mais teto.
 *
 *  2. A JANELA É POR CLÍNICA, NÃO GLOBAL. Uma clínica em loop não pode
 *     derrubar o agente das outras; e um teto global esconderia justamente o
 *     tenant anômalo, que é o sinal que interessa.
 *
 *  3. CORRIDA ACEITA E LIMITADA. A verificação lê antes de o turno gravar seu
 *     custo, então N turnos paralelos podem passar juntos e ultrapassar o teto
 *     em até `OUTBOX_PARALLELISM × custo-de-um-turno` (ordem de centavos).
 *     Fechar essa janela exigiria reserva transacional antes da chamada ao
 *     LLM — que roda FORA de transação por decisão do R2/ADR-022. O
 *     ultrapasse é limitado e não recorrente: o próximo turno já lê o valor
 *     gravado e bloqueia.
 *
 * O que isto NÃO é: um teto de plano comercial (isso é do Billing, por
 * `usage_metrics`), nem proteção contra abuso de um contato específico
 * (isso é rate limit por número, que continua fora deste arquivo).
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { AI_COST_WINDOW_MINUTES, MAX_AI_COST_USD_PER_CLINIC_WINDOW } from '../limits';
import { aiMessages } from '../schema';

export interface QuotaCheck {
  /** true → o turno NÃO pode chamar o provider. */
  blocked: boolean;
  /** Gasto somado na janela, em USD. */
  spendUsd: number;
  /** Teto vigente, em USD. */
  limitUsd: number;
  /** Tamanho da janela, em minutos — vai para a métrica e para o teste. */
  windowMinutes: number;
}

/**
 * Soma o custo da janela e compara com o teto. Só LÊ: quem decide o que fazer
 * com `blocked` é o handler do turno.
 *
 * `created_at` é a partition key de `ai_messages`, então o filtro por janela
 * poda para a partição do mês corrente antes de tocar o índice por clínica.
 */
export async function checkQuota(tx: Tx, clinicId: string): Promise<QuotaCheck> {
  const [row] = await tx
    .select({ spend: sql<string>`COALESCE(SUM(${aiMessages.costUsd}), 0)` })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.clinicId, clinicId),
        gte(
          aiMessages.createdAt,
          sql`now() - (${AI_COST_WINDOW_MINUTES}::text || ' minutes')::interval`,
        ),
      ),
    );

  // `numeric` volta como string no driver; Number() aqui é a única conversão.
  const spendUsd = Number(row?.spend ?? 0);
  return {
    // `>=` e não `>`: bater exatamente no teto já é o teto.
    blocked: Number.isFinite(spendUsd) && spendUsd >= MAX_AI_COST_USD_PER_CLINIC_WINDOW,
    spendUsd,
    limitUsd: MAX_AI_COST_USD_PER_CLINIC_WINDOW,
    windowMinutes: AI_COST_WINDOW_MINUTES,
  };
}
