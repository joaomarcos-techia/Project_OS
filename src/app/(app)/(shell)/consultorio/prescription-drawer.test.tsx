// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ emitPrescription: vi.fn() }));
vi.mock('@/contexts/clinical/actions-templates', () => ({
  createPrescriptionTemplate: vi.fn(),
  listMyPrescriptionTemplates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PrescriptionDrawer } from './prescription-drawer';

afterEach(cleanup);

describe('PrescriptionDrawer', () => {
  it('pode abrir diretamente sem prontuário ou consulta', () => {
    render(
      <PrescriptionDrawer
        patientId="00000000-0000-4000-8000-000000000001"
        prontuarioId={null}
        defaultOpen
      />,
    );

    expect(screen.getByRole('heading', { name: /Emitir prescri/u })).toBeTruthy();
  });
});
