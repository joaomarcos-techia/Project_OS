/**
 * appointment_state_log writer (C6). Single helper so every status transition —
 * from Server Actions or from the patient-deleted handler — records the same
 * forensic row inside the SAME tx as the UPDATE. Captures actor_type (M19),
 * source_event_id / source_idempotency_key (M11) and correlation_id (M20) so
 * "por que esse appointment mudou?" is answerable without cruzar 3 tabelas.
 */
import type { Tx } from '@/lib/db';

import { appointmentStateLog } from '../schema';
import type { AppointmentState } from '../state-machine';

export type AppointmentActor = 'user' | 'ai_agent' | 'worker' | 'system';

export interface LogStateChangeArgs {
  clinicId: string;
  appointmentId: string;
  fromStatus: AppointmentState | null;
  toStatus: AppointmentState;
  transitionedBy: string | null;
  actorType?: AppointmentActor;
  reason?: string | null;
  sourceEventId?: string | null;
  sourceIdempotencyKey?: string | null;
  correlationId?: string | null;
}

export async function logAppointmentStateChange(tx: Tx, args: LogStateChangeArgs): Promise<void> {
  await tx.insert(appointmentStateLog).values({
    clinicId: args.clinicId,
    appointmentId: args.appointmentId,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    transitionedBy: args.transitionedBy,
    actorType: args.actorType ?? 'user',
    reason: args.reason ?? null,
    sourceEventId: args.sourceEventId ?? null,
    sourceIdempotencyKey: args.sourceIdempotencyKey ?? null,
    correlationId: args.correlationId ?? null,
  });
}
