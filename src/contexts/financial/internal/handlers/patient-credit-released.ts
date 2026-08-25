/**
 * Financial consumer: o crédito saiu de `available` sem virar baixa
 * (ADR-051 1.5b.1).
 *
 * `disposition` vem EXPLÍCITA no payload, e não inferida do nome do evento,
 * porque os dois desfechos são economicamente opostos:
 *   - `refunded`  → o dinheiro **saiu** da conta da clínica;
 *   - `retained`  → **continua sendo receita**, só que sem atendimento associado.
 *
 * Inferir isso a partir do vocabulário de outro context é exatamente o
 * acoplamento que o ADR-051 D1 existe para impedir.
 *
 * **Não escreve `lancamentos`.** Nesta fase não há lançamento: o crédito morre
 * antes de o atendimento acontecer. Se um dia houver crédito já alocado a
 * liberar, o caminho é o estorno de lançamento, que já existe e tem regra
 * própria — daí o `WHERE status = 'available'` no store.
 */
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientCreditReleasedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { releaseCredit } from '../credit-store';

async function resolveCredit(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientCreditReleasedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;

  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  const outcome = await releaseCredit(tx, {
    clinicId,
    patientChargeId: payload.chargeId,
    disposition: payload.disposition,
    releasedAt: new Date(payload.releasedAt),
  });

  metrics.emit('financial.patient_credit.released', {
    clinicId,
    appointmentId: payload.appointmentId,
    chargeId: payload.chargeId,
    disposition: payload.disposition,
    // `not_found` é esperado para cobranças pagas ANTES da 1.5b.1 subir; falhar
    // aqui prenderia o evento num laço de retentativa por causa da janela de
    // deploy. `already_resolved` é reentrega.
    outcome,
  });
}

registerHandler<PatientCreditReleasedPayload>(PAYMENTS_EVENTS.CREDIT_RELEASED, resolveCredit);
