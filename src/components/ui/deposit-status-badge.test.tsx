// @vitest-environment happy-dom
/**
 * `DepositStatusBadge` (ADR-049 1.6b) — o sinal na agenda.
 *
 * O que se prova aqui é sobretudo o que NÃO aparece. `none` é o caso da grande
 * maioria das clínicas (sinal desligado por padrão desde a 1.2), e um rótulo
 * "sem sinal" em toda consulta treinaria o operador a ignorar a região da tela —
 * e aí ele também ignora quando importa.
 *
 * O TOM não é testado de propósito: cor é decisão de design, e assertar a classe
 * Tailwind acoplaria o teste ao interno do design system, quebrando a cada troca
 * de token sem que nada de comportamento tivesse mudado.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DepositStatusBadge } from './status-badge';

afterEach(cleanup);

describe('DepositStatusBadge', () => {
  it('sinal desligado não vira ruído na tela', () => {
    const { container } = render(<DepositStatusBadge status="none" />);

    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['pending', 'Sinal pendente'],
    ['paid', 'Sinal pago'],
    ['expired', 'Sinal vencido'],
    ['refunded', 'Sinal estornado'],
  ] as const)('%s → "%s"', (status, label) => {
    render(<DepositStatusBadge status={status} />);

    expect(screen.getByText(label).textContent).toBe(label);
  });

  it('cada estado tem rótulo próprio — nenhum se confunde com outro', () => {
    // "pendente" e "vencido" pedem ações opostas da recepção: um ainda dá para
    // salvar, o outro já virou cancelamento. Rótulo repetido apagaria isso.
    const labels = (['pending', 'paid', 'expired', 'refunded'] as const).map((status) => {
      const { container } = render(<DepositStatusBadge status={status} />);
      const text = container.textContent ?? '';
      cleanup();
      return text;
    });

    expect(new Set(labels).size).toBe(labels.length);
  });
});
