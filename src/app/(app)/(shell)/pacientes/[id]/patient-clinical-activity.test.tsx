// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./prontuarios/novo-prontuario-button', () => ({
  NovoProntuarioButton: ({ patientId }: { patientId: string }) => (
    <button type="button">Novo prontuário {patientId}</button>
  ),
}));

import type { ClinicalDocumentFeedItem } from '@/contexts/clinical/queries';
import type { ProntuarioSummary } from '@/contexts/clinical/types';

import { PatientClinicalActivity } from './patient-clinical-activity';

const record: ProntuarioSummary = {
  id: 'record-1',
  clinicId: 'clinic-a',
  patientId: 'patient-1',
  doctorId: 'doctor-1',
  appointmentId: 'appointment-1',
  status: 'assinado',
  version: 1,
  rowVersion: 1,
  needsReturn: true,
  returnDays: 15,
  signedAt: '2026-08-18T10:00:00.000Z',
  signedBy: 'doctor-1',
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
};
const document: ClinicalDocumentFeedItem = {
  kind: 'document',
  id: 'document-1',
  patientId: 'patient-1',
  patientNome: 'Ana Silva',
  label: 'Atestado',
  createdAt: '2026-08-19T10:00:00.000Z',
  pdfHref: '/documentos/document-1/pdf',
  hasPdf: true,
};

afterEach(cleanup);

describe('PatientClinicalActivity', () => {
  it('mostra somente registros reais recebidos e ordena o mais recente primeiro', () => {
    render(
      <PatientClinicalActivity
        patientId="patient-1"
        records={[record]}
        documents={[document]}
        canViewRecords
        canViewDocuments
        canCreateRecord={false}
        deceased={false}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Atestado');
    expect(items[1]?.textContent).toContain('Prontuário assinado');
    expect(screen.getByRole('link', { name: 'Abrir' }).getAttribute('href')).toBe(
      '/documentos/document-1/pdf',
    );
    expect(screen.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe(
      '/pacientes/patient-1/prontuarios/record-1',
    );
  });

  it('não oferece criação de prontuário para paciente falecido', () => {
    render(
      <PatientClinicalActivity
        patientId="patient-1"
        records={[]}
        documents={[]}
        canViewRecords
        canViewDocuments={false}
        canCreateRecord
        deceased
      />,
    );

    expect(screen.getByText('Sem atividade clínica')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Novo prontuário/ })).toBeNull();
  });

  it('não oferece criação quando o usuário pode ver documentos, mas não prontuários', () => {
    render(
      <PatientClinicalActivity
        patientId="patient-1"
        records={[]}
        documents={[document]}
        canViewRecords={false}
        canViewDocuments
        canCreateRecord
        deceased={false}
      />,
    );

    expect(screen.getByText('Atestado')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Novo prontuário/ })).toBeNull();
  });

  it('não renderiza um payload clínico recebido sem a capacidade de leitura', () => {
    render(
      <PatientClinicalActivity
        patientId="patient-1"
        records={[record]}
        documents={[document]}
        canViewRecords={false}
        canViewDocuments
        canCreateRecord={false}
        deceased={false}
      />,
    );

    expect(screen.queryByText('Prontuário assinado')).toBeNull();
    expect(screen.getByText('Atestado')).not.toBeNull();
  });
});
