import { and, eq } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { prontuarios } from './schema';

export interface FollowupClinicalState {
  prontuarioId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  status: 'rascunho' | 'assinado';
  needsReturn: boolean;
  signedAt: Date | null;
}

export interface ClinicalApiV1 {
  getFollowupState(clinicId: string, prontuarioId: string): Promise<FollowupClinicalState | null>;
}

async function getFollowupState(
  clinicId: string,
  prontuarioId: string,
): Promise<FollowupClinicalState | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({
        prontuarioId: prontuarios.id,
        patientId: prontuarios.patientId,
        doctorId: prontuarios.doctorId,
        appointmentId: prontuarios.appointmentId,
        status: prontuarios.status,
        needsReturn: prontuarios.needsReturn,
        signedAt: prontuarios.signedAt,
      })
      .from(prontuarios)
      .where(and(eq(prontuarios.id, prontuarioId), eq(prontuarios.clinicId, clinicId)))
      .limit(1);
    return row ?? null;
  });
}

export const clinicalApiV1: ClinicalApiV1 = { getFollowupState };
