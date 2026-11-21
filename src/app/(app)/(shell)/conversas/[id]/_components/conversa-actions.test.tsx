// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../actions', () => ({
  assumirConversaAction: vi.fn(),
  definirPrioridadeAction: vi.fn(),
  devolverAoAgenteAction: vi.fn(),
  responderAction: vi.fn(),
}));

import type { AIHandoffState } from '@/contexts/ai-agent/types';

import { ConversaActions } from './conversa-actions';

afterEach(cleanup);

const ME = 'user-me';

function renderWith(status: 'active' | 'handoff', handoff: AIHandoffState | null) {
  render(
    <ConversaActions
      conversationId="conv-1"
      status={status}
      windowOpen
      windowClosesAt={null}
      lastInboundAt={null}
      timeZone="America/Sao_Paulo"
      canManage
      handoff={handoff}
      currentUserId={ME}
      assignedToName={handoff?.assignedToUserId ? 'Colega' : null}
    />,
  );
}

const handoff = (assignedToUserId: string | null): AIHandoffState => ({
  assignedToUserId,
  priority: 'normal',
  dueAt: '2026-09-30T12:00:00Z',
  overdue: false,
});

const devolver = () => screen.queryByRole('button', { name: 'Devolver ao agente' });

describe('ConversaActions — devolver ao agente', () => {
  it('"Aguardando responsável" sem ninguém assumido oferece assumir E devolver', () => {
    renderWith('handoff', handoff(null));
    expect(screen.getByText('Aguardando responsável')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assumir atendimento' })).toBeTruthy();
    expect(devolver()).toBeTruthy();
  });

  it('atribuída a outra pessoa: só reatribuir, sem devolver por cima dela', () => {
    renderWith('handoff', handoff('user-colega'));
    expect(screen.getByRole('button', { name: 'Reatribuir para mim' })).toBeTruthy();
    expect(devolver()).toBeNull();
  });

  it('com o agente respondendo não há o que devolver', () => {
    renderWith('active', null);
    expect(screen.getByRole('button', { name: 'Assumir atendimento' })).toBeTruthy();
    expect(devolver()).toBeNull();
  });

  it('assumida por mim continua com o devolver do painel de atendimento', () => {
    renderWith('handoff', handoff(ME));
    expect(devolver()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assumir atendimento' })).toBeNull();
  });
});
