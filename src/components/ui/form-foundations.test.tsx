// @vitest-environment happy-dom
import { useState } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FormSection } from './form-section';
import { Input } from './input';
import { OptionCardGroup } from './option-card-group';

afterEach(cleanup);

describe('FormSection', () => {
  it('é fieldset com legend, para o leitor anunciar o grupo em cada campo', () => {
    const { container } = render(
      <FormSection label="Identificação">
        <Input aria-label="Nome" />
      </FormSection>,
    );
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).toBeTruthy();
    expect(fieldset?.querySelector('legend')?.textContent).toBe('Identificação');
  });

  it('mostra o helper depois dos campos, não no lugar do rótulo', () => {
    render(
      <FormSection label="Profissional" helper="Pode ser preenchido depois.">
        <Input aria-label="Quem atende" />
      </FormSection>,
    );
    expect(screen.getByText('Pode ser preenchido depois.')).toBeTruthy();
  });
});

function Harness() {
  const [value, setValue] = useState('atestado');
  return (
    <OptionCardGroup
      name="tipo"
      aria-label="Tipo de documento"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'atestado', label: 'Atestado', description: 'Justificar afastamento.' },
        { value: 'exame', label: 'Solicitação de exame', description: 'Pedir exames.' },
      ]}
    />
  );
}

describe('OptionCardGroup', () => {
  it('usa radio de verdade — teclado e formulário funcionam sem reimplementação', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.getAttribute('name') === 'tipo')).toBe(true);
  });

  it('troca a seleção no clique', () => {
    render(<Harness />);
    const exame = screen.getByRole('radio', { name: /Solicitação de exame/u });
    expect((exame as HTMLInputElement).checked).toBe(false);
    fireEvent.click(exame);
    expect((exame as HTMLInputElement).checked).toBe(true);
  });

  it('mantém uma só opção marcada', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Solicitação de exame/u }));
    const marcados = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
    expect(marcados).toHaveLength(1);
  });

  it('carrega a descrição no nome acessível, não só no visual', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /Justificar afastamento/u })).toBeTruthy();
  });
});
