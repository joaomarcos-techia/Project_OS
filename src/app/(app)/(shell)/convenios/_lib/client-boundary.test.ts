/**
 * Fronteira servidor/cliente das telas de Convênios: módulo `'use client'` só exporta
 * componentes/funções. Uma CONSTANTE exportada por ele chega ao Server Component como
 * referência de cliente, não como o valor (o `CARE_TYPES.find` deu 500 no Preview em 12/11).
 * Constantes compartilhadas ficam em `_lib/constants.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const LIB = path.join(process.cwd(), 'src/app/(app)/(shell)/convenios/_lib');

describe('fronteira servidor/cliente em Convênios', () => {
  it('nenhum módulo "use client" exporta constante (valor não-função)', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(LIB).filter((f) => /\.tsx?$/u.test(f) && !f.includes('.test.'))) {
      const src = readFileSync(path.join(LIB, file), 'utf8');
      if (!/^\s*['"]use client['"]/u.test(src)) continue;
      for (const m of src.matchAll(/^export const ([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(.)/gmu)) {
        // Arrow function/componente é permitido; array, objeto, string e número não.
        if (!/^\(|^async\b|^function\b/u.test(src.slice(m.index! + m[0].length - 1).trimStart())) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
