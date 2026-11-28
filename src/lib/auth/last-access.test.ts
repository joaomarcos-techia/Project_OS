import { describe, expect, it } from 'vitest';

import { decodeLastAccess, encodeLastAccess, lastAccessMessage } from './last-access';

const SECRET = 's'.repeat(43);

describe('R42 — aviso de último acesso (requisito 42)', () => {
  it('ida e volta assinada; só data e contagem', () => {
    const v = encodeLastAccess(
      { previousSuccessAt: '2026-11-22T13:05:00.000Z', failuresSince: 2 },
      SECRET,
    );
    expect(decodeLastAccess(v, SECRET)).toEqual({
      previousSuccessAt: '2026-11-22T13:05:00.000Z',
      failuresSince: 2,
    });
    expect(v).not.toMatch(/203\.0\.113|@/u);
  });

  it('valor adulterado, de outro segredo ou malformado é ignorado (nada vem do navegador)', () => {
    const v = encodeLastAccess({ previousSuccessAt: null, failuresSince: 0 }, SECRET);
    const [payload] = v.split('.');
    const forged = `${Buffer.from(JSON.stringify({ previousSuccessAt: null, failuresSince: 99 })).toString('base64url')}.${v.split('.')[1]}`;
    expect(decodeLastAccess(forged, SECRET)).toBeNull();
    expect(decodeLastAccess(v, 'outro'.repeat(10))).toBeNull();
    expect(decodeLastAccess(`${payload}`, SECRET)).toBeNull();
    expect(decodeLastAccess(undefined, SECRET)).toBeNull();
  });

  it('mensagem no fuso da clínica, com primeiro acesso e plural', () => {
    expect(lastAccessMessage({ previousSuccessAt: null, failuresSince: 0 })).toBe(
      'Este é o seu primeiro acesso registrado.',
    );
    expect(
      lastAccessMessage({ previousSuccessAt: '2026-11-22T13:05:00.000Z', failuresSince: 0 }),
    ).toBe(
      'Seu último acesso foi em 22/11/2026, 10:05; nenhuma tentativa sem sucesso desde então.',
    );
    expect(
      lastAccessMessage({ previousSuccessAt: '2026-11-22T13:05:00.000Z', failuresSince: 3 }),
    ).toMatch(/3 tentativas sem sucesso desde então/u);
  });
});
