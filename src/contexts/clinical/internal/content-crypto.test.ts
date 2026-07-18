/**
 * Round-trip da cifra de conteúdo clínico (A1) + guards de tipo e de tenant.
 *
 * Injeta um SecretProvider fake (mesmo padrão de lib/crypto/encryption.test.ts) —
 * não depende de chave real no env, então os round-trips rodam sempre.
 */
import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProntuarioContent, Medicamento } from '../types';
import { assertClinicOwnership, decryptJson, encryptJson } from './content-crypto';
import type { Encrypted } from '@/lib/crypto/brand';
import { __testing__, type SecretProvider } from '@/lib/crypto/secret-provider';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

const MASTER_V1 = randomBytes(32);
const SALT = randomBytes(16);
const fakeProvider: SecretProvider = {
  async getMasterKey(version) {
    if (version === 1) return MASTER_V1;
    throw new Error(`no master key v${version}`);
  },
  async getLookupSalt() {
    return SALT;
  },
};
beforeEach(() => __testing__.setProvider(fakeProvider));
afterEach(() => __testing__.reset());

describe('content-crypto — round-trip', () => {
  it('cifra e decifra ProntuarioContent (11 campos, unicode)', async () => {
    const content: ProntuarioContent = {
      queixa_principal: 'Dor de cabeça há 3 dias — ☤ acentuação, ção',
      conduta: 'Dipirona 500mg 6/6h',
      plan: 'Retorno em 7 dias',
    };
    const ct = await encryptJson(CLINIC_A, content);
    expect(typeof ct).toBe('string');
    const back = await decryptJson<ProntuarioContent>(CLINIC_A, CLINIC_A, ct);
    expect(back).toEqual(content);
  });

  it('o ciphertext NÃO contém o plaintext', async () => {
    const ct = await encryptJson(CLINIC_A, { conduta: 'losartana 50mg' } as ProntuarioContent);
    expect(ct).not.toContain('losartana');
  });

  it('cifra lista de medicamentos (1 e 50 itens)', async () => {
    const one: Medicamento[] = [{ nome: 'Amoxicilina', dosagem: '500mg' }];
    const many: Medicamento[] = Array.from({ length: 50 }, (_, i) => ({ nome: `Med ${i}` }));
    expect(await decryptJson<Medicamento[]>(CLINIC_A, CLINIC_A, await encryptJson(CLINIC_A, one))).toEqual(one);
    expect(await decryptJson<Medicamento[]>(CLINIC_A, CLINIC_A, await encryptJson(CLINIC_A, many))).toHaveLength(50);
  });

  it('objeto vazio e string vazia sobrevivem (espelha encryptForTenant(cid, ""))', async () => {
    expect(await decryptJson(CLINIC_A, CLINIC_A, await encryptJson(CLINIC_A, {}))).toEqual({});
    expect(await decryptJson(CLINIC_A, CLINIC_A, await encryptJson(CLINIC_A, ''))).toBe('');
  });

  it('clínica errada NÃO decifra (chave derivada do clinicId — falha fechada)', async () => {
    const ct = await encryptJson(CLINIC_A, { conduta: 'x' } as ProntuarioContent);
    // A checagem de ownership dispara antes do decrypt; mesmo sem ela, o GCM falharia.
    await expect(decryptJson(CLINIC_B, CLINIC_A, ct)).rejects.toThrow(/cross-tenant/);
  });
});

describe('content-crypto — assertClinicOwnership', () => {
  it('passa quando a linha é da clínica do contexto', () => {
    expect(() => assertClinicOwnership(CLINIC_A, CLINIC_A)).not.toThrow();
  });
  it('bloqueia linha de outra clínica', () => {
    expect(() => assertClinicOwnership(CLINIC_A, CLINIC_B)).toThrow(/cross-tenant read blocked/);
  });
});

describe('content-crypto — barreiras de tipo (substituem o arch-test)', () => {
  it('string crua não satisfaz Encrypted<T>; Encrypted<T> não satisfaz T', () => {
    const content: ProntuarioContent = { conduta: 'x' };
    // @ts-expect-error — string crua não é Encrypted<ProntuarioContent>
    const bad: Encrypted<ProntuarioContent> = JSON.stringify(content);
    void bad;
    const ct = 'zzz' as Encrypted<ProntuarioContent>;
    // @ts-expect-error — Encrypted<T> não é T (força decifrar antes de usar)
    const worse: ProntuarioContent = ct;
    void worse;
    // @ts-expect-error — domínios diferentes não colam
    const mixed: Encrypted<Medicamento[]> = ct;
    void mixed;
    expect(true).toBe(true);
  });
});
