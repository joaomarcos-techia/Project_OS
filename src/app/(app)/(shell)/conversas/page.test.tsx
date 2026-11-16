// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConversationListItem, AIConversationThread } from '@/contexts/ai-agent/types';

const { listConversations, getConversationThread, countOpenHandoffs, getProfileNames, pageGate } =
  vi.hoisted(() => ({
    listConversations: vi.fn(),
    getConversationThread: vi.fn(),
    countOpenHandoffs: vi.fn(),
    getProfileNames: vi.fn(),
    pageGate: vi.fn(),
  }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/lib/auth/page-guard', () => ({ pageGate }));
vi.mock('@/contexts/ai-agent/queries', () => ({ countOpenHandoffs }));
// S-01b: a inbox lê pela fronteira que conhece a sessão de suporte.
vi.mock('@/contexts/ai-agent/conversation-access', () => ({
  listConversationsForViewer: listConversations,
  readConversationThread: getConversationThread,
}));
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
  contactName: null,
  lastMessagePreview: 'Preciso confirmar a consulta.',
  status: 'handoff',
  lastMessageAt: '2026-09-09T12:00:00Z',
  intentAtual: null,
  windowOpen: true,
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
  pageGate.mockResolvedValue({
    allowed: true,
    clinicId: 'clinic-1',
    user: {
      userId: 'user-1',
      permissions: ['view:conversations', 'manage:conversations'],
    },
  });
  listConversations.mockResolvedValue({ items: [first, second], total: 2, page: 1, pageSize: 30 });
  getConversationThread.mockImplementation(async (_clinicId: string, id: string) =>
    thread(id === firstId ? first : second),
  );
  getProfileNames.mockResolvedValue(new Map([['user-1', 'Recepção Teste']]));
  countOpenHandoffs.mockResolvedValue({ abertos: 0, vencidos: 0 });
});
afterEach(cleanup);

describe('inbox de conversas', () => {
  it('mostra contato e histórico lado a lado, com telefone inclusive para paciente cadastrado', async () => {
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(getConversationThread).toHaveBeenCalledWith('clinic-1', firstId, 'conversas_inbox');
    const inbox = screen.getByRole('region', { name: 'Lista de conversas' });
    expect(within(inbox).getByText('+55 11 99999-1234')).toBeTruthy();
    expect(
      within(inbox)
        .getByRole('link', { name: /Ana Teste/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(
      within(screen.getByRole('region', { name: 'Conversa selecionada' })).getByText(
        '+55 11 99999-1234',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Responder ao contato' })).toBeTruthy();
  });

  it('identifica contato sem cadastro pelo nome do WhatsApp, com o telefone formatado embaixo', async () => {
    // O caso real: wa_id brasileiro de 12 dígitos (celular de antes do nono
    // dígito) e o nome que a pessoa usa no perfil do WhatsApp.
    const whatsapp: AIConversationListItem = {
      ...second,
      contactName: 'Maria do WhatsApp',
      contactPhone: '558897168587',
      maskedPhone: '+5588*****8587',
    };
    listConversations.mockResolvedValue({ items: [whatsapp], total: 1, page: 1, pageSize: 30 });
    getConversationThread.mockResolvedValue(thread(whatsapp));
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    const inbox = screen.getByRole('region', { name: 'Lista de conversas' });
    expect(within(inbox).getByText('Maria do WhatsApp')).toBeTruthy();
    expect(within(inbox).getByText('+55 88 9716-8587')).toBeTruthy();
    const selected = screen.getByRole('region', { name: 'Conversa selecionada' });
    expect(within(selected).getByRole('heading', { name: 'Maria do WhatsApp' })).toBeTruthy();
    expect(within(selected).getByText('+55 88 9716-8587')).toBeTruthy();
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
    expect(getConversationThread).toHaveBeenCalledWith('clinic-1', secondId, 'conversas_inbox');
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
      expect(getConversationThread).toHaveBeenCalledWith('clinic-1', firstId, 'conversas_inbox');
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
    pageGate.mockResolvedValue({
      allowed: true,
      clinicId: 'clinic-1',
      user: { userId: 'user-2', permissions: ['view:conversations'] },
    });
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('region', { name: 'Histórico da conversa' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Responder ao contato' })).toBeNull();
  });

  it('nega acesso antes de consultar ou decifrar contatos', async () => {
    pageGate.mockResolvedValue({ allowed: false });
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));
    expect(listConversations).not.toHaveBeenCalled();
    expect(getConversationThread).not.toHaveBeenCalled();
  });
});

describe('inbox na sessão de suporte (S-01b)', () => {
  // Como `listConversationsForViewer` entrega a lista numa sessão de suporte:
  // sem prévia, só o telefone mascarado, e `supportSession` ligado.
  const hidden = (item: AIConversationListItem): AIConversationListItem => ({
    ...item,
    lastMessagePreview: null,
    contactPhone: null,
    maskedPhone: '+5511*****1234',
    previewHidden: true,
  });

  beforeEach(() => {
    listConversations.mockResolvedValue({
      items: [hidden(first), hidden(second)],
      total: 2,
      page: 1,
      pageSize: 30,
      supportSession: true,
    });
  });

  it('não abre conversa sozinha e avisa que abrir fica registrado', async () => {
    render(await ConversasPage({ searchParams: Promise.resolve({}) }));

    expect(getConversationThread).not.toHaveBeenCalled();
    expect(screen.getAllByText('Prévia oculta na sessão de suporte')).toHaveLength(2);
    expect(screen.queryByText('Preciso confirmar a consulta.')).toBeNull();
    expect(screen.getByText(/cada abertura fica registrada na auditoria da clínica/u)).toBeTruthy();
  });

  it('abre a conversa escolhida pelo leitor auditado', async () => {
    render(await ConversasPage({ searchParams: Promise.resolve({ conversation: secondId }) }));

    expect(getConversationThread).toHaveBeenCalledOnce();
    expect(getConversationThread).toHaveBeenCalledWith('clinic-1', secondId, 'conversas_inbox');
  });
});
