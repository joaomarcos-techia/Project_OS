/**
 * Varredura do sinal (ADR-049 1.3b) — o gatilho da cobrança.
 *
 * **Por que scan e não handler de evento:** `scheduling.appointment.created` já
 * tem dono (o metering do Billing) e o registry do outbox aceita **um handler por
 * evento** — não existe fan-out. Este é o mesmo padrão que reminder e dunning já
 * usam neste repo, e ele traz uma propriedade que o handler não teria: é
 * **auto-curável**. Gateway fora do ar por três horas não deixa buraco — a próxima
 * varredura recobre a janela inteira.
 *
 * Ordem das perguntas, da mais barata para a mais cara — é o que mantém o custo
 * do tick proporcional ao que realmente muda:
 *   1. quais clínicas ligaram o sinal?           (1 query, dado do próprio Payments)
 *   2. o que essas clínicas agendaram na janela?  (1 query, read-model do Scheduling)
 *   3. quais desses já foram cobrados?            (1 query por clínica, em lote)
 *   4. cobra o que sobrou                         (aí sim, chamada externa)
 *
 * Uma clínica que falha não derruba as outras: o erro é registrado e o scan segue.
 * O contrário faria uma conta Asaas com problema travar a cobrança de todo mundo.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

/* eslint-disable-next-line boundaries/element-types -- `schedulingApiV1` é a API interna pública (M14), mesma exceção dos demais consumidores de contrato de vizinho. */
import { schedulingApiV1 } from '@/contexts/scheduling';

import { findChargedAppointmentIds } from './charge-store';
import { createDepositCharge } from './deposit-charge';

/** `Record<string, unknown>` porque o resumo vai direto para métrica e heartbeat. */
export interface DepositScanSummary extends Record<string, unknown> {
  clinics: number;
  candidates: number;
  charged: number;
  failed: number;
}

interface EnabledClinicRow extends Record<string, unknown> {
  clinic_id: string;
}

/**
 * Clínicas com o sinal ligado. Leitura cross-tenant de tabela do próprio Payments
 * — mesma justificativa dos crons financeiros: rotear todas as clínicas num passo.
 *
 * Exportada porque a varredura do RESTANTE (1.5b.3) faz a mesma pergunta. Copiar
 * a query para lá exigiria uma segunda exceção de `dbAdmin` na allowlist — e
 * allowlist de bypass de RLS é o último lugar onde vale duplicar código.
 */
export async function listClinicsWithDepositEnabled(limit: number): Promise<string[]> {
  const rows = await dbAdmin.execute<EnabledClinicRow>(sql`
    SELECT clinic_id::text AS clinic_id
    FROM clinic_deposit_policy
    WHERE enabled = true
    ORDER BY clinic_id
    LIMIT ${limit}
  `);
  return rows.map((r) => r.clinic_id);
}

export async function runDepositScan(opts?: {
  createdWithinHours?: number;
  maxClinics?: number;
  maxCandidates?: number;
}): Promise<DepositScanSummary> {
  const summary: DepositScanSummary = { clinics: 0, candidates: 0, charged: 0, failed: 0 };

  const clinicIds = await listClinicsWithDepositEnabled(opts?.maxClinics ?? 500);
  summary.clinics = clinicIds.length;
  if (clinicIds.length === 0) return summary;

  const candidates = await schedulingApiV1.listDepositCandidates(clinicIds, {
    ...(opts?.createdWithinHours !== undefined
      ? { createdWithinHours: opts.createdWithinHours }
      : {}),
    ...(opts?.maxCandidates !== undefined ? { limit: opts.maxCandidates } : {}),
  });
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  // Agrupa por clínica: o filtro de "já cobrado" é tenant-scoped (RLS), então
  // precisa ser uma consulta por clínica — mas UMA, não uma por agendamento.
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
    );

    for (const item of items) {
      if (alreadyCharged.has(item.appointmentId)) continue;
      try {
        await createDepositCharge({
          clinicId,
          appointment: {
            appointmentId: item.appointmentId,
            patientId: item.patientId,
            valor: item.valor,
            scheduledAt: item.scheduledAt,
          },
        });
        summary.charged += 1;
      } catch (err) {
        // Uma clínica com problema não pode travar a cobrança das outras.
        summary.failed += 1;
        metrics.emit('payments.deposit.scan_error', {
          clinicId,
          appointmentId: item.appointmentId,
          error: err,
        });
      }
    }
  }

  return summary;
}
