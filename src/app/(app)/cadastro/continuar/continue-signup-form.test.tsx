// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupAnswerValues, SignupDraftState } from '@/contexts/onboarding';

import { ContinueSignupForm } from './continue-signup-form';

const fetchMock = vi.fn<typeof fetch>();
const ANSWERS: SignupAnswerValues = {
  professionalsBand: '2_5',
  weeklyAppointmentsBand: '21_50',
  currentTooling: 'outro_sistema',
  discoverySource: 'indicacao_colega',
};
const OWNED: SignupDraftState = {
  status: 'email_verified',
  rowVersion: 7,
  ownerName: 'Ana',
  clinicName: 'Clínica Teste',
  answers: ANSWERS,
  idleExpiresAt: '2026-09-16T15:00:00.000Z',
  absoluteExpiresAt: '2026-09-16T16:00:00.000Z',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('continuação autenticada O-3b.5', () => {
  it('carrega o draft já pertencente ao usuário sem disparar escrita', async () => {
    fetchMock.mockResolvedValueOnce(json(200, OWNED));
    render(<ContinueSignupForm />);

    await screen.findByText('Dados vinculados à conta verificada');
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Clínica Teste')).toBeTruthy();
    expect(screen.getByText('2 a 5 profissionais')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escolher plano' })).toHaveProperty(
      'href',
      'http://localhost:3000/cadastro/plano',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/draft');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: 'no-store' });
  });

  it('vincula o navegador original por CAS, sem recuperar nomes nem pedir senha', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' })).mockResolvedValueOnce(
      json(200, {
        session: {
          status: 'email_pending',
          rowVersion: 5,
          riskLevel: 0,
          expiresAt: '2026-09-16T15:00:00.000Z',
          answers: ANSWERS,
        },
      }),
    );
    render(<ContinueSignupForm />);

    await screen.findByText(/Encontramos as respostas deste navegador/u);
    expect(screen.getByText('2 a 5 profissionais')).toBeTruthy();
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('value', '');
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: ' Ana ' } });
    fireEvent.change(screen.getByLabelText('Nome da clínica'), {
      target: { value: ' Clínica Teste ' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 6 }))
      .mockResolvedValueOnce(json(200, OWNED));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e revisar dados' }));

    await screen.findByText('Dados vinculados à conta verificada');
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      mode: 'link',
      rowVersion: 5,
      ownerName: 'Ana',
      clinicName: 'Clínica Teste',
      answers: ANSWERS,
      accepted: true,
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/signup/draft');
  });

  it('reinicia todos os dados em outro navegador e omite rowVersion/token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/não possui o cadastro original/u);
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Bia' } });
    fireEvent.change(screen.getByLabelText('Nome da clínica'), { target: { value: 'Clínica B' } });
    fireEvent.change(screen.getByLabelText('Profissionais'), { target: { value: '2_5' } });
    fireEvent.change(screen.getByLabelText('Atendimentos por semana'), {
      target: { value: '21_50' },
    });
    fireEvent.change(screen.getByLabelText('Organização atual'), {
      target: { value: 'outro_sistema' },
    });
    fireEvent.change(screen.getByLabelText('Como conheceu a Qoro'), {
      target: { value: 'indicacao_colega' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 1 }))
      .mockResolvedValueOnce(json(200, { ...OWNED, ownerName: 'Bia', clinicName: 'Clínica B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e revisar dados' }));

    await screen.findByText('Dados vinculados à conta verificada');
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(body).toEqual({
      mode: 'restart',
      ownerName: 'Bia',
      clinicName: 'Clínica B',
      answers: ANSWERS,
      accepted: true,
    });
    expect(body).not.toHaveProperty('rowVersion');
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).not.toMatch(/password|token/iu);
  });

  it('não trata indisponibilidade como navegador novo e permite repetir só a leitura', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: 'unavailable' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não foi possível consultar seu cadastro/u);
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, OWNED));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Dados vinculados à conta verificada');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('não trata resposta 200 malformada da sessão original como restart', async () => {
    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(200, { session: { status: 'email_pending' } }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não foi possível verificar o navegador original/u);
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('valida o restart antes do POST e mantém a confirmação explícita', async () => {
    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);
    await screen.findByText(/não possui o cadastro original/u);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e revisar dados' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Nome da clínica'), { target: { value: 'Clínica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e revisar dados' }));
    await waitFor(() => expect(screen.getByText(/Revise as quatro respostas/u)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
