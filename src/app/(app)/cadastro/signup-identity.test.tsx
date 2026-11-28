// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignupIdentity } from './signup-identity';
const fetchMock = vi.fn<typeof fetch>();
const pending = vi.fn();
function mount(saved = false, email?: string) {
  render(
    <SignupIdentity
      saved={saved}
      initialEmail={email}
      rowVersion={5}
      onCredentialsPrepared={vi.fn()}
      onCredentialsCleared={vi.fn()}
      onEmailPending={pending}
      onReconcile={vi.fn()}
      onGone={vi.fn()}
    />,
  );
}
function fill(address: string) {
  fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText('Nome da clínica'), {
    target: { value: 'Clínica sintética' },
  });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: address } });
  fireEvent.change(screen.getByLabelText('Crie sua senha'), {
    target: { value: 'QoroSyntheticStrong123!' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('identity and destination continuity', () => {
  it('preserva a identidade e o endereço fixados no convite piloto', () => {
    render(
      <SignupIdentity
        saved={false}
        rowVersion={5}
        pilotIdentity={{
          ownerName: 'Titular piloto',
          clinicName: 'Clínica piloto',
          email: 'pilot@example.test',
        }}
        onCredentialsPrepared={vi.fn()}
        onCredentialsCleared={vi.fn()}
        onEmailPending={pending}
        onReconcile={vi.fn()}
        onGone={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('value', 'Titular piloto');
    expect(screen.getByLabelText('Nome da clínica')).toHaveProperty('value', 'Clínica piloto');
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'pilot@example.test');
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('readOnly', true);
    expect(screen.getByLabelText('Nome da clínica')).toHaveProperty('readOnly', true);
    expect(screen.getByLabelText('E-mail')).toHaveProperty('readOnly', true);
  });
  it('requires a deliberate typo choice before any save/send', async () => {
    mount();
    fill('ana@gmail.comq');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Usar endereço sugerido' }));
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'ana@gmail.com');
    fetchMock
      .mockResolvedValueOnce(Response.json({ rowVersion: 6 }))
      .mockResolvedValueOnce(Response.json({ rowVersion: 8 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await waitFor(() => expect(pending).toHaveBeenCalledWith(8, 'ana@gmail.com'));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).email).toBe('ana@gmail.com');
  });
  it('allows explicitly keeping the typed domain without silent correction', async () => {
    mount();
    fill('ana@gmail.comq');
    fireEvent.click(screen.getByRole('button', { name: 'Manter como digitei' }));
    fetchMock
      .mockResolvedValueOnce(Response.json({ rowVersion: 6 }))
      .mockResolvedValueOnce(Response.json({ rowVersion: 8 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await waitFor(() => expect(pending).toHaveBeenCalledWith(8, 'ana@gmail.comq'));
  });
  it('resumes a saved identity without asking or rewriting names and answers', async () => {
    mount(true, 'corrected@example.test');
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'QoroSyntheticStrong123!' },
    });
    fetchMock.mockResolvedValue(Response.json({ rowVersion: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await waitFor(() => expect(pending).toHaveBeenCalledWith(7, 'corrected@example.test'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/sessions/auth');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      rowVersion: 5,
      email: 'corrected@example.test',
      password: 'QoroSyntheticStrong123!',
      accepted: true,
    });
  });
});
