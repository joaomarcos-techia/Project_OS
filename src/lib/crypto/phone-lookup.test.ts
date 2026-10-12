/**
 * Grafias da mesma linha brasileira (08/10/2026). A clínica cadastra o número
 * nacional e o WhatsApp entrega o wa_id com 55 e, em linhas antigas, sem o
 * nono dígito; o lookup exato fazia o paciente cadastrado parecer desconhecido.
 *
 * Os casos fixos documentam o contrato; as propriedades rodam sobre milhares de
 * números gerados com semente fixa (reprodutível, sem dependência nova).
 */
import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashForLookup, phoneLookupHashes, phoneLookupVariants } from './encryption';
import { __testing__, type SecretProvider } from './secret-provider';

const SALT = randomBytes(16);
const fakeProvider: SecretProvider = {
  async getMasterKey() {
    return randomBytes(32);
  },
  async getLookupSalt() {
    return SALT;
  },
};
beforeEach(() => __testing__.setProvider(fakeProvider));
afterEach(() => __testing__.reset());

const asSet = (phone: string) => new Set(phoneLookupVariants(phone));

/** DDD + assinante de uma grafia (sem 55 nem zero de longa distância). */
function nationalOf(variant: string): string {
  if ((variant.length === 12 || variant.length === 13) && variant.startsWith('55')) {
    return variant.slice(2);
  }
  return variant.startsWith('0') ? variant.slice(1) : variant;
}

describe('phoneLookupVariants — contrato', () => {
  it('o wa_id sem nono dígito e o número nacional da clínica são a mesma linha', () => {
    const fromWhatsApp = asSet('558897168587');
    for (const spelling of [
      '(88) 99716-8587',
      '88997168587',
      '+55 88 99716-8587',
      '5588997168587',
      '8897168587',
      '0 88 99716-8587',
    ]) {
      expect(asSet(spelling)).toEqual(fromWhatsApp);
    }
    expect(fromWhatsApp).toEqual(
      new Set([
        '558897168587',
        '8897168587',
        '08897168587',
        '88997168587',
        '5588997168587',
        '088997168587',
      ]),
    );
  });

  it('a grafia recebida vem primeiro (é o hash da própria conversa)', () => {
    expect(phoneLookupVariants('558897168587')[0]).toBe('558897168587');
    expect(phoneLookupVariants('(11) 98765-4321')[0]).toBe('11987654321');
  });

  it('celular cujo número sem o 9 cairia na faixa de fixo NÃO ganha a forma de 8 dígitos', () => {
    // 9 4xxx-xxxx sem o 9 seria 4xxx-xxxx: um FIXO, possivelmente de outra pessoa.
    expect(asSet('11941234567')).toEqual(new Set(['11941234567', '5511941234567', '011941234567']));
    expect(asSet('5511912345678')).toEqual(
      new Set(['5511912345678', '11912345678', '011912345678']),
    );
  });

  it('fixo só varia o 55 — nunca ganha nono dígito', () => {
    const landline = new Set(['1132345678', '551132345678', '01132345678']);
    expect(asSet('(11) 3234-5678')).toEqual(landline);
    expect(asSet('551132345678')).toEqual(landline);
  });

  it('DDD 55 não se confunde com o código do país', () => {
    expect(asSet('55991234567')).toEqual(
      new Set([
        '55991234567',
        '5555991234567',
        '055991234567',
        '5591234567',
        '555591234567',
        '05591234567',
      ]),
    );
  });

  it('número estrangeiro ou incompleto não ganha variante nenhuma', () => {
    expect(phoneLookupVariants('+351 912 345 678')).toEqual(['351912345678']);
    expect(phoneLookupVariants('+1 (415) 555-0132')).toEqual(['14155550132']);
    expect(phoneLookupVariants('12345')).toEqual(['12345']);
    expect(phoneLookupVariants('')).toEqual(['']);
  });

  it('phoneLookupHashes = hashForLookup de cada grafia, na mesma ordem', async () => {
    const hashes = await phoneLookupHashes('558897168587');
    const expected = await Promise.all(
      phoneLookupVariants('558897168587').map((value) => hashForLookup(value)),
    );
    expect(hashes).toEqual(expected);
    expect(hashes[0]).toBe(await hashForLookup('558897168587'));
  });
});

/** mulberry32 — gerador determinístico para as propriedades. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function digits(random: () => number, count: number, first = '0123456789'): string {
  let out = first[Math.floor(random() * first.length)]!;
  for (let i = 1; i < count; i += 1) out += String(Math.floor(random() * 10));
  return out;
}

type Line = { ddd: string; subscriber: string; kind: 'mobile' | 'landline' };

function randomLine(random: () => number): Line {
  const ddd = digits(random, 2, '123456789').slice(0, 1) + digits(random, 1, '123456789');
  if (random() < 0.7) return { ddd, subscriber: `9${digits(random, 8)}`, kind: 'mobile' };
  return { ddd, subscriber: digits(random, 8, '2345'), kind: 'landline' };
}

/** Uma grafia qualquer da linha (máscara, 55, +, zero de longa distância, sem o 9). */
function spell(line: Line, random: () => number): string {
  let national = `${line.ddd}${line.subscriber}`;
  if (line.kind === 'mobile' && /^9[6-9]/.test(line.subscriber) && random() < 0.4) {
    national = `${line.ddd}${line.subscriber.slice(1)}`;
  }
  const choice = Math.floor(random() * 5);
  if (choice === 0) return national;
  if (choice === 1) return `55${national}`;
  if (choice === 2) return `+55 (${national.slice(0, 2)}) ${national.slice(2)}`;
  if (choice === 3) return `0${national}`;
  return `(${national.slice(0, 2)}) ${national.slice(2, -4)}-${national.slice(-4)}`;
}

describe('phoneLookupVariants — propriedades (5.000 linhas, semente fixa)', () => {
  const random = seeded(20261008);
  const lines = Array.from({ length: 5_000 }, () => randomLine(random));

  it('qualquer grafia da mesma linha gera o MESMO conjunto (classe de equivalência)', () => {
    for (const line of lines) {
      const reference = asSet(`${line.ddd}${line.subscriber}`);
      expect(asSet(spell(line, random))).toEqual(reference);
      for (const variant of reference) expect(asSet(variant)).toEqual(reference);
    }
  });

  it('toda grafia preserva DDD e os 8 dígitos finais; fixo nunca vira celular', () => {
    for (const line of lines) {
      for (const variant of asSet(spell(line, random))) {
        const national = nationalOf(variant);
        expect(national.slice(0, 2)).toBe(line.ddd);
        expect(national.slice(-8)).toBe(line.subscriber.slice(-8));
        if (line.kind === 'landline') expect(national).toHaveLength(10);
        if (national.length === 10 && line.kind === 'mobile') {
          expect(national[2]).toMatch(/[6-9]/);
        }
      }
    }
  });

  it('linhas diferentes nunca compartilham grafia', () => {
    const owner = new Map<string, string>();
    for (const line of lines) {
      const id = `${line.ddd}${line.subscriber}`;
      for (const variant of asSet(id)) {
        const previous = owner.get(variant);
        if (previous !== undefined) expect(previous).toBe(id);
        owner.set(variant, id);
      }
    }
  });

  it('no máximo seis grafias por linha (com/sem 55, com/sem zero, com/sem o 9)', () => {
    for (const line of lines) {
      expect(phoneLookupVariants(spell(line, random)).length).toBeLessThanOrEqual(6);
    }
  });
});
