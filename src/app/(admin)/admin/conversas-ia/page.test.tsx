// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guardAdminAccess, listOptions, list, openConversationForAdmin } = vi.hoisted(() => ({
  guardAdminAccess: vi.fn(),
  listOptions: vi.fn(),
  list: vi.fn(),
  openConversationForAdmin: vi.fn(),
}));

vi.mock('../_lib/guard', () => ({ guardAdminAccess }));
vi.mock('../_lib/repositories/clinics.repo', () => ({ clinicRepository: { listOptions } }));
vi.mock('../_lib/repositories/conversations.repo', () => ({ conversationsRepository: { list } }));
vi.mock('../_lib/conversation-content', () => ({ openConversationForAdmin }));
vi.mock('@/components/ui/date-field', () => ({
  DateField: ({ name }: { name: string }) => <input name={name} aria-label={name} />,
}));

import ConversasIaPage from './page';

const CLINIC_X = '11111111-1111-4111-8111-111111111111';
const CONV = '33333333-3333-4333-8333-333333333333';
const SECRET_TEXT = 'Estou com dor no peito desde ontem';

const listItem = {
  id: CONV,
  clinicId: CLINIC_X,
  clinicNome: 'Clínica Aurora',
  status: 'handoff',
  lastMessageAt: '2026-11-15T12:00:00.000Z',
  messageCount: 2,
};

const meta = (over: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  direction: 'in',
  author: 'patient',
  intent: null,
  toolNames: [],
  model: null,
  latencyMs: null,
  createdAt: '2026-11-15T12:00:00.000Z',
  ...over,
});

const conversationMeta = {
  id: CONV,
  clinicId: CLINIC_X,
  clinicNome: 'Clínica Aurora',
  status: 'handoff',
  messages: [
    meta(),
    meta({
      id: 'msg-2',
      direction: 'out',
      author: 'agent',
      intent: 'prepare_appointment',
      toolNames: ['prepare_appointment'],
      model: 'gemini-2.5-flash',
      latencyMs: 812,
    }),
  ],
};

// O Next entrega `string | string[]`; o tipo da página é mais estreito de
// propósito — o array tem de cair na validação, não no SQL. Daí o `as never`.
async function renderPage(sp: Record<string, string | string[]> = {}) {
  return render(await ConversasIaPage({ searchParams: Promise.resolve(sp) as never }));
}

describe('ConversasIaPage (S-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardAdminAccess.mockResolvedValue(undefined);
    listOptions.mockResolvedValue([{ id: CLINIC_X, nome: 'Clínica Aurora' }]);
    list.mockResolvedValue([listItem]);
  });

  afterEach(() => {
    cleanup();
  });

  it('sem conversa escolhida: lista com link para a conversa e nada é aberto', async () => {
    await renderPage();

    expect(openConversationForAdmin).not.toHaveBeenCalled();
    expect(screen.getByText('Selecione uma conversa para ver as mensagens')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Clínica Aurora/u });
    expect(link.getAttribute('href')).toBe(`/admin/conversas-ia?c=${CONV}&clinic=${CLINIC_X}`);
  });

  it('abre a conversa com os ids validados', async () => {
    openConversationForAdmin.mockResolvedValue({ kind: 'not_found' });

    await renderPage({ clinic: CLINIC_X, c: CONV });

    expect(openConversationForAdmin).toHaveBeenCalledWith(CLINIC_X, CONV);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_X }));
    expect(screen.getByText('Conversa não encontrada.')).toBeTruthy();
  });

  it('id de conversa malformado ou repetido: "não encontrada" sem chamar o leitor', async () => {
    await renderPage({ clinic: CLINIC_X, c: 'nao-e-uuid' });
    expect(screen.getByText('Conversa não encontrada.')).toBeTruthy();
    cleanup();
    await renderPage({ clinic: CLINIC_X, c: [CONV, CONV] });
    expect(screen.getByText('Conversa não encontrada.')).toBeTruthy();

    expect(openConversationForAdmin).not.toHaveBeenCalled();
  });

  it('clínica malformada: lista sem filtro e nenhuma abertura', async () => {
    await renderPage({ clinic: "x' OR 1=1 --", c: CONV });

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ clinicId: undefined }));
    expect(openConversationForAdmin).not.toHaveBeenCalled();
    expect(screen.getByText('Conversa não encontrada.')).toBeTruthy();
  });

  it('sem sessão de suporte: metadados, aviso e caminho para abrir a sessão — nenhum texto', async () => {
    openConversationForAdmin.mockResolvedValue({
      kind: 'metadata',
      reason: 'no_support_session',
      conversation: conversationMeta,
    });

    const { container } = await renderPage({ clinic: CLINIC_X, c: CONV });

    expect(container.querySelector('.iad-bubble')).toBeNull();
    expect(container.querySelectorAll('[data-message-meta]')).toHaveLength(2);
    expect(screen.getByText(/só aparece numa sessão de suporte desta clínica/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir sessão de suporte' }).getAttribute('href')).toBe(
      `/admin/clinicas/${CLINIC_X}`,
    );
    expect(screen.getByText(/^Paciente ·/u)).toBeTruthy();
    expect(
      screen.getByText(
        /IA · .*prepare_appointment · tools: prepare_appointment · gemini-2\.5-flash · 812 ms/u,
      ),
    ).toBeTruthy();
  });

  it('sessão de outra clínica: aviso próprio, ainda sem texto', async () => {
    openConversationForAdmin.mockResolvedValue({
      kind: 'metadata',
      reason: 'other_clinic_session',
      conversation: conversationMeta,
    });

    const { container } = await renderPage({ clinic: CLINIC_X, c: CONV });

    expect(screen.getByText(/Sua sessão de suporte é de outra clínica/u)).toBeTruthy();
    expect(container.querySelector('.iad-bubble')).toBeNull();
  });

  it('com sessão da clínica: mostra o texto, a autoria certa e avisa que a abertura foi registrada', async () => {
    openConversationForAdmin.mockResolvedValue({
      kind: 'content',
      conversation: {
        ...conversationMeta,
        messages: [
          { ...meta(), text: SECRET_TEXT },
          { ...meta({ id: 'msg-2', direction: 'out', author: 'human' }), text: 'Já vamos ligar.' },
        ],
      },
    });

    await renderPage({ clinic: CLINIC_X, c: CONV });

    expect(screen.getByText(SECRET_TEXT)).toBeTruthy();
    expect(screen.getByText(/^Equipe da clínica ·/u)).toBeTruthy();
    expect(
      screen.getByText('Esta abertura foi registrada na auditoria da plataforma.'),
    ).toBeTruthy();
  });

  it('guard bloqueia: nada é consultado nem aberto', async () => {
    guardAdminAccess.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(
      ConversasIaPage({ searchParams: Promise.resolve({ clinic: CLINIC_X, c: CONV }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(listOptions).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(openConversationForAdmin).not.toHaveBeenCalled();
  });
});
