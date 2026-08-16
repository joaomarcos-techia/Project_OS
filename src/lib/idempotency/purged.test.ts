import { describe, expect, it } from 'vitest';

import { isPurgedResponse, PURGED_RESPONSE } from './purged';

describe('resposta idempotente expurgada (LGPD-004)', () => {
  it('o sentinel NÃO é null — é isso que o separa de uma reserva in-flight', () => {
    // O bug: o scrub escrevia NULL, e NULL já significava "in-flight". Uma
    // chave concluída passava a parecer operação em curso.
    expect(PURGED_RESPONSE).not.toBeNull();
    expect(typeof PURGED_RESPONSE).toBe('object');
  });

  it('não carrega PII — só o motivo', () => {
    expect(Object.keys(PURGED_RESPONSE)).toEqual(['purged']);
  });

  it('reconhece o próprio sentinel', () => {
    expect(isPurgedResponse(PURGED_RESPONSE)).toBe(true);
    // Round-trip por jsonb: o que volta do banco é um objeto novo.
    expect(isPurgedResponse(JSON.parse(JSON.stringify(PURGED_RESPONSE)))).toBe(true);
  });

  it('não confunde resposta real, null nem primitivos com expurgo', () => {
    expect(isPurgedResponse(null)).toBe(false);
    expect(isPurgedResponse(undefined)).toBe(false);
    expect(isPurgedResponse({ id: 'abc', nome: 'Fulano' })).toBe(false);
    expect(isPurgedResponse('lgpd_erasure')).toBe(false);
    expect(isPurgedResponse({ purged: true })).toBe(false);
  });
});
