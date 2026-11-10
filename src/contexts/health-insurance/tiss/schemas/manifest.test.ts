/**
 * Os XSDs oficiais da ANS ficam no repositório byte a byte (P0.7 do plano
 * mestre). Este teste é a trava: se alguém reformatar, converter fim de linha
 * ou trocar um arquivo, o SHA-256 deixa de bater com o MANIFEST, que registra o
 * pacote oficial de origem.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCHEMAS_ROOT = path.join(process.cwd(), 'src/contexts/health-insurance/tiss/schemas');

interface SchemaManifest {
  version: string;
  entrypoint: string;
  source: { url: string; archiveSha256: string };
  files: Record<string, string>;
}

function readManifest(version: string): SchemaManifest {
  return JSON.parse(
    readFileSync(path.join(SCHEMAS_ROOT, version, 'MANIFEST.json'), 'utf8'),
  ) as SchemaManifest;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const versions = readdirSync(SCHEMAS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('XSDs oficiais do Padrão TISS', () => {
  it('tem ao menos a versão de comunicação 4.03.00', () => {
    expect(versions).toContain('4.03.00');
  });

  describe.each(versions)('versão %s', (version) => {
    const manifest = readManifest(version);
    const dir = path.join(SCHEMAS_ROOT, version);

    it('declara a mesma versão da pasta e a origem oficial', () => {
      expect(manifest.version).toBe(version);
      expect(manifest.source.url).toMatch(/^https:\/\/www\.gov\.br\/ans\//u);
      expect(manifest.source.archiveSha256).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('cada arquivo tem exatamente o SHA-256 registrado', () => {
      for (const [name, expected] of Object.entries(manifest.files)) {
        expect(sha256(path.join(dir, name)), name).toBe(expected);
      }
    });

    it('não há XSD fora do manifesto', () => {
      const onDisk = readdirSync(dir).filter((name) => name.endsWith('.xsd'));
      expect(onDisk.sort()).toEqual(Object.keys(manifest.files).sort());
    });

    it('todo include e import aponta para um arquivo do manifesto', () => {
      for (const name of Object.keys(manifest.files)) {
        // Os XSDs da ANS são ISO-8859-1; latin1 lê os bytes sem perder nada.
        const text = readFileSync(path.join(dir, name), 'latin1');
        for (const match of text.matchAll(/<(?:include|import)\b[^>]*schemaLocation="([^"]+)"/gu)) {
          expect(manifest.files, `${name} → ${match[1]}`).toHaveProperty([match[1]!]);
        }
      }
    });

    it('o ponto de entrada é a mensagem TISS', () => {
      const entry = readFileSync(path.join(dir, manifest.entrypoint), 'latin1');
      expect(entry).toContain('<element name="mensagemTISS">');
    });
  });
});
