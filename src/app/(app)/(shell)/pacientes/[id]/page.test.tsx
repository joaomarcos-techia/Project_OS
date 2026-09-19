import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPatientWithDecryptedFields,
  getPrincipalAddress,
  listCurrentConsentDecisions,
  listPatientRelationships,
  listClinicalDocumentFeed,
  listProntuariosByPatient,
  listRecentProntuariosByPatient,
  pageGate,
  notFound,
  redirect,
} = vi.hoisted(() => ({
  getPatientWithDecryptedFields: vi.fn(),
  getPrincipalAddress: vi.fn(),
  listCurrentConsentDecisions: vi.fn(),
  listPatientRelationships: vi.fn(),
  listClinicalDocumentFeed: vi.fn(),
  listProntuariosByPatient: vi.fn(),
  listRecentProntuariosByPatient: vi.fn(),
  pageGate: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/contexts/patient/queries', () => ({
  getPatientWithDecryptedFields,
  getPrincipalAddress,
  listCurrentConsentDecisions,
  listPatientRelationships,
}));
vi.mock('@/contexts/clinical/queries', () => ({
  listClinicalDocumentFeed,
  listProntuariosByPatient,
  listRecentProntuariosByPatient,
}));
vi.mock('@/lib/auth/page-guard', () => ({ pageGate }));
vi.mock('next/navigation', () => ({ notFound, redirect }));

import { PERMISSIONS } from '@/lib/auth/permissions';

import PacienteDetailPage, {
  DadosTab,
  PatientClinicalActivityData,
  patientPageCapabilities,
} from './page';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const patient = {
  id: PATIENT_ID,
  clinicId: 'clinic-a',
  nome: 'Ana Silva',
  email: 'ana@example.com',
  dataNascimento: '1990-01-02',
  sexo: 'F' as const,
  obitoEm: null,
  mergedIntoPatientId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  deletedAt: null,
  cpf: '123.456.789-00',
  telefone: '(11) 99999-9999',
};

const dadosProps = {
  clinicId: 'clinic-a',
  patient,
  canEditPatient: false,
  canDeletePatient: false,
  canExportPatient: false,
  canViewProntuario: false,
  canCreateProntuario: false,
  canViewDocuments: false,
  canCreateDocuments: false,
  initialCreate: null,
};

describe('/pacientes/[id] CRM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageGate.mockResolvedValue({
      allowed: true,
      clinicId: 'clinic-a',
      user: { isSuperAdmin: false, aal: 'aal1', permissions: [PERMISSIONS.VIEW_PATIENT] },
    });
    getPatientWithDecryptedFields.mockResolvedValue(patient);
    getPrincipalAddress.mockResolvedValue(null);
    listPatientRelationships.mockResolvedValue([]);
    listCurrentConsentDecisions.mockResolvedValue([]);
    listProntuariosByPatient.mockResolvedValue([]);
    listRecentProntuariosByPatient.mockResolvedValue([]);
    listClinicalDocumentFeed.mockResolvedValue([]);
  });

  it('aplica o gate de paciente antes do ponto único de decifragem', async () => {
    pageGate.mockResolvedValue({ allowed: false });

    await PacienteDetailPage({
      params: Promise.resolve({ id: PATIENT_ID }),
      searchParams: Promise.resolve({}),
    });

    expect(getPatientWithDecryptedFields).not.toHaveBeenCalled();
  });

  it('não busca prontuários nem documentos sem as permissões clínicas correspondentes', async () => {
    await DadosTab(dadosProps);

    expect(getPrincipalAddress).toHaveBeenCalledWith('clinic-a', PATIENT_ID);
    expect(listPatientRelationships).toHaveBeenCalledWith('clinic-a', PATIENT_ID);
    expect(listCurrentConsentDecisions).toHaveBeenCalledWith('clinic-a', PATIENT_ID);

    await PatientClinicalActivityData({
      clinicId: 'clinic-a',
      patientId: PATIENT_ID,
      canViewProntuario: false,
      canViewDocuments: false,
      canCreateProntuario: false,
      canCreateDocuments: false,
      initialCreate: null,
      deceased: false,
    });
    expect(listRecentProntuariosByPatient).not.toHaveBeenCalled();
    expect(listProntuariosByPatient).not.toHaveBeenCalled();
    expect(listClinicalDocumentFeed).not.toHaveBeenCalled();
  });

  it('consulta somente os feeds já existentes quando cada permissão autoriza', async () => {
    await PatientClinicalActivityData({
      clinicId: 'clinic-a',
      patientId: PATIENT_ID,
      canViewProntuario: true,
      canCreateProntuario: true,
      canViewDocuments: true,
      canCreateDocuments: true,
      initialCreate: null,
      deceased: false,
    });

    expect(listRecentProntuariosByPatient).toHaveBeenCalledWith('clinic-a', PATIENT_ID);
    expect(listProntuariosByPatient).not.toHaveBeenCalled();
    expect(listClinicalDocumentFeed).toHaveBeenCalledWith('clinic-a', {
      patientId: PATIENT_ID,
      limit: 8,
    });
  });

  it('deriva cada ação da permissão própria, sem OR permissivo', () => {
    const capabilities = patientPageCapabilities({
      permissions: [PERMISSIONS.VIEW_PATIENT, PERMISSIONS.EXPORT_PATIENT],
    });

    expect(capabilities).toEqual({
      canEditPatient: false,
      canDeletePatient: false,
      canExportPatient: true,
      canViewProntuario: false,
      canCreateProntuario: false,
      canSignProntuario: false,
      canViewDocuments: false,
      canCreateDocuments: false,
    });
  });

  it('só libera o bypass de super-admin com AAL2', () => {
    expect(
      patientPageCapabilities({
        isSuperAdmin: true,
        aal: 'aal1',
        permissions: [PERMISSIONS.EDIT_PATIENT, PERMISSIONS.DELETE_PATIENT],
      }),
    ).toEqual({
      canEditPatient: false,
      canDeletePatient: false,
      canExportPatient: false,
      canViewProntuario: false,
      canCreateProntuario: false,
      canSignProntuario: false,
      canViewDocuments: false,
      canCreateDocuments: false,
    });
    expect(patientPageCapabilities({ isSuperAdmin: true, aal: 'aal2', permissions: [] })).toEqual({
      canEditPatient: true,
      canDeletePatient: true,
      canExportPatient: true,
      canViewProntuario: true,
      canCreateProntuario: true,
      canSignProntuario: true,
      canViewDocuments: true,
      canCreateDocuments: true,
    });
  });
});
