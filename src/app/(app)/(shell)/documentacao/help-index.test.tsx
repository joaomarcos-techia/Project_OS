// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { DOC_TOPICS } from './content';
import { HelpIndex } from './help-index';

afterEach(cleanup);

describe('busca da central de ajuda', () => {
  it('exibe os guias agrupados com o endereço solicitado', () => {
    render(<HelpIndex topics={DOC_TOPICS} />);
    expect(screen.getAllByRole('link')).toHaveLength(DOC_TOPICS.length);
    expect(
      screen.getByRole('link', { name: /Agendar, remarcar e cancelar/u }).getAttribute('href'),
    ).toBe('/documentação/agenda');
    expect(screen.getByRole('region', { name: 'WhatsApp e IA' })).toBeTruthy();
  });

  it('busca também nos passos, sem exigir acento ou letra maiúscula', () => {
    render(<HelpIndex topics={DOC_TOPICS} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'MEDICO CRM' } });
    expect(screen.getByRole('link', { name: /Planos, médicos e acessos/u })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Conectar o WhatsApp da clínica/u })).toBeNull();
  });

  it('permite limpar uma busca vazia de resultados e não interpreta HTML digitado', () => {
    const { container } = render(<HelpIndex topics={DOC_TOPICS} />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '<script>qualquercoisa</script>' },
    });
    expect(screen.getByRole('heading', { name: 'Nenhum guia encontrado' })).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getAllByRole('link')).toHaveLength(DOC_TOPICS.length);
    expect(screen.getByRole('status').textContent).toContain(`${DOC_TOPICS.length} guias`);
  });
});
