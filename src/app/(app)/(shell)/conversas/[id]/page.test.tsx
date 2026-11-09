// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversationThread, getProfileNames, notFound, pageGate } = vi.hoisted(() => ({
  getConversationThread: vi.fn(),
  getProfileNames: vi.fn(),
  notFound: vi.fn(),
  pageGate: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/lib/auth/page-guard', () => ({ pageGate }));
vi.mock('@/contexts/ai-agent/queries', () => ({ getConversationThread }));
vi.mock('@/contexts/identity/queries', () => ({ getProfileNames }));
vi.mock('@/contexts/tenancy/queries', () => ({
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
}));
vi.mock('./_components/conversa-actions', () => ({
  ConversaActions: () => <form aria-label="Composer persistente" />,
}));
vi.mock('../_components/conversation-auto-refresh', () => ({
  ConversationAutoRefresh: () => null,
}));
vi.mock('../_components/no-access', () => ({
  ConversasNoAccess: () => <p>Sem acesso às conversas</p>,
}));

import ConversaThreadPage from './page';

const conversationId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  pageGate.mockResolvedValue({
    allowed: true,
    clinicId: 'clinic-1',
    user: {
      userId: 'user-1',
      permissions: ['view:conversations', 'manage:conversations'],
    },
  });
  getProfileNames.mockResolvedValue(new Map([['user-1', 'Ana Costa']]));
  getConversationThread.mockResolvedValue({
    id: conversationId,
    patientDisplayName: 'Maria Silva',
    maskedPhone: '***-1234',
    contactPhone: '+5511999991234',
    status: 'handoff',
    intentAtual: 'agendamento',
    startedAt: '2026-08-20T12:00:00.000Z',
    lastMessageAt: '2026-08-20T12:05:00.000Z',
    messages: [
      {
        id: 'message-1',
        direction: 'out',
        author: 'agent',
        text: 'Posso ajudar com o agendamento.',
        createdAt: '2026-08-20T12:05:00.000Z',
        delivery: null,
        meta: {
          intent: 'schedule',
          toolCalls: [{ name: 'list_slots' }],
          model: 'gemini',
          latencyMs: 420,
          costUsd: 0.001,
        },
      },
    ],
    handoff: {
      assignedToUserId: 'user-1',
      priority: 'normal',
      dueAt: '2026-08-20T12:30:00.000Z',
      overdue: false,
    },
    window: {
      open: true,
      lastInboundAt: '2026-08-20T12:00:00.000Z',
      closesAt: '2026-08-21T12:00:00.000Z',
    },
  });
});

afterEach(cleanup);

describe('workspace da conversa', () => {
  it('mantém histórico, telefone e atendimento no mesmo painel', async () => {
    const { container } = render(
      await ConversaThreadPage({ params: Promise.resolve({ id: conversationId }) }),
    );
    const aside = screen.getByRole('complementary', { name: 'Atendimento humano' });
    const history = screen.getByRole('region', { name: 'Histórico da conversa' });

    expect(history.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('+55 11 99999-1234')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Composer persistente' })).toBeTruthy();
    expect(container.textContent).toContain('Posso ajudar com o agendamento.');
  });

  it('mantém o diagnóstico técnico recolhido por padrão', async () => {
    render(await ConversaThreadPage({ params: Promise.resolve({ id: conversationId }) }));

    const disclosure = screen.getByText('Diagnóstico do agente').closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('420 ms');
  });

  it('nega antes de consultar ou decifrar a thread sem view:conversations', async () => {
    pageGate.mockResolvedValue({ allowed: false });

    render(await ConversaThreadPage({ params: Promise.resolve({ id: conversationId }) }));

    expect(screen.getByText('Sem acesso às conversas')).toBeTruthy();
    expect(getConversationThread).not.toHaveBeenCalled();
  });
});
