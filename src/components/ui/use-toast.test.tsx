// @vitest-environment happy-dom
/**
 * Store de toasts (singleton sem Context) — o padrão que substitui os ~54
 * banners `msg={ok,text}` locais (ADR-031).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { _resetToasts, dismissToast, toast, useToasts } from './use-toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => _resetToasts());
  vi.useRealTimers();
  cleanup();
});

describe('toast store', () => {
  it('empilha toasts e entrega via useToasts', () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current).toHaveLength(0);

    act(() => {
      toast.success('Paciente criado');
      toast.info('Sincronizando');
    });

    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toMatchObject({ variant: 'success', title: 'Paciente criado' });
    expect(result.current[1]).toMatchObject({ variant: 'info', title: 'Sincronizando' });
  });

  it('dismissToast remove imediatamente', () => {
    const { result } = renderHook(() => useToasts());
    let id = 0;
    act(() => {
      id = toast.success('Feito');
    });
    expect(result.current).toHaveLength(1);
    act(() => dismissToast(id));
    expect(result.current).toHaveLength(0);
  });

  it('auto-dismiss após a duração (erro dura mais que sucesso)', () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      toast.success('ok'); // 4000ms
      toast.error('falhou'); // 6000ms
    });
    expect(result.current).toHaveLength(2);

    act(() => vi.advanceTimersByTime(4500));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.variant).toBe('error');

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toHaveLength(0);
  });

  it('duração customizada é respeitada', () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      toast.info('rápido', undefined, 1000);
    });
    act(() => vi.advanceTimersByTime(1100));
    expect(result.current).toHaveLength(0);
  });
});
