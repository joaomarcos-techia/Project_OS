// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `ChecklistDismiss` é client e chama `useRouter`. Aqui interessa a COMPOSIÇÃO
// do bloco; o comportamento de dispensar tem prova própria no harness de banco
// (`onboarding-progress-db.ts`) e em `operational-onboarding.test.ts`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ActivationChecklist } from './activation-checklist';

import type { ActivationChecklistDTO } from '../data';

function checklist(overrides: Partial<ActivationChecklistDTO> = {}): ActivationChecklistDTO {
  return {
    items: [
      {
        key: 'doctor',
        label: 'Cadastre um médico',
        desc: 'Adicione quem vai atender na clínica.',
        href: '/equipe',
        done: true,
      },
      {
        key: 'hours',
        label: 'Defina os horários',
        desc: 'Diga quando a clínica atende.',
        href: '/configuracoes/horarios',
        done: false,
      },
    ],
    done: 1,
    total: 2,
    complete: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe('ActivationChecklist', () => {
  it('anuncia o progresso como progressbar, não só como texto', () => {
    render(<ActivationChecklist data={checklist()} />);

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    // O leitor de tela precisa ouvir a fração, não "50".
    expect(bar.getAttribute('aria-valuetext')).toBe('1 de 2 passos concluídos');
  });

  it('mostra o próximo passo pendente, não o primeiro da lista', () => {
    render(<ActivationChecklist data={checklist()} />);

    // Asserção NO RESUMO, não no documento: as duas descrições também aparecem
    // na lista abaixo, então procurar no DOM inteiro passaria mesmo que o
    // resumo mostrasse o passo errado. Verificado por mutação.
    const resumo = screen.getByText('Próximo:').parentElement;
    expect(resumo?.textContent).toContain('Diga quando a clínica atende.');
    expect(resumo?.textContent).not.toContain('Adicione quem vai atender');
  });

  it('some quando os passos terminam', () => {
    const { container } = render(
      <ActivationChecklist data={checklist({ done: 2, complete: true })} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('some quando a pessoa dispensa, mesmo com passos pendentes', () => {
    const { container } = render(<ActivationChecklist data={checklist()} dismissed />);
    expect(container.innerHTML).toBe('');
  });

  it('leva cada item ao seu destino e risca só o que está feito', () => {
    render(<ActivationChecklist data={checklist()} />);

    expect(screen.getByRole('link', { name: /Cadastre um médico/ }).getAttribute('href')).toBe(
      '/equipe',
    );
    expect(screen.getByText('Cadastre um médico').className).toContain('line-through');
    expect(screen.getByText('Defina os horários').className).not.toContain('line-through');
  });
});
