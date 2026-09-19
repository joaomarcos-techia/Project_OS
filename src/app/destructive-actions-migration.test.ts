import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migratedFiles = [
  'src/app/(app)/(shell)/pacientes/[id]/delete-form.tsx',
  'src/app/(app)/(shell)/pacientes/[id]/patient-death-form.tsx',
  'src/app/(app)/(shell)/pacientes/[id]/lgpd-actions.tsx',
  'src/app/(app)/(shell)/configuracoes/procedimentos/procedures-manager.tsx',
  'src/app/(app)/(shell)/modelos-receita/templates-manager.tsx',
];

describe('P-13 — migração das ações destrutivas', () => {
  it.each(migratedFiles)('%s não usa confirmação nativa', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/u);
    expect(source).toMatch(/(?:ConfirmDialog|DestructiveAction)/u);
  });
});
