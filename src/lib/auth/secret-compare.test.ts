import { describe, expect, it } from 'vitest';

import { safeEqual } from './secret-compare';

/**
 * M1 (auditoria de APIs) — `safeEqual` guarda os 17 checks de Bearer/verify_token
 * de cron/health/meta e não tinha teste.
 *
 * O contrato que importa é "NUNCA lança": `crypto.timingSafeEqual` cru LANÇA com
 * buffers de tamanhos diferentes. Se este wrapper deixasse escapar, um header
 * `Authorization` de tamanho errado viraria 500 em vez de 401 — transformando o
 * gate de auth num oráculo de tamanho de segredo e derrubando o cron.
 */
const SECRET = 'a'.repeat(32);

describe('safeEqual — iguais', () => {
  it('strings idênticas → true', () => {
    expect(safeEqual(SECRET, SECRET)).toBe(true);
  });

  it('string vazia contra vazia → true (nenhum caller passa vazio; documenta o contrato)', () => {
    expect(safeEqual('', '')).toBe(true);
  });

  it('unicode multi-byte idêntico → true (compara bytes, não code units)', () => {
    expect(safeEqual('señor-🔑', 'señor-🔑')).toBe(true);
  });
});

describe('safeEqual — diferentes', () => {
  it('mesmo tamanho, conteúdo diferente → false', () => {
    expect(safeEqual(SECRET, 'b'.repeat(32))).toBe(false);
  });

  it('difere só no último byte → false', () => {
    expect(safeEqual(SECRET, 'a'.repeat(31) + 'b')).toBe(false);
  });

  it('difere só no primeiro byte → false', () => {
    expect(safeEqual(SECRET, 'b' + 'a'.repeat(31))).toBe(false);
  });

  it('prefixo do segredo → false (não lança apesar do tamanho diferente)', () => {
    expect(safeEqual('a'.repeat(31), SECRET)).toBe(false);
  });

  it('segredo + sufixo → false', () => {
    expect(safeEqual(SECRET + 'x', SECRET)).toBe(false);
  });

  it('case-sensitive', () => {
    expect(safeEqual('Secret', 'secret')).toBe(false);
  });

  it('mesmo comprimento em chars, comprimento em BYTES diferente → false, sem lançar', () => {
    // 'é' = 2 bytes em utf8; ambos têm 1 char, mas 2 vs 1 byte. É exatamente o caso
    // que faria `timingSafeEqual` cru lançar.
    expect(safeEqual('é', 'e')).toBe(false);
  });
});

describe('safeEqual — entrada inválida nunca lança (o contrato)', () => {
  const invalidos: Array<[string, unknown, unknown]> = [
    ['null vs string', null, SECRET],
    ['string vs null', SECRET, null],
    ['undefined vs string', undefined, SECRET],
    ['string vs undefined', SECRET, undefined],
    ['null vs null', null, null],
    ['undefined vs undefined', undefined, undefined],
  ];

  it.each(invalidos)('%s → false', (_nome, a, b) => {
    expect(() => safeEqual(a as string, b as string)).not.toThrow();
    expect(safeEqual(a as string, b as string)).toBe(false);
  });

  // Guarda a regressão do A1: `env.CRON_SECRET` é optional(), então o header
  // ausente e o segredo ausente podem chegar juntos. Nunca pode dar true.
  it('ambos ausentes → false (header ausente + segredo não configurado)', () => {
    expect(safeEqual(null, undefined)).toBe(false);
  });

  it('tipos não-string (defesa em runtime, além do tipo) → false', () => {
    expect(safeEqual(42 as unknown as string, 42 as unknown as string)).toBe(false);
    expect(safeEqual({} as unknown as string, {} as unknown as string)).toBe(false);
  });
});
