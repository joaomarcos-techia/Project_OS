// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  grantConsentForm: vi.fn(),
  revokeConsentForm: vi.fn(),
}));

import { ConsentCard } from './consent-card';

afterEach(cleanup);

describe('ConsentCard', () => {
  it('mostra o registro do consentimento no fuso da clínica', () => {
    render(
      <ConsentCard
        patientId="patient-1"
        canEdit={false}
        timeZone="Asia/Tokyo"
        purposes={[
          {
            purpose: 'marketing',
            label: 'Comunicações de marketing',
            description: 'Campanhas da clínica.',
            granted: true,
            version: 2,
            recordedAt: '2026-09-14T12:15:00.000Z',
          },
        ]}
      />,
    );

    // 12:15Z é 21:15 em Tóquio e 09:15 em São Paulo.
    expect(screen.getByText(/versão 2 · 14\/09\/2026, 21:15:00/u)).toBeTruthy();
  });

  // UX-014 (docs/otimização_ui_final.md): a equipe registra a decisão do paciente.
  it('o botão diz que registra a decisão e nomeia a finalidade', () => {
    render(
      <ConsentCard
        patientId="patient-1"
        canEdit
        timeZone="America/Sao_Paulo"
        purposes={[
          {
            purpose: 'marketing',
            label: 'Comunicações de marketing',
            description: 'Campanhas da clínica.',
            granted: false,
            version: 0,
            recordedAt: null,
          },
          {
            purpose: 'pesquisa',
            label: 'Pesquisa e estudos',
            description: 'Dados anonimizados.',
            granted: true,
            version: 1,
            recordedAt: '2026-09-14T12:15:00.000Z',
          },
        ]}
      />,
    );

    const registrar = screen.getByRole('button', {
      name: 'Registrar consentimento: Comunicações de marketing',
    });
    expect(registrar.textContent).toBe('Registrar consentimento');
    expect(
      screen.getByRole('button', { name: 'Registrar revogação: Pesquisa e estudos' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Conceder|^Revogar/u })).toBeNull();
  });
});
