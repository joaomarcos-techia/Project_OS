import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import HomePage from './page';

beforeEach(() => {
  mocks.redirect.mockReset();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
});

describe('retorno público do Checkout do paciente', () => {
  it('não afirma pagamento confirmado apenas pelo parâmetro success', async () => {
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ payment: 'success' }) }),
    );

    expect(html).toContain('Estamos verificando seu pagamento');
    expect(html).toContain('O Asaas ainda precisa confirmar a cobrança');
    expect(html).toContain('Esta página não é um comprovante');
    expect(html).not.toContain('Pagamento confirmado');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', 'Pagamento ainda não confirmado'],
    ['expired', 'Prazo do Checkout encerrado'],
  ])('mostra o retorno %s sem prometer baixa financeira', async (payment, title) => {
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ payment }) }),
    );
    expect(html).toContain(title);
    expect(html).toContain('Esta página não é um comprovante');
  });

  it.each([undefined, 'paid', ''])('preserva entrada normal pelo login (%s)', async (payment) => {
    await expect(
      HomePage({ searchParams: Promise.resolve(payment === undefined ? {} : { payment }) }),
    ).rejects.toThrow('REDIRECT:/login');
  });
});
