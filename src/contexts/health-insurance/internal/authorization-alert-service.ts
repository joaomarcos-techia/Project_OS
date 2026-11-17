/**
 * P6.6 — avisos de autorização ENTREGUES à clínica (migration 0166, `hi_authorization_alerts`).
 *
 * O aviso nasce na manutenção do fim do `financial-reconcile` (ator de sistema), sem depender de
 * alguém abrir a tela:
 *   - senha vencendo e sessões acabando: o mesmo cálculo puro da tela (`authorization-alerts.ts`);
 *   - senha vencida: autorização vencida nos últimos `EXPIRED_ALERT_LOOKBACK_DAYS` dias (lida do
 *     banco, não do instante do vencimento: uma falha na hora não perde o aviso);
 *   - operadora demorando: pedido sem resposta há mais de `AWAITING_OPERATOR_ALERT_DAYS` dias.
 *
 * Garantias:
 *   - um aviso por FATO: a chave estável é única por clínica no banco (rodar de novo não repete);
 *   - o aviso que deixou de valer é ENCERRADO (a operadora respondeu, a senha mudou, o saldo mudou,
 *     a autorização venceu ou foi usada): nada de aviso obsoleto aberto;
 *   - clínica com o módulo desligado, em avaliação ou com a assinatura parada (D24) não recebe aviso
 *     novo nem entrega: o estado continua sendo mantido (vencimento), só não há operação;
 *   - `detail` só com datas e contagens. Nenhum nome, carteirinha, senha ou dado clínico.
 *
 * A entrega é pedida pelo outbox, na MESMA transação que marca o lote (ver
 * `handlers/authorization-alerts-delivery.ts`): no máximo `MAX_DELIVERY_BATCHES_PER_DAY` lotes por
 * clínica em 24 horas.
 */
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { getPremiumDenialTx } from '@/lib/premium-access';

import { HEALTH_INSURANCE_EVENTS } from '../events';

import { alertKey, authorizationAlerts, type AuthorizationAlertInput } from './authorization-alerts';
import type { AuthorizationStatus } from './authorization-rules';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Row = Record<string, unknown>;

/** Pedido à operadora sem resposta há mais que isto (dias) vira aviso. */
export const AWAITING_OPERATOR_ALERT_DAYS = 3;
/** Autorização vencida há até isto (dias) ainda gera o aviso de senha vencida. */
export const EXPIRED_ALERT_LOOKBACK_DAYS = 7;
/** Teto de lotes de entrega por clínica em 24 horas (controle de frequência). */
export const MAX_DELIVERY_BATCHES_PER_DAY = 3;

export const AUTHORIZATION_ALERT_KINDS = ['password_expiring', 'password_expired', 'sessions_ending', 'operator_overdue'] as const;
export type AuthorizationAlertKind = (typeof AUTHORIZATION_ALERT_KINDS)[number];

/** Avisos que acompanham um fato que pode deixar de valer (os de senha vencida ficam até serem vistos). */
const REVOCABLE_KINDS: readonly AuthorizationAlertKind[] = ['password_expiring', 'sessions_ending', 'operator_overdue'];

export interface AuthorizationAlertFact {
  authorizationId: string;
  kind: AuthorizationAlertKind;
  key: string;
  /** Só datas e contagens. */
  detail: Record<string, string | number>;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Fatos de aviso do momento (puro). `expired` são as autorizações vencidas recentemente;
 * `overdue`, os pedidos parados na operadora.
 */
export function authorizationAlertFacts(input: {
  today: string;
  granted: ReadonlyArray<AuthorizationAlertInput>;
  overdue: ReadonlyArray<{ id: string; requestedOn: string }>;
  expired: ReadonlyArray<{ id: string; validUntil: string }>;
}): AuthorizationAlertFact[] {
  if (!ISO_DAY.test(input.today)) throw new RangeError(`data inválida: ${input.today}`);
  const facts: AuthorizationAlertFact[] = [];
  for (const a of authorizationAlerts(input.granted, input.today)) {
    facts.push(
      a.kind === 'password_expiring'
        ? { authorizationId: a.authorizationId, kind: a.kind, key: alertKey(a), detail: { validUntil: a.validUntil, daysLeft: a.daysLeft } }
        : { authorizationId: a.authorizationId, kind: a.kind, key: alertKey(a), detail: { remaining: a.remaining, authorized: a.authorized } },
    );
  }
  for (const o of input.overdue) {
    if (!ISO_DAY.test(o.requestedOn)) throw new RangeError(`data inválida: ${o.requestedOn}`);
    const days = dayNumber(input.today) - dayNumber(o.requestedOn);
    if (days <= AWAITING_OPERATOR_ALERT_DAYS) continue;
    facts.push({ authorizationId: o.id, kind: 'operator_overdue', key: `authorization:${o.id}:overdue:${o.requestedOn}`, detail: { requestedOn: o.requestedOn, days } });
  }
  for (const e of input.expired) {
    if (!ISO_DAY.test(e.validUntil)) throw new RangeError(`data inválida: ${e.validUntil}`);
    facts.push({ authorizationId: e.id, kind: 'password_expired', key: `authorization:${e.id}:expired:${e.validUntil}`, detail: { validUntil: e.validUntil } });
  }
  return facts;
}

/** Data da clínica e as autorizações concedidas, na forma do cálculo dos alertas. */
export async function loadAuthorizationAlertInputsTx(
  tx: Tx,
  clinicId: string,
): Promise<{ today: string; granted: AuthorizationAlertInput[] } | null> {
  const [today] = (await tx.execute(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS d
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`)) as unknown as Array<{ d: string }>;
  if (!today) return null;
  const auths = (await tx.execute(sql`
    SELECT a.id::text AS id, a.status::text AS status, a.password_valid_until::text AS valid_until,
           coalesce((SELECT json_agg(json_build_object('quantityAuthorized', coalesce(i.quantity_authorized, 0),
                                                      'quantityConsumed', coalesce(i.quantity_consumed, 0)))
                       FROM public.hi_authorization_items i
                      WHERE i.clinic_id = a.clinic_id AND i.authorization_id = a.id), '[]'::json) AS items
      FROM public.hi_authorizations a
     WHERE a.clinic_id = ${clinicId}::uuid AND a.status IN ('authorized', 'partially_authorized')`)) as unknown as Row[];
  return {
    today: today.d,
    granted: auths.map((r) => ({
      id: String(r.id),
      status: r.status as AuthorizationStatus,
      passwordValidUntil: r.valid_until ? String(r.valid_until) : null,
      // O driver pode devolver o json_agg como texto.
      items: (typeof r.items === 'string' ? JSON.parse(r.items) : r.items ?? []) as Array<{ quantityAuthorized: number; quantityConsumed: number }>,
    })),
  };
}

export interface AlertSyncResult {
  /** A clínica opera Convênios (módulo ligado e assinatura paga e ativa)? Senão, nada é criado. */
  operable: boolean;
  created: number;
  cancelled: number;
  deliveryRequested: number;
}

/** Módulo ligado E sem negativa comercial (D24), sem emitir métrica de negativa. */
export async function isConveniosOperableTx(tx: Tx, clinicId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`,
  )) as unknown as Array<{ enabled: boolean | null }>;
  if (rows[0]?.enabled !== true) return false;
  return (await getPremiumDenialTx(tx, clinicId, 'health_insurance')) === null;
}

/**
 * Sincroniza os avisos de UMA clínica (na transação dela): cria os fatos novos, encerra os
 * obsoletos e pede a entrega do que ainda não foi entregue. Idempotente.
 */
export async function syncAuthorizationAlertsTx(tx: Tx, clinicId: string): Promise<AlertSyncResult> {
  const result: AlertSyncResult = { operable: false, created: 0, cancelled: 0, deliveryRequested: 0 };
  if (!(await isConveniosOperableTx(tx, clinicId))) return result;
  result.operable = true;
  const inputs = await loadAuthorizationAlertInputsTx(tx, clinicId);
  if (!inputs) return result;
  const overdue = (await tx.execute(sql`
    SELECT a.id::text AS id, a.requested_on::text AS requested_on
      FROM public.hi_authorizations a
     WHERE a.clinic_id = ${clinicId}::uuid AND a.status IN ('requested', 'pending_operator')
       AND a.requested_on < ${inputs.today}::date - ${AWAITING_OPERATOR_ALERT_DAYS}::int`)) as unknown as Array<{ id: string; requested_on: string }>;
  const expired = (await tx.execute(sql`
    SELECT a.id::text AS id, a.password_valid_until::text AS valid_until
      FROM public.hi_authorizations a
     WHERE a.clinic_id = ${clinicId}::uuid AND a.status = 'expired' AND a.password_valid_until IS NOT NULL
       AND a.password_valid_until >= ${inputs.today}::date - ${EXPIRED_ALERT_LOOKBACK_DAYS}::int`)) as unknown as Array<{ id: string; valid_until: string }>;
  const facts = authorizationAlertFacts({
    today: inputs.today,
    granted: inputs.granted,
    overdue: overdue.map((o) => ({ id: o.id, requestedOn: o.requested_on })),
    expired: expired.map((e) => ({ id: e.id, validUntil: e.valid_until })),
  });

  for (const f of facts) {
    const inserted = (await tx.execute(sql`
      INSERT INTO public.hi_authorization_alerts (clinic_id, authorization_id, kind, alert_key, detail)
      VALUES (${clinicId}::uuid, ${f.authorizationId}::uuid, ${f.kind}, ${f.key}, ${JSON.stringify(f.detail)}::jsonb)
      ON CONFLICT (clinic_id, alert_key) DO NOTHING
      RETURNING id`)) as unknown as unknown[];
    result.created += inserted.length;
  }

  // Encerra o aviso aberto cujo fato deixou de valer. As chaves são ids, datas e contagens
  // (sem vírgula nem aspas): vão como literal de array, não como lista de parâmetros.
  const live = facts.filter((f) => REVOCABLE_KINDS.includes(f.kind)).map((f) => f.key);
  for (const k of live) if (!/^[a-z0-9:_-]+$/u.test(k)) throw new Error('chave de aviso fora do formato');
  const cancelled = (await tx.execute(sql`
    UPDATE public.hi_authorization_alerts
       SET status = 'cancelled', cancel_reason = 'obsolete'
     WHERE clinic_id = ${clinicId}::uuid AND status = 'open'
       AND kind IN ('password_expiring', 'sessions_ending', 'operator_overdue')
       AND NOT (alert_key = ANY(${`{${live.join(',')}}`}::text[]))
    RETURNING id`)) as unknown as unknown[];
  result.cancelled = cancelled.length;

  result.deliveryRequested = await requestAlertDeliveryTx(tx, clinicId);
  return result;
}

/**
 * Pede a entrega dos avisos abertos que ainda não entraram em lote. Uma entrega por conjunto de
 * avisos (a chave do evento é o lote) e no máximo `MAX_DELIVERY_BATCHES_PER_DAY` lotes em 24 horas.
 */
export async function requestAlertDeliveryTx(tx: Tx, clinicId: string): Promise<number> {
  const pending = (await tx.execute(sql`
    SELECT id::text AS id FROM public.hi_authorization_alerts
     WHERE clinic_id = ${clinicId}::uuid AND status = 'open' AND delivery_batch IS NULL
     ORDER BY id
     FOR UPDATE`)) as unknown as Array<{ id: string }>;
  if (pending.length === 0) return 0;
  const [recent] = (await tx.execute(sql`
    SELECT count(DISTINCT delivery_batch)::int AS n FROM public.hi_authorization_alerts
     WHERE clinic_id = ${clinicId}::uuid AND delivery_requested_at > now() - interval '24 hours'`)) as unknown as Array<{ n: number }>;
  if (Number(recent?.n ?? 0) >= MAX_DELIVERY_BATCHES_PER_DAY) return 0;
  const batch = createHash('sha256').update(`${clinicId}:${pending.map((p) => p.id).join(',')}`).digest('hex').slice(0, 32);
  await tx.execute(sql`
    UPDATE public.hi_authorization_alerts
       SET delivery_batch = ${batch}, delivery_requested_at = now()
     WHERE clinic_id = ${clinicId}::uuid AND status = 'open' AND delivery_batch IS NULL`);
  await publishEvent(tx, {
    clinicId,
    eventType: HEALTH_INSURANCE_EVENTS.AUTHORIZATION_ALERTS_DELIVERY_REQUESTED,
    payload: { clinicId, batch, count: pending.length },
    idempotencyKey: `hi-authorization-alerts:${clinicId}:${batch}`,
  });
  return pending.length;
}

export interface AuthorizationAlertView {
  id: string;
  authorizationId: string;
  kind: AuthorizationAlertKind;
  status: 'open' | 'read' | 'cancelled';
  detail: Record<string, string | number>;
  createdAt: string;
  deliveredAt: string | null;
}

/** Avisos abertos da clínica (mais novos primeiro). */
export async function listOpenAuthorizationAlertsTx(tx: Tx, clinicId: string, limit = 50): Promise<AuthorizationAlertView[]> {
  const rows = (await tx.execute(sql`
    SELECT id::text AS id, authorization_id::text AS authorization_id, kind, status, detail,
           created_at::text AS created_at, delivered_at::text AS delivered_at
      FROM public.hi_authorization_alerts
     WHERE clinic_id = ${clinicId}::uuid AND status = 'open'
     ORDER BY created_at DESC, id
     LIMIT ${limit}`)) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    authorizationId: String(r.authorization_id),
    kind: r.kind as AuthorizationAlertKind,
    status: r.status as AuthorizationAlertView['status'],
    detail: (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail ?? {}) as Record<string, string | number>,
    createdAt: String(r.created_at),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
  }));
}

export class AuthorizationAlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationAlertError';
  }
}

/**
 * Marca o aviso como visto. Quem viu é a pessoa da SESSÃO (o banco grava). Aviso de outra clínica,
 * inexistente, já visto ou encerrado: a mesma resposta, sem confirmar existência.
 */
export async function markAuthorizationAlertReadTx(tx: Tx, clinicId: string, alertId: string): Promise<{ authorizationId: string; kind: AuthorizationAlertKind }> {
  const rows = (await tx.execute(sql`
    UPDATE public.hi_authorization_alerts SET status = 'read'
     WHERE clinic_id = ${clinicId}::uuid AND id = ${alertId}::uuid AND status = 'open'
    RETURNING authorization_id::text AS authorization_id, kind`)) as unknown as Array<{ authorization_id: string; kind: AuthorizationAlertKind }>;
  if (rows.length !== 1) throw new AuthorizationAlertError('Aviso não encontrado ou já visto. Atualize a página.');
  return { authorizationId: rows[0]!.authorization_id, kind: rows[0]!.kind };
}
