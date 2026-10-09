/**
 * Persistência das cobranças de paciente e do mapa paciente → customer.
 *
 * Caminho TENANT (`withTenant` → RLS): nenhuma destas tabelas guarda segredo, então
 * quem isola é a RLS e não um seam privilegiado. O `dbAdmin` do Payments segue
 * reservado a quem lê a chave do Asaas (`lib/payments/account-store.ts`).
 *
 * Todas as escritas daqui são **idempotentes por constraint**, não por
 * `if (!existe)`: o worker do outbox entrega at-least-once e duas execuções
 * simultâneas do mesmo evento não podem gerar duas cobranças. Checar antes ajuda a
 * evitar a chamada externa; quem GARANTE é o `UNIQUE` + `onConflictDoNothing`.
 */
import 'server-only';

import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { PAYMENT_ACCOUNT_LOCK_NAMESPACE } from '@/lib/payments/account-lock';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import {
  PAYMENTS_EVENTS,
  type PatientChargeClosedPayload,
  type PatientChargeCreatedPayload,
  type PatientChargeLinkReadyPayload,
  type PatientChargePaidPayload,
  type PatientCreditGrantedPayload,
  type PatientPaymentEconomicsReconciledPayload,
  type PatientPaymentEconomicsCorrectedPayload,
  type PatientCreditReleasedPayload,
} from '../events';
import {
  clinicPaymentAccounts,
  patientCharges,
  patientCheckoutGenerations,
  patientPaymentCustomers,
  patientWebhookEvents,
} from '../schema';

/**
 * `billingType` do gateway → código do catálogo `payment_methods` (ADR-051).
 *
 * O catálogo é GLOBAL (sem `clinic_id`, como `permissions`), então conhecê-lo
 * aqui não acopla o Payments ao modelo interno do Financial — é configuração
 * compartilhada, não tabela de domínio de outro context.
 *
 * `null` para tudo que não reconhecemos, inclusive `UNDEFINED` (o paciente ainda
 * não escolheu). Baixa sem forma de pagamento é honesta; baixa com forma
 * INVENTADA corrompe a conciliação da clínica.
 */
export function toPaymentMethodCode(billingType: string | null | undefined): string | null {
  if (billingType === 'PIX') return 'pix';
  if (billingType === 'CREDIT_CARD') return 'cartao_credito';
  return null;
}

/** Identidade determinística da dívida, separada das gerações de Checkout. */
export function depositExternalReference(appointmentId: string): string {
  return `deposit:${appointmentId}`;
}

/** Referência determinística do RESTANTE (ADR-051 1.5b.3). */
export function remainderExternalReference(appointmentId: string): string {
  return `remainder:${appointmentId}`;
}

/** Uma identidade nova por link, sem transformar o link em uma nova dívida. */
export function checkoutGenerationExternalReference(
  chargeExternalReference: string,
  generation: number,
): string {
  return `${chargeExternalReference}:g${generation}`;
}

/** Cobrança já existente para o agendamento, se houver. */
export async function findChargeByAppointment(
  clinicId: string,
  appointmentId: string,
  kind: 'deposit' | 'remainder' = 'deposit',
): Promise<{ id: string; status: string } | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({ id: patientCharges.id, status: patientCharges.status })
      .from(patientCharges)
      .where(and(eq(patientCharges.appointmentId, appointmentId), eq(patientCharges.kind, kind)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** `customerId` já mapeado para o paciente nesta clínica, se houver. */
export async function findPaymentCustomer(
  clinicId: string,
  patientId: string,
): Promise<string | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({ providerCustomerId: patientPaymentCustomers.providerCustomerId })
      .from(patientPaymentCustomers)
      .where(
        and(
          eq(patientPaymentCustomers.clinicId, clinicId),
          eq(patientPaymentCustomers.patientId, patientId),
          eq(patientPaymentCustomers.provider, 'asaas'),
        ),
      )
      .limit(1),
  );
  return rows[0]?.providerCustomerId ?? null;
}

/**
 * Grava o vínculo paciente → customer.
 *
 * Numa corrida (duas entregas do mesmo evento ao mesmo tempo), o `UNIQUE` faz o
 * segundo `INSERT` não fazer nada e a leitura seguinte devolve o vínculo vencedor.
 * O customer órfão criado no Asaas pela corrida perdedora é inofensivo — não tem
 * cobrança apontando para ele.
 */
export async function linkPaymentCustomer(input: {
  clinicId: string;
  patientId: string;
  providerCustomerId: string;
}): Promise<string> {
  await withTenant(input.clinicId, (tx) =>
    tx
      .insert(patientPaymentCustomers)
      .values({
        clinicId: input.clinicId,
        patientId: input.patientId,
        provider: 'asaas',
        providerCustomerId: input.providerCustomerId,
      })
      .onConflictDoNothing(),
  );
  return (await findPaymentCustomer(input.clinicId, input.patientId)) ?? input.providerCustomerId;
}

// --- Checkout hospedado (D24/D57/D58) ---------------------------------------

export type InitialCheckoutClaim =
  | {
      state: 'claimed';
      chargeId: string;
      generationId: string;
      generation: number;
      externalReference: string;
      expiresAt: Date;
    }
  | { state: 'existing'; chargeId: string }
  | { state: 'account_paused' };

/** Serializa a reserva de Checkout com a pausa da conta, antes de qualquer POST. */
async function mayCreateCheckout(tx: Tx, clinicId: string): Promise<boolean> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${PAYMENT_ACCOUNT_LOCK_NAMESPACE}, hashtext(${clinicId}::text))`,
  );
  const [account] = await tx
    .select({ acceptNewCharges: clinicPaymentAccounts.acceptNewCharges })
    .from(clinicPaymentAccounts)
    .where(
      and(eq(clinicPaymentAccounts.clinicId, clinicId), eq(clinicPaymentAccounts.active, true)),
    )
    .limit(1);
  return account?.acceptNewCharges === true;
}

/**
 * Persiste a dívida e adquire o lease ANTES de `POST /checkouts`.
 *
 * Quem perde a UNIQUE nunca chama o gateway. Se o processo cair depois do POST,
 * a linha existente também impede retry cego: sem um GET de Checkout no contrato
 * público, duplicar um recurso pagável seria pior que exigir reconciliação.
 */
export async function claimInitialCheckoutCharge(input: {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  kind: 'deposit' | 'remainder';
  amount: number;
  holdExpiresAt: Date | null;
  collectionExpiresAt: Date;
  checkoutExpiresAt: Date;
  leaseUntil: Date;
  requestedPaymentMethod?: 'pix' | 'credit_card' | null;
  requestedInstallmentCount?: number | null;
}): Promise<InitialCheckoutClaim> {
  return withTenant(input.clinicId, async (tx) => {
    if (!(await mayCreateCheckout(tx, input.clinicId))) return { state: 'account_paused' };
    const chargeExternalReference =
      input.kind === 'deposit'
        ? depositExternalReference(input.appointmentId)
        : remainderExternalReference(input.appointmentId);
    const generation = 1;
    const externalReference = checkoutGenerationExternalReference(
      chargeExternalReference,
      generation,
    );

    const [charge] = await tx
      .insert(patientCharges)
      .values({
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        kind: input.kind,
        status: 'pending',
        amount: input.amount.toFixed(2),
        provider: 'asaas',
        externalReference: chargeExternalReference,
        holdExpiresAt: input.holdExpiresAt,
        checkoutGeneration: generation,
        collectionExpiresAt: input.collectionExpiresAt,
        requestedPaymentMethod: input.requestedPaymentMethod ?? null,
        requestedInstallmentCount: input.requestedInstallmentCount ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: patientCharges.id });

    if (!charge) {
      const [existing] = await tx
        .select({ id: patientCharges.id })
        .from(patientCharges)
        .where(
          and(
            eq(patientCharges.appointmentId, input.appointmentId),
            eq(patientCharges.kind, input.kind),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error('[payments] conflito de cobrança sem linha recuperável');
      }
      return { state: 'existing', chargeId: existing.id };
    }

    const [generationRow] = await tx
      .insert(patientCheckoutGenerations)
      .values({
        clinicId: input.clinicId,
        patientChargeId: charge.id,
        generation,
        externalReference,
        status: 'creating',
        expiresAt: input.checkoutExpiresAt,
        leaseUntil: input.leaseUntil,
      })
      .returning({ id: patientCheckoutGenerations.id });

    if (!generationRow) {
      throw new Error('[payments] geração inicial de Checkout não foi persistida');
    }

    return {
      state: 'claimed',
      chargeId: charge.id,
      generationId: generationRow.id,
      generation,
      externalReference,
      expiresAt: input.checkoutExpiresAt,
    };
  });
}

/** Ativa a geração e publica os eventos somente depois de receber id + link. */
export async function activateCheckoutGeneration(input: {
  clinicId: string;
  chargeId: string;
  generationId: string;
  generation: number;
  providerCheckoutId: string;
  checkoutUrl: string;
  expiresAt: Date;
  activatedAt: Date;
}): Promise<boolean> {
  return withTenant(input.clinicId, async (tx) => {
    const [charge] = await tx
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        appointmentId: patientCharges.appointmentId,
        patientId: patientCharges.patientId,
        kind: patientCharges.kind,
        amount: patientCharges.amount,
        holdExpiresAt: patientCharges.holdExpiresAt,
        collectionExpiresAt: patientCharges.collectionExpiresAt,
        checkoutGeneration: patientCharges.checkoutGeneration,
      })
      .from(patientCharges)
      .where(eq(patientCharges.id, input.chargeId))
      .limit(1)
      .for('update');
    if (
      !charge ||
      charge.status !== 'pending' ||
      charge.checkoutGeneration !== input.generation ||
      !charge.patientId
    ) {
      return false;
    }

    const [generation] = await tx
      .select({ status: patientCheckoutGenerations.status })
      .from(patientCheckoutGenerations)
      .where(
        and(
          eq(patientCheckoutGenerations.id, input.generationId),
          eq(patientCheckoutGenerations.patientChargeId, input.chargeId),
        ),
      )
      .limit(1)
      .for('update');
    if (generation?.status !== 'creating') return false;

    await tx
      .update(patientCheckoutGenerations)
      .set({
        status: 'active',
        providerCheckoutId: input.providerCheckoutId,
        checkoutUrl: input.checkoutUrl,
        expiresAt: input.expiresAt,
        leaseUntil: null,
        resolvedAt: input.activatedAt,
        failureCode: null,
        updatedAt: sql`now()`,
      })
      .where(eq(patientCheckoutGenerations.id, input.generationId));

    await tx
      .update(patientCharges)
      .set({
        providerCheckoutId: input.providerCheckoutId,
        invoiceUrl: input.checkoutUrl,
        checkoutExpiresAt: input.expiresAt,
        failureCode: null,
        updatedAt: sql`now()`,
      })
      .where(eq(patientCharges.id, input.chargeId));

    const amount = Number(charge.amount);
    const eventExpiry = charge.holdExpiresAt ?? charge.collectionExpiresAt ?? input.expiresAt;
    if (charge.kind === 'deposit' && input.generation === 1) {
      const created: PatientChargeCreatedPayload = {
        chargeId: charge.id,
        clinicId: input.clinicId,
        appointmentId: charge.appointmentId,
        patientId: charge.patientId,
        kind: 'deposit',
        amount,
        holdExpiresAt: eventExpiry.toISOString(),
      };
      await publishEvent(tx, {
        clinicId: input.clinicId,
        eventType: PAYMENTS_EVENTS.CHARGE_CREATED,
        payload: created,
        idempotencyKey: charge.id,
      });
    }

    const linkReady: PatientChargeLinkReadyPayload = {
      chargeId: charge.id,
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      patientId: charge.patientId,
      kind: charge.kind,
      amount,
      holdExpiresAt: eventExpiry.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.CHARGE_LINK_READY,
      payload: linkReady,
      idempotencyKey: `charge-link:${charge.id}:g${input.generation}`,
    });

    return true;
  });
}

/** Registra falha sem jamais persistir corpo/descrição do provider. */
export async function markCheckoutCreationIssue(input: {
  clinicId: string;
  chargeId: string;
  generationId: string;
  outcome: 'failed' | 'creation_unknown';
  failureCode: string;
  resolvedAt: Date;
}): Promise<void> {
  await withTenant(input.clinicId, async (tx) => {
    await tx
      .update(patientCheckoutGenerations)
      .set({
        status: input.outcome,
        leaseUntil: null,
        resolvedAt: input.resolvedAt,
        failureCode: input.failureCode,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCheckoutGenerations.id, input.generationId),
          eq(patientCheckoutGenerations.patientChargeId, input.chargeId),
          eq(patientCheckoutGenerations.status, 'creating'),
        ),
      );

    await tx
      .update(patientCharges)
      .set({
        ...(input.outcome === 'failed' ? { status: 'failed' as const } : {}),
        failureCode: input.failureCode,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patientCharges.id, input.chargeId), eq(patientCharges.status, 'pending')));
  });
}

export interface RemainderCheckoutRenewalCandidate {
  chargeId: string;
  appointmentId: string;
  patientId: string;
  amount: number;
  generation: number;
  providerCheckoutId: string;
  collectionExpiresAt: Date;
  requestedPaymentMethod: 'pix' | 'credit_card' | null;
  requestedInstallmentCount: number | null;
}

/** Links vencidos dentro da promessa de 7 dias, tenant-scoped. */
export async function listRemainderCheckoutRenewalCandidates(
  clinicId: string,
  now: Date,
  limit: number,
): Promise<RemainderCheckoutRenewalCandidate[]> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        chargeId: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        patientId: patientCharges.patientId,
        amount: patientCharges.amount,
        generation: patientCharges.checkoutGeneration,
        providerCheckoutId: patientCharges.providerCheckoutId,
        collectionExpiresAt: patientCharges.collectionExpiresAt,
        requestedPaymentMethod: patientCharges.requestedPaymentMethod,
        requestedInstallmentCount: patientCharges.requestedInstallmentCount,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.kind, 'remainder'),
          eq(patientCharges.status, 'pending'),
          isNull(patientCharges.providerPaymentId),
          lte(patientCharges.checkoutExpiresAt, now),
          gt(patientCharges.collectionExpiresAt, now),
        ),
      )
      .limit(limit),
  );
  return rows.flatMap((row) =>
    row.patientId && row.providerCheckoutId && row.collectionExpiresAt
      ? [
          {
            chargeId: row.chargeId,
            appointmentId: row.appointmentId,
            patientId: row.patientId,
            amount: Number(row.amount),
            generation: row.generation,
            providerCheckoutId: row.providerCheckoutId,
            collectionExpiresAt: row.collectionExpiresAt,
            requestedPaymentMethod:
              row.requestedPaymentMethod === 'pix' || row.requestedPaymentMethod === 'credit_card'
                ? row.requestedPaymentMethod
                : null,
            requestedInstallmentCount: row.requestedInstallmentCount,
          },
        ]
      : [],
  );
}

export type CheckoutRenewalClaim =
  | {
      state: 'claimed';
      chargeId: string;
      generationId: string;
      generation: number;
      externalReference: string;
    }
  | { state: 'lost' }
  | { state: 'account_paused' };

/** Troca a geração expirada por um lease novo; um único worker vence. */
export async function claimRemainderCheckoutRenewal(input: {
  clinicId: string;
  candidate: RemainderCheckoutRenewalCandidate;
  checkoutExpiresAt: Date;
  leaseUntil: Date;
  now: Date;
}): Promise<CheckoutRenewalClaim> {
  return withTenant(input.clinicId, async (tx) => {
    if (!(await mayCreateCheckout(tx, input.clinicId))) return { state: 'account_paused' };
    const [charge] = await tx
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        kind: patientCharges.kind,
        providerPaymentId: patientCharges.providerPaymentId,
        providerCheckoutId: patientCharges.providerCheckoutId,
        checkoutGeneration: patientCharges.checkoutGeneration,
        checkoutExpiresAt: patientCharges.checkoutExpiresAt,
        collectionExpiresAt: patientCharges.collectionExpiresAt,
        externalReference: patientCharges.externalReference,
      })
      .from(patientCharges)
      .where(eq(patientCharges.id, input.candidate.chargeId))
      .limit(1)
      .for('update');
    if (
      !charge ||
      charge.status !== 'pending' ||
      charge.kind !== 'remainder' ||
      charge.providerPaymentId !== null ||
      charge.providerCheckoutId !== input.candidate.providerCheckoutId ||
      charge.checkoutGeneration !== input.candidate.generation ||
      !charge.checkoutExpiresAt ||
      charge.checkoutExpiresAt.getTime() > input.now.getTime() ||
      !charge.collectionExpiresAt ||
      charge.collectionExpiresAt.getTime() <= input.now.getTime()
    ) {
      return { state: 'lost' };
    }

    const expired = await tx
      .update(patientCheckoutGenerations)
      .set({
        status: 'expired',
        leaseUntil: null,
        resolvedAt: input.now,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCheckoutGenerations.patientChargeId, charge.id),
          eq(patientCheckoutGenerations.generation, charge.checkoutGeneration),
          eq(patientCheckoutGenerations.status, 'active'),
        ),
      )
      .returning({ id: patientCheckoutGenerations.id });
    if (expired.length === 0) return { state: 'lost' };

    const generation = charge.checkoutGeneration + 1;
    const externalReference = checkoutGenerationExternalReference(
      charge.externalReference,
      generation,
    );
    const [generationRow] = await tx
      .insert(patientCheckoutGenerations)
      .values({
        clinicId: input.clinicId,
        patientChargeId: charge.id,
        generation,
        externalReference,
        status: 'creating',
        expiresAt: input.checkoutExpiresAt,
        leaseUntil: input.leaseUntil,
      })
      .returning({ id: patientCheckoutGenerations.id });
    if (!generationRow) throw new Error('[payments] renovação de Checkout não persistida');

    await tx
      .update(patientCharges)
      .set({
        providerCheckoutId: null,
        invoiceUrl: null,
        checkoutGeneration: generation,
        checkoutExpiresAt: null,
        failureCode: null,
        updatedAt: sql`now()`,
      })
      .where(eq(patientCharges.id, charge.id));

    return {
      state: 'claimed',
      chargeId: charge.id,
      generationId: generationRow.id,
      generation,
      externalReference,
    };
  });
}

export interface RemainderCheckoutExpiryCandidate {
  chargeId: string;
  providerPaymentId: string | null;
  providerCheckoutId: string;
}

/** Candidatos cujo prazo total acabou; o caller verifica/cancela no provider. */
export async function listRemainderCheckoutExpiryCandidates(
  clinicId: string,
  now: Date,
  limit: number,
): Promise<RemainderCheckoutExpiryCandidate[]> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        chargeId: patientCharges.id,
        providerPaymentId: patientCharges.providerPaymentId,
        providerCheckoutId: patientCharges.providerCheckoutId,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.kind, 'remainder'),
          eq(patientCharges.status, 'pending'),
          lte(patientCharges.collectionExpiresAt, now),
        ),
      )
      .limit(limit),
  );
  return rows.flatMap((row) =>
    row.providerCheckoutId
      ? [
          {
            chargeId: row.chargeId,
            providerPaymentId: row.providerPaymentId,
            providerCheckoutId: row.providerCheckoutId,
          },
        ]
      : [],
  );
}

/** Fecha somente o instrumento após cleanup; o recebível Financial fica aberto. */
export async function expireRemainderCheckoutCollection(input: {
  clinicId: string;
  chargeId: string;
  expiredAt: Date;
}): Promise<boolean> {
  return withTenant(input.clinicId, async (tx) => {
    const [expired] = await tx
      .update(patientCharges)
      .set({
        status: 'expired',
        providerCheckoutId: null,
        invoiceUrl: null,
        checkoutExpiresAt: null,
        expiredAt: input.expiredAt,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCharges.id, input.chargeId),
          eq(patientCharges.kind, 'remainder'),
          eq(patientCharges.status, 'pending'),
          lte(patientCharges.collectionExpiresAt, input.expiredAt),
        ),
      )
      .returning({ id: patientCharges.id });
    if (!expired) return false;

    await tx
      .update(patientCheckoutGenerations)
      .set({
        status: 'expired',
        leaseUntil: null,
        resolvedAt: input.expiredAt,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCheckoutGenerations.patientChargeId, expired.id),
          eq(patientCheckoutGenerations.status, 'active'),
        ),
      );
    return true;
  });
}

export interface InsertDepositChargeInput {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  amount: number;
  providerPaymentId: string;
  invoiceUrl: string | null;
  holdExpiresAt: Date;
}

/**
 * Grava a cobrança e publica `payments.patient_charge.created` **na mesma
 * transação** — o evento é o que faz o Scheduling segurar a vaga. Gravar a
 * cobrança sem publicar deixaria dinheiro cobrado e vaga solta.
 *
 * Devolve `null` quando o `UNIQUE (appointment_id, kind)` barrou o insert: outra
 * entrega chegou primeiro, e publicar o evento de novo criaria um segundo hold.
 */
export async function insertDepositCharge(
  input: InsertDepositChargeInput,
): Promise<{ chargeId: string } | null> {
  return withTenant(input.clinicId, async (tx) => {
    const [row] = await tx
      .insert(patientCharges)
      .values({
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        kind: 'deposit',
        status: 'pending',
        amount: input.amount.toFixed(2),
        provider: 'asaas',
        providerPaymentId: input.providerPaymentId,
        invoiceUrl: input.invoiceUrl,
        externalReference: depositExternalReference(input.appointmentId),
        holdExpiresAt: input.holdExpiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: patientCharges.id });

    if (!row) return null;

    const payload: PatientChargeCreatedPayload = {
      chargeId: row.id,
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      patientId: input.patientId,
      kind: 'deposit',
      amount: input.amount,
      holdExpiresAt: input.holdExpiresAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.CHARGE_CREATED,
      payload,
      // A cobrança é única por agendamento, então a própria cobrança é a chave.
      idempotencyKey: row.id,
    });

    // 1.6a — só há o que avisar se existir link. `invoiceUrl` é nullable: o
    // gateway pode aceitar a cobrança sem devolver a página. Publicar mesmo
    // assim enfileiraria uma mensagem sem link para o paciente abrir.
    if (input.invoiceUrl) {
      const linkReady: PatientChargeLinkReadyPayload = {
        chargeId: row.id,
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        kind: 'deposit',
        amount: input.amount,
        holdExpiresAt: input.holdExpiresAt.toISOString(),
      };
      await publishEvent(tx, {
        clinicId: input.clinicId,
        eventType: PAYMENTS_EVENTS.CHARGE_LINK_READY,
        payload: linkReady,
        idempotencyKey: `charge-link:${row.id}`,
      });
    }

    return { chargeId: row.id };
  });
}

/**
 * Dos agendamentos informados, quais JÁ têm cobrança de sinal.
 *
 * Uma query para o lote inteiro, e não uma por agendamento: o scan roda a cada
 * tick e a maioria dos candidatos já foi cobrada. N consultas por varredura
 * viraria um problema no dia em que houver muitas clínicas.
 */
export async function findChargedAppointmentIds(
  clinicId: string,
  appointmentIds: readonly string[],
  kind: 'deposit' | 'remainder' = 'deposit',
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({ appointmentId: patientCharges.appointmentId })
      .from(patientCharges)
      .where(
        and(
          inArray(patientCharges.appointmentId, [...appointmentIds]),
          eq(patientCharges.kind, kind),
        ),
      ),
  );
  return new Set(rows.map((r) => r.appointmentId));
}

// --- conciliação (1.4) -------------------------------------------------------

export type ReconcileOutcome =
  | 'paid'
  | 'economics_reconciled'
  | 'economics_corrected'
  | 'already_paid'
  | 'unknown_charge'
  | 'amount_mismatch'
  | 'method_mismatch'
  | 'installment_mismatch'
  | 'ignored';

export interface ProviderPaymentEconomics {
  grossAmount: number;
  netAmount: number | null;
  feeAmount: number | null;
}

/**
 * Usa apenas valores reais devolvidos pelo provedor. A taxa é a diferença exata
 * entre bruto e líquido, nunca uma porcentagem estimada. Se o líquido ainda não
 * existe ou está fora do intervalo aceito pelo modelo, ambos ficam pendentes.
 * Isso nunca impede o reconhecimento do pagamento confirmado pelo provedor.
 */
export function reconcileProviderPaymentEconomics(
  grossAmount: number,
  netAmount: number | null | undefined,
): ProviderPaymentEconomics {
  const grossCents = Math.round(grossAmount * 100);
  const netCents = netAmount == null ? null : Math.round(netAmount * 100);
  const validNetCents =
    netAmount != null &&
    Number.isFinite(netAmount) &&
    netAmount >= 0 &&
    netAmount <= grossAmount &&
    netCents != null &&
    Number.isFinite(netCents) &&
    netCents >= 0 &&
    netCents <= grossCents
      ? netCents
      : null;
  return {
    grossAmount: grossCents / 100,
    netAmount: validNetCents == null ? null : validNetCents / 100,
    feeAmount: validNetCents == null ? null : (grossCents - validNetCents) / 100,
  };
}

function reportProviderNetOutOfRange(input: {
  clinicId: string;
  chargeId: string;
  grossAmount: number;
  netAmount: number;
}): void {
  metrics.emit('payments.economics.net_out_of_range', {
    clinicId: input.clinicId,
    chargeId: input.chargeId,
    direction:
      input.netAmount < 0
        ? 'negative'
        : input.netAmount > input.grossAmount
          ? 'above_gross'
          : 'non_finite',
  });
}

async function reconcilePaidChargeEconomicsInTransaction(
  tx: Tx,
  input: {
    clinicId: string;
    charge: {
      id: string;
      appointmentId: string;
      amount: string;
      paidAt: Date | null;
      economicsReconciledAt: Date | null;
      providerFeeAmount: string | null;
      providerEconomicsRevision: number;
    };
    providerPaymentId: string;
    allowCorrection?: boolean;
    reconciledAt: Date;
    providerGrossAmount: number;
    providerNetAmount: number | null;
    billingType?: string | null | undefined;
    providerInstallmentId?: string | null | undefined;
    providerInstallmentNumber?: number | null | undefined;
  },
): Promise<'economics_reconciled' | 'economics_corrected' | 'already_paid' | 'amount_mismatch'> {
  if (input.providerNetAmount == null) {
    return 'already_paid';
  }

  const expectedCents = Math.round(Number(input.charge.amount) * 100);
  const providerCents = Math.round(input.providerGrossAmount * 100);
  if (expectedCents !== providerCents) return 'amount_mismatch';

  const economics = reconcileProviderPaymentEconomics(
    input.providerGrossAmount,
    input.providerNetAmount,
  );
  if (economics.netAmount == null || economics.feeAmount == null) {
    reportProviderNetOutOfRange({
      clinicId: input.clinicId,
      chargeId: input.charge.id,
      grossAmount: input.providerGrossAmount,
      netAmount: input.providerNetAmount,
    });
    return 'already_paid';
  }
  if (input.charge.economicsReconciledAt) {
    if (!input.allowCorrection || input.reconciledAt <= input.charge.economicsReconciledAt) {
      return 'already_paid';
    }
    if (
      Math.round(Number(input.charge.providerFeeAmount) * 100) ===
      Math.round(economics.feeAmount * 100)
    ) {
      return 'already_paid';
    }
    const revision = input.charge.providerEconomicsRevision + 1;
    const updated = await tx
      .update(patientCharges)
      .set({
        providerFeeAmount: economics.feeAmount.toFixed(2),
        providerNetAmount: economics.netAmount.toFixed(2),
        providerEconomicsRevision: revision,
        economicsReconciledAt: input.reconciledAt,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCharges.id, input.charge.id),
          eq(patientCharges.status, 'paid'),
          eq(patientCharges.providerEconomicsRevision, input.charge.providerEconomicsRevision),
          lt(patientCharges.economicsReconciledAt, input.reconciledAt),
        ),
      )
      .returning({ id: patientCharges.id });
    if (updated.length === 0) return 'already_paid';

    const payload: PatientPaymentEconomicsCorrectedPayload = {
      chargeId: input.charge.id,
      clinicId: input.clinicId,
      appointmentId: input.charge.appointmentId,
      providerPaymentId: input.providerPaymentId,
      revision,
      providerGrossAmount: economics.grossAmount,
      providerFeeAmount: economics.feeAmount,
      providerNetAmount: economics.netAmount,
      observedAt: input.reconciledAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.PAYMENT_ECONOMICS_CORRECTED,
      payload,
      idempotencyKey: `payment-economics-correction:${input.charge.id}:${revision}`,
    });
    return 'economics_corrected';
  }
  const updated = await tx
    .update(patientCharges)
    .set({
      providerGrossAmount: economics.grossAmount.toFixed(2),
      providerFeeAmount: economics.feeAmount.toFixed(2),
      providerNetAmount: economics.netAmount.toFixed(2),
      providerBillingType: input.billingType ?? null,
      providerInstallmentId: input.providerInstallmentId ?? null,
      providerInstallmentNumber: input.providerInstallmentNumber ?? null,
      economicsReconciledAt: input.reconciledAt,
      providerEconomicsRevision: 1,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(patientCharges.id, input.charge.id),
        eq(patientCharges.status, 'paid'),
        isNull(patientCharges.economicsReconciledAt),
        eq(patientCharges.providerEconomicsRevision, 0),
      ),
    )
    .returning({ id: patientCharges.id });
  if (updated.length === 0) return 'already_paid';

  const paidAt = input.charge.paidAt ?? input.reconciledAt;
  const payload: PatientPaymentEconomicsReconciledPayload = {
    chargeId: input.charge.id,
    clinicId: input.clinicId,
    appointmentId: input.charge.appointmentId,
    providerGrossAmount: economics.grossAmount,
    providerFeeAmount: economics.feeAmount,
    providerNetAmount: economics.netAmount,
    earlySettlementFeeAmount: null,
    installmentNumber: input.providerInstallmentNumber ?? null,
    paidAt: paidAt.toISOString(),
    paymentMethod: toPaymentMethodCode(input.billingType),
  };
  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: PAYMENTS_EVENTS.PAYMENT_ECONOMICS_RECONCILED,
    payload,
    idempotencyKey: `payment-economics:${input.charge.id}`,
  });
  return 'economics_reconciled';
}

/**
 * Backstop para cobrança paga cujo `netValue` ainda não existia no primeiro
 * readback. Atualiza apenas fatos ausentes e publica uma complementação do
 * crédito; nunca republica o pagamento nem confirma a agenda outra vez.
 */
export async function reconcilePaidChargeEconomics(input: {
  clinicId: string;
  chargeId: string;
  providerPaymentId: string;
  reconciledAt: Date;
  providerGrossAmount: number;
  providerNetAmount: number | null;
  billingType?: string | null;
  providerInstallmentId?: string | null;
  providerInstallmentNumber?: number | null;
}): Promise<
  | 'economics_reconciled'
  | 'economics_corrected'
  | 'already_paid'
  | 'unknown_charge'
  | 'amount_mismatch'
> {
  return withTenant(input.clinicId, async (tx) => {
    const [charge] = await tx
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        appointmentId: patientCharges.appointmentId,
        amount: patientCharges.amount,
        providerPaymentId: patientCharges.providerPaymentId,
        paidAt: patientCharges.paidAt,
        economicsReconciledAt: patientCharges.economicsReconciledAt,
        providerFeeAmount: patientCharges.providerFeeAmount,
        providerEconomicsRevision: patientCharges.providerEconomicsRevision,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.id, input.chargeId),
          eq(patientCharges.providerPaymentId, input.providerPaymentId),
        ),
      )
      .limit(1);
    if (!charge || charge.status !== 'paid') return 'unknown_charge';
    return reconcilePaidChargeEconomicsInTransaction(tx, {
      clinicId: input.clinicId,
      charge,
      providerPaymentId: input.providerPaymentId,
      allowCorrection: true,
      reconciledAt: input.reconciledAt,
      providerGrossAmount: input.providerGrossAmount,
      providerNetAmount: input.providerNetAmount,
      billingType: input.billingType,
      providerInstallmentId: input.providerInstallmentId,
      providerInstallmentNumber: input.providerInstallmentNumber,
    });
  });
}

/**
 * Marca o sinal como pago e publica `payments.patient_charge.paid` na MESMA
 * transação, junto do registro de dedup do webhook.
 *
 * Três coisas atômicas de propósito: se a transação falhar, o dedup cai junto e o
 * Asaas re-entrega. O contrário — dedup gravado e cobrança não conciliada —
 * significaria um pagamento recebido que o sistema nunca reconhece.
 *
 * A transição é **monotônica**: o `WHERE status = 'pending'` faz o segundo
 * webhook do mesmo pagamento não republicar o evento (o que confirmaria de novo
 * um agendamento que o paciente já pode ter cancelado depois).
 */
export async function markDepositPaid(input: {
  clinicId: string;
  providerPaymentId: string;
  asaasEventId: string;
  eventType: string;
  paidAt: Date;
  /** Valores do `getPayment`, nunca do corpo do webhook. */
  providerGrossAmount: number;
  providerNetAmount: number | null;
  /** Do `getPayment` — vira a forma de pagamento da baixa no Financial. */
  billingType?: string | null;
  /** Do `getPayment`, nunca do corpo do webhook. */
  checkoutSessionId?: string | null;
  providerInstallmentId?: string | null;
  providerInstallmentNumber?: number | null;
}): Promise<ReconcileOutcome> {
  return withTenant(input.clinicId, async (tx) => {
    let checkoutChargeId: string | null = null;
    if (input.checkoutSessionId) {
      const [generation] = await tx
        .select({ patientChargeId: patientCheckoutGenerations.patientChargeId })
        .from(patientCheckoutGenerations)
        .where(eq(patientCheckoutGenerations.providerCheckoutId, input.checkoutSessionId))
        .limit(1);
      if (!generation) return 'unknown_charge';
      checkoutChargeId = generation.patientChargeId;
    }

    const [charge] = await tx
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        appointmentId: patientCharges.appointmentId,
        patientId: patientCharges.patientId,
        kind: patientCharges.kind,
        amount: patientCharges.amount,
        providerPaymentId: patientCharges.providerPaymentId,
        requestedPaymentMethod: patientCharges.requestedPaymentMethod,
        requestedInstallmentCount: patientCharges.requestedInstallmentCount,
        paidAt: patientCharges.paidAt,
        economicsReconciledAt: patientCharges.economicsReconciledAt,
        providerFeeAmount: patientCharges.providerFeeAmount,
        providerEconomicsRevision: patientCharges.providerEconomicsRevision,
      })
      .from(patientCharges)
      .where(
        checkoutChargeId
          ? eq(patientCharges.id, checkoutChargeId)
          : eq(patientCharges.providerPaymentId, input.providerPaymentId),
      )
      .limit(1);
    if (!charge) return 'unknown_charge';
    if (charge.providerPaymentId && charge.providerPaymentId !== input.providerPaymentId) {
      return 'unknown_charge';
    }
    let mismatch: 'method_mismatch' | 'installment_mismatch' | 'amount_mismatch' | null = null;
    if (
      (charge.requestedPaymentMethod === 'pix' && input.billingType !== 'PIX') ||
      (charge.requestedPaymentMethod === 'credit_card' && input.billingType !== 'CREDIT_CARD')
    ) {
      mismatch = 'method_mismatch';
    }
    if (
      !mismatch &&
      charge.requestedPaymentMethod === 'credit_card' &&
      charge.requestedInstallmentCount === 1 &&
      (input.providerInstallmentId != null ||
        (input.providerInstallmentNumber != null && input.providerInstallmentNumber !== 1))
    ) {
      mismatch = 'installment_mismatch';
    }
    const expectedCents = Math.round(Number(charge.amount) * 100);
    const providerCents = Math.round(input.providerGrossAmount * 100);
    if (!mismatch && expectedCents !== providerCents) mismatch = 'amount_mismatch';
    if (mismatch) {
      if (charge.status === 'pending') {
        const [quarantined] = await tx
          .update(patientCharges)
          .set({
            providerPaymentId: input.providerPaymentId,
            providerBillingType: input.billingType ?? null,
            failureCode: `payment_${mismatch}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(patientCharges.id, charge.id),
              eq(patientCharges.status, 'pending'),
              or(
                isNull(patientCharges.providerPaymentId),
                eq(patientCharges.providerPaymentId, input.providerPaymentId),
              ),
            ),
          )
          .returning({ id: patientCharges.id });
        if (!quarantined) return 'already_paid';
      }
      return mismatch;
    }

    const dedup = await tx
      .insert(patientWebhookEvents)
      .values({
        clinicId: input.clinicId,
        asaasEventId: input.asaasEventId,
        eventType: input.eventType,
      })
      .onConflictDoNothing()
      .returning({ id: patientWebhookEvents.id });
    if (dedup.length === 0) return 'ignored';

    if (charge.status === 'paid') {
      return reconcilePaidChargeEconomicsInTransaction(tx, {
        clinicId: input.clinicId,
        charge,
        providerPaymentId: input.providerPaymentId,
        reconciledAt: input.paidAt,
        providerGrossAmount: input.providerGrossAmount,
        providerNetAmount: input.providerNetAmount,
        billingType: input.billingType,
        providerInstallmentId: input.providerInstallmentId,
        providerInstallmentNumber: input.providerInstallmentNumber,
      });
    }

    const economics = reconcileProviderPaymentEconomics(
      input.providerGrossAmount,
      input.providerNetAmount,
    );
    if (input.providerNetAmount != null && economics.netAmount == null) {
      reportProviderNetOutOfRange({
        clinicId: input.clinicId,
        chargeId: charge.id,
        grossAmount: input.providerGrossAmount,
        netAmount: input.providerNetAmount,
      });
    }

    const updated = await tx
      .update(patientCharges)
      .set({
        status: 'paid',
        providerPaymentId: input.providerPaymentId,
        providerGrossAmount: economics.grossAmount.toFixed(2),
        providerFeeAmount: economics.feeAmount == null ? null : economics.feeAmount.toFixed(2),
        providerNetAmount: economics.netAmount == null ? null : economics.netAmount.toFixed(2),
        // Antecipação tem ciclo próprio no Asaas; não é inferida do pagamento.
        earlySettlementFeeAmount: null,
        providerBillingType: input.billingType ?? null,
        providerInstallmentId: input.providerInstallmentId ?? null,
        providerInstallmentNumber: input.providerInstallmentNumber ?? null,
        failureCode: null,
        economicsReconciledAt:
          economics.netAmount == null || economics.feeAmount == null ? null : input.paidAt,
        providerEconomicsRevision:
          economics.netAmount == null || economics.feeAmount == null ? 0 : 1,
        paidAt: input.paidAt,
        holdExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientCharges.id, charge.id),
          eq(patientCharges.status, 'pending'),
          or(
            isNull(patientCharges.providerPaymentId),
            eq(patientCharges.providerPaymentId, input.providerPaymentId),
          ),
        ),
      )
      .returning({ id: patientCharges.id });
    // Perdeu a corrida para outra entrega: o evento já foi publicado por ela.
    if (updated.length === 0) return 'already_paid';

    if (input.checkoutSessionId) {
      await tx
        .update(patientCheckoutGenerations)
        .set({ status: 'paid', resolvedAt: input.paidAt, leaseUntil: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(patientCheckoutGenerations.patientChargeId, charge.id),
            eq(patientCheckoutGenerations.providerCheckoutId, input.checkoutSessionId),
          ),
        );
    }

    const payload: PatientChargePaidPayload = {
      chargeId: charge.id,
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      patientId: charge.patientId,
      kind: charge.kind,
      amount: Number(charge.amount),
      paidAt: input.paidAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.CHARGE_PAID,
      payload,
      idempotencyKey: `charge-paid:${charge.id}`,
    });

    // ADR-051 — o mesmo dinheiro, contado para o FINANCIAL. Na mesma transação
    // de propósito: reconhecer o pagamento sem registrar o crédito deixaria
    // dinheiro recebido que o Caixa nunca vê.
    const credit: PatientCreditGrantedPayload = {
      chargeId: charge.id,
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      patientId: charge.patientId,
      kind: charge.kind === 'remainder' ? 'remaining_payment' : 'deposit',
      amount: Number(charge.amount),
      providerGrossAmount: economics.grossAmount,
      providerFeeAmount: economics.feeAmount,
      providerNetAmount: economics.netAmount,
      earlySettlementFeeAmount: null,
      installmentNumber: input.providerInstallmentNumber ?? null,
      paidAt: input.paidAt.toISOString(),
      paymentMethod: toPaymentMethodCode(input.billingType),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.CREDIT_GRANTED,
      payload: credit,
      idempotencyKey: `credit-granted:${charge.id}`,
    });

    return 'paid';
  });
}

// --- fechamento da cobrança (1.5) -------------------------------------------

/** Estados a partir dos quais a cobrança ainda pode ser fechada. */
export type OpenChargeStatus = 'pending' | 'paid';

export interface OpenCharge {
  id: string;
  status: OpenChargeStatus;
  kind: 'deposit' | 'remainder';
  amount: number;
  providerPaymentId: string | null;
  providerCheckoutId: string | null;
}

/** Mantém uma cobrança paga sem ID do provedor visível para investigação no Caixa. */
export async function flagPaidChargeMissingPaymentId(
  clinicId: string,
  chargeId: string,
): Promise<boolean> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .update(patientCharges)
      .set({ failureCode: 'refund_missing_provider_payment_id', updatedAt: sql`now()` })
      .where(
        and(
          eq(patientCharges.clinicId, clinicId),
          eq(patientCharges.id, chargeId),
          eq(patientCharges.status, 'paid'),
          isNull(patientCharges.providerPaymentId),
        ),
      )
      .returning({ id: patientCharges.id }),
  );
  return rows.length > 0;
}

/**
 * A cobrança do agendamento, se ela ainda estiver ABERTA.
 *
 * Devolve `null` para `expired`/`refunded`/`cancelled`/`failed` — todos terminais.
 * Filtrar aqui (e não no chamador) é o que impede uma reentrega do evento de
 * chamar o gateway de novo em cima de algo já resolvido.
 */
export async function findOpenCharge(
  clinicId: string,
  appointmentId: string,
  kind: 'deposit' | 'remainder' = 'deposit',
): Promise<OpenCharge | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        kind: patientCharges.kind,
        amount: patientCharges.amount,
        providerPaymentId: patientCharges.providerPaymentId,
        providerCheckoutId: patientCharges.providerCheckoutId,
      })
      .from(patientCharges)
      .where(and(eq(patientCharges.appointmentId, appointmentId), eq(patientCharges.kind, kind)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'pending' && row.status !== 'paid') return null;
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    amount: Number(row.amount),
    providerPaymentId: row.providerPaymentId,
    providerCheckoutId: row.providerCheckoutId,
  };
}

export interface CloseChargeInput {
  clinicId: string;
  chargeId: string;
  /** Estado ESPERADO. É ele que torna a escrita monotônica sob reentrega. */
  from: OpenChargeStatus;
  outcome: 'refunded' | 'cancelled' | 'expired';
  kind: 'deposit' | 'remainder';
  appointmentId: string;
  amount: number;
  closedAt: Date;
}

/**
 * Fecha a cobrança e publica `payments.patient_charge.closed` na MESMA transação
 * — o evento é o que faz a agenda soltar o hold ou marcar o estorno. Gravar um
 * sem o outro deixaria a agenda e o dinheiro contando histórias diferentes.
 *
 * `WHERE status = from` é a trava: numa segunda entrega do mesmo evento o UPDATE
 * não acha linha, nada é publicado, e o chamador sabe que já estava fechada. Sem
 * isso, cada reentrega republicaria o evento e a agenda reprojetaria um desfecho
 * que já foi superado por outro.
 */
export async function closeChargeInTransaction(tx: Tx, input: CloseChargeInput): Promise<boolean> {
  const updated = await tx
    .update(patientCharges)
    .set({
      status: input.outcome,
      // O CHECK da 0085 vale para a agenda, mas a intenção é a mesma aqui:
      // cobrança fechada não segura vaga nenhuma.
      holdExpiresAt: null,
      ...(input.outcome === 'refunded' ? { refundedAt: input.closedAt } : {}),
      ...(input.outcome === 'expired' ? { expiredAt: input.closedAt } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(patientCharges.id, input.chargeId), eq(patientCharges.status, input.from)))
    .returning({ id: patientCharges.id });
  if (updated.length === 0) return false;

  const payload: PatientChargeClosedPayload = {
    chargeId: input.chargeId,
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    kind: input.kind,
    outcome: input.outcome,
    amount: input.amount,
    closedAt: input.closedAt.toISOString(),
  };
  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: PAYMENTS_EVENTS.CHARGE_CLOSED,
    payload,
    // A cobrança só fecha uma vez (o UPDATE monotônico garante), então a
    // própria cobrança é a chave.
    idempotencyKey: `charge-closed:${input.chargeId}`,
  });

  // ADR-051 — o dinheiro voltou ao paciente, então o crédito no Financial
  // precisa sair de `available`. `cancelled`/`expired` não publicam: cobrança
  // que nunca foi paga nunca virou crédito, não há o que liberar.
  if (input.outcome === 'refunded') {
    await publishReleased(tx, {
      clinicId: input.clinicId,
      chargeId: input.chargeId,
      appointmentId: input.appointmentId,
      amount: input.amount,
      disposition: 'refunded',
      releasedAt: input.closedAt,
    });
  }
  return true;
}

export async function closeCharge(input: CloseChargeInput): Promise<boolean> {
  return withTenant(input.clinicId, (tx) => closeChargeInTransaction(tx, input));
}

// --- entrega do link ao paciente (1.6a) --------------------------------------

export interface PayableCharge {
  chargeId: string;
  appointmentId: string;
  amount: number;
  /** A pagina hospedada do Asaas. Nunca entra em evento, log ou metrica. */
  invoiceUrl: string;
  holdExpiresAt: Date | null;
}

/**
 * A cobranca, **somente se ainda for pagavel**.
 *
 * Devolve `null` quando ela ja foi paga, estornada, cancelada, expirou, ou nunca
 * teve link. A guarda vive AQUI, e nao no chamador, de proposito: quem entrega a
 * mensagem nao pode ser o responsavel por lembrar de perguntar se ela ainda faz
 * sentido. Mandar link de cobranca ja paga e o pior desfecho desta fase.
 */
export async function findPayableCharge(
  clinicId: string,
  chargeId: string,
): Promise<PayableCharge | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        id: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        amount: patientCharges.amount,
        invoiceUrl: patientCharges.invoiceUrl,
        holdExpiresAt: patientCharges.holdExpiresAt,
        providerCheckoutId: patientCharges.providerCheckoutId,
        checkoutExpiresAt: patientCharges.checkoutExpiresAt,
        collectionExpiresAt: patientCharges.collectionExpiresAt,
      })
      .from(patientCharges)
      .where(and(eq(patientCharges.id, chargeId), eq(patientCharges.status, 'pending')))
      .limit(1),
  );
  const row = rows[0];
  const now = Date.now();
  if (
    !row?.invoiceUrl ||
    !row.providerCheckoutId ||
    !row.checkoutExpiresAt ||
    row.checkoutExpiresAt.getTime() <= now ||
    (row.collectionExpiresAt && row.collectionExpiresAt.getTime() <= now)
  ) {
    return null;
  }
  return {
    chargeId: row.id,
    appointmentId: row.appointmentId,
    amount: Number(row.amount),
    invoiceUrl: row.invoiceUrl,
    holdExpiresAt: row.holdExpiresAt,
  };
}

// --- liberação do crédito (ADR-051) ------------------------------------------

interface ReleaseInput {
  clinicId: string;
  chargeId: string;
  appointmentId: string;
  amount: number;
  disposition: 'refunded' | 'retained';
  releasedAt: Date;
}

/** Publica `patient_credit.released` numa tx já aberta. */
async function publishReleased(tx: Parameters<typeof publishEvent>[0], i: ReleaseInput) {
  const payload: PatientCreditReleasedPayload = {
    chargeId: i.chargeId,
    clinicId: i.clinicId,
    appointmentId: i.appointmentId,
    amount: i.amount,
    disposition: i.disposition,
    releasedAt: i.releasedAt.toISOString(),
  };
  await publishEvent(tx, {
    clinicId: i.clinicId,
    eventType: PAYMENTS_EVENTS.CREDIT_RELEASED,
    payload,
    // Um crédito libera uma vez. `onConflictDoNothing` no outbox faz a reentrega
    // do evento de origem (`no_show` é at-least-once) virar no-op silencioso.
    idempotencyKey: `credit-released:${i.chargeId}`,
  });
}

/**
 * Retenção: o sinal fica com a clínica, sem atendimento (falta, ou cancelamento
 * fora da janela).
 *
 * **Isto NÃO contradiz a 1.5a.** Lá, "retido" continua sendo DERIVADO na
 * `patient_charges` — não existe status `retained` na cobrança, e não passa a
 * existir. O que ganha estado explícito é o CRÉDITO, que é outro objeto: um
 * crédito `available` é uma promessa sobre dinheiro futuro, e deixá-lo assim
 * para sempre faria um lançamento posterior absorver dinheiro que já foi retido
 * como taxa de falta.
 */
export async function releaseCreditAsRetained(input: {
  clinicId: string;
  chargeId: string;
  appointmentId: string;
  amount: number;
}): Promise<void> {
  await withTenant(input.clinicId, (tx) =>
    publishReleased(tx, { ...input, disposition: 'retained', releasedAt: new Date() }),
  );
}

// --- cobrança do restante (ADR-051 1.5b.3) -----------------------------------

export interface InsertRemainderChargeInput {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  amount: number;
  providerPaymentId: string;
  invoiceUrl: string | null;
}

/**
 * Grava a cobrança do restante e publica `link_ready` na MESMA transação.
 *
 * **Não publica `charge.created`**: aquele evento faz a AGENDA segurar a vaga, e
 * o restante é cobrado DEPOIS do atendimento — não há vaga a segurar, e projetar
 * um hold sobre um agendamento `atendido` seria inventar estado. Sem
 * `holdExpiresAt` pela mesma razão.
 *
 * Devolve `false` quando o `UNIQUE (appointment_id, kind)` barrou: outra entrega
 * chegou primeiro, e publicar de novo enfileiraria uma segunda mensagem ao
 * paciente pelo mesmo dinheiro.
 */
export async function insertRemainderCharge(input: InsertRemainderChargeInput): Promise<boolean> {
  return withTenant(input.clinicId, async (tx) => {
    const [row] = await tx
      .insert(patientCharges)
      .values({
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        kind: 'remainder',
        status: 'pending',
        amount: input.amount.toFixed(2),
        provider: 'asaas',
        providerPaymentId: input.providerPaymentId,
        invoiceUrl: input.invoiceUrl,
        externalReference: remainderExternalReference(input.appointmentId),
      })
      .onConflictDoNothing()
      .returning({ id: patientCharges.id });
    if (!row) return false;

    if (input.invoiceUrl) {
      const linkReady: PatientChargeLinkReadyPayload = {
        chargeId: row.id,
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        kind: 'remainder',
        amount: input.amount,
        // O contrato do evento exige prazo; para o restante ele é o VENCIMENTO
        // do link, não um hold — nada é cancelado quando passa.
        holdExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await publishEvent(tx, {
        clinicId: input.clinicId,
        eventType: PAYMENTS_EVENTS.CHARGE_LINK_READY,
        payload: linkReady,
        idempotencyKey: `charge-link:${row.id}`,
      });
    }
    return true;
  });
}
