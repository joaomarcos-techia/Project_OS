// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  grantConsentForm: vi.fn(),
  revokeConsentForm: vi.fn(),
}));

import { grantConsentForm } from '../actions';
import { ConsentCard, type ConsentPurposeView } from './consent-card';

afterEach(cleanup);

const MARKETING: ConsentPurposeView = {
  purpose: 'marketing',
  label: 'Comunicações de marketing',
  description: 'Campanhas da clínica.',
  granted: false,
  version: 0,
  recordedAt: null,
};

function card(purposes: ConsentPurposeView[]) {
  return (
    <ConsentCard patientId="patient-1" canEdit timeZone="America/Sao_Paulo" purposes={purposes} />
  );
}

async function registrar() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar consentimento: Comunicações de marketing' }),
    );
  });
}

function chavesEnviadas(): string[] {
  return vi
    .mocked(grantConsentForm)
    .mock.calls.map(([, fd]) => String((fd as FormData).get('idempotencyKey')));
}

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

  // Hidratação e idempotência (17/11/2026): a chave saía de `uuidv4()` no render.
  describe('chave de idempotência', () => {
    beforeEach(() => {
      vi.mocked(grantConsentForm).mockReset();
    });

    it('o HTML do servidor não leva valor aleatório, então hidrata igual', () => {
      const a = renderToString(card([MARKETING]));
      const b = renderToString(card([MARKETING]));
      expect(a).toBe(b);
      expect(a).not.toContain('idempotencyKey');
    });

    it('repetir a mesma decisão depois de uma falha reaproveita a chave', async () => {
      vi.mocked(grantConsentForm).mockResolvedValue({ error: 'Falha de rede.', message: null });
      render(card([MARKETING]));
      await registrar();
      await registrar();
      const chaves = chavesEnviadas();
      expect(chaves).toHaveLength(2);
      expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/u);
      expect(chaves[1]).toBe(chaves[0]);
    });

    it('a versão nova que volta depois do sucesso abre outra operação, com outra chave', async () => {
      vi.mocked(grantConsentForm).mockResolvedValue({
        error: null,
        message: 'Consentimento registrado.',
      });
      const { rerender } = render(card([MARKETING]));
      await registrar();
      // O servidor revalida a ficha: a finalidade voltou a "não concedido" (revogada por outra
      // pessoa) com versão nova. Registrar de novo é outra operação.
      rerender(card([{ ...MARKETING, version: 2, recordedAt: '2026-11-17T12:00:00.000Z' }]));
      await registrar();
      const chaves = chavesEnviadas();
      expect(chaves).toHaveLength(2);
      expect(chaves[1]).not.toBe(chaves[0]);
    });
  });
});
