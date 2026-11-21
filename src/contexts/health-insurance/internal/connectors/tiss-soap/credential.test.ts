/**
 * P6.5/P12.5 — leitura em claro da credencial só para o envio: só a ativa do login do
 * webservice, marca o uso e devolve login e senha decifrados com a chave da clínica.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const decrypt = vi.hoisted(() => vi.fn(async (clinicId: string, c: string) => `claro(${clinicId}:${c})`));
vi.mock('@/lib/crypto/encryption', () => ({ decryptForTenant: decrypt }));

import type { Tx } from '@/lib/db';

import { readWebserviceCredentialForSendTx } from './credential';

function fakeTx(rows: Array<{ usernameEncrypted: string | null; secretEncrypted: string }>) {
  const calls: { set?: unknown; where?: unknown } = {};
  const tx = {
    update: () => ({
      set: (v: unknown) => {
        calls.set = v;
        return {
          where: (w: unknown) => {
            calls.where = w;
            return { returning: async () => rows };
          },
        };
      },
    }),
  } as unknown as Tx;
  return { tx, calls };
}

beforeEach(() => decrypt.mockClear());

describe('readWebserviceCredentialForSendTx', () => {
  it('decifra login e senha da credencial ativa com a chave da clínica e marca o uso', async () => {
    const { tx, calls } = fakeTx([{ usernameEncrypted: 'u-cifrado', secretEncrypted: 's-cifrado' }]);
    const cred = await readWebserviceCredentialForSendTx(tx, 'clinica-1', 'operadora-1');
    expect(cred).toEqual({ login: 'claro(clinica-1:u-cifrado)', password: 'claro(clinica-1:s-cifrado)' });
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(Object.keys(calls.set as object)).toEqual(['lastUsedAt']);
    expect(calls.where).toBeDefined();
  });

  it('sem credencial ativa (ou sem usuário): nada é decifrado', async () => {
    expect(await readWebserviceCredentialForSendTx(fakeTx([]).tx, 'c', 'o')).toBeNull();
    expect(await readWebserviceCredentialForSendTx(fakeTx([{ usernameEncrypted: null, secretEncrypted: 'x' }]).tx, 'c', 'o')).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });
});
