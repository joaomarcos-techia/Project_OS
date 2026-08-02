/**
 * Matching tolerante de procedimento (prepare_appointment) — cobre o bug real
 * do teste ao vivo: paciente diz "cardiologia", procedimento é "Consulta
 * Cardiológica"; substring simples não casava e o agendamento falhava.
 */
import { describe, expect, it } from 'vitest';

import { __testing__ } from './prepare-appointment';

const { matchesProcedure } = __testing__;
const cardio = { descricao: 'Consulta Cardiológica', categoria: 'consulta' };
const dermato = { descricao: 'Consulta Dermatológica', categoria: 'consulta' };

describe('matchesProcedure (tolerante a especialidade vs nome)', () => {
  it('casa especialidade com o nome do procedimento (cardiologia ↔ Cardiológica)', () => {
    expect(matchesProcedure('cardiologia', cardio)).toBe(true);
    expect(matchesProcedure('dermatologia', dermato)).toBe(true);
  });

  it('casa por nome parcial e por categoria', () => {
    expect(matchesProcedure('cardio', cardio)).toBe(true);
    expect(matchesProcedure('consulta', cardio)).toBe(true);
    expect(matchesProcedure('Consulta Cardiológica', cardio)).toBe(true);
  });

  it('NÃO casa especialidade de outro procedimento', () => {
    expect(matchesProcedure('cardiologia', dermato)).toBe(false);
    expect(matchesProcedure('ortopedia', cardio)).toBe(false);
  });
});
