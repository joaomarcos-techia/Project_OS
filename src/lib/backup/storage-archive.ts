import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MAX_STORAGE_ARCHIVE_OBJECT_BYTES = 32 * 1024 * 1024;
const ARCHIVE_VERSION = 1;

export type StorageBucket = {
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
};
export type StorageObject = { bucket: string; name: string };

type Manifest = {
  version: number;
  projectRef: string;
  createdAt: string;
  buckets: StorageBucket[];
  objects: Array<StorageObject & { file: string; size: number; sha256: string }>;
};

type Header = { version: number; salt: string };

function keyFor(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 24 || /[\r\n]/u.test(passphrase)) {
    throw new Error('Storage backup passphrase is missing or invalid');
  }
  return scryptSync(passphrase, salt, 32);
}

function encrypt(data: Buffer, key: Buffer, label: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(label));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(data: Buffer, key: Buffer, label: string): Buffer {
  if (data.length < 28) throw new Error('Storage archive is truncated');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}

function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function safeFile(name: string): boolean {
  return /^[a-f0-9]{32}\.enc$/u.test(name);
}

/** Cada nome/caminho de objeto fica somente no manifesto cifrado. O diretório é sempre novo. */
export async function writeStorageArchive(input: {
  parentDir: string;
  projectRef: string;
  passphrase: string;
  buckets: StorageBucket[];
  objects: StorageObject[];
  fetchObject: (object: StorageObject) => Promise<Blob>;
}): Promise<string> {
  if (!/^[a-z0-9]{20}$/u.test(input.projectRef)) throw new Error('Invalid Supabase project ref');
  const bucketNames = new Set(input.buckets.map((bucket) => bucket.name));
  if (
    bucketNames.size !== input.buckets.length ||
    input.objects.some((object) => !bucketNames.has(object.bucket))
  ) {
    throw new Error('Storage inventory has an unknown or duplicate bucket');
  }
  const salt = randomBytes(16);
  const key = keyFor(input.passphrase, salt);
  const directory = await mkdtemp(join(resolve(input.parentDir), 'qoro-storage-'));
  try {
    const manifest: Manifest = {
      version: ARCHIVE_VERSION,
      projectRef: input.projectRef,
      createdAt: new Date().toISOString(),
      buckets: input.buckets,
      objects: [],
    };
    for (const object of input.objects) {
      const blob = await input.fetchObject(object);
      if (blob.size > MAX_STORAGE_ARCHIVE_OBJECT_BYTES)
        throw new Error('Storage object exceeds archive size limit');
      const data = Buffer.from(await blob.arrayBuffer());
      const file = `${randomBytes(16).toString('hex')}.enc`;
      await writeFile(join(directory, file), encrypt(data, key, file), { flag: 'wx', mode: 0o600 });
      manifest.objects.push({ ...object, file, size: data.length, sha256: hash(data) });
    }
    await writeFile(
      join(directory, 'manifest.enc'),
      encrypt(Buffer.from(JSON.stringify(manifest)), key, 'manifest'),
      { flag: 'wx', mode: 0o600 },
    );
    const header: Header = { version: ARCHIVE_VERSION, salt: salt.toString('hex') };
    await writeFile(join(directory, 'header.json'), JSON.stringify(header), {
      flag: 'wx',
      mode: 0o600,
    });
    await verifyStorageArchive(directory, input.passphrase);
    return directory;
  } catch (error) {
    // Somente o diretório recém-criado por mkdtemp, nunca o parentDir fornecido.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Verifica a cópia sem expor nomes de objetos ou conteúdo em logs. */
async function inspectStorageArchive(
  directory: string,
  passphrase: string,
  onObject?: (object: StorageObject, data: Buffer) => Promise<void>,
): Promise<Manifest> {
  const header = JSON.parse(await readFile(join(directory, 'header.json'), 'utf8')) as Header;
  if (header.version !== ARCHIVE_VERSION || !/^[a-f0-9]{32}$/u.test(header.salt)) {
    throw new Error('Invalid storage archive header');
  }
  const key = keyFor(passphrase, Buffer.from(header.salt, 'hex'));
  const manifest = JSON.parse(
    decrypt(await readFile(join(directory, 'manifest.enc')), key, 'manifest').toString('utf8'),
  ) as Manifest;
  if (
    manifest.version !== ARCHIVE_VERSION ||
    !Array.isArray(manifest.objects) ||
    !Array.isArray(manifest.buckets)
  )
    throw new Error('Invalid storage archive manifest');
  for (const object of manifest.objects) {
    if (!safeFile(object.file)) throw new Error('Invalid storage archive object name');
    const data = decrypt(await readFile(join(directory, object.file)), key, object.file);
    if (data.length !== object.size || hash(data) !== object.sha256) {
      throw new Error('Storage archive integrity check failed');
    }
    await onObject?.({ bucket: object.bucket, name: object.name }, data);
  }
  return manifest;
}

export async function verifyStorageArchive(
  directory: string,
  passphrase: string,
): Promise<Manifest> {
  return inspectStorageArchive(directory, passphrase);
}

/** O chamador só deve implementar upload para um projeto isolado e autorizado. */
export async function restoreStorageArchive(
  directory: string,
  passphrase: string,
  uploadObject: (object: StorageObject, data: Buffer) => Promise<void>,
): Promise<Manifest> {
  // Verifica o archive inteiro antes de gravar o primeiro objeto no destino.
  await verifyStorageArchive(directory, passphrase);
  return inspectStorageArchive(directory, passphrase, uploadObject);
}
