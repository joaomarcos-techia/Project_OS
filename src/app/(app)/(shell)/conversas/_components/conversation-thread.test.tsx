// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIConversationThread } from '@/contexts/ai-agent/types';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('../[id]/_components/conversa-actions', () => ({
  ConversaActions: () => <form aria-label="Atender" />,
}));
vi.mock('../[id]/_components/retry-message-button', () => ({
  RetryMessageButton: () => <button>Reenviar</button>,
}));
import { ConversationThread } from './conversation-thread';

const original: AIConversationThread = {
  id: '11111111-1111-4111-8111-111111111111',
  patientDisplayName: 'Paciente Teste',
  contactPhone: '+5511999991234',
  maskedPhone: '+5511*****1234',
  status: 'handoff',
  intentAtual: null,
  startedAt: '2026-09-09T12:00:00Z',
  lastMessageAt: '2026-09-09T12:00:00Z',
  messages: [
    {
      id: 'message-1',
      direction: 'out',
      author: 'human',
      text: 'Mensagem de teste',
      createdAt: '2026-09-09T12:00:00Z',
      meta: null,
      delivery: 'failed',
    },
  ],
  handoff: {
    assignedToUserId: 'user-1',
    priority: 'normal',
    dueAt: '2026-09-09T13:00:00Z',
    overdue: false,
  },
  window: { open: true, lastInboundAt: '2026-09-09T12:00:00Z', closesAt: '2026-09-10T12:00:00Z' },
};
afterEach(cleanup);

describe('reenvio no histórico compartilhado', () => {
  it('mostra falha de entrega e reenvio para responsável autorizado dentro da janela', () => {
    render(
      <ConversationThread
        thread={original}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByText('Falha de entrega no WhatsApp')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reenviar' })).toBeTruthy();
  });

  it.each([
    { name: 'sem permissão', canManage: false, currentUserId: 'user-1', thread: original },
    { name: 'outro responsável', canManage: true, currentUserId: 'user-2', thread: original },
    {
      name: 'janela fechada',
      canManage: true,
      currentUserId: 'user-1',
      thread: { ...original, window: { ...original.window, open: false } },
    },
    {
      name: 'conversa encerrada',
      canManage: true,
      currentUserId: 'user-1',
      thread: { ...original, status: 'closed' as const },
    },
    {
      name: 'sem handoff',
      canManage: true,
      currentUserId: 'user-1',
      thread: { ...original, handoff: null },
    },
    {
      name: 'mensagem entregue',
      canManage: true,
      currentUserId: 'user-1',
      thread: {
        ...original,
        messages: original.messages.map((message) => ({
          ...message,
          delivery: 'delivered' as const,
        })),
      },
    },
  ])('não oferece reenvio: $name', ({ thread, canManage, currentUserId }) => {
    render(
      <ConversationThread
        thread={thread}
        canManage={canManage}
        currentUserId={currentUserId}
        assignedToName="Recepção"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reenviar' })).toBeNull();
    expect(screen.getByText('Mensagem de teste')).toBeTruthy();
  });
});
