// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type * as ReactModule from 'react';

const { refresh, transition } = vi.hoisted(() => ({
  refresh: vi.fn(),
  // Controla o `isPending` do `useTransition` (o router real é assíncrono; o
  // mock de `refresh` volta na hora, então o "em andamento" é simulado aqui).
  transition: { pending: false },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useTransition: () => [transition.pending, (callback: () => void) => callback()] as const,
  };
});

import {
  CONVERSATION_REFRESH_INTERVAL_MS,
  ConversationAutoRefresh,
} from './conversation-auto-refresh';

let visibility = 'visible';
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  transition.pending = false;
  refresh.mockReset();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalVisibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
  }
});

describe('ConversationAutoRefresh', () => {
  it('refreshes the current route while the conversation screen is visible', () => {
    render(<ConversationAutoRefresh />);

    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a background tab', () => {
    visibility = 'hidden';
    render(<ConversationAutoRefresh />);

    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS * 2));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('cleans up its interval after unmounting', () => {
    const { unmount } = render(<ConversationAutoRefresh />);
    unmount();

    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS * 2));

    expect(refresh).not.toHaveBeenCalled();
  });

  // Incidente de /conversas (14/11/2026, docs/otimização_ui_final.md).
  it('não começa outro refresh enquanto o anterior está em andamento', () => {
    transition.pending = true;
    render(<ConversationAutoRefresh />);

    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS * 3));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('volta a atualizar quando o refresh anterior termina', () => {
    transition.pending = true;
    const { rerender } = render(<ConversationAutoRefresh />);
    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS));
    expect(refresh).not.toHaveBeenCalled();

    transition.pending = false;
    rerender(<ConversationAutoRefresh />);
    act(() => vi.advanceTimersByTime(CONVERSATION_REFRESH_INTERVAL_MS));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
