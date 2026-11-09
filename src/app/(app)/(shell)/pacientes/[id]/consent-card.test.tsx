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
});
