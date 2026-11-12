/**
 * Armazenamento privado dos arquivos TISS (D20, P12.7): XML de lote, documentos de
 * retorno e XML de recurso de glosa (o PDF da guia é gerado sob demanda do snapshot
 * congelado, sem cópia guardada).
 *
 * O banco guarda só os metadados (`hi_files`: referência opaca, SHA-256 do
 * conteúdo e do cifrado, tamanho, versão). Os BYTES — já cifrados por clínica
 * antes de chegar aqui — ficam num bucket PRIVADO, acessado só no servidor com
 * service role; o navegador recebe o arquivo por rota same-origin que revalida
 * sessão, permissão e clínica. Nunca há URL pública nem URL assinada.
 *
 * Diferente do `clinical.ts`, aqui NÃO há sobrescrita (`upsert: false`): um
 * arquivo emitido é imutável; versão nova é um objeto novo, encadeado em
 * `hi_files.supersedes_file_id`.
 *
 * O bucket `tiss-files` precisa existir (privado) antes de ligar o módulo em
 * qualquer ambiente: SQL e procedimento em `docs/convenios/armazenamento-tiss.md`
 * (provisionamento só com autorização do fundador; nada é criado por este código).
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const TISS_FILES_BUCKET = 'tiss-files';

export interface TissStoredObject {
  /** `<clinic_id>/<uuid>`, a mesma referência de `hi_files.storage_ref`. */
  ref: string;
  createdAt: Date | null;
}

/** Porta do armazenamento: o serviço não conhece o provedor (testes usam memória). */
export interface TissObjectStore {
  /** Grava um objeto NOVO; falha se a referência já existir (sem sobrescrita). */
  put(ref: string, bytes: Uint8Array): Promise<void>;
  /** Lê o objeto; ausente = `TissStorageError` com `reason: 'not_found'`. */
  get(ref: string): Promise<Uint8Array>;
  /** Compensação ou descarte de órfão: nunca de objeto referenciado por `hi_files`. */
  remove(ref: string): Promise<void>;
  /** Objetos de uma clínica (conferência de consistência; opcional nos testes simples). */
  list?(clinicId: string): Promise<TissStoredObject[]>;
}

export type TissStorageFailure = 'not_found' | 'unavailable';

export class TissStorageError extends Error {
  constructor(
    readonly op: 'put' | 'get' | 'remove' | 'list',
    detail: string,
    readonly reason: TissStorageFailure = 'unavailable',
  ) {
    // A referência não entra na mensagem: é opaca, mas não precisa ir para log.
    super(`[tiss-files] ${op} falhou: ${detail.slice(0, 200)}`);
    this.name = 'TissStorageError';
  }
}

const NOT_FOUND = /not.?found|does not exist|no such|404/iu;
const CLINIC_PREFIX = /^[0-9a-f-]{36}$/u;

export function supabaseTissObjectStore(): TissObjectStore {
  const bucket = () => createAdminClient().storage.from(TISS_FILES_BUCKET);
  return {
    async put(ref, bytes) {
      const { error } = await bucket().upload(ref, bytes, { contentType: 'application/octet-stream', upsert: false });
      if (error) throw new TissStorageError('put', error.message);
    },
    async get(ref) {
      const { data, error } = await bucket().download(ref);
      if (error || !data) {
        const detail = error?.message ?? 'sem dados';
        throw new TissStorageError('get', detail, NOT_FOUND.test(detail) ? 'not_found' : 'unavailable');
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(ref) {
      const { error } = await bucket().remove([ref]);
      if (error) throw new TissStorageError('remove', error.message);
    },
    async list(clinicId) {
      if (!CLINIC_PREFIX.test(clinicId)) throw new TissStorageError('list', 'prefixo inválido');
      const out: TissStoredObject[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket().list(clinicId, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new TissStorageError('list', error.message);
        for (const o of data ?? []) {
          out.push({ ref: `${clinicId}/${o.name}`, createdAt: o.created_at ? new Date(o.created_at) : null });
        }
        if (!data || data.length < 1000) return out;
      }
    },
  };
}

/** Bucket existe e é PRIVADO? (prontidão antes de ligar o módulo; não cria nada). */
export async function checkTissBucketReadiness(): Promise<{ ok: boolean; reason: 'ready' | 'missing' | 'public' | 'error' }> {
  try {
    const { data, error } = await createAdminClient().storage.getBucket(TISS_FILES_BUCKET);
    if (error || !data) return { ok: false, reason: error && NOT_FOUND.test(error.message) ? 'missing' : 'error' };
    return data.public ? { ok: false, reason: 'public' } : { ok: true, reason: 'ready' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
