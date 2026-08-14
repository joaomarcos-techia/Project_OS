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

const { listSlots, listProcedures } = vi.hoisted(() => ({
  listSlots: vi.fn(),
  listProcedures: vi.fn(),
}));

// `vi.mock` é chamada, não import — não cruza fronteira de contexto.
vi.mock('@/contexts/scheduling', () => ({ schedulingApiV1: { listSlots, listProcedures } }));

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
    listSlots.mockResolvedValue([]);
    const before = Date.now();
    await getTool('list_slots')!.handler(
      { date_from: '2026-08-14T00:00:00-03:00', date_to: '2026-08-20T00:00:00-03:00' },
      ctx,
    );
    const notBefore = lastNotBefore();
    expect(notBefore).toBeInstanceOf(Date);
    expect(notBefore!.getTime()).toBeGreaterThanOrEqual(before + AGENT_MIN_LEAD_MINUTES * 60_000);
  });

  it('janela inteiramente passada nem chega ao Scheduling', async () => {
    await getTool('list_slots')!.handler(
      { date_from: '2020-01-01T00:00:00-03:00', date_to: '2020-01-02T00:00:00-03:00' },
      ctx,
    );
    expect(listSlots).not.toHaveBeenCalled();
  });
});

describe('prepare_appointment pede o piso nos DOIS caminhos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProcedures.mockResolvedValue([
      { id: PROCEDURE, descricao: 'Harmonização Facial', categoria: 'Estética', valorPadrao: 900, duracaoPadraoMin: 60 },
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

  it('F-04: hora ambígua pergunta em vez de chutar a madrugada', async () => {
    const out = await getTool('prepare_appointment')!.handler(
      {},
      { ...ctx, currentMessage: 'pode ser às 3' },
    );
    expect(out).toMatchObject({ status: 'appointment_information_required' });
    expect((out as { patient_message: string }).patient_message).toContain('você prefere');
    expect(listSlots).not.toHaveBeenCalled();
  });

  it('caminho "horário pedido" também aplica o piso', async () => {
    const at = new Date(Date.now() + 5 * 86_400_000);
    listSlots.mockResolvedValue([
      { doctorId: DOCTOR, startAt: at.toISOString(), endAt: at.toISOString(), durationMin: 60 },
    ]);
    const before = Date.now();
    await getTool('prepare_appointment')!.handler({ scheduled_at: at.toISOString() }, ctx).catch(
      () => undefined, // proposePendingAction precisa de tx; o que importa é o argumento acima
    );
    expect(lastNotBefore()!.getTime()).toBeGreaterThanOrEqual(
      before + AGENT_MIN_LEAD_MINUTES * 60_000,
    );
  });
});
