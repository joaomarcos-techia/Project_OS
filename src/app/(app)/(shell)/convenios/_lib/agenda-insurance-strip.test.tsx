// @vitest-environment happy-dom
/**
 * P3.3/P5.2 — faixa "Convênios de hoje" na agenda: só para quem vê Convênios; só os atendimentos de
 * HOJE (fuso da clínica); pendência pré-consulta marcada com o que falta; carteirinha mascarada;
 * "Resolver" só para quem opera (recepção); sem convênio no dia, nada aparece.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), installed: vi.fn(), tz: vi.fn() }));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser: m.user }));
vi.mock('@/contexts/health-insurance/config-queries', () => ({
  COVERAGE_STATUS_LABELS: { incomplete: 'Com pendência', ready: 'Pronta' },
  listUpcomingInsuranceAppointments: m.list,
}));
vi.mock('@/contexts/health-insurance/queries', () => ({ isInsuranceSchemaInstalled: m.installed }));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: m.tz }));

import { AgendaInsuranceStrip } from './agenda-insurance-strip';

const today = new Date();
const at = (h: number) => {
  const d = new Date(today);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};
const tomorrow = new Date(today.getTime() + 36 * 3_600_000).toISOString();
const rows = [
  { appointmentId: 'a1', scheduledAt: at(12), status: 'agendado', patientId: 'p', patientName: 'Paciente Um', doctorName: 'Dra', procedureName: 'X',
    coverage: { status: 'ready', insurerName: 'Operadora Um', last4: '1234', issues: [] } },
  { appointmentId: 'a2', scheduledAt: at(13), status: 'agendado', patientId: 'p', patientName: 'Paciente Dois', doctorName: 'Dra', procedureName: 'X', coverage: null },
  { appointmentId: 'a3', scheduledAt: at(14), status: 'agendado', patientId: 'p', patientName: 'Paciente Três', doctorName: 'Dra', procedureName: 'X',
    coverage: { status: 'incomplete', insurerName: 'Operadora Um', last4: '9876', issues: [{ code: 'MEMBERSHIP_EXPIRED', message: 'Carteirinha vencida.', owner: 'recepcao' }] } },
  { appointmentId: 'a4', scheduledAt: tomorrow, status: 'agendado', patientId: 'p', patientName: 'Amanhã', doctorName: 'Dra', procedureName: 'X', coverage: null },
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.installed.mockResolvedValue(true);
  m.tz.mockResolvedValue('UTC');
  m.list.mockResolvedValue(rows);
});

describe('faixa "Convênios de hoje" na agenda (P3.3/P5.2)', () => {
  it('recepção: só os de hoje, pendências com o que falta, carteirinha mascarada e o link para resolver', async () => {
    m.user.mockResolvedValue({ userId: 'u', clinicId: 'c', permissions: ['view:convenios', 'operate:convenios'] });
    render((await AgendaInsuranceStrip())!);
    const region = screen.getByRole('region', { name: 'Convênios de hoje' });
    expect(region.textContent).toContain('2 de 3 atendimento(s) com pendência antes da consulta.');
    const list = within(region).getByRole('list', { name: 'Atendimentos de convênio de hoje' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.querySelector('[data-appointment="a1"]')!.getAttribute('data-pending')).toBe('no');
    expect(list.querySelector('[data-appointment="a2"]')!.textContent).toContain('Sem cobertura de convênio registrada.');
    expect(list.querySelector('[data-appointment="a3"]')!.textContent).toContain('Carteirinha vencida.');
    expect(list.textContent).toContain('••••1234');
    expect(list.textContent).not.toContain('Amanhã');
    expect(within(region).getByRole('link', { name: 'Resolver as pendências em Convênios' }).getAttribute('href')).toBe('/convenios/atendimentos');
  });

  it('médica: o escopo é o dela (própria) e não recebe o link de resolver', async () => {
    m.user.mockResolvedValue({ userId: 'doc', clinicId: 'c', permissions: ['view:convenios'] });
    render((await AgendaInsuranceStrip())!);
    expect(m.list).toHaveBeenCalledWith('c', { kind: 'own', professionalId: 'doc' }, 60);
    expect(screen.queryByRole('link', { name: 'Resolver as pendências em Convênios' })).toBeNull();
    expect(screen.getByText('A recepção resolve as pendências em Convênios.')).toBeTruthy();
  });

  it('sem acesso a Convênios, sem a instalação ou sem convênio hoje: nada aparece', async () => {
    m.user.mockResolvedValue({ userId: 'u', clinicId: 'c', permissions: ['view:agenda'] });
    expect(await AgendaInsuranceStrip()).toBeNull();
    m.user.mockResolvedValue({ userId: 'u', clinicId: 'c', permissions: ['view:convenios'] });
    m.installed.mockResolvedValueOnce(false);
    expect(await AgendaInsuranceStrip()).toBeNull();
    m.list.mockResolvedValueOnce([rows[3]]);
    expect(await AgendaInsuranceStrip()).toBeNull();
  });
});
