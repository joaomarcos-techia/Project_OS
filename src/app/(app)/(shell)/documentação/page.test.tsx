// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn<() => Promise<{ id: string } | null>>(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  permanentRedirect: vi.fn((path: string): never => {
    throw new Error(`permanent:${path}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error('not-found');
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  permanentRedirect: mocks.permanentRedirect,
  notFound: mocks.notFound,
}));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser: mocks.currentUser }));
vi.mock('../_painel/onboarding-progress', () => ({ currentOnboardingProgress: async () => null }));
vi.mock('../documentacao/mark-visited', () => ({ MarkDocsVisited: () => null }));
vi.mock('../documentacao/restart-tour', () => ({ RestartTour: () => null }));

import DocumentationPage from './page';
import TopicPage, { generateMetadata, generateStaticParams } from './[topic]/page';
import { DOC_TOPICS } from '../documentacao/content';

beforeEach(() => {
  mocks.currentUser.mockResolvedValue({ id: 'test-account' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('documentação dentro da conta Qoro', () => {
  it('oferece guias de uso e busca, sem conteúdo de engenharia ou marcas anteriores', async () => {
    const { container } = render(await DocumentationPage());
    expect(screen.getByRole('heading', { name: 'Central de ajuda' })).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(DOC_TOPICS.length);
    expect(container.textContent).not.toMatch(/ClinicaOS|Mintlify|commit|migrações|outbox/iu);
  });

  it('renderiza um guia com passos numerados e volta para a central no endereço correto', async () => {
    render(await TopicPage({ params: Promise.resolve({ topic: 'agenda' }) }));
    expect(screen.getByRole('heading', { name: 'Agendar, remarcar e cancelar' })).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Criar um agendamento' }).querySelectorAll('ol li'),
    ).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Ajuda' }).getAttribute('href')).toBe('/documentação');
    // UX-008: a página não repete a marca; o modelo '%s · Qoro' do layout raiz a acrescenta, e a
    // aba fica "Agendar, remarcar e cancelar · Ajuda · Qoro" (src/app/page-titles.test.ts).
    expect(await generateMetadata({ params: Promise.resolve({ topic: 'agenda' }) })).toEqual({
      title: 'Agendar, remarcar e cancelar · Ajuda',
      description: findAgendaSummary(),
    });
  });

  it('recusa um guia desconhecido sem ler arquivos pelo parâmetro', async () => {
    await expect(TopicPage({ params: Promise.resolve({ topic: '__proto__' }) })).rejects.toThrow(
      'not-found',
    );
    expect(await generateStaticParams()).toHaveLength(DOC_TOPICS.length);
  });

  it('exige a sessão tanto no índice quanto em um artigo', async () => {
    mocks.currentUser.mockResolvedValue(null);
    await expect(DocumentationPage()).rejects.toThrow('redirect:/login');
    await expect(TopicPage({ params: Promise.resolve({ topic: 'agenda' }) })).rejects.toThrow(
      'redirect:/login',
    );
  });
});

function findAgendaSummary(): string {
  const topic = DOC_TOPICS.find((item) => item.slug === 'agenda');
  if (!topic) throw new Error('Guide fixture missing');
  return topic.summary;
}
