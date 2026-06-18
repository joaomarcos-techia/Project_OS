/**
 * Enqueue de reminder/dunning (C14) — materializa jobs JUST-IN-TIME a partir dos
 * read-models dos contextos-fonte (Scheduling/Financial são donos da regra de
 * "quem"). C14 decide o horário-alvo local e o estágio. Idempotente via dedup_key
 * (re-scan no próximo tick só re-deduplica). Followup NÃO passa aqui: é criado
 * pelo handler de clinical.prontuario.signed.
 *
 * ponytail: LIMIT 500/scan basta no MVP (§14.13: ~100-200 jobs/clínica/dia).
 * Acima disso, o read-model deve anti-join os já-enfileirados — débito p/ escala.
 */
/* eslint-disable boundaries/element-types -- APIs internas PÚBLICAS (M14): os contextos-fonte são donos da regra de "candidatos"; C14 só orquestra. */
import { financialApiV1 } from '@/contexts/financial';
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */
import { metrics } from '@/lib/observability/metrics';

import type { DunningPayload, ReminderPayload } from '../domain/types';
import * as repo from '../infra/repository';
import { clinicLocalToUtc, localDateYMD } from '../infra/tz';

/** Hora-alvo LOCAL de disparo (experimental §14.18; janela do processor é 8-20h). */
const REMINDER_HOUR = 18;
const DUNNING_HOUR = 9;

export interface EnqueueSummary {
  scanned: number;
  enqueued: number;
}

export async function enqueueRemindersDue(limit = 500): Promise<EnqueueSummary> {
  const cands = await schedulingApiV1.listReminderCandidates(limit);
  const now = new Date();
  let enqueued = 0;

  for (const c of cands) {
    const scheduledFor = clinicLocalToUtc(c.timezone, localDateYMD(c.timezone, now), REMINDER_HOUR);
    const payload: ReminderPayload = {
      patientId: c.patientId,
      appointmentId: c.appointmentId,
      scheduledAt: c.scheduledAt,
      doctorNome: c.doctorNome,
    };
    const id = await repo.enqueue(c.clinicId, {
      clinicId: c.clinicId,
      type: 'reminder',
      scheduledFor,
      payload,
      dedupKey: `reminder:${c.appointmentId}`,
    });
    if (id) {
      enqueued += 1;
      metrics.emit('proactive.job.created', { clinicId: c.clinicId, jobId: id, type: 'reminder' });
    }
  }

  metrics.emit('proactive.enqueue.reminders', { scanned: cands.length, enqueued });
  return { scanned: cands.length, enqueued };
}

export async function enqueueDunningDue(limit = 500): Promise<EnqueueSummary> {
  const cands = await financialApiV1.listDunningCandidates(limit);
  const now = new Date();
  let enqueued = 0;

  for (const c of cands) {
    const scheduledFor = clinicLocalToUtc(c.timezone, localDateYMD(c.timezone, now), DUNNING_HOUR);
    const stages: Array<3 | 7> = [];
    if (c.daysOverdue >= 3) stages.push(3);
    if (c.daysOverdue >= 7) stages.push(7);

    for (const stage of stages) {
      const payload: DunningPayload = {
        patientId: c.patientId,
        lancamentoId: c.lancamentoId,
        stage,
        valor: c.valor,
        dueDate: c.dueDate,
        procedureNome: c.procedureNome,
      };
      const id = await repo.enqueue(c.clinicId, {
        clinicId: c.clinicId,
        type: 'dunning',
        scheduledFor,
        payload,
        dedupKey: `dunning:${c.lancamentoId}:d${stage}`,
      });
      if (id) {
        enqueued += 1;
        metrics.emit('proactive.job.created', { clinicId: c.clinicId, jobId: id, type: 'dunning' });
      }
    }
  }

  metrics.emit('proactive.enqueue.dunning', { scanned: cands.length, enqueued });
  return { scanned: cands.length, enqueued };
}
