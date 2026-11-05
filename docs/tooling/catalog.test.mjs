import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { navigationPages, validSlug, classify, catalogMarkdown, validate } from './catalog.mjs';

test('logo do portal preserva os traços da identidade existente', async () => {
  const svg = await readFile(new URL('../assets/qoro-logo.svg', import.meta.url), 'utf8');
  const component = await readFile(
    new URL('../../src/components/shared/logo.tsx', import.meta.url),
    'utf8',
  );
  const paths = (text) => [...text.matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(paths(svg), paths(component));
  assert.equal(paths(svg).length, 6);
  assert.match(svg, /<title[^>]*>Qoro<\/title>/u);
});

test('extrai páginas aninhadas sem confundir rótulos e URLs com slugs', () => {
  assert.deepEqual(
    navigationPages({
      tabs: [
        {
          tab: 'Título',
          groups: [{ group: 'Grupo', pages: ['index', { group: 'Subgrupo', pages: ['a/b'] }] }],
        },
      ],
      global: { anchor: 'https://example.com' },
    }),
    ['index', 'a/b'],
  );
});
test('recusa escape de diretório, extensão, duplicação de barra e URL na navegação', () => {
  for (const input of [
    '../secret',
    '/index',
    'a//b',
    'a/../b',
    'index.md',
    'https://example.com',
    'a/',
  ])
    assert.equal(validSlug(input), false, input);
  for (const input of ['index', 'a/b-2026']) assert.equal(validSlug(input), true, input);
});
test('distingue evidência, decisão, material gerado e página de navegação', () => {
  const nav = new Set(['quality/index.md']);
  assert.equal(classify('quality/index.md', nav), 'portal');
  assert.equal(classify('quality/resultado.md', nav), 'evidence');
  assert.equal(classify('adr/001-stack.md', nav), 'decision');
  assert.equal(classify('security/acoes.md', nav), 'generated');
});
test('catálogo encaminha manual ao portal e evidência ao snapshot histórico', () => {
  const output = catalogMarkdown([
    { path: 'index.md', category: 'portal', title: 'Início' },
    { path: 'quality/a b.md', category: 'evidence', title: 'Resultado | datado' },
  ]);
  assert.match(output, /\[index.md\]\(\/index\)/u);
  assert.match(
    output,
    /\/blob\/af677c00cfb9a4faa8474ddbf1d69d489d8c8849\/docs\/quality\/a%20b.md/u,
  );
  assert.match(output, /Resultado \\\| datado/u);
});
test('documentação real mantém navegação, metadados, catálogo e links coerentes', async () => {
  const result = await validate();
  assert.deepEqual(result.errors, []);
  assert.ok(result.pages > 30);
  assert.ok(result.files > 220);
});
