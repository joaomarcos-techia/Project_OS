import { describe, expect, it } from 'vitest';

import type { ToolResult } from '@/lib/ai/provider';
import { clinicInformationReply, previousReadResult } from './inbound-received';

const info: ToolResult = { name: 'provide_clinic_info', args: {}, response: { nome: 'Clínica' } };

describe('reuso de leituras dentro de um turno', () => {
  it('reconhece uma consulta já respondida, sem depender da ordem das chaves', () => {
    const slots: ToolResult = {
      name: 'list_slots',
      args: { date_from: '2026-11-05T08:00:00Z', date_to: '2026-11-05T18:00:00Z' },
      response: { slots: [] },
    };
    expect(
      previousReadResult(
        {
          name: slots.name,
          args: {
            date_to: '2026-11-05T18:00:00Z',
            date_from: '2026-11-05T08:00:00Z',
          },
        },
        [slots],
      ),
    ).toBe(slots);
  });

  it('não reutiliza disponibilidade para outra janela nem dados de outro turno', () => {
    expect(
      previousReadResult({ name: 'list_slots', args: { date_from: 'outro dia' } }, [info]),
    ).toBeUndefined();
    expect(previousReadResult({ name: info.name, args: {} }, [])).toBeUndefined();
  });

  it('nunca reutiliza mutações ou ferramentas fora da whitelist', () => {
    for (const name of [
      'prepare_appointment',
      'confirm_pending_action',
      'request_human_handoff',
      'unknown_tool',
    ]) {
      const result = { name, args: {}, response: {} };
      expect(previousReadResult({ name, args: {} }, [result])).toBeUndefined();
    }
  });

  it('resposta determinística só vem do campo específico da ferramenta de informação', () => {
    expect(clinicInformationReply([info])).toBeNull();
    expect(
      clinicInformationReply([{ ...info, response: { patient_message: 'Informação aprovada.' } }]),
    ).toBe('Informação aprovada.');
    expect(
      clinicInformationReply([
        { name: 'list_slots', args: {}, response: { patient_message: 'Outra ferramenta' } },
      ]),
    ).toBeNull();
    expect(clinicInformationReply([{ ...info, response: { patient_message: 5 } }])).toBeNull();
  });
});
