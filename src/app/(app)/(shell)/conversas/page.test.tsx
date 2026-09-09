// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConversationListItem, AIConversationThread } from '@/contexts/ai-agent/types';

const { listConversations, getConversationThread, getProfileNames, requireClinicId, requireUser } =
  vi.hoisted(() => ({
    listConversations: vi.fn(),
    getConversationThread: vi.fn(),
    getProfileNames: vi.fn(),
    requireClinicId: vi.fn(),
    requireUser: vi.fn(),
  }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/lib/auth/tenant-context', () => ({ requireClinicId, requireUser }));
vi.mock('@/contexts/ai-agent/queries', () => ({ listConversations, getConversationThread }));
vi.mock('@/contexts/identity/queries', () => ({ getProfileNames }));
vi.mock('./_components/conversation-auto-refresh', () => ({ ConversationAutoRefresh: () => null }));
vi.mock('./[id]/_components/conversa-actions', () => ({
  ConversaActions: () => <form aria-label="Responder ao contato" />,
}));

import ConversasPage from './page';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first: AIConversationListItem = {
  id: firstId,
  patientDisplayName: 'Ana Teste',
  contactPhone: '+5511999991234',
  maskedPhone: null,
  lastMessagePreview: 'Preciso confirmar a consulta.',
  status: 'handoff',
  lastMessageAt: '2026-09-09T12:00:00Z',
  intentAtual: null,
  handoff: {
    assignedToUserId: 'user-1',
    priority: 'urgent',
    dueAt: '2026-09-09T12:30:00Z',
    overdue: true,
  },
};
const second: AIConversationListItem = {
  ...first,
  id: secondId,
  patientDisplayName: null,
  contactPhone: '+5511988885678',
  maskedPhone: '+5511*****5678',
  status: 'closed',
  handoff: null,
};
function thread(item: AIConversationListItem): AIConversationThread {
  return {
    ...item,
    startedAt: '2026-09-09T11:00:00Z',
    messages: [],
    window: { open: true, lastInboundAt: item.lastMessageAt, closesAt: '2026-09-10T12:00:00Z' },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({
    userId: 'user-1',
    permissions: ['view:conversations', 'manage:conversations'],
  });
  requireClinicId.mockResolvedValue('clinic-1');
  listConversations.mockResolvedValue({ items: [first, second], total: 2, page: 1, pageSize: 30 });
  getConversationThread.mockImplementation(async (_clinicId: string, id: string) =>
    thread(id === firstId ? first : second),
  );
  getProfileNames.mockResolvedValue(new Map([['user-1', 'Recepção Teste']]));
});
afterEach(cleanup);

describe('inbox de conversas', () => {
  it('mostra contato e histórico lado a lado, com telefone inclusive para paciente cadastrado', async () => {
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(getConversationThread).toHaveBeenCalledWith('clinic-1', firstId);
    const inbox = screen.getByRole('region', { name: 'Lista de conversas' });
    expect(within(inbox).getByText('+5511999991234')).toBeTruthy();
    expect(
      within(inbox)
        .getByRole('link', { name: /Ana Teste/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(
      within(screen.getByRole('region', { name: 'Conversa selecionada' })).getByText(
        '+5511999991234',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Responder ao contato' })).toBeTruthy();
  });

  it('seleciona uma conversa da página e mantém os filtros ao voltar e paginar', async () => {
    listConversations.mockResolvedValue({
      items: [first, second],
      total: 32,
      page: 1,
      pageSize: 30,
    });
    render(
      await ConversasPage({
        searchParams: Promise.resolve({
          q: 'Ana',
          status: 'handoff',
          sla: 'overdue',
          conversation: secondId,
        }),
      }),
    );
    expect(getConversationThread).toHaveBeenCalledWith('clinic-1', secondId);
    expect(listConversations).toHaveBeenCalledWith('clinic-1', {
      search: 'Ana',
      status: 'handoff',
      overdueOnly: true,
      page: 1,
    });
    expect(screen.getByRole('link', { name: 'Voltar às conversas' }).getAttribute('href')).toBe(
      '/conversas?q=Ana&status=handoff&sla=overdue',
    );
    expect(screen.getByRole('link', { name: 'Próxima página' }).getAttribute('href')).toBe(
      '/conversas?q=Ana&status=handoff&sla=overdue&page=2',
    );
    expect(
      screen
        .getByRole('region', { name: 'Lista de conversas' })
        .parentElement?.getAttribute('data-detail'),
    ).toBe('true');
  });

  it.each(['invalid-id', '33333333-3333-4333-8333-333333333333'])(
    'não consulta seleção fora dos resultados: %s',
    async (conversation) => {
      render(
        await ConversasPage({ searchParams: Promise.resolve({ conversation, page: 'Infinity' }) }),
      );
      expect(getConversationThread).toHaveBeenCalledOnce();
      expect(getConversationThread).toHaveBeenCalledWith('clinic-1', firstId);
      expect(listConversations).toHaveBeenCalledWith('clinic-1', { page: 1 });
    },
  );

  it('mostra estado vazio sem consultar histórico', async () => {
    listConversations.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 30 });
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Nenhuma conversa ainda')).toBeTruthy();
    expect(getConversationThread).not.toHaveBeenCalled();
  });

  it('mantém leitura sem composer para quem não pode gerenciar', async () => {
    requireUser.mockResolvedValue({ userId: 'user-2', permissions: ['view:conversations'] });
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('region', { name: 'Histórico da conversa' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Responder ao contato' })).toBeNull();
  });

  it('nega acesso antes de consultar ou decifrar contatos', async () => {
    requireUser.mockResolvedValue({ userId: 'user-2', permissions: [] });
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(requireClinicId).not.toHaveBeenCalled();
    expect(listConversations).not.toHaveBeenCalled();
    expect(getConversationThread).not.toHaveBeenCalled();
  });
});
