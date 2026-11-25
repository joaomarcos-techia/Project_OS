// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A página lê o usuário por `requirePageUser` (sessão morta vai para /login, OBS-001). Aqui ele
// delega ao `requireUser` simulado, para os cenários continuarem os mesmos; o redirecionamento
// tem teste próprio em `src/lib/auth/page-guard.test.ts`.
vi.mock('@/lib/auth/page-guard', () => ({
  requirePageUser: async () => (await import('@/lib/auth/tenant-context')).requireUser(),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireClinicId: vi.fn(async () => 'clinic-a'),
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
}));
vi.mock('@/contexts/feedback/internal/suggestions', () => ({
  listOwnFeedbackSuggestions: vi.fn(async () => [
    {
      id: 'suggestion-1',
      title: 'Melhorar a agenda',
      status: 'received',
      createdAt: '2026-09-14T20:00:00.000Z',
    },
  ]),
}));
vi.mock('@/contexts/tenancy/queries', () => ({
  getClinicTimezone: vi.fn(async () => 'Asia/Tokyo'),
}));
vi.mock('./feedback-form', () => ({ FeedbackForm: () => null }));

import SugestoesPage from './page';

afterEach(cleanup);

describe('SugestoesPage', () => {
  it('data a sugestão no fuso da clínica', async () => {
    render(await SugestoesPage());

    // 20:00Z já é dia 15 em Tóquio, e ainda dia 14 em São Paulo.
    expect(screen.getByText('15/09/2026')).toBeTruthy();
  });
});
