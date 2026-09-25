// @vitest-environment happy-dom

/**
 * §33.8 — "Leitura falha não esvazia".
 *
 * A asserção central deste arquivo é NEGATIVA: quando o GET do perfil falha, os
 * campos não podem existir na árvore. É o oposto do teste habitual, e é de
 * propósito — a armadilha da §33.5 é justamente um formulário em branco que
 * parece "nada configurado" e convida a salvar por cima do que está publicado.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ler: vi.fn(),
  salvar: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('./actions', () => ({
  readWhatsappProfileAction: mocks.ler,
  saveWhatsappProfileAction: mocks.salvar,
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn(), info: vi.fn(), ai: vi.fn() },
}));

import { WhatsappProfile, type PerfilCarregado } from './whatsapp-profile';

const perfil = (over: Record<string, unknown> = {}) => ({
  perfil: {
    about: 'Saúde mental',
    description: 'Clínica de psiquiatria.',
    address: 'Rua A, 1',
    email: 'contato@clinica.com.br',
    websites: ['https://clinica.com.br'],
    vertical: 'HEALTH' as const,
    ...over,
  },
  verticalDesconhecida: null,
});

const carregado = (over: Record<string, unknown> = {}): PerfilCarregado => ({
  ok: true,
  lido: perfil(over),
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('leitura falha', () => {
  const falhou: PerfilCarregado = { ok: false, message: 'A Meta não respondeu.' };

  it('NÃO renderiza formulário nenhum', () => {
    const { container } = render(<WhatsappProfile inicial={falhou} />);

    // A prova é a ausência: nenhum controle de edição na árvore.
    expect(container.querySelectorAll('input, textarea, select').length).toBe(0);
    expect(screen.queryByLabelText('Recado')).toBeNull();
    expect(screen.queryByText('Salvar perfil')).toBeNull();
  });

  it('marca o estado no DOM e explica por que o formulário sumiu', () => {
    const { container } = render(<WhatsappProfile inicial={falhou} />);

    expect(
      container.querySelector('[data-slot="whatsapp-profile"]')?.getAttribute('data-profile-state'),
    ).toBe('erro-leitura');
    expect(screen.getByRole('alert').textContent).toContain('A Meta não respondeu.');
    expect(screen.getByRole('alert').textContent).toContain('apagaria o conteúdo atual');
  });

  it('oferece novo carregamento, e o formulário só aparece quando a leitura volta', async () => {
    mocks.ler.mockResolvedValue({ ok: true, data: perfil() });
    render(<WhatsappProfile inicial={falhou} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Recado') as HTMLInputElement).value).toBe('Saúde mental');
    });
  });

  it('continua sem formulário se a nova tentativa também falhar', async () => {
    mocks.ler.mockResolvedValue({ ok: false, code: 'META_AUTH_FAILED', message: 'De novo não.' });
    const { container } = render(<WhatsappProfile inicial={falhou} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('De novo não.');
    });
    expect(container.querySelectorAll('input, textarea, select').length).toBe(0);
  });
});

describe('leitura bem-sucedida', () => {
  it('preenche os campos com o que a Meta reporta', () => {
    render(<WhatsappProfile inicial={carregado()} />);

    expect((screen.getByLabelText('Recado') as HTMLInputElement).value).toBe('Saúde mental');
    expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe(
      'Clínica de psiquiatria.',
    );
    expect((screen.getByLabelText('Primeiro site') as HTMLInputElement).value).toBe(
      'https://clinica.com.br',
    );
    expect((screen.getByLabelText('Segundo site') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('HEALTH');
  });

  it('avisa, com todas as letras e acima dos campos, que o conteúdo é público', () => {
    const { container } = render(<WhatsappProfile inicial={carregado()} />);

    const avisos = [...container.querySelectorAll('[role="alert"]')];
    const publico = avisos.find((a) => a.textContent?.includes('é público'));
    expect(publico?.textContent).toContain('Não escreva nome de paciente');

    // §33.3 nº 2 — o aviso precede os campos. Depois deles seria decoração.
    const primeiroCampo = container.querySelector('input, textarea');
    expect(publico?.compareDocumentPosition(primeiroCampo!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('rotula o e-mail como sendo DA CLÍNICA, nunca genérico', () => {
    render(<WhatsappProfile inicial={carregado()} />);
    // Um rótulo genérico convida alguém a colar o e-mail de um paciente num
    // campo que o mundo inteiro enxerga.
    expect(screen.getByLabelText('E-mail de contato da clínica')).toBeTruthy();
    expect(screen.queryByLabelText('E-mail')).toBeNull();
  });

  it('aplica os limites da Meta nos próprios controles', () => {
    render(<WhatsappProfile inicial={carregado()} />);

    expect(screen.getByLabelText('Recado').getAttribute('maxLength')).toBe('139');
    expect(screen.getByLabelText('Descrição').getAttribute('maxLength')).toBe('512');
    expect(screen.getByLabelText('Endereço').getAttribute('maxLength')).toBe('256');
    expect(screen.getByLabelText('E-mail de contato da clínica').getAttribute('maxLength')).toBe(
      '128',
    );
    expect(screen.getByLabelText('Primeiro site').getAttribute('maxLength')).toBe('256');
  });

  it('oferece exatamente dois campos de site — o teto da Meta', () => {
    render(<WhatsappProfile inicial={carregado()} />);
    expect(screen.queryByLabelText('Terceiro site')).toBeNull();
  });

  it('denuncia vertical que a Meta reporta e o Qoro não conhece', () => {
    render(
      <WhatsappProfile
        inicial={{
          ok: true,
          lido: { ...perfil(), verticalDesconhecida: 'MEDICAL_CLINIC' },
        }}
      />,
    );

    const avisos = [...document.querySelectorAll('[role="alert"]')];
    const aviso = avisos.find((a) => a.textContent?.includes('MEDICAL_CLINIC'));
    expect(aviso?.textContent).toContain('preservada');
  });
});

describe('salvar', () => {
  it('começa desabilitado e só habilita depois de uma alteração de verdade', () => {
    render(<WhatsappProfile inicial={carregado()} />);
    const botao = screen.getByRole('button', { name: 'Salvar perfil' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Recado'), { target: { value: 'Outro recado' } });
    expect(botao.disabled).toBe(false);
  });

  it('envia os seis campos, com os sites como lista sem vazios', async () => {
    mocks.salvar.mockResolvedValue({ ok: true, data: { ...perfil(), alterados: ['about'] } });
    render(<WhatsappProfile inicial={carregado({ websites: [] })} />);

    fireEvent.change(screen.getByLabelText('Recado'), { target: { value: 'Novo' } });
    fireEvent.change(screen.getByLabelText('Segundo site'), {
      target: { value: 'https://insta.com/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => expect(mocks.salvar).toHaveBeenCalledTimes(1));
    const enviado = mocks.salvar.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual([
      'about',
      'address',
      'description',
      'email',
      'vertical',
      'websites',
    ]);
    // O primeiro site estava vazio; o que sobra é o segundo, sem buraco.
    expect(enviado.websites).toEqual(['https://insta.com/x']);
  });

  it('passa a exibir o que a Meta devolveu, não o que foi digitado', async () => {
    mocks.salvar.mockResolvedValue({
      ok: true,
      data: { ...perfil({ about: 'NORMALIZADO PELA META' }), alterados: ['about'] },
    });
    render(<WhatsappProfile inicial={carregado()} />);

    fireEvent.change(screen.getByLabelText('Recado'), { target: { value: 'o que eu digitei' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Recado') as HTMLInputElement).value).toBe(
        'NORMALIZADO PELA META',
      );
    });
  });

  it('mostra erro POR CAMPO e PRESERVA o texto digitado', async () => {
    mocks.salvar.mockResolvedValue({
      ok: false,
      code: 'validation',
      message: 'Revise os campos destacados. Nada foi alterado.',
      fields: { about: 'Recado: máximo de 139 caracteres.' },
    });
    render(<WhatsappProfile inicial={carregado()} />);

    fireEvent.change(screen.getByLabelText('Recado'), { target: { value: 'texto longo demais' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => {
      expect(screen.getByText('Recado: máximo de 139 caracteres.')).toBeTruthy();
    });
    // Limpar o campo aqui obrigaria a pessoa a reescrever tudo para corrigir um
    // erro que ela nem viu qual era.
    expect((screen.getByLabelText('Recado') as HTMLInputElement).value).toBe('texto longo demais');
  });

  it('não habilita o botão quando a única diferença é espaço em branco', () => {
    render(<WhatsappProfile inicial={carregado()} />);
    const botao = screen.getByRole('button', { name: 'Salvar perfil' }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText('Recado'), { target: { value: '  Saúde mental  ' } });

    // O servidor apara antes de comparar; se a tela não aparasse também,
    // qualquer espaço acidental viraria um POST à Meta sem alteração nenhuma.
    expect(botao.disabled).toBe(true);
  });

  it('distingue "salvo" de "nada mudou" quando a Meta já tinha o valor', async () => {
    // Caminho real desta mensagem: a pessoa edita, mas alguém já pôs o mesmo
    // valor pelo Business Manager no meio. O diff do servidor vem vazio, e
    // dizer "atualizado" ali seria afirmar uma escrita que não houve.
    mocks.salvar.mockResolvedValue({
      ok: true,
      data: { ...perfil({ about: 'Valor que já estava lá' }), alterados: [] },
    });
    render(<WhatsappProfile inicial={carregado()} />);

    fireEvent.change(screen.getByLabelText('Recado'), {
      target: { value: 'Valor que já estava lá' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.toastSuccess.mock.calls[0]![0]).toContain('Nada mudou');
  });
});
