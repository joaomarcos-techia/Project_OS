import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import './provide-procedure-price';
import { getTool, type ToolContext } from './registry';

const listProcedures = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures },
}));

const PROCEDURE_ID = '55555555-5555-5555-5555-555555555555';
const context: ToolContext = {
  tx: {} as Tx,
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: null,
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'Quanto custa a consulta?',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  listProcedures.mockResolvedValue([
    {
      id: PROCEDURE_ID,
      descricao: 'Consulta Cardiológica',
      categoria: 'consulta',
      valorPadrao: 250,
      duracaoPadraoMin: 30,
    },
  ]);
});

describe('provide_procedure_price com preço único', () => {
  it('expõe apenas o preço do procedimento, sem cotação por meio', async () => {
    const result = await getTool('provide_procedure_price')!.handler({}, context);
    expect(result.procedures).toEqual([
      {
        procedure_id: PROCEDURE_ID,
        descricao: 'Consulta Cardiológica',
        categoria: 'consulta',
        valor: 250,
        duracao_min: 30,
      },
    ]);
    expect(listProcedures).toHaveBeenCalledWith(context.clinicId, { limit: 20 });
  });
});
