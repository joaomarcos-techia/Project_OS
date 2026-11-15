// @vitest-environment happy-dom
/**
 * Painel "Dados da consulta" (P4.6) por teclado e leitor de tela (P0.4 de 15/11): o foco vai para
 * o primeiro campo ao abrir e volta ao botão ao fechar; a recusa do servidor fica escrita no
 * formulário (role="alert") até o próximo envio; a dica da observação é ligada ao campo.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConsultaFieldsPanel } from './consulta-fields-ui';

const GUIDE = '22222222-2222-4222-8222-222222222222';
const options = {
  regimeAtendimento: [{ code: '01', term: 'Ambulatorial' }],
  indicacaoAcidente: [{ code: '9', term: 'Não acidente' }],
  tipoConsulta: [
    { code: '1', term: 'Primeira consulta' },
    { code: '4', term: 'Por encaminhamento' },
  ],
  coberturaEspecial: [],
  saudeOcupacional: [],
};

afterEach(cleanup);

describe('painel Dados da consulta: foco, erro e dica', () => {
  it('abre com o foco no primeiro campo e devolve o foco ao botão ao voltar', () => {
    render(
      <ConsultaFieldsPanel
        guideId={GUIDE}
        version={3}
        overrides={null}
        options={options}
        editable
        issued={false}
        action={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar dados da consulta' }));
    // O primeiro campo do formulário (o painel só tem esse formulário).
    expect(screen.getByRole('form', { name: 'Ajustar dados da consulta' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Regime de atendimento'));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Ajustar dados da consulta' }),
    );
  });

  it('a dica da observação (limite e aviso de CID) é a descrição acessível do campo', () => {
    render(
      <ConsultaFieldsPanel
        guideId={GUIDE}
        version={3}
        overrides={null}
        options={options}
        editable
        issued={false}
        action={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar dados da consulta' }));
    const obs = screen.getByLabelText('Observação');
    const hint = document.getElementById(obs.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/^0\/500 \(padrão TISS\)\. Não escreva diagnóstico/u);
  });

  it('a recusa do servidor fica no formulário com role="alert", sem fechar e sem perder o que foi escolhido', async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Convênios: este recurso está disponível para clínicas com assinatura ativa.',
    });
    render(
      <ConsultaFieldsPanel
        guideId={GUIDE}
        version={3}
        overrides={null}
        options={options}
        editable
        issued={false}
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar dados da consulta' }));
    fireEvent.change(screen.getByLabelText('Tipo de consulta'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Ajustar dados da consulta' }));
    });
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ guideId: GUIDE, version: 3, tipoConsulta: '4' }),
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Convênios: este recurso está disponível para clínicas com assinatura ativa.',
    );
    expect(screen.getByRole('form', { name: 'Ajustar dados da consulta' })).toBeTruthy();
    expect((screen.getByLabelText('Tipo de consulta') as HTMLSelectElement).value).toBe('4');
  });

  it('sem permissão de ajuste não há botão nem formulário (a tela não oferece o que o servidor recusa)', () => {
    render(
      <ConsultaFieldsPanel
        guideId={GUIDE}
        version={3}
        overrides={null}
        options={options}
        editable={false}
        issued={false}
        action={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ajustar dados da consulta' })).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });
});
