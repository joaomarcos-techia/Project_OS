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

  // UX-001 (docs/otimização_ui_final.md): dica e erro descrevem o controle.
  it('liga a dica ao controle por aria-describedby', () => {
    render(
      <Field label="Telefone" htmlFor="patient-phone" hint="Com DDD, só números.">
        <Input id="patient-phone" />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Telefone' });
    expect(input.getAttribute('aria-describedby')).toBe('patient-phone-hint');
    expect(document.getElementById('patient-phone-hint')?.textContent).toBe('Com DDD, só números.');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('com erro, liga o erro no lugar da dica e marca o controle como inválido', () => {
    render(
      <Field
        label="Telefone"
        htmlFor="patient-phone"
        hint="Com DDD, só números."
        error="Informe o DDD e o número."
      >
        <Input id="patient-phone" />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Telefone' });
    expect(input.getAttribute('aria-describedby')).toBe('patient-phone-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('patient-phone-hint')).toBeNull();
    expect(screen.getByRole('textbox', { description: 'Informe o DDD e o número.' })).toBe(input);
  });

  it('preserva aria-describedby e aria-invalid passados pelo chamador', () => {
    render(
      <Field label="CPF" htmlFor="patient-cpf" hint="Só números." error="CPF inválido.">
        <Input id="patient-cpf" aria-describedby="cpf-extra" aria-invalid={false} />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'CPF' });
    expect(input.getAttribute('aria-describedby')).toBe('cpf-extra patient-cpf-error');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('anuncia a obrigatoriedade quando o controle não tem required', () => {
    render(
      <Field label="Nome" htmlFor="patient-name" required>
        <Input id="patient-name" />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Nome' }).getAttribute('aria-required')).toBe(
      'true',
    );
  });

  it('não mexe em filho que não é o controle do rótulo', () => {
    render(
      <Field label="Valor" htmlFor="amount" hint="Em reais." error="Informe o valor.">
        <div data-testid="wrapper">
          <Input id="amount" />
        </div>
      </Field>,
    );

    expect(screen.getByTestId('wrapper').getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByTestId('wrapper').getAttribute('aria-invalid')).toBeNull();
  });

  it('em grupo, a dica descreve o fieldset', () => {
    render(
      <Field label="Canais" group hint="Escolha ao menos um.">
        <label>
          <input type="checkbox" /> E-mail
        </label>
      </Field>,
    );

    const group = screen.getByRole('group', { name: 'Canais' });
    const describedBy = group.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Escolha ao menos um.');
  });
});
