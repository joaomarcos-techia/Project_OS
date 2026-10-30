/**
 * Cópia cifrada dos arquivos do Storage. Nunca executa sem opt-in e destino local.
 * Os caminhos dos objetos ficam apenas dentro do manifesto cifrado.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import {
  MAX_STORAGE_ARCHIVE_OBJECT_BYTES,
  writeStorageArchive,
  type StorageBucket,
  type StorageObject,
} from '../src/lib/backup/storage-archive';

const PAGE_SIZE = 100;
const MAX_READ_ATTEMPTS = 3;

async function retryRead<T>(
  operation: () => Promise<{ data: T | null; error: unknown }>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await operation();
      if (!error && data !== null) return data;
    } catch {
      // Uma falha de rede transitória pode ser repetida; não imprime resposta sensível.
    }
    if (attempt < MAX_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error('[storage-backup] leitura do Storage falhou após três tentativas');
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[storage-backup] ${name} não configurada`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.STORAGE_BACKUP_COPY_PROD !== 'approved') {
    throw new Error('[storage-backup] opt-in STORAGE_BACKUP_COPY_PROD=approved obrigatório');
  }
  if (process.env.SUPABASE_PROJECT_ENV !== 'prod') {
    throw new Error('[storage-backup] ambiente de origem precisa ser prod');
  }
  const ref = required('SUPABASE_PROJECT_REF_PROD');
  const url = required('SUPABASE_URL_PROD');
  if (!/^[a-z0-9]{20}$/u.test(ref) || url !== `https://${ref}.supabase.co`) {
    throw new Error('[storage-backup] URL e project ref de origem não conferem');
  }
  const parentDir = resolve(required('STORAGE_BACKUP_LOCAL_DIR'));
  if (!(await stat(parentDir)).isDirectory()) {
    throw new Error('[storage-backup] destino local não é diretório');
  }
  const secret = required('SUPABASE_SECRET_KEY_PROD');
  const passphrase = required('BACKUP_PASSPHRASE');
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const buckets: StorageBucket[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const data = await retryRead(() => client.storage.listBuckets({ limit: PAGE_SIZE, offset }));
    for (const bucket of data) {
      buckets.push({
        name: bucket.name,
        public: bucket.public,
        fileSizeLimit: typeof bucket.file_size_limit === 'number' ? bucket.file_size_limit : null,
        allowedMimeTypes: bucket.allowed_mime_types ?? null,
      });
    }
    if (data.length < PAGE_SIZE) break;
  }

  async function listObjects(): Promise<StorageObject[]> {
    const objects: StorageObject[] = [];
    for (const bucket of buckets) {
      const pending = [''];
      while (pending.length > 0) {
        const prefix = pending.pop();
        if (prefix === undefined) break;
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const data = await retryRead(() =>
            client.storage.from(bucket.name).list(prefix, {
              limit: PAGE_SIZE,
              offset,
              sortBy: { column: 'name', order: 'asc' },
            }),
          );
          for (const entry of data) {
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.id === null) pending.push(name);
            else {
              if (
                typeof entry.metadata?.size === 'number' &&
                entry.metadata.size > MAX_STORAGE_ARCHIVE_OBJECT_BYTES
              ) {
                throw new Error('[storage-backup] objeto excede o limite do archive');
              }
              objects.push({ bucket: bucket.name, name });
            }
          }
          if (data.length < PAGE_SIZE) break;
        }
      }
    }
    return objects.sort((a, b) =>
      a.bucket === b.bucket ? a.name.localeCompare(b.name) : a.bucket.localeCompare(b.bucket),
    );
  }

  const objects = await listObjects();
  const directory = await writeStorageArchive({
    parentDir,
    projectRef: ref,
    passphrase,
    buckets,
    objects,
    fetchObject: async ({ bucket, name }) => {
      return retryRead(() => client.storage.from(bucket).download(name));
    },
  });
  // A API de listagem não oferece snapshot atômico: qualquer mudança invalida a cópia.
  const after = await listObjects();
  if (JSON.stringify(after) !== JSON.stringify(objects)) {
    throw new Error('[storage-backup] inventário mudou durante a cópia; archive requer revisão');
  }
  process.stdout.write(
    `[storage-backup] archive cifrado verificado: ${buckets.length} buckets, ${objects.length} objetos; diretório ${directory}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : '[storage-backup] falha não identificada'}\n`,
  );
  process.exitCode = 1;
});
