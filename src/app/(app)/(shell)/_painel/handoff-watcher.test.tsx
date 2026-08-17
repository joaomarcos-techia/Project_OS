// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchOpenHandoffs: vi.fn(),
  refresh: vi.fn(),
  info: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./handoff-actions', () => ({ fetchOpenHandoffs: mocks.fetchOpenHandoffs }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { info: mocks.info } }));

import { useOpenHandoffCount, __testing__ } from '@/components/painel/handoff-store';

import { HandoffWatcher } from './handoff-watcher';

const handoff = (id: string, priority: 'normal' | 'urgent' = 'normal') => ({
  conversationId: id,
  createdAt: '2026-08-17T10:00:00.000Z',
  priority,
});

/** Deixa o efeito rodar e o `await` da action resolver. */
const tick = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
const poll = async () => {
  await vi.advanceTimersByTimeAsync(20_000);
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchOpenHandoffs.mockReset();
  mocks.refresh.mockReset();
  mocks.info.mockReset();
  __testing__.reset();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HandoffWatcher', () => {
  it('não avisa nada quando a fila está vazia', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValue([]);
    render(<HandoffWatcher />);
    await tick();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('a primeira carga resume o que já espera, sem um toast por item', async () => {
    // Abrir o app não pode reproduzir uma pilha de avisos antigos como se
    // tivessem acabado de chegar.
    mocks.fetchOpenHandoffs.mockResolvedValue([handoff('c1'), handoff('c2'), handoff('c3')]);
    render(<HandoffWatcher />);
    await tick();
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls[0]![0]).toContain('3 conversas');
  });

  it('avisa quando um handoff NOVO aparece depois do baseline', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValueOnce([]).mockResolvedValueOnce([handoff('c1')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls[0]![0]).toBe('Paciente pediu atendimento');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('NÃO repete o aviso do mesmo handoff a cada ciclo', async () => {
    // O risco central: um toast a cada 20 segundos até alguém assumir.
    mocks.fetchOpenHandoffs
      .mockResolvedValueOnce([])
      .mockResolvedValue([handoff('c1')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    await poll();
    await poll();
    expect(mocks.info).toHaveBeenCalledTimes(1);
  });

  it('distingue urgente', async () => {
    mocks.fetchOpenHandoffs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([handoff('c1', 'urgent')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info.mock.calls[0]![0]).toContain('urgente');
  });

  it('resume em vez de empilhar quando chegam muitos de uma vez', async () => {
    mocks.fetchOpenHandoffs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([handoff('c1'), handoff('c2'), handoff('c3'), handoff('c4')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls[0]![0]).toContain('4 pacientes');
  });

  it('volta a avisar se o paciente pedir de novo depois de resolvido', async () => {
    mocks.fetchOpenHandoffs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([handoff('c1')])
      .mockResolvedValueOnce([]) // atendido
      .mockResolvedValueOnce([handoff('c1')]); // pediu de novo
    render(<HandoffWatcher />);
    await tick();
    await poll();
    await poll();
    await poll();
    expect(mocks.info).toHaveBeenCalledTimes(2);
  });

  it('não consulta com a aba em segundo plano', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    mocks.fetchOpenHandoffs.mockResolvedValue([handoff('c1')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.fetchOpenHandoffs).not.toHaveBeenCalled();
  });

  it('falha de rede não vira toast de erro', async () => {
    // Quem atende não tem o que fazer com "falha ao consultar a fila".
    mocks.fetchOpenHandoffs.mockRejectedValue(new Error('offline'));
    render(<HandoffWatcher />);
    await tick();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('para de consultar ao desmontar', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValue([]);
    const { unmount } = render(<HandoffWatcher />);
    await tick();
    const chamadas = mocks.fetchOpenHandoffs.mock.calls.length;
    unmount();
    await poll();
    expect(mocks.fetchOpenHandoffs.mock.calls.length).toBe(chamadas);
  });

  it('dispensa sozinho em 5s, acima do padrão de 4s do info', async () => {
    // O X de fechar vem do <Toaster/>; o que este componente controla é quanto
    // tempo o aviso fica na tela antes de sumir sozinho.
    mocks.fetchOpenHandoffs.mockResolvedValueOnce([]).mockResolvedValueOnce([handoff('c1')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info.mock.calls[0]![2]).toBe(5_000);
  });

  it('o resumo da primeira carga usa a mesma duração', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValue([handoff('c1'), handoff('c2')]);
    render(<HandoffWatcher />);
    await tick();
    expect(mocks.info.mock.calls[0]![2]).toBe(5_000);
  });

  it('leva à conversa ao clicar', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValueOnce([]).mockResolvedValueOnce([handoff('c1')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info.mock.calls[0]![3]).toBe('/conversas/c1');
  });

  it('o resumo leva à lista, não a uma conversa específica', async () => {
    mocks.fetchOpenHandoffs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([handoff('c1'), handoff('c2'), handoff('c3'), handoff('c4')]);
    render(<HandoffWatcher />);
    await tick();
    await poll();
    expect(mocks.info.mock.calls[0]![3]).toBe('/conversas');
  });
});

/**
 * O badge é o que sustenta quem não viu o toast passar, então ele precisa
 * refletir a fila SEMPRE — inclusive quando ela esvazia.
 */
describe('HandoffWatcher — contador da sidebar', () => {
  function Contador() {
    return <span data-testid="contador">{useOpenHandoffCount()}</span>;
  }

  it('publica o tamanho da fila já na primeira carga', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValue([handoff('c1'), handoff('c2')]);
    const { getByTestId } = render(
      <>
        <HandoffWatcher />
        <Contador />
      </>,
    );
    await tick();
    expect(getByTestId('contador').textContent).toBe('2');
  });

  it('zera quando a fila é atendida', async () => {
    mocks.fetchOpenHandoffs.mockResolvedValueOnce([handoff('c1')]).mockResolvedValueOnce([]);
    const { getByTestId } = render(
      <>
        <HandoffWatcher />
        <Contador />
      </>,
    );
    await tick();
    expect(getByTestId('contador').textContent).toBe('1');
    await poll();
    expect(getByTestId('contador').textContent).toBe('0');
  });
});
