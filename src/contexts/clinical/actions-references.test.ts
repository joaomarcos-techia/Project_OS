import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAppointmentMatchesPatient: vi.fn(),
  assertClinicCanWriteTx: vi.fn(),
  assertDoctorHasCrm: vi.fn(),
  assertProntuarioMatchesPatient: vi.fn(),
  encryptJson: vi.fn(),
  ensureMedicalDocumentPdf: vi.fn(),
  ensurePrescriptionPdf: vi.fn(),
  idempotentMutation: vi.fn(),
  loadClinicEmitente: vi.fn(),
  patientApiV1: { getAddressForDocument: vi.fn() },
  publishEvent: vi.fn(),
  requestContext: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireUser: vi.fn(),
  resolveDoctorSnapshot: vi.fn(),
  resolvePatientNome: vi.fn(),
  toProntuarioDetail: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@/contexts/patient', () => ({ patientApiV1: mocks.patientApiV1 }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: mocks.requireClinicId,
  requireFreshPermission: mocks.requireFreshPermission,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/tenant-access', () => ({ assertClinicCanWriteTx: mocks.assertClinicCanWriteTx }));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('./internal/action-helpers', () => ({
  idemKey: (_operation: string, key: string) => key,
  jsonSafe: (value: unknown) => value,
  requestContext: mocks.requestContext,
}));
vi.mock('./internal/content-crypto', () => ({
  decryptJson: vi.fn(),
  encryptJson: mocks.encryptJson,
}));
vi.mock('./internal/doctor', () => ({
  assertDoctorHasCrm: mocks.assertDoctorHasCrm,
  resolveDoctorSnapshot: mocks.resolveDoctorSnapshot,
}));
vi.mock('./internal/patient-ref', () => ({ resolvePatientNome: mocks.resolvePatientNome }));
vi.mock('./internal/pdf-pipeline', () => ({
  ensureMedicalDocumentPdf: mocks.ensureMedicalDocumentPdf,
  ensurePrescriptionPdf: mocks.ensurePrescriptionPdf,
}));
vi.mock('./internal/tenant-references', () => ({
  assertAppointmentMatchesPatient: mocks.assertAppointmentMatchesPatient,
  assertProntuarioMatchesPatient: mocks.assertProntuarioMatchesPatient,
}));
vi.mock('./internal/whitelabel', () => ({ loadClinicEmitente: mocks.loadClinicEmitente }));
vi.mock('./queries', () => ({
  getProntuarioOrThrow: vi.fn(),
  toProntuarioDetail: mocks.toProntuarioDetail,
}));

import { createMedicalDocument, createPrescription, createProntuario } from './actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const DOCTOR_ID = '33333333-3333-4333-8333-333333333333';
const APPOINTMENT_ID = '44444444-4444-4444-8444-444444444444';
const PRONTUARIO_ID = '55555555-5555-4555-8555-555555555555';

function fakeTx() {
  const inserted: unknown[] = [];
  const returning = vi.fn().mockResolvedValue([{ id: PRONTUARIO_ID }]);
  const values = vi.fn((value: unknown) => {
    inserted.push(value);
    return { returning };
  });
  const insert = vi.fn(() => ({ values }));
  const selectResult = Promise.resolve([]);
  const selectQuery = Object.assign(selectResult, {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  });
  selectQuery.from.mockReturnValue(selectQuery);
  selectQuery.where.mockReturnValue(selectQuery);
  selectQuery.limit.mockReturnValue(selectQuery);
  return {
    tx: { insert, select: vi.fn().mockReturnValue(selectQuery) },
    insert,
    inserted,
  };
}

describe('Clinical actions — integridade das referências opcionais', () => {
  let currentTx: ReturnType<typeof fakeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTx = fakeTx();
    mocks.requireUser.mockResolvedValue({ userId: DOCTOR_ID });
    mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
    mocks.requestContext.mockResolvedValue({ correlationId: 'correlation-a' });
    mocks.encryptJson.mockResolvedValue('ciphertext');
    mocks.resolvePatientNome.mockResolvedValue('Ana Lima');
    mocks.resolveDoctorSnapshot.mockResolvedValue({
      nome: 'Dra. Lia',
      crm: '123456',
      crmUf: 'SP',
      especialidade: 'Clínica',
    });
    mocks.toProntuarioDetail.mockImplementation((_clinicId, row) => ({
      ...row,
      content: {},
    }));
    mocks.idempotentMutation.mockImplementation(async (_options, operation) =>
      operation(currentTx.tx),
    );
  });

  it('cria prontuário avulso sem inventar consulta e valida o paciente no tenant', async () => {
    await createProntuario({ patientId: PATIENT_ID }, 'idem-a');

    expect(mocks.resolvePatientNome).toHaveBeenCalledWith(currentTx.tx, CLINIC_ID, PATIENT_ID);
    expect(mocks.assertAppointmentMatchesPatient).not.toHaveBeenCalled();
    expect(currentTx.inserted[0]).toMatchObject({
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      appointmentId: null,
      doctorId: DOCTOR_ID,
    });
  });

  it('valida consulta e paciente dentro da mesma transação antes do insert', async () => {
    mocks.assertAppointmentMatchesPatient.mockRejectedValueOnce(new Error('invalid appointment'));

    await expect(
      createProntuario({ patientId: PATIENT_ID, appointmentId: APPOINTMENT_ID }, 'idem-b'),
    ).rejects.toThrow('invalid appointment');
    expect(mocks.assertAppointmentMatchesPatient).toHaveBeenCalledWith(
      currentTx.tx,
      CLINIC_ID,
      APPOINTMENT_ID,
      PATIENT_ID,
    );
    expect(currentTx.insert).not.toHaveBeenCalled();
  });

  it('rejeita prontuário incompatível antes de persistir ou renderizar prescrição', async () => {
    mocks.assertProntuarioMatchesPatient.mockRejectedValueOnce(new Error('invalid record'));

    await expect(
      createPrescription(
        {
          patientId: PATIENT_ID,
          prontuarioId: PRONTUARIO_ID,
          kind: 'simples',
          medicamentos: [{ nome: 'Dipirona' }],
        },
        'idem-c',
      ),
    ).rejects.toThrow('invalid record');
    expect(mocks.assertProntuarioMatchesPatient).toHaveBeenCalledWith(
      currentTx.tx,
      CLINIC_ID,
      PRONTUARIO_ID,
      PATIENT_ID,
    );
    expect(currentTx.insert).not.toHaveBeenCalled();
    expect(mocks.ensurePrescriptionPdf).not.toHaveBeenCalled();
  });

  it('emite documento avulso com paciente validado e sem appointmentId', async () => {
    await createMedicalDocument(
      {
        patientId: PATIENT_ID,
        type: 'declaracao',
        content: { texto: 'Compareceu à clínica.' },
      },
      'idem-d',
    );

    expect(mocks.resolvePatientNome).toHaveBeenCalledWith(currentTx.tx, CLINIC_ID, PATIENT_ID);
    expect(currentTx.inserted[0]).toMatchObject({
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      doctorId: DOCTOR_ID,
    });
    expect(currentTx.inserted[0]).not.toHaveProperty('appointmentId');
    expect(mocks.ensureMedicalDocumentPdf).toHaveBeenCalledWith(
      CLINIC_ID,
      PRONTUARIO_ID,
      'correlation-a',
    );
  });
});
