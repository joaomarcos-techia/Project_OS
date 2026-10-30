/**
 * F-03 (auditoria 2026-08-14) — o piso de disponibilidade chega ao Scheduling.
 *
 * `filterSlotsFrom` (slot-resolver.test.ts) prova a REGRA; este arquivo prova a
 * FIAÇÃO: que as duas tools que consultam agenda pedem o filtro. Sem isto o
 * agente voltava a oferecer 08:00 às 15:00, porque `computeSlots` recebe DIAS.
 *
 * `@/contexts/scheduling` é mockado de propósito: `getAvailableSlots` precisa de
 * banco, e executá-lo aqui só arrastaria branches não exercitadas para o gate de
 * cobertura. O que importa medir é o argumento enviado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import type * as PendingActionModule from '../internal/pending-action';

const { listSlots, listProcedures, proposePendingAction } = vi.hoisted(() => ({
  listSlots: vi.fn(),
  listProcedures: vi.fn(),
  proposePendingAction: vi.fn(),
}));

// Só a PERSISTÊNCIA da ação pendente é substituída: ela cifra o payload e grava
// no banco, e nada disso é o que está sob teste aqui. As validações de
// identidade e de política de agenda continuam reais.
vi.mock('../internal/pending-action', async (orig) => ({
  ...(await orig<typeof PendingActionModule>()),
  proposePendingAction,
}));

// `vi.mock` é chamada, não import — não cruza fronteira de contexto.
vi.mock('@/contexts/scheduling', () => ({ schedulingApiV1: { listSlots, listProcedures } }));
// Sem sinal: o resumo não ganha a linha do sinal (08/10/2026).
vi.mock('@/contexts/payments', () => ({
  paymentsApiV1: { previewDepositForBooking: async () => null },
}));

import { AGENT_MIN_LEAD_MINUTES } from '../limits';
import { agentSlotFloor } from './list-slots';
import './prepare-appointment';
import { getTool, type ToolContext } from './registry';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PROCEDURE = '55555555-5555-5555-5555-555555555555';
const DOCTOR = '66666666-6666-6666-6666-666666666666';

const ctx: ToolContext = {
  tx: {} as Tx,
  clinicId: CLINIC,
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: '77777777-7777-7777-7777-777777777777',
  patientNome: 'Ana Souza',
  identityAmbiguous: false,
  verifiedPhone: '5511999990000',
  currentMessage: 'quero marcar',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

/** Argumento `notBefore` da última chamada a listSlots. */
function lastNotBefore(): Date | undefined {
  const call = listSlots.mock.calls.at(-1);
  return (call?.[0] as { notBefore?: Date } | undefined)?.notBefore;
}

describe('agentSlotFloor', () => {
  it('empurra o piso pela antecedência mínima do agente', () => {
    const now = new Date('2026-08-14T18:00:00.000Z');
    expect(agentSlotFloor(now).getTime()).toBe(now.getTime() + AGENT_MIN_LEAD_MINUTES * 60_000);
  });
});

describe('list_slots pede o piso ao Scheduling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passa notBefore ≈ agora + antecedência mínima', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T18:00:00.000Z'));

    try {
      listSlots.mockResolvedValue([]);
      const before = Date.now();
      await getTool('list_slots')!.handler(
        { date_from: '2026-08-14T00:00:00-03:00', date_to: '2026-08-20T00:00:00-03:00' },
        ctx,
      );
      const notBefore = lastNotBefore();
      expect(notBefore).toBeInstanceOf(Date);
      expect(notBefore!.getTime()).toBeGreaterThanOrEqual(before + AGENT_MIN_LEAD_MINUTES * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('janela inteiramente passada nem chega ao Scheduling', async () => {
    await getTool('list_slots')!.handler(
      { date_from: '2020-01-01T00:00:00-03:00', date_to: '2020-01-02T00:00:00-03:00' },
      ctx,
    );
    expect(listSlots).not.toHaveBeenCalled();
  });

  it('apresenta os slots no fuso da clínica, não na hora UTC do banco', async () => {
    // O relógio é fixado porque a janela é datada: sem isso o teste passa no dia
    // em que foi escrito e falha no seguinte, quando `normalizeSlotWindow` passa
    // a rejeitar 2026-08-20 como janela inteiramente passada.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'));

    try {
      listSlots.mockResolvedValue([
        {
          doctorId: DOCTOR,
          startAt: '2026-08-20T11:00:00.000Z',
          endAt: '2026-08-20T11:30:00.000Z',
          durationMin: 30,
        },
      ]);

      const out = await getTool('list_slots')!.handler(
        { date_from: '2026-08-20T00:00:00-03:00', date_to: '2026-08-20T23:59:59-03:00' },
        ctx,
      );

      expect(out).toEqual({
        time_zone: 'America/Sao_Paulo',
        slots: [
          {
            doctor_id: DOCTOR,
            start_at: '2026-08-20T08:00:00-03:00',
            end_at: '2026-08-20T08:30:00-03:00',
            duration_min: 30,
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('prepare_appointment pede o piso nos DOIS caminhos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposePendingAction.mockImplementation(async (_tx, args: { summary: string }) => ({
      id: '88888888-8888-8888-8888-888888888888',
      action: 'schedule_appointment' as const,
      summary: args.summary,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }));
    listProcedures.mockResolvedValue([
      {
        id: PROCEDURE,
        descricao: 'Harmonização Facial',
        categoria: 'Estética',
        valorPadrao: 900,
        duracaoPadraoMin: 60,
      },
    ]);
  });

  it('caminho "primeiro horário livre" — era ele que preparava marcação no passado', async () => {
    listSlots.mockResolvedValue([]);
    const before = Date.now();
    const out = await getTool('prepare_appointment')!.handler({}, ctx);

    expect(lastNotBefore()!.getTime()).toBeGreaterThanOrEqual(
      before + AGENT_MIN_LEAD_MINUTES * 60_000,
    );
    // Sem slots futuros a tool orienta, em vez de propor um horário vencido.
    expect(out).toMatchObject({ status: 'appointment_unavailable' });
  });

  it('F-04: a frase do paciente vence o scheduled_at do modelo', async () => {
    listSlots.mockResolvedValue([]);
    // O modelo propõe 09:00; a mensagem diz "depois de amanhã às 14".
    await getTool('prepare_appointment')!.handler(
      { scheduled_at: '2026-08-15T12:00:00.000Z' },
      { ...ctx, currentMessage: 'depois de amanhã às 14' },
    );
    const call = listSlots.mock.calls.at(-1)![0] as { from: Date; to: Date };
    // Janela de ±1h em torno do horário RESOLVIDO pelo servidor, não do modelo.
    const centro = new Date((call.from.getTime() + call.to.getTime()) / 2);
    const local = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(centro);
    expect(local).toBe('14');
  });

  /**
   * Hora nua ("às 3" = 03:00 ou 15:00): quem desempata é a AGENDA CONFIGURADA
   * pela clínica, não uma faixa de horário embutida no código. Os três casos
   * abaixo são o contrato inteiro.
   */
  describe('hora ambígua — a agenda da clínica decide', () => {
    const slotAt = (iso: string) => ({
      doctorId: DOCTOR,
      startAt: iso,
      endAt: iso,
      durationMin: 60,
    });
    /** Instante local de amanhã na hora pedida (SP não tem DST). */
    const tomorrowAt = (hour: number): string => {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(Date.now() + 86_400_000));
      return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();
    };

    it('clínica 08–18: "às 3" vira 15:00 sozinho, sem perguntar nada', async () => {
      listSlots.mockResolvedValue([slotAt(tomorrowAt(15))]); // 03:00 não existe na agenda
      const out = await getTool('prepare_appointment')!.handler(
        {},
        { ...ctx, currentMessage: 'pode ser amanhã às 3' },
      );
      expect(out).toMatchObject({ status: 'appointment_prepared' });
      expect((out as { summary: string }).summary).toContain('15:00');
    });

    it('clínica que atende à noite: "às 9" vira 21:00 quando 09:00 não tem vaga', async () => {
      listSlots.mockResolvedValue([slotAt(tomorrowAt(21))]);
      const out = await getTool('prepare_appointment')!.handler(
        {},
        { ...ctx, currentMessage: 'pode ser amanhã às 9' },
      );
      expect(out).toMatchObject({ status: 'appointment_prepared' });
      expect((out as { summary: string }).summary).toContain('21:00');
    });

    it('as DUAS existem na agenda → aí sim pergunta', async () => {
      listSlots.mockResolvedValue([slotAt(tomorrowAt(9)), slotAt(tomorrowAt(21))]);
      const out = await getTool('prepare_appointment')!.handler(
        {},
        { ...ctx, currentMessage: 'pode ser amanhã às 9' },
      );
      expect(out).toMatchObject({ status: 'appointment_information_required' });
      const msg = (out as { patient_message: string }).patient_message;
      expect(msg).toContain('você prefere');
      expect(msg).toContain('09:00');
      expect(msg).toContain('21:00');
    });

    it('nenhuma das duas existe → indisponível, sem inventar horário', async () => {
      listSlots.mockResolvedValue([]);
      const out = await getTool('prepare_appointment')!.handler(
        {},
        { ...ctx, currentMessage: 'pode ser amanhã às 9' },
      );
      expect(out).toMatchObject({ status: 'appointment_unavailable' });
    });
  });

  it('caminho "horário pedido" também aplica o piso', async () => {
    const at = new Date(Date.now() + 5 * 86_400_000);
    listSlots.mockResolvedValue([
      { doctorId: DOCTOR, startAt: at.toISOString(), endAt: at.toISOString(), durationMin: 60 },
    ]);
    const before = Date.now();
    await getTool('prepare_appointment')!.handler({ scheduled_at: at.toISOString() }, ctx);
    expect(lastNotBefore()!.getTime()).toBeGreaterThanOrEqual(
      before + AGENT_MIN_LEAD_MINUTES * 60_000,
    );
  });
});
