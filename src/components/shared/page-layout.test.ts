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
    ['/pacientes', 'data'],
    ['/financeiro', 'data'],
    ['/rota-futura', 'data'],
  ] as const)('classifica %s como %s', (pathname, expected) => {
    expect(resolvePageLayout(pathname)).toBe(expected);
  });

  /**
   * As três rotas que ficavam em 960px. Alinhá-las é o ponto: a régua da coluna
   * precisa ser a mesma de /dashboard e /pacientes em todas as abas da sidebar.
   */
  it.each(['/configuracoes', '/configuracoes/whatsapp', '/equipe', '/modelos-receita'])(
    'usa a mesma largura do resto do app em %s',
    (pathname) => {
      expect(resolvePageLayout(pathname)).toBe('data');
    },
  );
});
