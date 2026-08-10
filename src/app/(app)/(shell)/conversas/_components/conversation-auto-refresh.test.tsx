// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import {
  CONVERSATION_REFRESH_INTERVAL_MS,
  ConversationAutoRefresh,
} from './conversation-auto-refresh';

let visibility = 'visible';
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
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
});
