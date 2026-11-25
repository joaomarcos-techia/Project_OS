/**
 * P6.3 — envio do comprovante de autorização em PARTES (até 10 MB, o contrato do domínio).
 *
 * Por quê: as server actions têm limite global de 4,25 MB (next.config, compartilhado; não é mexido)
 * e a função na Vercel aceita ~4,5 MB por requisição. Em vez de reduzir o contrato, o arquivo vai
 * em partes de 3 MiB, cada uma numa chamada autorizada:
 *
 *   1. INÍCIO: o servidor valida tamanho, tipo declarado e SHA-256 informados e emite um TOKEN
 *      SELADO com a criptografia do próprio tenant (`encryptForTenant`: ninguém forja nem lê sem a
 *      chave da clínica) com clínica, pessoa, autorização, tamanho, hash, número de partes e
 *      validade de 30 minutos. Nenhum segredo novo;
 *   2. PARTES: cada parte confere o token contra a SESSÃO (mesma clínica e pessoa, dentro da
 *      validade), o índice e o tamanho exato, e é gravada CIFRADA no armazenamento privado
 *      (`<clinica>/upload-<id>-<nnn>`), sem URL pública. Reenvio da mesma parte é idempotente;
 *   3. FIM: as partes são lidas, decifradas, juntadas e conferidas (tamanho e SHA-256 do token);
 *      só então o domínio (`attachAuthorizationReceipt`) confere o tipo pelo conteúdo, cifra o
 *      arquivo inteiro e grava o registro com auditoria. As partes são descartadas;
 *   4. LIMPEZA: envio abandonado é removido pela manutenção diária (partes com mais de 2 horas).
 *
 * Nada aqui decide permissão: as actions chamam o portão (`operate:convenios`) antes.
 */
import { createHash, randomUUID } from 'node:crypto';

import { decryptForTenant, encryptForTenant } from '@/lib/crypto/encryption';
import { TissStorageError, type TissObjectStore } from '@/lib/storage/tiss-files';

import { RECEIPT_MAX_BYTES, RECEIPT_MEDIA_TYPES } from './authorization-rules';

export const RECEIPT_CHUNK_BYTES = 3 * 1024 * 1024;
export const RECEIPT_UPLOAD_TTL_MS = 30 * 60 * 1000;
export const RECEIPT_UPLOAD_PREFIX = 'upload-';
/** Partes paradas há mais que isto são de envio abandonado (o token vale 30 min). */
export const RECEIPT_UPLOAD_STALE_MS = 2 * 60 * 60 * 1000;

export class ReceiptUploadError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'expired' | 'forbidden' | 'incomplete' | 'integrity',
  ) {
    super(message);
    this.name = 'ReceiptUploadError';
  }
}

export interface ReceiptUploadClaims {
  v: 1;
  id: string;
  clinicId: string;
  userId: string;
  authorizationId: string;
  size: number;
  sha256: string;
  type: string;
  chunks: number;
  exp: number;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function beginReceiptUpload(args: {
  clinicId: string;
  userId: string;
  authorizationId: string;
  size: number;
  sha256: string;
  declaredType: string;
  now?: number;
}): Promise<{ uploadId: string; token: string; chunkBytes: number; chunks: number }> {
  if (!Number.isInteger(args.size) || args.size < 1)
    throw new ReceiptUploadError('O arquivo está vazio.', 'invalid');
  if (args.size > RECEIPT_MAX_BYTES)
    throw new ReceiptUploadError('O comprovante passa de 10 MB. Envie um arquivo menor.', 'invalid');
  if (!/^[0-9a-f]{64}$/u.test(args.sha256)) throw new ReceiptUploadError('Resumo do arquivo inválido.', 'invalid');
  const type = args.declaredType.split(';')[0]!.trim().toLowerCase();
  if (!(RECEIPT_MEDIA_TYPES as readonly string[]).includes(type))
    throw new ReceiptUploadError('Tipo de arquivo não aceito. Envie PDF, PNG, JPEG ou XML.', 'invalid');
  const claims: ReceiptUploadClaims = {
    v: 1,
    id: randomUUID(),
    clinicId: args.clinicId,
    userId: args.userId,
    authorizationId: args.authorizationId,
    size: args.size,
    sha256: args.sha256,
    type,
    chunks: Math.ceil(args.size / RECEIPT_CHUNK_BYTES),
    exp: (args.now ?? Date.now()) + RECEIPT_UPLOAD_TTL_MS,
  };
  const token = await encryptForTenant(args.clinicId, JSON.stringify(claims));
  return { uploadId: claims.id, token, chunkBytes: RECEIPT_CHUNK_BYTES, chunks: claims.chunks };
}

/** Abre o token CONTRA A SESSÃO: outra clínica, outra pessoa ou validade vencida = recusa. */
export async function openReceiptUpload(
  token: string,
  session: { clinicId: string; userId: string; now?: number },
): Promise<ReceiptUploadClaims> {
  let claims: ReceiptUploadClaims;
  try {
    claims = JSON.parse(await decryptForTenant(session.clinicId, token)) as ReceiptUploadClaims;
  } catch {
    throw new ReceiptUploadError('Envio não reconhecido nesta clínica. Comece de novo.', 'forbidden');
  }
  if (claims?.v !== 1 || claims.clinicId !== session.clinicId || claims.userId !== session.userId)
    throw new ReceiptUploadError('Envio não reconhecido nesta clínica. Comece de novo.', 'forbidden');
  if ((session.now ?? Date.now()) > claims.exp)
    throw new ReceiptUploadError('O envio expirou (30 minutos). Comece de novo.', 'expired');
  return claims;
}

export const receiptChunkRef = (c: ReceiptUploadClaims, index: number) =>
  `${c.clinicId}/${RECEIPT_UPLOAD_PREFIX}${c.id}-${String(index).padStart(3, '0')}`;

export function expectedChunkLength(c: ReceiptUploadClaims, index: number): number {
  return index < c.chunks - 1 ? RECEIPT_CHUNK_BYTES : c.size - RECEIPT_CHUNK_BYTES * (c.chunks - 1);
}

async function readChunk(store: TissObjectStore, c: ReceiptUploadClaims, index: number): Promise<Uint8Array> {
  const cipher = await store.get(receiptChunkRef(c, index));
  return new Uint8Array(Buffer.from(await decryptForTenant(c.clinicId, Buffer.from(cipher).toString('utf8')), 'base64'));
}

export async function putReceiptChunk(
  store: TissObjectStore,
  c: ReceiptUploadClaims,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  if (!Number.isInteger(index) || index < 0 || index >= c.chunks)
    throw new ReceiptUploadError('Parte fora do envio.', 'invalid');
  if (bytes.length !== expectedChunkLength(c, index))
    throw new ReceiptUploadError('Parte com tamanho diferente do combinado. Comece de novo.', 'invalid');
  const cipher = Buffer.from(await encryptForTenant(c.clinicId, Buffer.from(bytes).toString('base64')), 'utf8');
  try {
    await store.put(receiptChunkRef(c, index), cipher);
  } catch (error) {
    // Reenvio da mesma parte (a resposta anterior se perdeu): aceita se o conteúdo é o mesmo.
    let same = false;
    try {
      same = sha256(await readChunk(store, c, index)) === sha256(bytes);
    } catch {
      same = false;
    }
    if (!same) throw error;
  }
}

/** Junta e confere (tamanho e SHA-256 do token). Parte ausente = envio incompleto. */
export async function assembleReceiptUpload(store: TissObjectStore, c: ReceiptUploadClaims): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < c.chunks; i++) {
    try {
      parts.push(await readChunk(store, c, i));
    } catch (error) {
      if (error instanceof TissStorageError && error.reason === 'not_found')
        throw new ReceiptUploadError('O envio está incompleto. Comece de novo.', 'incomplete');
      throw error;
    }
  }
  const whole = new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
  if (whole.length !== c.size || sha256(whole) !== c.sha256)
    throw new ReceiptUploadError('O arquivo chegou diferente do enviado. Comece de novo.', 'integrity');
  return whole;
}

/** Descarta as partes (fim ou desistência). Parte já ausente não é erro. */
export async function discardReceiptUpload(store: TissObjectStore, c: ReceiptUploadClaims): Promise<void> {
  for (let i = 0; i < c.chunks; i++) {
    await store.remove(receiptChunkRef(c, i)).catch(() => undefined);
  }
}

/** Partes de envio abandonado (mais velhas que `maxAgeMs`) de UMA clínica; devolve quantas saíram. */
export async function sweepStaleReceiptUploads(
  store: TissObjectStore,
  clinicId: string,
  now = Date.now(),
  maxAgeMs = RECEIPT_UPLOAD_STALE_MS,
): Promise<number> {
  if (!store.list) return 0;
  const prefix = `${clinicId}/${RECEIPT_UPLOAD_PREFIX}`;
  let removed = 0;
  for (const o of await store.list(clinicId)) {
    if (!o.ref.startsWith(prefix) || !o.createdAt || now - o.createdAt.getTime() < maxAgeMs) continue;
    await store.remove(o.ref);
    removed += 1;
  }
  return removed;
}
