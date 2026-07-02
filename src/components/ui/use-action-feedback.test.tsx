// @vitest-environment happy-dom
/**
 * useActionFeedback — ponte useActionState → toast global (ADR-031).
 * Regras: não notifica no estado inicial; notifica UMA vez por mudança de
 * state; respeita o resolve (null = silencioso).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useActionFeedback, type ActionFeedback } from './use-action-feedback';
import { _resetToasts, useToasts } from './use-toast';

type State = { ok: boolean; text: string } | null;

const resolve = (s: State): ActionFeedback =>
  s === null ? null : { type: s.ok ? 'success' : 'error', title: s.text };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => _resetToasts());
  vi.useRealTimers();
  cleanup();
});

function setup(initial: State) {
  return renderHook(
    ({ state }: { state: State }) => {
      useActionFeedback(state, resolve);
      return useToasts();
    },
    { initialProps: { state: initial } },
  );
}

describe('useActionFeedback', () => {
  it('não dispara toast no estado inicial', () => {
    const { result } = setup(null);
    expect(result.current).toHaveLength(0);
  });

  it('dispara success quando o state muda para ok', () => {
    const { result, rerender } = setup(null);
    act(() => rerender({ state: { ok: true, text: 'Salvo' } }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ variant: 'success', title: 'Salvo' });
  });

  it('dispara error quando o state muda para falha', () => {
    const { result, rerender } = setup(null);
    act(() => rerender({ state: { ok: false, text: 'Deu ruim' } }));
    expect(result.current[0]).toMatchObject({ variant: 'error', title: 'Deu ruim' });
  });

  it('re-render com o MESMO state não duplica o toast', () => {
    const initial: State = { ok: true, text: 'já visto' };
    const { result, rerender } = setup(initial);
    act(() => rerender({ state: initial }));
    act(() => rerender({ state: initial }));
    expect(result.current).toHaveLength(0);
  });

  it('duas mudanças de state = dois toasts', () => {
    const { result, rerender } = setup(null);
    act(() => rerender({ state: { ok: true, text: 'um' } }));
    act(() => rerender({ state: { ok: true, text: 'dois' } }));
    expect(result.current).toHaveLength(2);
  });
});
