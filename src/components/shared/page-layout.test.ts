import { describe, expect, it } from 'vitest';

import { resolvePageLayout } from './page-layout';

describe('resolvePageLayout', () => {
  it.each([
    ['/agenda', 'workspace'],
    ['/agenda/ausencias', 'workspace'],
    ['/consultorio', 'workspace'],
    ['/conversas/thread-1', 'workspace'],
    ['/pacientes/patient-1', 'read'],
    ['/pacientes/patient-1/prontuarios/record-1', 'read'],
    ['/configuracoes/whatsapp', 'form'],
    ['/equipe', 'form'],
    ['/modelos-receita', 'form'],
    ['/pacientes', 'data'],
    ['/financeiro', 'data'],
    ['/rota-futura', 'data'],
  ] as const)('classifica %s como %s', (pathname, expected) => {
    expect(resolvePageLayout(pathname)).toBe(expected);
  });
});
