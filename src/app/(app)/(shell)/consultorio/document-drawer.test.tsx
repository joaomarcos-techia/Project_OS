// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ emitDocument: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn() } }));

import { DocumentDrawer } from './document-drawer';

afterEach(cleanup);

function openDrawer() {
  render(<DocumentDrawer patientId="00000000-0000-4000-8000-000000000001" />);
  fireEvent.click(screen.getByRole('button', { name: 'Documento' }));
}

describe('DocumentDrawer', () => {
  it('associa cada rótulo ao campo do tipo de documento selecionado', () => {
    openDrawer();

    expect(screen.getByLabelText('Descrição').getAttribute('id')).toBe('document-description');
    expect(screen.getByLabelText('Dias de afastamento').getAttribute('id')).toBe('document-days');
    expect(screen.getByLabelText('CID (opcional)').getAttribute('id')).toBe('document-cid');

    // O tipo deixou de ser <select> e virou grupo de radio com descrição —
    // <option> não comporta duas linhas. A troca é por clique no rádio.
    fireEvent.click(screen.getByRole('radio', { name: /Solicitação de exame/u }));

    expect(screen.getByLabelText('Exames (um por linha)').getAttribute('id')).toBe(
      'document-exams',
    );
    expect(screen.getByLabelText('Indicação clínica (opcional)').getAttribute('id')).toBe(
      'document-indication',
    );
  });

  it('expõe os quatro tipos como rádios de um grupo nomeado', () => {
    openDrawer();

    const group = screen.getByRole('radiogroup', { name: 'Tipo de documento' });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Atestado/u }).getAttribute('checked')).not.toBe(null);
  });

  it('descreve o que cada tipo serve, não só o nome dele', () => {
    // O rótulo sozinho não distingue atestado de declaração para quem não emite
    // documento todo dia — a descrição é o que torna a escolha decidível.
    openDrawer();
    expect(screen.getByText('Justificar afastamento ou incapacidade.')).toBeTruthy();
    expect(screen.getByText('Comprovar comparecimento ou acompanhamento.')).toBeTruthy();
  });
});
