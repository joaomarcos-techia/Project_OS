// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DocumentationDirectory } from './documentation-directory';

afterEach(cleanup);

describe('DocumentationDirectory', () => {
  it('filtra os tópicos por título e resumo', () => {
    render(<DocumentationDirectory />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'WhatsApp' } });

    expect(screen.getByRole('link', { name: /WhatsApp e Meta/u })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Financeiro e caixa/u })).toBeNull();
    expect(screen.getByText('1 tópico')).toBeTruthy();
  });

  it('mostra uma orientação quando a busca não encontra conteúdo', () => {
    render(<DocumentationDirectory />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'termo inexistente' } });
    expect(screen.getByText('Nenhum tópico encontrado')).toBeTruthy();
  });
});
