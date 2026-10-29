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

function fillRestartForm() {
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
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('continuação autenticada do cadastro verificado', () => {
  it('recupera o cadastro pela identidade verificada, sem redigitar nada', async () => {
    fetchMock.mockResolvedValueOnce(json(200, OWNED));
    render(<ContinueSignupForm />);

    await screen.findByText('Cadastro recuperado na conta verificada');
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Clínica Teste')).toBeTruthy();
    expect(screen.getByText('2 a 5 médicos')).toBeTruthy();
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.getByRole('link', { name: 'Escolher plano' })).toHaveProperty(
      'href',
      'http://localhost:3000/cadastro/plano',
    );
    // Uma única leitura: este GET não altera o vínculo no Auth.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/draft');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: 'no-store' });
  });

  it('não consulta a sessão anônima: 410 já significa que não há nada a recuperar', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não encontramos um cadastro em andamento/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/signup/sessions/me');
  });

  it('recomeça com todos os dados e envia só o contrato do recomeço', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não encontramos um cadastro em andamento/u);
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    fillRestartForm();
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 1 }))
      .mockResolvedValueOnce(json(200, { ...OWNED, ownerName: 'Bia', clinicName: 'Clínica B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));

    await screen.findByText('Cadastro recuperado na conta verificada');
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toEqual({
      ownerName: 'Bia',
      clinicName: 'Clínica B',
      answers: ANSWERS,
      accepted: true,
    });
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('rowVersion');
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).not.toMatch(/password|token/iu);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/signup/draft');
  });

  it('relê o resultado quando outra aba concluiu primeiro, em vez de sobrescrever', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);
    await screen.findByText(/Não encontramos um cadastro em andamento/u);
    fillRestartForm();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(200, OWNED));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));

    await screen.findByText('Cadastro recuperado na conta verificada');
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('pede novo login se o draft foi salvo mas o vínculo no Auth falhou', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);
    await screen.findByText(/Não encontramos um cadastro em andamento/u);
    fillRestartForm();
    fetchMock.mockResolvedValueOnce(json(503, { error: 'binding_unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));

    await screen.findByText('Cadastro salvo; vínculo pendente');
    expect(screen.getByRole('link', { name: 'Ir para o login' })).toHaveProperty(
      'href',
      'http://localhost:3000/login',
    );
    expect(screen.queryByRole('link', { name: 'Escolher plano' })).toBeNull();
  });

  it('não trata conflito após cobrança como sucesso ou sessão nova', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);
    await screen.findByText(/Não encontramos um cadastro em andamento/u);
    fillRestartForm();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));

    await screen.findByText(/Pode haver um pagamento em processamento/u);
    expect(screen.queryByRole('link', { name: 'Escolher plano' })).toBeNull();
  });

  it('não trata indisponibilidade como navegador novo e permite repetir só a leitura', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: 'unavailable' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não foi possível consultar seu cadastro/u);
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, OWNED));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Cadastro recuperado na conta verificada');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('não trata 200 malformado do draft como cadastro recuperado', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'email_verified' }));
    render(<ContinueSignupForm />);

    await screen.findByText(/Não foi possível consultar seu cadastro/u);
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('manda para o login quando a sessão verificada não vale mais', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
    render(<ContinueSignupForm />);

    await screen.findByText('Sessão encerrada');
    expect(screen.getByRole('link', { name: 'Ir para o login' })).toBeTruthy();
  });

  it('valida o recomeço antes do POST e mantém a confirmação explícita', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<ContinueSignupForm />);
    await screen.findByText(/Não encontramos um cadastro em andamento/u);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Nome da clínica'), { target: { value: 'Clínica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }));
    await waitFor(() => expect(screen.getByText(/Revise as quatro respostas/u)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
