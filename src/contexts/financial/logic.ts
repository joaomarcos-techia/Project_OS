/**
 * Financial domain logic (C9) — state machine de `lancamentos` + helpers puros.
 *
 * [R1] A transição de status vive AQUI (domínio), não num trigger de banco. O
 * trigger só barra colunas imutáveis (valor/tipo/created_via/...). Toda Server
 * Action que muda status DEVE chamar `assertLancamentoTransition` antes do UPDATE
 * (espelho de scheduling/state-machine.ts).
 *
 * Estados:
 *   pendente → parcial → pago
 *      ↓  ↘        ↓  ↘     ↓
 *   cancelado  estornado (compensação append-only)
 *
 * Terminais (cancelado / estornado): sem saída.
 * `pago` só pode ir para `estornado` (nunca volta a pendente/parcial).
 *
 * Sem `if (status === ...)` de transição em nenhum outro lugar do sistema.
 */
import { LancamentoStateError } from './errors';
import type { LancamentoStatus, LancamentoTipo } from './types';

export const LANCAMENTO_STATES = ['pendente', 'parcial', 'pago', 'cancelado', 'estornado'] as const;

export const TERMINAL_LANCAMENTO_STATES = ['cancelado', 'estornado'] as const;

/** Tabela de transições congelada. Mudar aqui exige atualizar logic.test.ts. */
const VALID_TRANSITIONS: Record<LancamentoStatus, readonly LancamentoStatus[]> = {
  pendente: ['parcial', 'pago', 'cancelado', 'estornado'],
  parcial: ['parcial', 'pago', 'cancelado', 'estornado'],
  pago: ['estornado'],
  cancelado: [],
  estornado: [],
};

export function isTerminalLancamento(status: LancamentoStatus): boolean {
  return (TERMINAL_LANCAMENTO_STATES as readonly string[]).includes(status);
}

export function canTransitionLancamento(from: LancamentoStatus, to: LancamentoStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Lança LancamentoStateError (409) quando `from → to` não é permitido. */
export function assertLancamentoTransition(from: LancamentoStatus, to: LancamentoStatus): void {
  if (!canTransitionLancamento(from, to)) {
    throw new LancamentoStateError(`transição inválida de lançamento: '${from}' → '${to}'`);
  }
}

/** Arredonda para 2 casas (centavos) — evita drift de ponto flutuante. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Status resultante de um pagamento: total pago >= valor ⇒ 'pago', senão 'parcial'.
 * Não decide cancelado/estornado (isso é ação explícita do operador).
 */
export function calcStatusPagamento(valor: number, valorPagoTotal: number): 'parcial' | 'pago' {
  return round2(valorPagoTotal) >= round2(valor) ? 'pago' : 'parcial';
}

/** Tipo do lançamento de compensação (estorno) = oposto do original. */
export function estornoTipoOposto(tipo: LancamentoTipo): LancamentoTipo {
  return tipo === 'receber' ? 'pagar' : 'receber';
}

/** Descrição do lançamento automático gerado pelo faturamento. */
export function atendimentoDescricao(procedureName: string): string {
  return `Atendimento - ${procedureName}`;
}

/** Descrição do lançamento de estorno (referencia o original). */
export function estornoDescricao(originalDescricao: string): string {
  return `Estorno - ${originalDescricao}`;
}

/**
 * Offset (ms) da timezone `tz` no instante `at`: wall-clock local − UTC.
 * Ex.: America/Sao_Paulo (UTC-3) → −10_800_000. Usa Intl (DST-aware).
 */
export function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - at.getTime();
}

/** Janela [from, to) do dia atual na timezone da clínica, como instantes UTC. */
export function clinicDayBounds(tz: string, now: Date = new Date()): { from: Date; to: Date } {
  const off = tzOffsetMs(tz, now);
  const localNow = new Date(now.getTime() + off); // wall-clock local em campos UTC
  const localMidnight = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  const from = new Date(localMidnight - off);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/** Janela [1º do mês 00:00, 1º do mês seguinte 00:00) no fuso da clínica (UTC). */
export function clinicMonthBounds(tz: string, now: Date = new Date()): { from: Date; to: Date } {
  const off = tzOffsetMs(tz, now);
  const localNow = new Date(now.getTime() + off);
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1) - off);
  const to = new Date(Date.UTC(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1) - off);
  return { from, to };
}
