// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/scheduling/actions', () => ({
  acceptWaitlistOffer: vi.fn(),
  cancelWaitlistEntry: vi.fn(),
  declineWaitlistOffer: vi.fn(),
}));
vi.mock('@/contexts/scheduling/action-result', () => ({ unwrapAction: vi.fn() }));
vi.mock('../actions', () => ({ buscarPacientes: vi.fn() }));
vi.mock('./actions', () => ({ createWaitlistFromUi: vi.fn() }));

import type { WaitlistEntryDTO } from '@/contexts/scheduling/types';

import { WaitlistManager } from './waitlist-manager';

afterEach(cleanup);

const entry: WaitlistEntryDTO = {
  id: 'entry-1',
  patientId: 'patient-1',
  doctorId: null,
  procedureId: 'procedure-1',
  priority: 'normal',
  status: 'offered',
  preferredFrom: null,
  preferredUntil: null,
  offeredAppointmentId: 'appointment-1',
  offeredAt: '2026-09-14T11:00:00.000Z',
  offeredScheduledAt: '2026-09-14T12:15:00.000Z',
  bookedAppointmentId: null,
  notes: null,
  createdAt: '2026-09-14T10:00:00.000Z',
};

describe('WaitlistManager', () => {
  it('mostra a vaga oferecida no fuso da clínica', () => {
    render(
      <WaitlistManager
        initial={[entry]}
        patients={[{ id: 'patient-1', name: 'Ana Silva' }]}
        procedures={[{ id: 'procedure-1', name: 'Consulta' }]}
        doctors={[]}
        timeZone="Asia/Tokyo"
      />,
    );

    // 12:15Z é 21:15 em Tóquio e 09:15 em São Paulo.
    expect(screen.getByText(/Vaga oferecida: 14\/09, 21:15/u)).toBeTruthy();
  });
});
