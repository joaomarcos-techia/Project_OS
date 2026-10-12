// @vitest-environment happy-dom
/**
 * EC-32 — a faixa da Agenda e o selo da linha da consulta.
 *
 * A faixa só aparece com algo acionável; cada item diz o que fazer, por que não
 * chegou e o código da Meta, e o "Copiar link" depende de edit:agenda e de a
 * cobrança ainda estar pendente.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ copiarLinkDeCobrancaAction: vi.fn() }));

import { DeliveryFailureBadge, DeliveryFailureStrip } from './delivery-failure-strip';
import type { AgendaDeliveryFailure } from './delivery-failures';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-10-08T15:00:00.000Z'); // 12:00 em São Paulo

function item(over: Partial<AgendaDeliveryFailure> = {}): AgendaDeliveryFailure {
  return {
    jobId: 'job-1',
    kind: 'deposit_link',
    pacienteNome: 'Maria Souza',
    appointmentId: 'appt-1',
    consultaEm: '2026-10-10T13:00:00.000Z',
    retornoEm: null,
    vagaSeguradaAte: '2026-10-08T21:00:00.000Z',
    acionavel: true,
    linkCopiavel: true,
    causa: { kind: 'meta_refused', code: '131042' },
    ...over,
  };
}

function renderStrip(
  failures: AgendaDeliveryFailure[],
  over: Partial<{ limited: boolean; canCopyLink: boolean }> = {},
) {
  return render(
    <DeliveryFailureStrip
      failures={failures}
      limited={over.limited ?? false}
      tz={TZ}
      canCopyLink={over.canCopyLink ?? true}
      now={NOW}
    />,
  );
}

afterEach(cleanup);

describe('DeliveryFailureStrip', () => {
  it('sem nada acionável não desenha nada', () => {
    const { container } = renderStrip([item({ acionavel: false })]);
    expect(container.innerHTML).toBe('');
  });

  it('o resumo diz quem e até quando; o item, o que fazer, o motivo e o código', () => {
    renderStrip([item()]);

    expect(
      screen.getByText('O link do sinal não chegou a Maria Souza · vaga segurada até 18:00'),
    ).toBeTruthy();
    expect(screen.getByText('Ver detalhes')).toBeTruthy();

    const list = screen.getByRole('list', {
      name: 'Mensagens automáticas que não chegaram aos pacientes',
    });
    const entry = within(list).getByRole('listitem');
    expect(entry.textContent).toContain('Maria Souza · Link do sinal · consulta 10/10 10:00');
    expect(
      within(entry).getByText(
        'Envie o link ao paciente por outro canal antes de 18:00; depois disso a vaga é liberada.',
      ),
    ).toBeTruthy();
    expect(entry.textContent).toContain(
      'A conta do WhatsApp Business da clínica está com pendência de pagamento na Meta.',
    );
    expect(entry.textContent).toContain('Configure a forma de pagamento na WhatsApp Manager.');
    expect(within(entry).getByText('131042')).toBeTruthy();
    expect(within(entry).getByText('Esta mensagem não será reenviada.')).toBeTruthy();
    expect(within(entry).getByRole('button', { name: 'Copiar link do sinal' })).toBeTruthy();
  });

  it('o botão some sem edit:agenda e sem cobrança pendente', () => {
    renderStrip([item()], { canCopyLink: false });
    expect(screen.queryByRole('button', { name: 'Copiar link do sinal' })).toBeNull();

    cleanup();
    renderStrip([item({ linkCopiavel: false })]);
    expect(screen.queryByRole('button', { name: 'Copiar link do sinal' })).toBeNull();

    cleanup();
    renderStrip([item({ kind: 'reminder', vagaSeguradaAte: null, linkCopiavel: true })]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('só os acionáveis entram, e o teto da leitura é avisado', () => {
    renderStrip(
      [
        item({ jobId: 'a' }),
        item({ jobId: 'b', acionavel: false, pacienteNome: 'Fora da Faixa' }),
        item({ jobId: 'c', kind: 'reminder', vagaSeguradaAte: null, pacienteNome: 'João Lima' }),
      ],
      { limited: true },
    );

    expect(
      screen.getByText(
        '2 mensagens automáticas não chegaram aos pacientes · 1 vaga segurada até 18:00',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/Fora da Faixa/u)).toBeNull();
    expect(
      screen.getByText(
        'A lista mostra no máximo 100 mensagens dos últimos 7 dias; pode haver outras.',
      ),
    ).toBeTruthy();
  });

  it('sem código não há código; sem nome, "Paciente"', () => {
    renderStrip([
      item({ pacienteNome: null, causa: { kind: 'number_not_connected' }, linkCopiavel: false }),
    ]);

    const entry = screen.getByRole('listitem');
    expect(entry.textContent).toContain('Paciente · Link do sinal');
    expect(entry.textContent).toContain(
      'O WhatsApp da clínica não estava conectado. Reconecte em Configurações › WhatsApp.',
    );
    expect(entry.querySelector('.font-mono')).toBeNull();
  });
});

describe('DeliveryFailureBadge', () => {
  it('recusa: selo vermelho com o motivo e o código no title', () => {
    render(<DeliveryFailureBadge failure={item()} />);

    const label = screen.getByText('Link não entregue');
    expect(label.closest('[title]')?.getAttribute('title')).toBe(
      'A conta do WhatsApp Business da clínica está com pendência de pagamento na Meta. Enquanto isso, nenhuma mensagem automática sai. (131042)',
    );
  });

  it('sem confirmação não é dito como recusa', () => {
    render(
      <DeliveryFailureBadge failure={item({ kind: 'reminder', causa: { kind: 'unconfirmed' } })} />,
    );

    expect(screen.getByText('Entrega não confirmada')).toBeTruthy();
    expect(screen.queryByText('Lembrete não entregue')).toBeNull();
  });
});
