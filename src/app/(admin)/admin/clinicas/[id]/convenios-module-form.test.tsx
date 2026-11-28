// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../actions/convenios-module', () => ({ setConveniosModuleAction: vi.fn() }));

import { ConveniosModuleForm } from './convenios-module-form';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const view = (o: Partial<Parameters<typeof ConveniosModuleForm>[0]['view']> = {}) => ({
  available: true,
  enabled: false,
  enabledAt: null,
  commercialDenial: null,
  ...o,
});

afterEach(cleanup);

describe('ConveniosModuleForm (P1.13)', () => {
  it('desligado por padrão; ligar pede motivo e o código do autenticador', () => {
    render(<ConveniosModuleForm clinicId={CLINIC} view={view()} />);
    expect(screen.getByText('Desligado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ligar Convênios' }));
    expect(screen.getByRole('textbox', { name: /Motivo/u })).toBeTruthy();
    expect(screen.getByLabelText('Código do autenticador (TOTP)')).toBeTruthy();
    expect((document.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe(
      'true',
    );
  });

  it('sem disponibilidade comercial ou sem contrato com Convênios: não deixa ligar', () => {
    const { unmount } = render(
      <ConveniosModuleForm clinicId={CLINIC} view={view({ available: false })} />,
    );
    expect(
      (screen.getByRole('button', { name: 'Ligar Convênios' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    unmount();
    render(<ConveniosModuleForm clinicId={CLINIC} view={view({ commercialDenial: 'trial' })} />);
    expect(
      (screen.getByRole('button', { name: 'Ligar Convênios' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('ligado: oferece desligar (sempre permitido, também com motivo e TOTP)', () => {
    render(
      <ConveniosModuleForm
        clinicId={CLINIC}
        view={view({ enabled: true, commercialDenial: 'subscription_canceled' })}
      />,
    );
    const b = screen.getByRole('button', { name: 'Desligar Convênios' }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect((document.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe(
      'false',
    );
  });
});
