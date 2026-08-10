'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const CONVERSATION_REFRESH_INTERVAL_MS = 10_000;

/**
 * The inbox stays server-rendered for tenant/RLS safety. Refreshing the current
 * route while it is visible makes persisted inbound/outbound updates appear
 * without a manual reload and without keeping background tabs active.
 */
export function ConversationAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, CONVERSATION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
