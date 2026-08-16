import { describe, expect, it } from 'vitest';

import {
  ageFromBirthdate,
  buildCard,
  canCheckIn,
  canMarkNoShow,
  clinicDayBounds,
  demographicsLine,
  fail,
  motivoOf,
  ok,
  pickByStatus,
  sexoLong,
  sexoShort,
  tzOffsetMs,
  type CardPatient,
} from './board-logic';

// --- ok / fail (contrato do banner de concorrência) ------------------------

describe('board-logic — ok', () => {
  it('wraps data', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });
});

describe('board-logic — fail (erro de domínio → ActionResult)', () => {
  const named = (name: string) => Object.assign(new Error('boom'), { name });

  it('mapeia InvalidTransitionError → invalid_transition (banner "mudou de etapa")', () => {
    const r = fail(named('InvalidTransitionError'));
    expect(r).toEqual({
      ok: false,
      code: 'invalid_transition',
      message: 'Esta ação não é mais possível — o paciente já mudou de etapa.',
    });
  });

  it('mapeia cada erro nomeado conhecido para seu code', () => {
    expect(fail(named('SchedulingConflictError')).code).toBe('conflict');
    expect(fail(named('AppointmentNotFoundError')).code).toBe('not_found');
    expect(fail(named('AuthError')).code).toBe('forbidden');
    expect(fail(named('IdempotencyConflictError')).code).toBe('duplicate');
    expect(fail(named('ProntuarioConflitoError')).code).toBe('conflict');
  });

  it('erro desconhecido (Error) → code error com a própria message', () => {
    const r = fail(new Error('algo quebrou'));
    expect(r).toEqual({ ok: false, code: 'error', message: 'algo quebrou' });
  });

  it('valor não-Error → mensagem genérica', () => {
    expect(fail('x')).toEqual({ ok: false, code: 'error', message: 'Erro inesperado.' });
    expect(fail(null).code).toBe('error');
  });
});

// --- idade ------------------------------------------------------------------

describe('board-logic — ageFromBirthdate', () => {
  const now = new Date('2026-06-04T12:00:00Z');

  it('calcula a idade em anos completos', () => {
    expect(ageFromBirthdate('1984-06-03', now)).toBe(42); // aniversário já passou
    expect(ageFromBirthdate('1984-06-04', now)).toBe(42); // aniversário é hoje
    expect(ageFromBirthdate('1984-06-05', now)).toBe(41); // aniversário ainda não chegou
  });

  it('retorna null para ausente/inválida', () => {
    expect(ageFromBirthdate(null, now)).toBeNull();
    expect(ageFromBirthdate('', now)).toBeNull();
    expect(ageFromBirthdate('not-a-date', now)).toBeNull();
  });

  it('rejeita idades absurdas (futuro / > 200 anos)', () => {
    expect(ageFromBirthdate('2999-01-01', now)).toBeNull();
    expect(ageFromBirthdate('1500-01-01', now)).toBeNull();
  });
});

// --- demografia -------------------------------------------------------------

describe('board-logic — sexo + demografia', () => {
  it('sexoShort / sexoLong', () => {
    expect(sexoShort('F')).toBe('F');
    expect(sexoLong('F')).toBe('Feminino');
    expect(sexoShort('M')).toBe('M');
    expect(sexoLong('M')).toBe('Masculino');
    expect(sexoShort(null)).toBeNull();
    expect(sexoLong(null)).toBeNull();
  });

  it('demographicsLine combina idade · sexo (DS "42 anos · F")', () => {
    expect(demographicsLine(42, 'F')).toBe('42 anos · F');
    expect(demographicsLine(42, null)).toBe('42 anos');
    expect(demographicsLine(null, 'M')).toBe('M');
    expect(demographicsLine(null, null)).toBe('');
  });
});

// --- janela do dia (DST-correct) -------------------------------------------

describe('board-logic — clinicDayBounds / tzOffsetMs', () => {
  it('janela = 24h e contém o "now"', () => {
    const now = new Date('2026-06-04T12:00:00Z');
    const { from, to } = clinicDayBounds('America/Sao_Paulo', now);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(from.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime()).toBeLessThan(to.getTime());
  });

  it('São Paulo (UTC-3, sem DST): meia-noite local = 03:00Z', () => {
    const now = new Date('2026-06-04T12:00:00Z');
    const { from } = clinicDayBounds('America/Sao_Paulo', now);
    expect(from.toISOString()).toBe('2026-06-04T03:00:00.000Z');
  });

  it('pega o dia LOCAL, não o dia UTC (now logo após a meia-noite local)', () => {
    // 02:00Z = 23:00 do dia anterior em São Paulo → janela do dia anterior local.
    const now = new Date('2026-06-04T02:00:00Z');
    const { from, to } = clinicDayBounds('America/Sao_Paulo', now);
    expect(from.toISOString()).toBe('2026-06-03T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-06-04T03:00:00.000Z');
  });

  it('respeita DST: New York EDT (junho, UTC-4) vs EST (janeiro, UTC-5)', () => {
    const summer = clinicDayBounds('America/New_York', new Date('2026-06-04T12:00:00Z'));
    expect(summer.from.toISOString()).toBe('2026-06-04T04:00:00.000Z'); // EDT
    const winter = clinicDayBounds('America/New_York', new Date('2026-01-15T12:00:00Z'));
    expect(winter.from.toISOString()).toBe('2026-01-15T05:00:00.000Z'); // EST
  });

  it('tzOffsetMs reflete o offset local→UTC (São Paulo = -3h)', () => {
    const off = tzOffsetMs(new Date('2026-06-04T03:00:00Z'), 'America/Sao_Paulo');
    expect(off).toBe(-3 * 60 * 60 * 1000);
  });
});

// --- montagem dos cards -----------------------------------------------------

type Appt = Parameters<typeof buildCard>[0];
function appt(over: Partial<Appt> = {}): Appt {
  return {
    id: 'a1',
    patientId: 'p1',
    scheduledAt: '2026-06-04T13:00:00.000Z',
    snapshotProcedureName: 'Consulta',
    observacoes: null,
    status: 'chegou',
    urgencia: false,
    ...over,
  };
}

const patient: CardPatient = {
  nome: 'Maria Helena',
  alergias: ['Dipirona'],
  dataNascimento: '1984-06-03',
  sexo: 'F',
};

describe('board-logic — motivoOf', () => {
  it('procedimento sozinho, ou com observação anexada', () => {
    expect(motivoOf({ snapshotProcedureName: 'Consulta', observacoes: null })).toBe('Consulta');
    expect(motivoOf({ snapshotProcedureName: 'Consulta', observacoes: 'retorno' })).toBe(
      'Consulta · retorno',
    );
  });
});

describe('board-logic — buildCard', () => {
  const now = new Date('2026-06-04T12:00:00Z');

  it('monta o card com idade/sexo/alergias do paciente', () => {
    const card = buildCard(appt(), patient, '2026-06-04T12:30:00.000Z', now);
    expect(card).toMatchObject({
      appointmentId: 'a1',
      patientId: 'p1',
      pacienteNome: 'Maria Helena',
      alergias: ['Dipirona'],
      idade: 42,
      sexo: 'F',
      horario: '2026-06-04T13:00:00.000Z',
      motivo: 'Consulta',
      status: 'chegou',
      urgencia: false,
      checkInAt: '2026-06-04T12:30:00.000Z',
    });
  });

  it('walk-in (sem paciente) → nome "Walk-in", sem idade/sexo/alergias', () => {
    const card = buildCard(appt({ patientId: null }), undefined, null, now);
    expect(card.pacienteNome).toBe('Walk-in');
    expect(card.idade).toBeNull();
    expect(card.sexo).toBeNull();
    expect(card.alergias).toEqual([]);
    expect(card.checkInAt).toBeNull();
  });

  it('paciente referenciado mas card ausente → fallback "Paciente"', () => {
    const card = buildCard(appt({ patientId: 'p9' }), undefined, null, now);
    expect(card.pacienteNome).toBe('Paciente');
  });
});

describe('board-logic — pickByStatus', () => {
  const rows = [
    { id: 1, status: 'chegou' as const },
    { id: 2, status: 'em_atendimento' as const },
    { id: 3, status: 'chegou' as const },
    { id: 4, status: 'atendido' as const },
  ];

  it('filtra por status preservando a ordem', () => {
    expect(pickByStatus(rows, ['chegou']).map((r) => r.id)).toEqual([1, 3]);
    expect(pickByStatus(rows, ['agendado', 'confirmado'])).toEqual([]);
  });

  it('respeita o teto da coluna (limit)', () => {
    expect(pickByStatus(rows, ['chegou'], 1).map((r) => r.id)).toEqual([1]);
  });
});

describe('STATE-001 — ações derivadas da máquina de estados', () => {
  it('falta é oferecida em agendado e confirmado (transição válida)', () => {
    expect(canMarkNoShow('agendado')).toBe(true);
    expect(canMarkNoShow('confirmado')).toBe(true);
  });

  it('falta NÃO é oferecida depois do check-in — `chegou → faltou` não existe', () => {
    // Era exatamente aqui que o botão aparecia e a action recusava com
    // HTTP 200 e zero persistência.
    expect(canMarkNoShow('chegou')).toBe(false);
    expect(canMarkNoShow('em_atendimento')).toBe(false);
  });

  it('estados terminais não oferecem nada', () => {
    for (const s of ['atendido', 'cancelado', 'faltou'] as const) {
      expect(canMarkNoShow(s)).toBe(false);
      expect(canCheckIn(s)).toBe(false);
    }
  });

  it('check-in é oferecido apenas onde `→ chegou` é válido', () => {
    expect(canCheckIn('agendado')).toBe(true);
    expect(canCheckIn('confirmado')).toBe(true);
    expect(canCheckIn('chegou')).toBe(false);
  });
});
