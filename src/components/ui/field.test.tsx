// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Field } from './field';
import { Combobox } from './combobox';
import { Input } from './input';

afterEach(cleanup);

describe('Field', () => {
  it('associa o rótulo de um controle simples por htmlFor/id', () => {
    render(
      <Field label="E-mail" htmlFor="account-email" required>
        <Input id="account-email" type="email" />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'E-mail' }).getAttribute('id')).toBe(
      'account-email',
    );
  });

  it('usa fieldset/legend para um conjunto de controles', () => {
    render(
      <Field label="Canais de contato" group>
        <label>
          <input type="checkbox" /> E-mail
        </label>
        <label>
          <input type="checkbox" /> WhatsApp
        </label>
      </Field>,
    );

    const group = screen.getByRole('group', { name: 'Canais de contato' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelector('legend')?.textContent).toBe('Canais de contato');
  });

  it('mantém o rótulo do Combobox associado quando já existe uma seleção', () => {
    render(
      <Field label="Paciente" htmlFor="appointment-patient">
        <Combobox
          id="appointment-patient"
          value={{ id: 'patient-1', label: 'Maria Silva' }}
          onSelect={() => undefined}
          onSearch={async () => []}
        />
      </Field>,
    );

    expect(screen.getByRole('group', { name: 'Paciente' }).textContent).toContain('Maria Silva');
    expect(screen.getByRole('button', { name: 'Trocar seleção' })).not.toBeNull();
  });
});
