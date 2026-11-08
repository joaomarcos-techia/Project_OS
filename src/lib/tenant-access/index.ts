/**
 * Capacidade de ESCRITA do tenant — primitiva de plataforma (ADR-046).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE isto mora em `lib` e não em `contexts/billing`
 * ─────────────────────────────────────────────────────────────────────────────
 * A pergunta "este tenant pode escrever?" é atravessada: vale para TODA mutação
 * de TODO contexto, e o ponto onde ela precisa ser respondida é o chokepoint de
 * mutação (`idempotentMutation`), que é infraestrutura.
 *
 * A matriz de imports (eslint-plugin-boundaries) proíbe `lib → context`, e está
 * certa: infraestrutura não pode depender de regra de domínio. A separação que
 * resolve é:
 *
 *   - AQUI (plataforma): a PRIMITIVA — dado um `clinics.status`, a escrita está
 *     bloqueada? E a mecânica de checar isso dentro de uma transação.
 *   - No `billing` (domínio): a DECISÃO — o dunning escolhe o modo de acesso e
 *     escreve o status (`accessModeToClinicStatus`, `setClinicAccess`).
 *
 * Billing continua sendo o dono do "quando"; a plataforma só sabe ler o "está".
 * `contexts/billing/internal/access.ts` re-exporta daqui para manter uma única
 * fonte da verdade do predicado.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

export type ClinicStatus =
  | 'trial'
  | 'active'
  | 'suspended_readonly'
  | 'suspended'
  | 'cancelled'
  | 'pending_payment';

/**
 * Escrita (mutação de negócio) bloqueada? (ADR-016)
 *
 * É o ÚNICO enforcement de billing (ADR-046). Inadimplência nunca bloqueia login
 * nem leitura: o prontuário é registro médico-legal com guarda obrigatória de 20
 * anos (CFM 1.821/2007 — ADR-017), e trancar o profissional fora dele por
 * disputa comercial põe o produto entre ele e uma obrigação legal dele.
 */
export function isWriteBlocked(status: ClinicStatus): boolean {
  return (
    status === 'suspended_readonly' ||
    status === 'suspended' ||
    status === 'cancelled' ||
    status === 'pending_payment'
  );
}

export class ClinicAccessError extends Error {
  readonly code = 'clinic_write_blocked';
  constructor(readonly status: ClinicStatus) {
    super(`[billing] escrita bloqueada: clínica está '${status}'`);
    this.name = 'ClinicAccessError';
  }
}

/**
 * `resourceType` de pedido LGPD — direito do TITULAR (LGPD Art. 18), não da
 * clínica. Negar export/delete porque a clínica está inadimplente transferiria
 * ao paciente a punição de uma disputa comercial da qual ele não participa.
 */
const LGPD_RESOURCE_TYPE = 'lgpd_request';
const SUBSCRIPTION_REACTIVATION_RESOURCE_TYPE = 'subscription_reactivation';

export interface WriteGateInput {
  /** `audit.resourceType` da mutação. */
  resourceType: string;
  /** Presente = ator de SISTEMA (worker/outbox/AI agent), sem sessão de usuário. */
  actor?: { clinicId: string; userId: string | null } | undefined;
  /** super_admin com sessão de impersonate ativa. */
  impersonating?: boolean | undefined;
}

/**
 * `true` = a mutação deve ser bloqueada se a clínica estiver com escrita suspensa.
 *
 * As três exceções, e por que cada uma existe:
 *
 * 1. **Ator de sistema** — ADR-016 invariante 2: worker/outbox é status-agnóstico.
 *    Uma reconciliação financeira não se perde porque o billing venceu, e o AI
 *    agent responde no WhatsApp sem sessão de usuário.
 * 2. **Impersonate** — o suporte precisa conseguir agir numa clínica suspensa.
 *    Sem isto, o "entre em contato com o suporte" do aviso não resolveria nada.
 * 3. **Pedido LGPD** — direito do titular, independe da adimplência da clínica.
 */
export function shouldEnforceWriteGate(input: WriteGateInput): boolean {
  if (input.actor) return false;
  if (input.impersonating) return false;
  if (input.resourceType === LGPD_RESOURCE_TYPE) return false;
  // This audited action is the controlled path that clears clinic.status=cancelled.
  if (input.resourceType === SUBSCRIPTION_REACTIVATION_RESOURCE_TYPE) return false;
  return true;
}

/**
 * Checa o status DENTRO de uma transação já aberta.
 *
 * Roda no chokepoint (`idempotentMutation`), que já abriu o `withTenant`: uma 2ª
 * transação por mutação seria custo de conexão puro no caminho mais quente do
 * app, e leitura fora da tx poderia divergir do que a mutação enxerga.
 *
 * Fail-OPEN quando a clínica não é encontrada: `rows[0]` ausente significa que a
 * RLS não devolveu a linha (contexto de tenant ainda não aplicado, ou clínica
 * sendo criada). Bloquear aí trancaria o provisionamento — e este gate existe
 * para inadimplência, não para ser um segundo gate de tenant.
 */
export async function assertClinicCanWriteTx(tx: Tx, clinicId: string): Promise<void> {
  const rows = (await tx.execute(
    sql`SELECT c.status,
               (s.enforce_trial_deadline IS TRUE
                 AND s.billing_status = 'trial'
                 AND s.trial_ends_at <= now()) AS trial_expired,
               (s.billing_provider = 'abacatepay'
                 AND s.billing_status IN ('active','past_due')
                 AND s.current_period_end <= now()
                 AND coalesce(s.grace_period_until,s.current_period_end) <= now()) AS paid_period_expired
          FROM clinics c
          LEFT JOIN subscriptions s ON s.clinic_id = c.id
         WHERE c.id = ${clinicId}::uuid LIMIT 1`,
  )) as unknown as Array<{
    status: ClinicStatus;
    trial_expired: boolean;
    paid_period_expired: boolean;
  }>;
  const status = rows[0]?.trial_expired
    ? 'pending_payment'
    : rows[0]?.paid_period_expired
      ? 'suspended_readonly'
      : (rows[0]?.status ?? null);
  if (status && isWriteBlocked(status)) throw new ClinicAccessError(status);
}
