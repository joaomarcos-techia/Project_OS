// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  buscarPacientesRelacionamento: vi.fn(async () => []),
  linkPatientRelationshipForm: vi.fn(async () => ({ error: null })),
  mergePatientsForm: vi.fn(async () => ({ error: null })),
  unlinkPatientRelationshipForm: vi.fn(async () => ({ error: null })),
  requestLgpdDeleteForm: vi.fn(async () => ({ error: null, message: null })),
  requestLgpdExportForm: vi.fn(async () => ({ error: null, message: null })),
}));

import type { PatientRelationshipDTO } from '@/contexts/patient/types';

import { LgpdActions } from './lgpd-actions';
import { PatientRelationshipsCard } from './patient-relationships-card';

const relationship: PatientRelationshipDTO = {
  id: 'relationship-1',
  responsiblePatientId: 'responsible-1',
  responsibleName: 'Maria Silva',
  dependentPatientId: 'patient-1',
  dependentName: 'João Silva',
  relationshipType: 'mae',
  legalGuardian: true,
  financialResponsible: true,
  canManageAppointments: true,
};

afterEach(cleanup);

describe('controles do CRM de paciente', () => {
  it('mantém vínculos em modo de leitura sem oferecer mutações não autorizadas', () => {
    render(
      <PatientRelationshipsCard
        patientId="patient-1"
        relationships={[relationship]}
        canEdit={false}
      />,
    );

    expect(screen.getByText('Maria Silva')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Gerenciar vínculos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
    expect(screen.queryByText('Mesclar cadastro duplicado')).toBeNull();
  });

  it('revela a gestão de vínculos inline apenas após intenção explícita', () => {
    render(
      <PatientRelationshipsCard patientId="patient-1" relationships={[relationship]} canEdit />,
    );

    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar vínculos' }));

    expect(screen.getByRole('button', { name: 'Remover' })).not.toBeNull();
    expect(screen.getByText('Adicionar responsável')).not.toBeNull();
    expect(screen.getByText('Mesclar cadastro duplicado')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Concluir' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('expõe exportação e exclusão LGPD somente pela permissão correspondente', () => {
    const { rerender } = render(<LgpdActions id="patient-1" canExport={false} canDelete={false} />);
    expect(screen.queryByText('LGPD (pedido do titular)')).toBeNull();

    rerender(<LgpdActions id="patient-1" canExport canDelete={false} />);
    expect(screen.getByRole('button', { name: 'Exportar dados (LGPD)' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Solicitar exclusão (LGPD)' })).toBeNull();

    rerender(<LgpdActions id="patient-1" canExport={false} canDelete />);
    expect(screen.queryByRole('button', { name: 'Exportar dados (LGPD)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Solicitar exclusão (LGPD)' })).not.toBeNull();
  });
});
