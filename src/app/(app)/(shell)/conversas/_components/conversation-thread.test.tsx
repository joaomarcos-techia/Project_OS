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
  contactName: null,
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

describe('continuidade do atendimento humano', () => {
  it('explica a pausa e a retomada sem prometer reprocessar mensagens antigas', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={original}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByText(/A IA está pausada nesta conversa/)).toBeTruthy();
    expect(screen.getByText(/próximas mensagens do paciente/)).toBeTruthy();
  });

  it('mostra falta de responsável e urgência sem devolver automaticamente', () => {
    const thread: AIConversationThread = {
      ...original,
      handoff: {
        ...original.handoff!,
        assignedToUserId: null,
        priority: 'urgent',
      },
    };
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={thread}
        canManage
        currentUserId="user-1"
        assignedToName={null}
      />,
    );
    expect(screen.getByText(/Nenhuma pessoa assumiu/)).toBeTruthy();
    expect(screen.getByText(/revise com a equipe responsável/)).toBeTruthy();
  });
});

describe('reenvio no histórico compartilhado', () => {
  it('mostra falha de entrega e reenvio para responsável autorizado dentro da janela', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={original}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByText(/Não entregue às/)).toBeTruthy();
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
        timeZone="America/Sao_Paulo"
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

describe('resposta da recepção pelo app do celular (coexistência)', () => {
  it('aparece como Recepção pelo celular, e não como a IA nem como o responsável', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={{
          ...original,
          messages: [
            {
              id: 'message-app',
              direction: 'out',
              author: 'business_app',
              text: 'Oi, já te retorno',
              createdAt: '2026-09-09T12:05:00Z',
              meta: null,
              delivery: null,
            },
          ],
        }}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByText('Recepção pelo celular')).toBeTruthy();
    expect(screen.getByText('Celular')).toBeTruthy();
    expect(screen.queryByText('Agente Qoro')).toBeNull();
    // Não foi a Qoro que enviou: não há entrega a acompanhar nem o que reenviar.
    expect(screen.queryByRole('button', { name: 'Reenviar' })).toBeNull();
  });
});

describe('identidade do contato na conversa', () => {
  const inbound = {
    id: 'message-in',
    direction: 'in' as const,
    author: 'patient' as const,
    text: 'Quero marcar uma consulta',
    createdAt: '2026-09-09T12:01:00Z',
    meta: null,
    delivery: null,
  };

  it('assina a mensagem com o nome do WhatsApp quando não há cadastro', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={{
          ...original,
          patientDisplayName: null,
          contactName: 'Maria do WhatsApp',
          contactPhone: '558897168587',
          messages: [inbound],
        }}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Maria do WhatsApp' })).toBeTruthy();
    expect(screen.getByText('+55 88 9716-8587')).toBeTruthy();
    // O chip continua dizendo o papel; o nome substitui o "Paciente" repetido.
    expect(screen.getByText('Maria do WhatsApp', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByText('Paciente')).toHaveLength(1);
  });

  it('sem nome nenhum, assina com o telefone formatado', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={{
          ...original,
          patientDisplayName: null,
          contactName: null,
          contactPhone: '558897168587',
          messages: [inbound],
        }}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByText('+55 88 9716-8587', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByText('Paciente')).toHaveLength(1);
  });

  it('o nome do cadastro tem precedência sobre o do WhatsApp', () => {
    render(
      <ConversationThread
        timeZone="America/Sao_Paulo"
        thread={{ ...original, contactName: 'Apelido no WhatsApp', messages: [inbound] }}
        canManage
        currentUserId="user-1"
        assignedToName="Recepção"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Paciente Teste' })).toBeTruthy();
    expect(screen.queryByText('Apelido no WhatsApp')).toBeNull();
  });
});
