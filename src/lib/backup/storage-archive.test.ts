import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  restoreStorageArchive,
  verifyStorageArchive,
  writeStorageArchive,
} from './storage-archive';

const created: string[] = [];
afterEach(async () => {
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('archive de arquivos do Storage', () => {
  it('cifra inclusive nomes privados, preserva buckets vazios e detecta alteração dos bytes', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'qoro-storage-test-'));
    created.push(parentDir);
    const archive = await writeStorageArchive({
      parentDir,
      projectRef: 'abcdefghijklmnopqrst',
      passphrase: 'senha-sintetica-longa-para-teste',
      buckets: [
        {
          name: 'clinical-pdfs',
          public: false,
          fileSizeLimit: null,
          allowedMimeTypes: null,
        },
        {
          name: 'admin-exports',
          public: false,
          fileSizeLimit: null,
          allowedMimeTypes: null,
        },
      ],
      objects: [{ bucket: 'clinical-pdfs', name: 'paciente-sintetico/arquivo.pdf' }],
      fetchObject: async () => new Blob(['conteudo sintetico']),
    });
    const manifest = await verifyStorageArchive(archive, 'senha-sintetica-longa-para-teste');
    expect(manifest.buckets).toHaveLength(2);
    expect(manifest.objects).toMatchObject([
      { bucket: 'clinical-pdfs', name: 'paciente-sintetico/arquivo.pdf', size: 18 },
    ]);
    const restored = new Map<string, string>();
    await restoreStorageArchive(
      archive,
      'senha-sintetica-longa-para-teste',
      async (object, data) => {
        restored.set(`${object.bucket}/${object.name}`, data.toString('utf8'));
      },
    );
    expect(restored.get('clinical-pdfs/paciente-sintetico/arquivo.pdf')).toBe('conteudo sintetico');
    expect(await readFile(join(archive, 'header.json'), 'utf8')).not.toContain('paciente');
    const archivedObject = manifest.objects.at(0);
    if (!archivedObject) throw new Error('Arquivo sintético ausente do manifesto');
    const file = join(archive, archivedObject.file);
    const ciphertext = await readFile(file);
    const lastByte = ciphertext.at(-1);
    if (lastByte === undefined) throw new Error('Arquivo cifrado sintético vazio');
    ciphertext[ciphertext.length - 1] = lastByte ^ 1;
    await writeFile(file, ciphertext);
    await expect(
      verifyStorageArchive(archive, 'senha-sintetica-longa-para-teste'),
    ).rejects.toThrow();
    await expect(
      verifyStorageArchive(archive, 'senha-incorreta-longa-para-teste'),
    ).rejects.toThrow();
  });
});
