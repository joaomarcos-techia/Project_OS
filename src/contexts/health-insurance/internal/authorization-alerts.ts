/**
 * P6.6 — alertas da autorização da operadora, puros (sem banco, sem relógio):
 *   - senha vencendo: concedida, com validade informada, que vence hoje ou nos próximos
 *     `passwordDaysAhead` dias (data da clínica). A senha já vencida não é alerta: é estado
 *     ("vencida"), gravado por `expireAuthorizationsTx`;
 *   - sessões acabando: concedida, já usada, com saldo entre 1 e `sessionsRemainingAtMost`.
 *     Autorização de sessão única ainda não usada não gera alerta (não está "acabando").
 *
 * A entrega (cron `insurance-reconcile`, P12.6) ainda não existe: a tela da P6.3 usa o mesmo
 * cálculo na leitura. `alertKey` identifica o alerta de forma estável, para a entrega futura não
 * repetir o mesmo aviso; muda quando o fato muda (nova validade, novo saldo).
 */
import { authorizationDisplayState, GRANTED_AUTHORIZATION, remainingQuantity, type AuthorizationForDisplay } from './authorization-rules';

export interface AuthorizationAlertInput extends AuthorizationForDisplay {
  id: string;
}

export interface AuthorizationAlertPolicy {
  /** Quantos dias antes do vencimento da senha o alerta aparece (0 = só no dia). */
  passwordDaysAhead: number;
  /** Saldo de sessões a partir do qual o alerta aparece. */
  sessionsRemainingAtMost: number;
}

export const DEFAULT_AUTHORIZATION_ALERT_POLICY: Readonly<AuthorizationAlertPolicy> = {
  passwordDaysAhead: 3,
  sessionsRemainingAtMost: 1,
};

export type AuthorizationAlert =
  | { kind: 'password_expiring'; authorizationId: string; validUntil: string; daysLeft: number }
  | { kind: 'sessions_ending'; authorizationId: string; remaining: number; authorized: number };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function dayNumber(iso: string): number {
  const m = ISO_DAY.exec(iso);
  if (!m) throw new RangeError(`data inválida: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`data inválida: ${iso}`);
  }
  return t / 86_400_000;
}

function checkPolicy(p: AuthorizationAlertPolicy): void {
  const ok = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!ok(p.passwordDaysAhead, 60)) throw new RangeError('passwordDaysAhead deve ser inteiro entre 0 e 60');
  if (!ok(p.sessionsRemainingAtMost, 999) || p.sessionsRemainingAtMost < 1) {
    throw new RangeError('sessionsRemainingAtMost deve ser inteiro entre 1 e 999');
  }
}

/**
 * Alertas das autorizações, do mais urgente para o menos urgente. `today` é a data da clínica
 * (AAAA-MM-DD), a mesma usada por `authorizationDisplayState` e pelo vencimento gravado.
 */
export function authorizationAlerts(
  rows: ReadonlyArray<AuthorizationAlertInput>,
  today: string,
  policy: AuthorizationAlertPolicy = DEFAULT_AUTHORIZATION_ALERT_POLICY,
): AuthorizationAlert[] {
  checkPolicy(policy);
  const todayN = dayNumber(today);
  const out: AuthorizationAlert[] = [];
  for (const a of rows) {
    if (!GRANTED_AUTHORIZATION.includes(a.status)) continue;
    // Valida a data ANTES do estado mostrado: lá a comparação é por texto, e uma validade
    // malformada (ex.: "16/11/2026") sumiria como "vencida", sem alerta e sem erro.
    const validUntilN = a.passwordValidUntil ? dayNumber(a.passwordValidUntil) : null;
    const shown = authorizationDisplayState(a, today);
    if (shown === 'expired' || shown === 'consumed') continue;
    if (a.passwordValidUntil && validUntilN !== null) {
      const daysLeft = validUntilN - todayN;
      if (daysLeft >= 0 && daysLeft <= policy.passwordDaysAhead) {
        out.push({ kind: 'password_expiring', authorizationId: a.id, validUntil: a.passwordValidUntil, daysLeft });
      }
    }
    const granted = a.items.filter((i) => i.quantityAuthorized > 0);
    const authorized = granted.reduce((s, i) => s + i.quantityAuthorized, 0);
    const consumed = granted.reduce((s, i) => s + Math.min(i.quantityConsumed, i.quantityAuthorized), 0);
    const remaining = granted.reduce((s, i) => s + remainingQuantity(i), 0);
    if (consumed > 0 && remaining >= 1 && remaining <= policy.sessionsRemainingAtMost) {
      out.push({ kind: 'sessions_ending', authorizationId: a.id, remaining, authorized });
    }
  }
  const urgency = (x: AuthorizationAlert) => (x.kind === 'password_expiring' ? x.daysLeft : x.remaining - 1);
  return out.sort((x, y) => urgency(x) - urgency(y) || x.authorizationId.localeCompare(y.authorizationId) || x.kind.localeCompare(y.kind));
}

/** Identidade estável do alerta (para não repetir o mesmo aviso). Sem dado pessoal. */
export function alertKey(a: AuthorizationAlert): string {
  return a.kind === 'password_expiring'
    ? `authorization:${a.authorizationId}:password:${a.validUntil}`
    : `authorization:${a.authorizationId}:remaining:${a.remaining}`;
}
