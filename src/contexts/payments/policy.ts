/**
 * Regras do sinal — funções PURAS, sem banco e sem I/O (ADR-049, sub-fase 1.2).
 *
 * Ficam separadas de propósito: são elas que decidem se o paciente vai ser cobrado
 * e se o dinheiro volta num cancelamento. Regra de dinheiro precisa ser testável
 * sem subir banco, e precisa ser lida por um humano sem seguir cinco chamadas.
 *
 * Quem consome isto ainda não existe (chega na 1.3/1.5). O que existe é o contrato:
 * política desligada ⇒ `null` em tudo, que é o comportamento de hoje.
 */

/** Recorte da política que as regras precisam — o resto da linha não importa aqui. */
export interface DepositPolicy {
  enabled: boolean;
  /** 1..100. Percentual do valor do procedimento cobrado como sinal. */
  percent: number;
  /** Antecedência MÍNIMA para o cancelamento render estorno. 0 = basta cancelar antes. */
  cancellationWindowHours: number;
  appliesToFirstVisit: boolean;
  appliesToReturn: boolean;
}

/**
 * Estado de uma clínica que nunca configurou nada. É o mesmo que a migration 0082
 * escreve por DEFAULT — e o mesmo que vale para clínica SEM linha na tabela.
 */
export const DEPOSIT_POLICY_OFF: DepositPolicy = {
  enabled: false,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
};

/**
 * Arredonda para centavos. Gêmeo do `round2` de `financial/logic.ts` — duplicado de
 * propósito: importar dali criaria uma aresta `payments → financial` entre contexts
 * por causa de uma linha de aritmética. Uma linha repetida custa menos que um
 * acoplamento novo entre domínios de dinheiro.
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ResolveDepositArgs {
  policy: DepositPolicy;
  /** Valor cheio do procedimento, em reais. */
  basePrice: number;
  /** `true` = retorno; `false` = primeira consulta. */
  isReturn: boolean;
}

/**
 * Quanto cobrar de sinal. **`null` significa "não cobre nada"** — e é o retorno
 * para todo caso duvidoso, porque o modo de falha seguro aqui é não cobrar:
 * cobrança indevida de paciente custa confiança e estorno; não cobrar custa o
 * risco de no-show que a clínica já corre hoje.
 *
 * `null` quando: política desligada · o tipo de consulta está fora do escopo ·
 * preço ausente/não-finito/≤ 0 · o percentual resulta em zero centavos.
 */
export function resolveDepositAmount(args: ResolveDepositArgs): number | null {
  const { policy, basePrice, isReturn } = args;
  if (!policy.enabled) return null;
  if (isReturn && !policy.appliesToReturn) return null;
  if (!isReturn && !policy.appliesToFirstVisit) return null;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return null;
  if (!Number.isFinite(policy.percent) || policy.percent <= 0) return null;

  const amount = round2((basePrice * Math.min(policy.percent, 100)) / 100);
  // Sinal de R$ 0,00 não é sinal: gera cobrança inútil no gateway e um link que
  // confunde o paciente. Trata-se como "não se aplica".
  if (amount <= 0) return null;
  // Nunca cobrar mais que o procedimento, nem que o percentual venha corrompido.
  return Math.min(amount, round2(basePrice));
}

export interface RefundableCancellationArgs {
  policy: DepositPolicy;
  /** Início do atendimento. */
  startsAt: Date;
  /** Momento do cancelamento. */
  cancelledAt: Date;
}

/**
 * O cancelamento devolve o sinal?
 *
 * Regra: devolve quando o cancelamento acontece com pelo menos
 * `cancellationWindowHours` de antecedência do início. Cancelar depois do horário
 * (ou em cima dele) nunca devolve — é falta, e é justamente o que o sinal cobre.
 *
 * Datas inválidas ⇒ `false`: sem saber quando foi, o dinheiro não se move sozinho.
 * Devolver é decisão positiva; na dúvida ela não acontece automaticamente.
 */
export function isRefundableCancellation(args: RefundableCancellationArgs): boolean {
  const { policy, startsAt, cancelledAt } = args;
  const start = startsAt.getTime();
  const cancelled = cancelledAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(cancelled)) return false;

  const deadline = start - policy.cancellationWindowHours * 60 * 60 * 1000;
  return cancelled <= deadline;
}
