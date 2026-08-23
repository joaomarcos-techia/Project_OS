// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AppointmentStatusBadge,
  PatientStatusBadge,
  PaymentStatusBadge,
  ProntuarioStatusBadge,
} from './status-badge';

afterEach(cleanup);

describe('StatusBadge — cor definida uma vez, nunca por tela', () => {
  it('traduz o status de agendamento para o rotulo da state machine', () => {
    render(<AppointmentStatusBadge status="em_atendimento" />);
    expect(screen.getByText('Em atendimento')).toBeTruthy();
  });

  it('mostra Pendente quando o recebivel ainda esta no prazo', () => {
    render(<PaymentStatusBadge status="pendente" />);
    expect(screen.getByText('Pendente')).toBeTruthy();
  });

  it('vira Vencido quando o Financial marca o pendente como vencido', () => {
    render(<PaymentStatusBadge status="pendente" overdue />);
    expect(screen.getByText('Vencido')).toBeTruthy();
  });

  it('nao chama de vencido o que ja foi pago, mesmo com a flag ligada', () => {
    // Vencido descreve cobranca em aberto fora do prazo. Um pago que venceu
    // antes de ser quitado continua pago — o contrario alarmaria a tela sem motivo.
    render(<PaymentStatusBadge status="pago" overdue />);
    expect(screen.getByText('Pago')).toBeTruthy();
    expect(screen.queryByText('Vencido')).toBeNull();
  });

  it('cobre os dois estados reais do prontuario', () => {
    const { rerender } = render(<ProntuarioStatusBadge status="rascunho" />);
    expect(screen.getByText('Rascunho')).toBeTruthy();
    rerender(<ProntuarioStatusBadge status="assinado" />);
    expect(screen.getByText('Assinado')).toBeTruthy();
  });

  it('deriva ativo/inativo do soft delete, que e o que o dominio tem', () => {
    const { rerender } = render(<PatientStatusBadge deletedAt={null} />);
    expect(screen.getByText('Ativo')).toBeTruthy();
    rerender(<PatientStatusBadge deletedAt="2026-08-01T00:00:00Z" />);
    expect(screen.getByText('Inativo')).toBeTruthy();
  });
});
