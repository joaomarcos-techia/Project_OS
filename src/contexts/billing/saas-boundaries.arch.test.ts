import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(file);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [file] : [];
  });
}

function forbiddenImports(directories: string[], forbidden: RegExp) {
  return directories.flatMap((directory) =>
    productionFiles(directory).flatMap((file) =>
      ts
        .preProcessFile(readFileSync(file, 'utf8'), true, true)
        .importedFiles.filter((entry) => {
          const dependency = entry.fileName.startsWith('@/')
            ? `src/${entry.fileName.slice(2)}`
            : entry.fileName.startsWith('.')
              ? path.join(path.dirname(file), entry.fileName).replaceAll('\\', '/')
              : entry.fileName;
          return forbidden.test(dependency);
        })
        .map((entry) => ({ file: path.relative(process.cwd(), file), dependency: entry.fileName })),
    ),
  );
}

describe('SaaS billing and patient payment ownership', () => {
  it('keeps subscription services independent of TISS operations and patient payment services', () => {
    expect(
      forbiddenImports(
        ['src/contexts/billing', 'src/lib/payments/saas', 'src/lib/payments/abacatepay'],
        /(?:contexts\/health-insurance|contexts\/payments|lib\/payments\/patient)(?:\/|$)/u,
      ),
    ).toEqual([]);
  });

  it('keeps patient collection and its Asaas webhook independent of the SaaS AbacatePay adapter', () => {
    expect(
      forbiddenImports(
        ['src/contexts/payments', 'src/app/api/webhooks/asaas/patient'],
        /(?:lib\/payments\/abacatepay|contexts\/billing\/internal\/abacatepay)[/-]/u,
      ),
    ).toEqual([]);
  });
});
