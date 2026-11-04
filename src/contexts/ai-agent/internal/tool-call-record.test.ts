/**
 * F-16 (auditoria 2026-08-14) — o que fica gravado em `ai_messages.tool_calls`.
 *
 * A coluna é `jsonb` SEM cifra. O teste existe para impedir que alguém, tentando
 * melhorar a observabilidade, passe a persistir os args crus: os de
 * `collect_patient_data` carregam nome e CPF, que apareceriam em claro num
 * `pg_dump` de uma base que cifra o conteúdo da conversa exatamente para evitar
 * isso. A whitelist é o contrato; o resto destes casos existe para prová-la.
 */
import { describe, expect, it } from 'vitest';

import { appendToolCallRecords, toToolCallRecords } from './tool-call-record';

const APPT = '11111111-1111-1111-1111-111111111111';
const DOCTOR = '22222222-2222-2222-2222-222222222222';
const PROCEDURE = '33333333-3333-3333-3333-333333333333';

describe('auditoria de um turno com várias rodadas', () => {
  it('mantém as chamadas anteriores sem mudar o array original nem expor dados livres', () => {
    const first = appendToolCallRecords(null, [{ name: 'provide_clinic_info', args: {} }], 1);
    const all = appendToolCallRecords(
      first,
      [
        {
          name: 'collect_patient_data',
          args: {
            nome: 'Paciente Sintético',
            cpf: '39053344705',
            motivo: 'informação privada',
          },
        },
      ],
      2,
    );
    expect(all.map((record) => [record.name, record.round])).toEqual([
      ['provide_clinic_info', 1],
      ['collect_patient_data', 2],
    ]);
    expect(first).toHaveLength(1);
    const persisted = JSON.stringify(all);
    for (const secret of ['Paciente Sintético', '39053344705', 'informação privada']) {
      expect(persisted).not.toContain(secret);
    }
  });
});

describe('toToolCallRecords — PII nunca é persistida', () => {
  it('descarta os VALORES de nome, CPF e motivo, preservando só as chaves', () => {
    const rec = toToolCallRecords([
      {
        name: 'collect_patient_data',
        args: { nome: 'Joao Marcos Silva', cpf: '39053344705', motivo: 'dor nas costas' },
      },
    ])[0]!;

    expect(rec).toEqual({
      name: 'collect_patient_data',
      argKeys: ['nome', 'cpf', 'motivo'],
    });
    const serialized = JSON.stringify(rec);
    for (const pii of ['Joao Marcos Silva', '39053344705', 'dor nas costas']) {
      expect(serialized).not.toContain(pii);
    }
  });

  it('procedure_name é texto do PACIENTE e não vira valor persistido', () => {
    const rec = toToolCallRecords([
      { name: 'prepare_appointment', args: { procedure_name: 'harmonização pro meu casamento' } },
    ])[0]!;
    expect(rec.argKeys).toEqual(['procedure_name']);
    expect(rec.args).toBeUndefined();
  });

  it('reason livre do modelo não é persistido', () => {
    const rec = toToolCallRecords([
      { name: 'request_human_handoff', args: { reason: 'paciente relatou dor no peito' } },
    ])[0]!;
    expect(JSON.stringify(rec)).not.toContain('dor no peito');
  });
});

describe('toToolCallRecords — o que a auditoria precisa responder', () => {
  it('preserva ids e instantes: "qual consulta, para quando"', () => {
    expect(
      toToolCallRecords([
        {
          name: 'reschedule_appointment',
          args: { appointment_id: APPT, new_scheduled_at: '2026-08-20T13:00:00.000Z' },
        },
      ]),
    ).toEqual([
      {
        name: 'reschedule_appointment',
        argKeys: ['appointment_id', 'new_scheduled_at'],
        args: { appointment_id: APPT, new_scheduled_at: '2026-08-20T13:00:00.000Z' },
      },
    ]);
  });

  it('mistura de chaves: só as seguras viram valor, todas viram chave', () => {
    const rec = toToolCallRecords([
      {
        name: 'prepare_appointment',
        args: { procedure_name: 'Harmonização', scheduled_at: '2026-08-20T13:00:00.000Z' },
      },
    ])[0]!;
    expect(rec.argKeys).toEqual(['procedure_name', 'scheduled_at']);
    expect(rec.args).toEqual({ scheduled_at: '2026-08-20T13:00:00.000Z' });
  });

  it('preserva a janela de busca de horários', () => {
    const rec = toToolCallRecords([
      {
        name: 'list_slots',
        args: {
          date_from: '2026-08-20T00:00:00.000Z',
          date_to: '2026-08-21T00:00:00.000Z',
          doctor_id: DOCTOR,
          procedure_id: PROCEDURE,
        },
      },
    ])[0]!;
    expect(rec.args).toEqual({
      date_from: '2026-08-20T00:00:00.000Z',
      date_to: '2026-08-21T00:00:00.000Z',
      doctor_id: DOCTOR,
      procedure_id: PROCEDURE,
    });
  });

  it('booleano seguro atravessa como booleano', () => {
    const rec = toToolCallRecords([
      { name: 'collect_patient_data', args: { confirmed: true } },
    ])[0]!;
    expect(rec.args).toEqual({ confirmed: true });
  });
});

describe('toToolCallRecords — args vindos do modelo são NÃO confiáveis', () => {
  it.each([
    ['sem args', undefined],
    ['args nulos', null],
    ['args string', 'nao é objeto'],
    ['args array', [1, 2, 3]],
  ])('%s → só o nome, sem quebrar', (_caso, args) => {
    expect(toToolCallRecords([{ name: 'list_my_appointments', args }])).toEqual([
      { name: 'list_my_appointments' },
    ]);
  });

  it('objeto vazio não gera argKeys ruidoso', () => {
    expect(toToolCallRecords([{ name: 'patient_lookup', args: {} }])).toEqual([
      { name: 'patient_lookup' },
    ]);
  });

  it('valor não-escalar numa chave segura é descartado (só a chave fica)', () => {
    const rec = toToolCallRecords([
      { name: 'cancel_appointment', args: { appointment_id: { nested: 'objeto' } } },
    ])[0]!;
    expect(rec.argKeys).toEqual(['appointment_id']);
    expect(rec.args).toBeUndefined();
  });

  it('trunca valor longo numa chave segura (anti prompt-bomb no log)', () => {
    const rec = toToolCallRecords([
      { name: 'cancel_appointment', args: { appointment_id: 'x'.repeat(500) } },
    ])[0]!;
    expect((rec.args!.appointment_id as string).length).toBe(40);
  });

  it('limita a quantidade de chaves', () => {
    const args = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const rec = toToolCallRecords([{ name: 'x', args }])[0]!;
    expect(rec.argKeys!.length).toBeLessThanOrEqual(12);
  });

  it('preserva a ordem e a quantidade das chamadas do turno', () => {
    expect(
      toToolCallRecords([
        { name: 'provide_procedure_price', args: {} },
        { name: 'list_slots', args: {} },
        { name: 'prepare_appointment', args: {} },
      ]).map((r) => r.name),
    ).toEqual(['provide_procedure_price', 'list_slots', 'prepare_appointment']);
  });
});
