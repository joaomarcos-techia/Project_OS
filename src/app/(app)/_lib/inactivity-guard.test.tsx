// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./session-activity-actions', () => ({}));

import { InactivityGuard } from './inactivity-guard';
import { registerPendingWork } from './pending-work';

/** BroadcastChannel em memória: duas instâncias com o mesmo nome conversam (como duas abas). */
class FakeChannel {
  static all = new Set<FakeChannel>();
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.add(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all)
      if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
  }
  close() {
    FakeChannel.all.delete(this);
  }
}

const MIN = 60_000;
const registerActivity = vi.fn(async () => ({ ok: true as const, enforced: true }));
const lockSession = vi.fn(async () => ({ ok: true as const }));
const navigate = vi.fn();

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function mount() {
  return render(
    <InactivityGuard
      warnMs={9 * MIN}
      limitMs={10 * MIN}
      renewThrottleMs={30_000}
      registerActivity={registerActivity}
      lockSession={lockSession}
      navigate={navigate}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeChannel.all.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  registerActivity.mockClear();
  registerActivity.mockResolvedValue({ ok: true, enforced: true });
  lockSession.mockClear();
  navigate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InactivityGuard (S2 / requisito 83)', () => {
  it('6. ao montar (logo depois do login) grava o registro de atividade', async () => {
    mount();
    await advance(0);
    expect(registerActivity).toHaveBeenCalledTimes(1);
  });

  it('1. médico digitando: renova no servidor no máximo a cada 30 s e nunca avisa', async () => {
    mount();
    await advance(0);
    for (let i = 0; i < 24; i += 1) {
      await advance(30_000);
      fireEvent.keyDown(window, { key: 'a' });
    }
    expect(registerActivity.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(registerActivity.mock.calls.length).toBeLessThanOrEqual(25);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(lockSession).not.toHaveBeenCalled();
  });

  it('4. aos 9 min parado: aviso de 1 minuto e o rascunho pendente é salvo (sessão ainda ativa)', async () => {
    const flush = vi.fn(async () => true);
    const off = registerPendingWork(flush);
    mount();
    await advance(9 * MIN + 1_000);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/bloqueada em 1 minuto/u);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(lockSession).not.toHaveBeenCalled();
    off();
  });

  it('"Continuar trabalhando" fecha o aviso e renova na hora', async () => {
    mount();
    await advance(9 * MIN + 1_000);
    registerActivity.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuar trabalhando' }));
    });
    await advance(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(registerActivity).toHaveBeenCalled();
    await advance(5 * MIN);
    expect(lockSession).not.toHaveBeenCalled();
  });

  it('5. aos 10 min: esconde a tela, salva, encerra a sessão e manda para o login', async () => {
    const flush = vi.fn(async () => true);
    const off = registerPendingWork(flush);
    mount();
    await advance(10 * MIN + 1_000);
    expect(document.querySelector('[data-session-locked]')).not.toBeNull();
    expect(flush).toHaveBeenCalledTimes(2); // no aviso e no bloqueio
    expect(lockSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login?reason=inactivity');
    off();
  });

  it('10. rede fora no último salvamento: bloqueia do mesmo jeito e avisa no login', async () => {
    const off = registerPendingWork(async () => false);
    mount();
    await advance(10 * MIN + 1_000);
    expect(lockSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login?reason=inactivity_unsaved');
    off();
  });

  it('servidor responde que a sessão está bloqueada: bloqueia na hora', async () => {
    registerActivity.mockResolvedValue({ ok: false, locked: true } as never);
    mount();
    await advance(0);
    expect(document.querySelector('[data-session-locked]')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login?reason=inactivity');
  });

  it('8. duas abas: a interação na outra aba mantém esta; esta avisa a outra; o bloqueio de uma bloqueia a outra', async () => {
    const otherTab = new FakeChannel('qoro-session-activity');
    const heard: unknown[] = [];
    otherTab.onmessage = (e) => heard.push(e.data);
    mount();
    await advance(0);
    for (let i = 0; i < 7; i += 1) {
      await advance(2 * MIN);
      await act(async () => otherTab.postMessage({ type: 'input', at: Date.now() }));
    }
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(lockSession).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'x' });
    expect(heard).toContainEqual(expect.objectContaining({ type: 'input' }));
    await act(async () => otherTab.postMessage({ type: 'locked' }));
    await advance(0);
    expect(document.querySelector('[data-session-locked]')).not.toBeNull();
    expect(lockSession).toHaveBeenCalledTimes(1);
  });
});
