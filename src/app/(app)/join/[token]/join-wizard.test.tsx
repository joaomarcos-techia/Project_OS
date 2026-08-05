// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { OnboardingComplete } from './join-wizard';

afterEach(cleanup);

describe('OnboardingComplete', () => {
  it('não afirma envio de e-mail quando não há provedor transacional configurado', () => {
    render(<OnboardingComplete />);

    expect(screen.getByText('Sua clínica está pronta para acesso.')).toBeTruthy();
    expect(screen.queryByText(/enviamos os detalhes de acesso/i)).toBeNull();
  });
});
