// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLINIC_LOGO_MAX_BYTES } from '@/lib/storage/clinic-logo-policy';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  uploadClinicLogo: vi.fn(),
  updateClinicProfile: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/contexts/tenancy/actions', () => ({
  uploadClinicLogo: mocks.uploadClinicLogo,
  updateClinicProfile: mocks.updateClinicProfile,
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

import { PerfilForm } from './perfil-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PerfilForm', () => {
  it('bloqueia no cliente uma logo acima do limite antes de chamar a Server Action', () => {
    const { container } = render(
      <PerfilForm
        initial={{
          updatedAt: null,
          nome: 'Clínica Teste',
          endereco: null,
          telefone: null,
          cnpj: null,
          cnes: null,
          logoUrl: null,
        }}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const oversizedLogo = new File([new Uint8Array(CLINIC_LOGO_MAX_BYTES + 1)], 'logo.png', {
      type: 'image/png',
    });
    fireEvent.change(input!, { target: { files: [oversizedLogo] } });

    expect(mocks.toastError).toHaveBeenCalledWith('Imagem muito grande (máx. 4 MB).');
    expect(mocks.uploadClinicLogo).not.toHaveBeenCalled();
  });
});
