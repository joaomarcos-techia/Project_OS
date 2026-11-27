// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RAIL_ATTRIBUTE, RAIL_INIT, RAIL_PINNED, RAIL_STORAGE_KEY } from './rail-preference';
import { useRailPinned } from './use-rail-pinned';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(RAIL_ATTRIBUTE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('preferência de fixar o menu', () => {
  it('nasce recolhido e alterna atributo e armazenamento juntos', () => {
    const { result } = renderHook(() => useRailPinned());
    expect(result.current.pinned).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.pinned).toBe(true);
    expect(document.documentElement.getAttribute(RAIL_ATTRIBUTE)).toBe(RAIL_PINNED);
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe(RAIL_PINNED);

    act(() => result.current.toggle());
    expect(result.current.pinned).toBe(false);
    expect(document.documentElement.hasAttribute(RAIL_ATTRIBUTE)).toBe(false);
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull();
  });

  it('com armazenamento bloqueado ainda vale para a aba aberta', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const { result } = renderHook(() => useRailPinned());

    act(() => result.current.toggle());
    expect(result.current.pinned).toBe(true);
  });

  it('o script de antes da pintura só marca quem fixou', () => {
    new Function(RAIL_INIT)();
    expect(document.documentElement.hasAttribute(RAIL_ATTRIBUTE)).toBe(false);

    localStorage.setItem(RAIL_STORAGE_KEY, RAIL_PINNED);
    new Function(RAIL_INIT)();
    expect(document.documentElement.getAttribute(RAIL_ATTRIBUTE)).toBe(RAIL_PINNED);
  });
});
