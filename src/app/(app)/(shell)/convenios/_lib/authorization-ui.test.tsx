// @vitest-environment happy-dom
/**
 * P6.3 — formulário da resposta da operadora (Guia de Consulta): autorizada só com evidência
 * (conferido antes de enviar e de novo no servidor), negada com motivo, quantidades por item, e a
 * recusa do servidor escrita no formulário (role="alert").
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ action: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/health-insurance/actions', () => ({ recordConsultaAuthorizationResponseAction: m.action }));

import { ConsultaAuthorizationResponseForm } from './authorization-ui';

const AUTH = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';

function open() {
  render(
    <ConsultaAuthorizationResponseForm
      authorizationId={AUTH}
      version={2}
      requestedOn="2026-11-10"
      items={[{ id: ITEM, label: '22 · 10101012', requested: 1 }]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Registrar resposta da operadora' }));
  return screen.getByRole('form', { name: 'Resposta da operadora' });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.action.mockResolvedValue({ ok: true, data: 'authorized' });
});

describe('resposta da operadora (Consulta)', () => {
  it('autorizada sem número, senha nem protocolo: avisa no formulário e não envia', async () => {
    const form = open();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByRole('alert').textContent).toContain('Sem evidência da operadora, não há autorização');
    expect(m.action).not.toHaveBeenCalled();
  });

  it('autorizada com o número da operadora: envia a evidência, a data e a quantidade por item (vazio vira ausente)', async () => {
    const form = open();
    fireEvent.change(screen.getByLabelText('Número da guia na operadora'), { target: { value: ' 998877 ' } });
    fireEvent.change(screen.getByLabelText(/Data da autorização/u), { target: { value: '2026-11-12' } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(m.action).toHaveBeenCalledWith({
      decision: 'authorized',
      authorizationId: AUTH,
      version: 2,
      authorizedOn: '2026-11-12',
      operatorGuideNumber: '998877',
      operatorProtocol: null,
      password: null,
      passwordValidUntil: null,
      items: [{ itemId: ITEM, quantityAuthorized: 1 }],
    });
    expect(screen.queryByRole('form', { name: 'Resposta da operadora' })).toBeNull();
  });

  it('negada: pede o motivo e envia só a negativa', async () => {
    const form = open();
    fireEvent.click(screen.getByLabelText('Negou'));
    expect(screen.queryByLabelText('Número da guia na operadora')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Motivo informado pela operadora/u), { target: { value: 'Fora da cobertura do plano' } });
    m.action.mockResolvedValueOnce({ ok: true, data: 'denied' });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(m.action).toHaveBeenCalledWith({ decision: 'denied', authorizationId: AUTH, version: 2, denialReason: 'Fora da cobertura do plano' });
  });

  it('a recusa do servidor fica escrita no formulário, que continua aberto', async () => {
    const form = open();
    fireEvent.change(screen.getByLabelText('Protocolo'), { target: { value: 'PROT-1' } });
    m.action.mockResolvedValueOnce({ ok: false, error: 'A autorização mudou desde que a tela foi aberta. Atualize e tente de novo.' });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByRole('alert').textContent).toBe('A autorização mudou desde que a tela foi aberta. Atualize e tente de novo.');
    expect(screen.getByRole('form', { name: 'Resposta da operadora' })).toBeTruthy();
  });

  it('a senha é campo sem autocompletar e com o aviso de que não volta à tela', () => {
    open();
    const pwd = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(pwd.getAttribute('autocomplete')).toBe('off');
    expect(screen.getByText('Guardada cifrada; não aparece de novo na tela.')).toBeTruthy();
  });
});
