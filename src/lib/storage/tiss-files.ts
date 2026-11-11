/**
 * Armazenamento privado dos arquivos TISS (D20, P12.7): XML de lote, PDFs de
 * guia e documentos de retorno.
 *
 * O banco guarda só os metadados (`hi_files`: referência opaca, SHA-256 do
 * conteúdo e do cifrado, tamanho, versão). Os BYTES — já cifrados por clínica
 * antes de chegar aqui — ficam num bucket PRIVADO, acessado só no servidor com
 * service role; o navegador recebe o arquivo por rota same-origin que revalida
 * sessão, permissão e clínica. Nunca há URL pública.
 *
 * Diferente do `clinical.ts`, aqui NÃO há sobrescrita (`upsert: false`): um
 * arquivo emitido é imutável; versão nova é um objeto novo, encadeado em
 * `hi_files.supersedes_file_id`.
 *
 * O bucket `tiss-files` precisa existir (privado) antes de ligar o módulo em
 * qualquer ambiente: pré-requisito de implantação registrado no plano.
 */
import 'server-only';

import { createAdminClient } from '@/lib/auth/supabase-admin';

export const TISS_FILES_BUCKET = 'tiss-files';

/** Porta do armazenamento: o serviço não conhece o provedor (testes usam memória). */
export interface TissObjectStore {
  /** Grava um objeto NOVO; falha se a referência já existir (sem sobrescrita). */
  put(ref: string, bytes: Uint8Array): Promise<void>;
  get(ref: string): Promise<Uint8Array>;
  /** Compensação: só para objeto gravado numa transação que não confirmou. */
  remove(ref: string): Promise<void>;
}

export function supabaseTissObjectStore(): TissObjectStore {
  return {
    async put(ref, bytes) {
      const { error } = await createAdminClient()
        .storage.from(TISS_FILES_BUCKET)
        .upload(ref, bytes, { contentType: 'application/octet-stream', upsert: false });
      if (error) throw new TissStorageError('put', error.message);
    },
    async get(ref) {
      const { data, error } = await createAdminClient().storage.from(TISS_FILES_BUCKET).download(ref);
      if (error || !data) throw new TissStorageError('get', error?.message ?? 'sem dados');
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(ref) {
      const { error } = await createAdminClient().storage.from(TISS_FILES_BUCKET).remove([ref]);
      if (error) throw new TissStorageError('remove', error.message);
    },
  };
}

export class TissStorageError extends Error {
  constructor(
    readonly op: 'put' | 'get' | 'remove',
    detail: string,
  ) {
    // A referência não entra na mensagem: é opaca, mas não precisa ir para log.
    super(`[tiss-files] ${op} falhou: ${detail.slice(0, 200)}`);
    this.name = 'TissStorageError';
  }
}
