import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UX-008 (`docs/otimização_ui_final.md`) — WCAG 2.4.2 (nível A): cada tela tem
 * título próprio. O layout raiz define o modelo `%s · Qoro`; cada `page.tsx`
 * exporta `metadata`/`generateMetadata`, ou herda o título de um layout da
 * própria pasta (usado nas páginas de cliente e nas pastas de PRs paralelas).
 */
const APP_DIR = resolve(process.cwd(), 'src/app');
const OWN_TITLE =
  /export\s+(const\s+metadata\b|async\s+function\s+generateMetadata\b|function\s+generateMetadata\b)|export\s*\{[^}]*\b(metadata|generateMetadata)\b[^}]*\}\s*from/;

function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.isFile() && entry.name === 'page.tsx' ? [path] : [];
  });
}

function titledByLayout(pageFile: string): boolean {
  let directory = dirname(pageFile);
  while (directory.startsWith(APP_DIR) && directory !== APP_DIR) {
    const layout = join(directory, 'layout.tsx');
    if (existsSync(layout) && /title\s*:/.test(readFileSync(layout, 'utf8'))) return true;
    directory = dirname(directory);
  }
  return false;
}

describe('títulos de página (UX-008)', () => {
  it('o layout raiz usa o modelo "%s · Qoro"', () => {
    const root = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8');
    expect(root).toMatch(/template:\s*'%s · Qoro'/);
  });

  it('toda page.tsx tem título próprio ou herdado de um layout da pasta', () => {
    const missing = pages(APP_DIR)
      .filter((file) => !OWN_TITLE.test(readFileSync(file, 'utf8')) && !titledByLayout(file))
      .map((file) => relative(APP_DIR, file).split('\\').join('/'));
    expect(missing).toEqual([]);
  });

  it('nenhum título repete a marca (o modelo já acrescenta "· Qoro")', () => {
    const repeated = pages(APP_DIR)
      .concat(
        readdirSync(APP_DIR, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name === 'layout.tsx')
          .map((entry) => join(entry.parentPath, entry.name))
          .filter((file) => file !== join(APP_DIR, 'layout.tsx')),
      )
      .filter((file) => /title:\s*[`'"][^`'"]*Qoro[`'"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP_DIR, file).split('\\').join('/'));
    expect(repeated).toEqual([]);
  });
});
