/**
 * BILLING-001 — período de cobrança derivado do vencimento autoritativo.
 *
 * `markInvoicePaid()` marcava a invoice `paid`, ativava a subscription e zerava
 * o dunning, mas NUNCA preenchia `invoice.period_start/period_end` nem avançava
 * `subscriptions.current_period_*`. A clínica virava `active` com o ciclo local
 * ainda apontando para o trial encerrado, e a partir daí cancelamento "ao fim do
 * ciclo", prorrata, renovação, dunning e a tela de assinatura passavam a decidir
 * sobre uma data vencida.
 *
 * Aritmética PURA sobre `YYYY-MM-DD`, sem `Date` local: `due_date` é uma
 * data-calendário (coluna `date`), e convertê-la para instante introduziria o
 * fuso do servidor numa decisão que não tem hora. Um pagamento no dia 1º às 00h
 * de Brasília não pode virar o dia anterior porque o processo roda em UTC.
 */

export type BillingCycleCode = 'monthly' | 'annual';

export interface BillingPeriod {
  /** Início do período, `YYYY-MM-DD` (= vencimento da cobrança paga). */
  start: string;
  /** Fim exclusivo do período, `YYYY-MM-DD` (= próxima renovação). */
  end: string;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(value: string): { y: number; m: number; d: number } {
  const match = YMD.exec(value);
  if (!match) throw new Error(`[billing] data-calendário inválida: ${value}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`[billing] data-calendário inválida: ${value}`);
  }
  return { y, m, d };
}

/** Dia 0 do mês seguinte = último dia deste mês. Cobre ano bissexto. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Soma meses de CALENDÁRIO com clamp de fim de mês: 31/01 + 1 mês = 28/02 (ou
 * 29/02 em bissexto), não 03/03. Sem o clamp, o Postgres aceitaria a data
 * inválida como overflow e o ciclo pularia um mês.
 *
 * Não há deriva acumulada: cada período é derivado do `due_date` da PRÓPRIA
 * cobrança, que vem do provedor, e não do fim do período anterior.
 */
export function addCalendarMonths(ymd: string, months: number): string {
  const { y, m, d } = parseYmd(ymd);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/**
 * Período aberto pela cobrança paga. A fonte é o `due_date` da invoice — a data
 * que o provedor cobrou — e não `now()`: um webhook atrasado, um reconcile do
 * dia seguinte e um replay têm que produzir exatamente o mesmo período.
 */
export function billingPeriodFor(dueDate: string, cycle: BillingCycleCode): BillingPeriod {
  return {
    start: dueDate,
    end: addCalendarMonths(dueDate, cycle === 'annual' ? 12 : 1),
  };
}

/**
 * O ciclo só avança para FRENTE. Pagar hoje uma cobrança vencida de dois meses
 * atrás regulariza o acesso, mas não pode puxar `current_period_end` para o
 * passado — nem pular o ciclo corrente. `null` = subscription sem período ainda
 * (o caso do trial), onde qualquer período é um avanço.
 */
export function shouldAdvanceSubscriptionPeriod(
  currentPeriodEnd: Date | null,
  candidateEnd: string,
): boolean {
  if (currentPeriodEnd === null) return true;
  // Comparação por data-calendário em UTC: `candidateEnd` não tem hora, e
  // `current_period_end` foi gravado como meia-noite UTC deste mesmo formato.
  return candidateEnd > currentPeriodEnd.toISOString().slice(0, 10);
}
