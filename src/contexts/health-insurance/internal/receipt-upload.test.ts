import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

// Cifra de teste: reversível, AUTENTICADA (adulteração falha, como no AES-GCM real) e presa à clínica.
vi.mock('@/lib/crypto/encryption', async () => {
  const { createHash: h } = await import('node:crypto');
  const tag = (s: string) => h('sha256').update(s).digest('hex').slice(0, 16);
  return {
    encryptForTenant: async (clinicId: string, plain: string) => {
      const body = Buffer.from(plain).toString('base64');
      return `${clinicId}|${body}|${tag(clinicId + body)}`;
    },
    decryptForTenant: async (clinicId: string, cipher: string) => {
      const [c, body, t] = cipher.split('|');
      if (c !== clinicId || body === undefined || t !== tag(clinicId + body)) throw new Error('cifra inválida');
      return Buffer.from(body, 'base64').toString();
    },
  };
});

import { TissStorageError, type TissObjectStore } from '@/lib/storage/tiss-files';

import {
  RECEIPT_CHUNK_BYTES,
  ReceiptUploadError,
  assembleReceiptUpload,
  beginReceiptUpload,
  discardReceiptUpload,
  openReceiptUpload,
  putReceiptChunk,
  receiptChunkRef,
  sweepStaleReceiptUploads,
} from './receipt-upload';

const C = '11111111-1111-4111-8111-111111111111';
const U = 'user-1';
const A = '22222222-2222-4222-8222-222222222222';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function memoryStore(): TissObjectStore & { objects: Map<string, { bytes: Uint8Array; createdAt: Date }> } {
  const objects = new Map<string, { bytes: Uint8Array; createdAt: Date }>();
  return {
    objects,
    async put(ref, bytes) {
      if (objects.has(ref)) throw new TissStorageError('put', 'The resource already exists');
      objects.set(ref, { bytes, createdAt: new Date() });
    },
    async get(ref) {
      const o = objects.get(ref);
      if (!o) throw new TissStorageError('get', 'Object not found', 'not_found');
      return o.bytes;
    },
    async remove(ref) {
      objects.delete(ref);
    },
    async list(clinicId) {
      return [...objects.entries()].filter(([r]) => r.startsWith(`${clinicId}/`)).map(([ref, o]) => ({ ref, createdAt: o.createdAt }));
    },
  };
}

/** Arquivo de 7 MB (3 partes de 3 MiB, a última menor) com cabeçalho de PDF. */
const FILE = (() => {
  const b = new Uint8Array(7 * 1024 * 1024);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
  for (let i = 5; i < b.length; i++) b[i] = i % 251;
  return b;
})();

async function start(now = 1_000) {
  return beginReceiptUpload({ clinicId: C, userId: U, authorizationId: A, size: FILE.length, sha256: sha(FILE), declaredType: 'application/pdf', now });
}

describe('envio do comprovante em partes (P6.3)', () => {
  it('início: valida tamanho (até 10 MB), tipo e hash; o token só abre na mesma clínica e pessoa, dentro da validade', async () => {
    await expect(beginReceiptUpload({ clinicId: C, userId: U, authorizationId: A, size: 0, sha256: sha(FILE), declaredType: 'application/pdf' })).rejects.toThrow(/vazio/u);
    await expect(beginReceiptUpload({ clinicId: C, userId: U, authorizationId: A, size: 10 * 1024 * 1024 + 1, sha256: sha(FILE), declaredType: 'application/pdf' })).rejects.toThrow(/10 MB/u);
    await expect(beginReceiptUpload({ clinicId: C, userId: U, authorizationId: A, size: 10, sha256: 'x', declaredType: 'application/pdf' })).rejects.toThrow(/Resumo/u);
    await expect(beginReceiptUpload({ clinicId: C, userId: U, authorizationId: A, size: 10, sha256: sha(FILE), declaredType: 'application/zip' })).rejects.toThrow(/não aceito/u);
    const s = await start();
    expect([s.chunks, s.chunkBytes]).toEqual([3, RECEIPT_CHUNK_BYTES]);
    const claims = await openReceiptUpload(s.token, { clinicId: C, userId: U, now: 2_000 });
    expect([claims.authorizationId, claims.size, claims.type]).toEqual([A, FILE.length, 'application/pdf']);
    await expect(openReceiptUpload(s.token, { clinicId: 'outra-clinica', userId: U, now: 2_000 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(openReceiptUpload(s.token, { clinicId: C, userId: 'outra-pessoa', now: 2_000 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(openReceiptUpload(s.token, { clinicId: C, userId: U, now: 1_000 + 31 * 60_000 })).rejects.toMatchObject({ code: 'expired' });
    await expect(openReceiptUpload(`${s.token}x`, { clinicId: C, userId: U, now: 2_000 })).rejects.toBeInstanceOf(ReceiptUploadError);
  });

  it('partes cifradas no armazenamento; índice e tamanho exatos; reenvio da mesma parte é idempotente; montagem confere tamanho e hash', async () => {
    const store = memoryStore();
    const claims = await openReceiptUpload((await start()).token, { clinicId: C, userId: U, now: 2_000 });
    const part = (i: number) => FILE.slice(i * RECEIPT_CHUNK_BYTES, (i + 1) * RECEIPT_CHUNK_BYTES);
    await expect(putReceiptChunk(store, claims, 3, part(0))).rejects.toThrow(/fora do envio/u);
    await expect(putReceiptChunk(store, claims, 0, part(0).slice(1))).rejects.toThrow(/tamanho/u);
    await expect(assembleReceiptUpload(store, claims)).rejects.toMatchObject({ code: 'incomplete' });
    for (const i of [0, 1, 2]) await putReceiptChunk(store, claims, i, part(i));
    await putReceiptChunk(store, claims, 1, part(1)); // resposta perdida: reenvio igual passa
    const altered = part(1).slice();
    altered[10] = 0;
    await expect(putReceiptChunk(store, claims, 1, altered)).rejects.toThrow(/already exists/u);
    // Gravado cifrado: o conteúdo bruto não aparece no armazenamento.
    const stored = Buffer.from(store.objects.get(receiptChunkRef(claims, 0))!.bytes).toString();
    expect(stored.startsWith(`${C}|`)).toBe(true);
    const whole = await assembleReceiptUpload(store, claims);
    expect(sha(whole)).toBe(sha(FILE));
    await discardReceiptUpload(store, claims);
    expect(store.objects.size).toBe(0);
  });

  it('montagem com parte trocada (mesmo tamanho) é recusada pela integridade', async () => {
    const store = memoryStore();
    const claims = await openReceiptUpload((await start()).token, { clinicId: C, userId: U, now: 2_000 });
    for (const i of [0, 1, 2]) {
      const p = FILE.slice(i * RECEIPT_CHUNK_BYTES, (i + 1) * RECEIPT_CHUNK_BYTES);
      if (i === 2) p[0] = (p[0]! + 1) % 256;
      await putReceiptChunk(store, claims, i, p);
    }
    await expect(assembleReceiptUpload(store, claims)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('limpeza: só partes de envio da clínica, mais velhas que 2 h', async () => {
    const store = memoryStore();
    const old = new Date(Date.now() - 3 * 3_600_000);
    store.objects.set(`${C}/upload-a-000`, { bytes: new Uint8Array(1), createdAt: old });
    store.objects.set(`${C}/upload-b-000`, { bytes: new Uint8Array(1), createdAt: new Date() });
    store.objects.set(`${C}/registrado`, { bytes: new Uint8Array(1), createdAt: old });
    store.objects.set(`outra/upload-c-000`, { bytes: new Uint8Array(1), createdAt: old });
    expect(await sweepStaleReceiptUploads(store, C)).toBe(1);
    expect([...store.objects.keys()].sort()).toEqual([`${C}/registrado`, `${C}/upload-b-000`, 'outra/upload-c-000']);
  });
});
