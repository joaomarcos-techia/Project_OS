import { describe, expect, it } from 'vitest';

import { mapIdentityError } from './map-error';

describe('erros da cota categórica', () => {
  it('explica ao gestor quando o banco recusou médico ou equipe excedente', () => {
    expect(mapIdentityError({ code: '23514', constraint_name: 'offer_2026_seat_limit' })).toMatch(
      /vagas de médicos ou equipe/,
    );
  });

  it('reconhece a constraint dentro do erro de query do Drizzle', () => {
    const wrapped = new Error('Failed query', {
      cause: { code: '23514', constraint_name: 'offer_2026_seat_limit' },
    });
    expect(mapIdentityError(wrapped)).toMatch(/vagas de médicos ou equipe/);
  });

  it('não mostra detalhes SQL para outra constraint', () => {
    expect(mapIdentityError({ code: '23514', constraint_name: 'private_constraint' })).toBe(
      'Não foi possível concluir a ação. Tente novamente.',
    );
  });
});
