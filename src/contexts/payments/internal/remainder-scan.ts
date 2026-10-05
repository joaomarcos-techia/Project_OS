/**
 * Varredura do RESTANTE (ADR-051 1.5b.3) — o gatilho da cobrança do saldo.
 *
 * **Por que scan e não handler de evento:** `scheduling.appointment.completed`
 * tem um único dono, o faturamento do Financial, e o registry do outbox aceita
 * um handler por evento. Mas aqui a varredura é melhor mesmo com fan-out
 * disponível: ela roda DEPOIS de o lançamento existir. Um segundo handler do
 * mesmo evento correria com o primeiro, e poderia perguntar o saldo antes de
 * haver recebível — respondendo "nada a cobrar" para todo atendimento.
 *
 * É também **auto-curável**: gateway fora do ar não deixa buraco, porque a
 * próxima passada recobre a janela inteira.
 *
 * Ordem das perguntas, da mais barata para a mais cara:
 *   1. quais clínicas ligaram o sinal?      (1 query, dado do próprio Payments)
 *   2. o que essas clínicas concluíram?     (1 query, read-model do Scheduling)
 *   3. quais já têm cobrança de restante?   (1 query por clínica, em lote)
 *   4. quanto ainda falta, e cobra          (Financial decide; aí sim, gateway)
 */
import 'server-only';

import { metrics } from '@/lib/observability/metrics';

/* eslint-disable-next-line boundaries/element-types -- `schedulingApiV1` é a API interna pública (M14), mesma exceção do `deposit-scan`. */
import { schedulingApiV1 } from '@/contexts/scheduling';

import { findChargedAppointmentIds } from './charge-store';
import { listClinicsWithDepositEnabled } from './deposit-scan';
import { createRemainderCharge } from './remainder-charge';

export interface RemainderScanSummary extends Record<string, unknown> {
  clinics: number;
  candidates: number;
  charged: number;
  failed: number;
}

export async function runRemainderScan(opts?: {
  completedWithinHours?: number;
  maxClinics?: number;
  maxCandidates?: number;
}): Promise<RemainderScanSummary> {
  const summary: RemainderScanSummary = { clinics: 0, candidates: 0, charged: 0, failed: 0 };

  const clinicIds = await listClinicsWithDepositEnabled(opts?.maxClinics ?? 500);
  summary.clinics = clinicIds.length;
  if (clinicIds.length === 0) return summary;

  const candidates = await schedulingApiV1.listRemainderCandidates(clinicIds, {
    ...(opts?.completedWithinHours !== undefined
      ? { completedWithinHours: opts.completedWithinHours }
      : {}),
    ...(opts?.maxCandidates !== undefined ? { limit: opts.maxCandidates } : {}),
  });
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  const byClinic = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const bucket = byClinic.get(candidate.clinicId) ?? [];
    bucket.push(candidate);
    byClinic.set(candidate.clinicId, bucket);
  }

  for (const [clinicId, items] of byClinic) {
    const alreadyCharged = await findChargedAppointmentIds(
      clinicId,
      items.map((i) => i.appointmentId),
      'remainder',
    );

    for (const item of items) {
      if (alreadyCharged.has(item.appointmentId)) continue;
      if (item.commercialPaymentMethod === 'cash') continue;
      try {
        await createRemainderCharge({
          clinicId,
          appointment: {
            appointmentId: item.appointmentId,
            patientId: item.patientId,
            valor: item.valor,
            commercialPaymentMethod: item.commercialPaymentMethod,
            commercialInstallmentCount: item.commercialInstallmentCount,
          },
        });
        summary.charged += 1;
      } catch (err) {
        // Uma clínica com problema não trava a cobrança das outras.
        summary.failed += 1;
        metrics.emit('payments.remainder.scan_error', {
          clinicId,
          appointmentId: item.appointmentId,
          error: err,
        });
      }
    }
  }

  return summary;
}
