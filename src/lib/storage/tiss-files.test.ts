import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/supabase-admin', () => ({ createAdminClient: vi.fn() }));

import { supabaseTissObjectStore, TissStorageError } from './tiss-files';

/** Respostas reais do Storage do DEV (12/11): ambas 400 com statusCode "404". */
const OBJECT_MISSING = { name: 'StorageApiError', message: 'Object not found', status: 400, statusCode: '404' };
const KEY_REFUSED = { name: 'StorageApiError', message: 'Bucket not found', status: 400, statusCode: '404' };

const clientWith = (error: unknown) =>
  () =>
    ({
      storage: { from: () => ({ download: async () => ({ data: null, error }) }) },
    }) as never;

describe('supabaseTissObjectStore — classificação da falha de leitura (P12.7)', () => {
  it('objeto ausente é not_found (arquivo registrado sumiu: crítico, 409)', async () => {
    const err = await supabaseTissObjectStore(clientWith(OBJECT_MISSING)).get('a/b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TissStorageError);
    expect((err as TissStorageError).reason).toBe('not_found');
  });

  it('chave recusada ou bucket inexistente é indisponível, NUNCA "arquivo ausente" (503)', async () => {
    const err = await supabaseTissObjectStore(clientWith(KEY_REFUSED)).get('a/b').catch((e: unknown) => e);
    expect((err as TissStorageError).reason).toBe('unavailable');
    const net = await supabaseTissObjectStore(clientWith({ message: 'fetch failed' })).get('a/b').catch((e: unknown) => e);
    expect((net as TissStorageError).reason).toBe('unavailable');
  });

  it('a mensagem do erro não carrega a referência do objeto', async () => {
    const err = (await supabaseTissObjectStore(clientWith(OBJECT_MISSING)).get('clinica/objeto-secreto').catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('objeto-secreto');
  });
});
