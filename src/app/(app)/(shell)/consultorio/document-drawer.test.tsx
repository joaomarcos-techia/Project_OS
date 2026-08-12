// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ emitDocument: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn() } }));

import { DocumentDrawer } from './document-drawer';

describe('DocumentDrawer', () => {
  it('associa cada rótulo ao campo do tipo de documento selecionado', () => {
    render(<DocumentDrawer patientId="00000000-0000-4000-8000-000000000001" />);

    fireEvent.click(screen.getByRole('button', { name: 'Documento' }));

    expect(screen.getByLabelText('Tipo').getAttribute('id')).toBe('document-type');
    expect(screen.getByLabelText('Descrição').getAttribute('id')).toBe('document-description');
    expect(screen.getByLabelText('Dias de afastamento').getAttribute('id')).toBe('document-days');
    expect(screen.getByLabelText('CID (opcional)').getAttribute('id')).toBe('document-cid');

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'exame' } });

    expect(screen.getByLabelText('Exames (um por linha)').getAttribute('id')).toBe(
      'document-exams',
    );
    expect(screen.getByLabelText('Indicação clínica (opcional)').getAttribute('id')).toBe(
      'document-indication',
    );
  });
});
