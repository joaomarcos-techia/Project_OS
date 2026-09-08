import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type MutationFixture = {
  version: 1;
  runId: string;
  clinicId: string;
  patientName: string;
  patientEmail: string;
  patientCpf: string;
  appointmentDate: string;
  doctorName: string;
  doctorEmail: string;
  procedureName: string;
  procedureCode: string;
  paymentDescription: string;
  paymentAmount: string;
  doctorId?: string;
  /** Segredo sintético e efêmero; existe somente no manifesto ignorado e é apagado no teardown. */
  doctorPassword?: string;
  doctorAvailabilityId?: string;
  procedureId?: string;
  paymentId?: string;
};

export const mutationFixturePath = path.join(process.cwd(), 'e2e', '.mutation-fixture.json');

export async function readMutationFixture(): Promise<MutationFixture> {
  const raw = await readFile(mutationFixturePath, 'utf8');
  const value: unknown = JSON.parse(raw);
  if (!isMutationFixture(value)) {
    throw new Error('Fixture E2E mutável inválida. Rode com E2E_MUTATION=1.');
  }
  return value;
}

function isMutationFixture(value: unknown): value is MutationFixture {
  if (!value || typeof value !== 'object') return false;
  const fixture = value as Partial<MutationFixture>;
  return (
    fixture.version === 1 &&
    typeof fixture.runId === 'string' &&
    typeof fixture.clinicId === 'string' &&
    typeof fixture.patientName === 'string' &&
    typeof fixture.patientEmail === 'string' &&
    typeof fixture.patientCpf === 'string' &&
    typeof fixture.appointmentDate === 'string' &&
    typeof fixture.doctorName === 'string' &&
    typeof fixture.doctorEmail === 'string' &&
    typeof fixture.procedureName === 'string' &&
    typeof fixture.procedureCode === 'string' &&
    typeof fixture.paymentDescription === 'string' &&
    typeof fixture.paymentAmount === 'string'
  );
}
