/**
 * Ciclo da coparticipação (P5.3, parte do servidor): estimar (na cobertura),
 * CALCULAR (na conclusão), CONFERIR (recepção), CONFIRMAR (quem tem permissão) e
 * DISPENSAR. Os seis valores ficam separados (previsto, calculado, conferido,
 * confirmado, cobrável, recebido).
 *
 * Regra central: **nada é cobrado sem confirmação.** Só a confirmação publica
 * `health_insurance.copay.confirmed`, e só com valor cobrável > 0; o Financeiro
 * cria o recebível do paciente por ESSE valor (e o banco recusa qualquer recebível
 * de convênio acima dele). Cobrar via Asaas e registrar recebimento são da P10.5.
 *
 * As funções rodam na transação do chamador; a permissão é conferida pela Server
 * Action que chama (P5.3, tela).
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { HEALTH_INSURANCE_EVENTS } from '../events';
import { hiCopayments } from '../schema-clinic';

export class CopayStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopayStateError';
  }
}

async function load(tx: Tx, clinicId: string, where: { id?: string; appointmentId?: string }) {
  const [row] = await tx
    .select()
    .from(hiCopayments)
    .where(
      and(
        eq(hiCopayments.clinicId, clinicId),
        where.id
          ? eq(hiCopayments.id, where.id)
          : eq(hiCopayments.appointmentId, where.appointmentId!),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Valor calculado na conclusão: fixo, ou percentual sobre o total da guia (meio para cima). */
export function calculatedCopayCents(
  row: { kind: 'fixed' | 'percentage'; percentage: string | null; expectedCents: number },
  guideTotalCents: number,
): number {
  if (row.kind === 'fixed') return Math.min(row.expectedCents, guideTotalCents);
  const pctHundredths = Math.round(Number(row.percentage ?? 0) * 100);
  return Math.floor((guideTotalCents * pctHundredths + 5_000) / 10_000);
}

/** Conclusão do atendimento: estimada → calculada pelo total da guia. Idempotente. */
export async function calculateCopayForAppointment(
  tx: Tx,
  args: { clinicId: string; appointmentId: string; guideTotalCents: number },
): Promise<{ copaymentId: string; calculatedCents: number } | null> {
  const row = await load(tx, args.clinicId, { appointmentId: args.appointmentId });
  if (!row) return null;
  if (row.status !== 'estimated') {
    return row.calculatedCents === null
      ? null
      : { copaymentId: row.id, calculatedCents: row.calculatedCents };
  }
  const calculatedCents = calculatedCopayCents(row, args.guideTotalCents);
  await tx
    .update(hiCopayments)
    .set({ status: 'calculated', calculatedCents })
    .where(and(eq(hiCopayments.clinicId, args.clinicId), eq(hiCopayments.id, row.id)));
  return { copaymentId: row.id, calculatedCents };
}

/** Recepção confere o valor (pode divergir do calculado; fica registrado quem conferiu). */
export async function checkCopay(
  tx: Tx,
  args: { clinicId: string; copaymentId: string; checkedCents: number; actorUserId: string },
): Promise<void> {
  const row = await load(tx, args.clinicId, { id: args.copaymentId });
  if (!row) throw new CopayStateError('coparticipação inexistente nesta clínica');
  if (row.status !== 'calculated') {
    throw new CopayStateError(`só se confere coparticipação calculada (estado: ${row.status})`);
  }
  if (!Number.isInteger(args.checkedCents) || args.checkedCents < 0) {
    throw new CopayStateError('valor conferido inválido');
  }
  await tx
    .update(hiCopayments)
    .set({ status: 'checked', checkedCents: args.checkedCents, checkedBy: args.actorUserId })
    .where(and(eq(hiCopayments.clinicId, args.clinicId), eq(hiCopayments.id, row.id)));
}

/**
 * Confirma o valor e o cobrável (≤ confirmado). Com cobrável > 0, publica o evento
 * para o Financeiro na MESMA transação (outbox): sem confirmação, nada é cobrado.
 */
export async function confirmCopay(
  tx: Tx,
  args: {
    clinicId: string;
    copaymentId: string;
    confirmedCents: number;
    chargeableCents: number;
    actorUserId: string;
    procedureName: string;
  },
): Promise<{ published: boolean }> {
  const row = await load(tx, args.clinicId, { id: args.copaymentId });
  if (!row) throw new CopayStateError('coparticipação inexistente nesta clínica');
  if (row.status !== 'checked') {
    throw new CopayStateError(`só se confirma coparticipação conferida (estado: ${row.status})`);
  }
  if (
    !Number.isInteger(args.confirmedCents) ||
    !Number.isInteger(args.chargeableCents) ||
    args.confirmedCents < 0 ||
    args.chargeableCents < 0 ||
    args.chargeableCents > args.confirmedCents
  ) {
    throw new CopayStateError('o cobrável deve estar entre zero e o valor confirmado');
  }
  const [updated] = await tx
    .update(hiCopayments)
    .set({
      status: 'confirmed',
      confirmedCents: args.confirmedCents,
      chargeableCents: args.chargeableCents,
      confirmedBy: args.actorUserId,
    })
    .where(
      and(
        eq(hiCopayments.clinicId, args.clinicId),
        eq(hiCopayments.id, row.id),
        eq(hiCopayments.version, row.version),
      ),
    )
    .returning({ id: hiCopayments.id });
  if (!updated)
    throw new CopayStateError('a coparticipação mudou enquanto era confirmada; recarregue');
  if (args.chargeableCents === 0) return { published: false };
  await publishEvent(tx, {
    clinicId: args.clinicId,
    eventType: HEALTH_INSURANCE_EVENTS.COPAY_CONFIRMED,
    payload: {
      copaymentId: row.id,
      clinicId: args.clinicId,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      chargeableCents: args.chargeableCents,
      procedureName: args.procedureName,
    },
    idempotencyKey: `copay-confirmed:${row.id}`,
  });
  return { published: true };
}

/** Dispensa (com motivo). Confirmada já com recebível não é dispensável aqui (o banco recusa). */
export async function waiveCopay(
  tx: Tx,
  args: { clinicId: string; copaymentId: string; reason: string },
): Promise<void> {
  const row = await load(tx, args.clinicId, { id: args.copaymentId });
  if (!row) throw new CopayStateError('coparticipação inexistente nesta clínica');
  await tx
    .update(hiCopayments)
    .set({ status: 'waived', waiveReason: args.reason, transitionNote: args.reason })
    .where(and(eq(hiCopayments.clinicId, args.clinicId), eq(hiCopayments.id, row.id)));
}
