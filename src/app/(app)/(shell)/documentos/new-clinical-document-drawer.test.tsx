// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { buscarPacientesParaDocumento } = vi.hoisted(() => ({
  buscarPacientesParaDocumento: vi.fn(),
}));

vi.mock('./actions', () => ({ buscarPacientesParaDocumento }));

import { NewClinicalDocumentDrawer } from './new-clinical-document-drawer';

afterEach(cleanup);

describe('NewClinicalDocumentDrawer', () => {
  it('seleciona paciente e roteia cada tipo sem criar consulta', async () => {
    buscarPacientesParaDocumento.mockResolvedValueOnce([{ id: 'patient-a', label: 'Ana Lima' }]);
    render(<NewClinicalDocumentDrawer canCreateProntuario canCreateDocument />);

    fireEvent.click(screen.getByRole('button', { name: 'Novo documento' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar paciente' }), {
      target: { value: 'Ana' },
    });
    await waitFor(() => expect(buscarPacientesParaDocumento).toHaveBeenCalledWith('ana'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ana Lima' }));

    expect(screen.getByRole('link', { name: /Prontu/u }).getAttribute('href')).toBe(
      '/pacientes/patient-a?tab=prontuarios',
    );
    expect(screen.getByRole('link', { name: /Prescri/u }).getAttribute('href')).toBe(
      '/pacientes/patient-a?novo=prescricao',
    );
    expect(screen.getByRole('link', { name: /Documento m/u }).getAttribute('href')).toBe(
      '/pacientes/patient-a?novo=documento',
    );
    // P1.7: o texto diz o caminho real (a emissão segue na ficha) e mantém a garantia de não
    // criar consulta só para emitir.
    expect(document.body.textContent).toContain('A emissão continua na ficha do paciente');
    expect(document.body.textContent).toContain('nenhuma consulta');
  });

  it('não oferece tipo sem permissão correspondente', async () => {
    buscarPacientesParaDocumento.mockResolvedValueOnce([{ id: 'patient-a', label: 'Ana Lima' }]);
    render(<NewClinicalDocumentDrawer canCreateProntuario={false} canCreateDocument />);

    fireEvent.click(screen.getByRole('button', { name: 'Novo documento' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar paciente' }), {
      target: { value: 'Ana' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Ana Lima' }));

    expect(screen.queryByRole('link', { name: /Prontu/u })).toBeNull();
    expect(screen.getByRole('link', { name: /Prescri/u })).toBeTruthy();
  });
});
