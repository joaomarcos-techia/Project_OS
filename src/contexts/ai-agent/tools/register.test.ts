/**
 * Guard de whitelist (G9) — a fonte única `register.ts` deve registrar EXATAMENTE
 * as 15 tools de produção, e as declarações derivadas (o que vai ao modelo) têm
 * de bater 1:1 com `PRODUCTION_TOOL_NAMES`. Este teste é o que impede o drift que
 * existia entre o handler (15 tools) e os scripts de verificação (3 tools).
 */
import { describe, expect, it } from 'vitest';

import { PRODUCTION_TOOL_NAMES } from './register';
import { listTools, listToolDeclarations } from './registry';

describe('register.ts — whitelist canônica de produção', () => {
  it('registra exatamente as 16 tools de produção', () => {
    expect(PRODUCTION_TOOL_NAMES).toHaveLength(16);
    const registered = listTools()
      .map((t) => t.name)
      .sort();
    expect(registered).toEqual([...PRODUCTION_TOOL_NAMES].sort());
  });

  it('não há tools duplicadas nem faltantes na lista declarada', () => {
    const names = [...PRODUCTION_TOOL_NAMES];
    expect(new Set(names).size).toBe(names.length);
  });

  it('as declarações enviadas ao modelo cobrem exatamente a whitelist', () => {
    const declared = listToolDeclarations()
      .map((d) => d.name)
      .sort();
    expect(declared).toEqual([...PRODUCTION_TOOL_NAMES].sort());
  });

  it('toda tool declarada tem parameters JSON Schema do tipo object', () => {
    for (const decl of listToolDeclarations()) {
      expect(decl.parameters).toMatchObject({ type: 'object' });
    }
  });
});
