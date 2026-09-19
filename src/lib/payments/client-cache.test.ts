/**
 * `getClinicAsaasClient` — o resolvedor de client por clínica (ADR-049 1.3).
 *
 * O teste central aqui é o do CACHE, e ele não é sobre performance: o circuit
 * breaker vive na instância do client. Se cada cobrança criasse um client novo, o
 * breaker zeraria toda vez e a conta de uma clínica fora do ar seria martelada sem
 * parar. Cachear é o que faz a proteção existir — e reagir ao `key_version` é o
 * que impede um client zumbi seguir autenticando com credencial revogada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock, decryptMock, createClientMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  decryptMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute: executeMock, transaction: vi.fn() } }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ decryptForTenant: decryptMock }));
vi.mock('./asaas', () => ({ createAsaasClient: createClientMock }));

import { __testing__, getClinicAsaasClient } from './account-store';

beforeEach(() => {
  vi.clearAllMocks();
  __testing__.resetClientCache();
  decryptMock.mockImplementation(async (_clinicId: string, blob: string) => `chave(${blob})`);
  createClientMock.mockImplementation((cred: { apiKey: string }) => ({ id: cred.apiKey }));
});

describe('getClinicAsaasClient', () => {
  it('clínica sem conta conectada devolve null — não é erro, é a maioria', async () => {
    executeMock.mockResolvedValue([]);

    await expect(getClinicAsaasClient('clinic-1')).resolves.toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('conta ativa sem chave (estado impossível pelo CHECK) também devolve null', async () => {
    executeMock.mockResolvedValue([{ api_key_encrypted: null, key_version: 1 }]);

    await expect(getClinicAsaasClient('clinic-1')).resolves.toBeNull();
  });

  it('decifra a chave e monta o client', async () => {
    executeMock.mockResolvedValue([{ api_key_encrypted: 'BLOB', key_version: 1 }]);

    await expect(getClinicAsaasClient('clinic-1')).resolves.toEqual({ id: 'chave(BLOB)' });
    expect(decryptMock).toHaveBeenCalledWith('clinic-1', 'BLOB');
  });

  it('reusa a MESMA instância enquanto a versão da chave não muda', async () => {
    executeMock.mockResolvedValue([{ api_key_encrypted: 'BLOB', key_version: 7 }]);

    const primeiro = await getClinicAsaasClient('clinic-1');
    const segundo = await getClinicAsaasClient('clinic-1');

    expect(segundo).toBe(primeiro); // mesma referência ⇒ mesmo circuit breaker
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });

  it('rotação da chave (key_version novo) descarta o client velho', async () => {
    executeMock.mockResolvedValueOnce([{ api_key_encrypted: 'ANTIGA', key_version: 1 }]);
    const antes = await getClinicAsaasClient('clinic-1');

    executeMock.mockResolvedValueOnce([{ api_key_encrypted: 'NOVA', key_version: 2 }]);
    const depois = await getClinicAsaasClient('clinic-1');

    expect(depois).not.toBe(antes);
    expect(depois).toEqual({ id: 'chave(NOVA)' });
    expect(createClientMock).toHaveBeenCalledTimes(2);
  });

  it('clínicas diferentes nunca compartilham client', async () => {
    executeMock.mockResolvedValueOnce([{ api_key_encrypted: 'A', key_version: 1 }]);
    const a = await getClinicAsaasClient('clinic-a');
    executeMock.mockResolvedValueOnce([{ api_key_encrypted: 'B', key_version: 1 }]);
    const b = await getClinicAsaasClient('clinic-b');

    expect(a).not.toBe(b);
    expect(a).toEqual({ id: 'chave(A)' });
    expect(b).toEqual({ id: 'chave(B)' });
  });

  it('relê a versão da chave a cada chamada — é isso que torna a rotação segura', async () => {
    executeMock.mockResolvedValue([{ api_key_encrypted: 'BLOB', key_version: 1 }]);

    await getClinicAsaasClient('clinic-1');
    await getClinicAsaasClient('clinic-1');

    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});
