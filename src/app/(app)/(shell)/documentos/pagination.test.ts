import { describe, expect, it } from 'vitest';

import { documentosPageHref, parseDocumentosPage } from './pagination';

describe('paginação de /documentos', () => {
  it.each([
    { value: undefined, expected: 1 },
    { value: '', expected: 1 },
    { value: '0', expected: 1 },
    { value: '-2', expected: 1 },
    { value: '1.5', expected: 1 },
    { value: 'abc', expected: 1 },
    { value: '3', expected: 3 },
  ])('normaliza page=$value para $expected', ({ value, expected }) => {
    expect(parseDocumentosPage(value)).toBe(expected);
  });

  it('preserva busca e tipo ao navegar', () => {
    expect(documentosPageHref({ q: 'Ana Silva', kind: 'document' }, 3)).toBe(
      '/documentos?q=Ana+Silva&tipo=document&page=3',
    );
  });

  it('omite a primeira página da URL canônica', () => {
    expect(documentosPageHref({}, 1)).toBe('/documentos');
    expect(documentosPageHref({ kind: 'prescription' }, 1)).toBe('/documentos?tipo=prescription');
  });
});
