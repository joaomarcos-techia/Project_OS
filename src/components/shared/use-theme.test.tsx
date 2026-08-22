// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveThemePreference, useTheme } from './use-theme';

function installMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return { media, listeners };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

describe('tema light, dark e system', () => {
  it('resolve system pela preferência do sistema operacional', () => {
    expect(resolveThemePreference('light', true)).toBe(false);
    expect(resolveThemePreference('dark', false)).toBe(true);
    expect(resolveThemePreference('system', true)).toBe(true);
    expect(resolveThemePreference('system', false)).toBe(false);
  });

  it('cicla os três modos e persiste a escolha', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.theme).toBe('system');
    expect(localStorage.getItem('clinicaos-theme')).toBe('system');

    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('acompanha mudanças do sistema somente no modo system', () => {
    localStorage.setItem('clinicaos-theme', 'system');
    const { media, listeners } = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
    expect(result.current.dark).toBe(false);

    Object.defineProperty(media, 'matches', { configurable: true, value: true });
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current.dark).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
