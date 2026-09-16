// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConsultorioPolling } from './use-consultorio-polling';

let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useConsultorioPolling', () => {
  it('faz uma leitura imediata, uma por intervalo e para ao desmontar', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const { result, unmount } = renderHook(() => useConsultorioPolling(refresh));
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('active');

    await advance(19_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    unmount();
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('aplica backoff em falhas e volta ao intervalo normal após recuperação', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);
    const { result } = renderHook(() => useConsultorioPolling(refresh));
    await advance(0);
    expect(result.current).toBe('retrying');

    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(result.current).toBe('active');
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it('não dispara uma segunda leitura enquanto a primeira ainda está em voo', async () => {
    let finish: ((value: boolean) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useConsultorioPolling(refresh));
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => finish?.(true));
    expect(result.current).toBe('active');
    await advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('pausa em segundo plano e retoma imediatamente ao voltar', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useConsultorioPolling(refresh));
    await advance(0);
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe('paused');
    await advance(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('active');
  });

  it('troca o filtro sem deixar a resposta antiga controlar o ciclo novo', async () => {
    let finishOld: ((value: boolean) => void) | undefined;
    const oldRefresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishOld = resolve;
        }),
    );
    const newRefresh = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ refresh }) => useConsultorioPolling(refresh), {
      initialProps: { refresh: oldRefresh as () => Promise<boolean> },
    });
    rerender({ refresh: newRefresh });
    await advance(0);
    expect(newRefresh).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('active');
    await act(async () => finishOld?.(false));
    expect(result.current).toBe('active');
    await advance(20_000);
    expect(newRefresh).toHaveBeenCalledTimes(2);
  });
});
