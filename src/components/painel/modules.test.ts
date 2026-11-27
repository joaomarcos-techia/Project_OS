import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import { MODULES, visibleModuleIds } from './modules';

const SHELL = path.join(process.cwd(), 'src/app/(app)/(shell)');

/**
 * Onde cada página decide se abre. A Agenda decide no loader, as demais na
 * própria página.
 */
const GATE_SOURCE: Record<string, string> = {
  agenda: 'agenda/data.ts',
  consultorio: 'consultorio/page.tsx',
  pacientes: 'pacientes/page.tsx',
  documentos: 'documentos/page.tsx',
  financeiro: 'financeiro/page.tsx',
  caixa: 'caixa/page.tsx',
  conversas: 'conversas/page.tsx',
  equipe: 'equipe/page.tsx',
};

const permissionKey = (value: string) =>
  Object.entries(PERMISSIONS).find(([, permission]) => permission === value)?.[0];

describe('menu espelha o gate de cada página', () => {
  it.each(MODULES.filter((module) => module.requires).map((module) => [module.id, module]))(
    '%s pede a mesma permissão que a página',
    (id, module) => {
      const file = GATE_SOURCE[id];
      expect(file, `sem fonte de gate mapeada para ${id}`).toBeTruthy();
      const source = readFileSync(path.join(SHELL, file!), 'utf8');
      expect(source).toContain(`PERMISSIONS.${permissionKey(module.requires!)}`);
    },
  );

  it('toda página com gate mapeado tem `requires` no menu', () => {
    for (const id of Object.keys(GATE_SOURCE)) {
      expect(MODULES.find((module) => module.id === id)?.requires, id).toBeTruthy();
    }
  });
});

describe('visibleModuleIds', () => {
  it('sem permissão nenhuma, sobram os destinos abertos a todos', () => {
    expect(visibleModuleIds([], false)).toEqual(['dashboard', 'relatorios', 'config', 'ajuda']);
  });

  it('cada permissão libera só os seus módulos', () => {
    expect(visibleModuleIds([PERMISSIONS.VIEW_FINANCIAL], false)).toEqual([
      'dashboard',
      'financeiro',
      'caixa',
      'relatorios',
      'config',
      'ajuda',
    ]);
  });

  it('super_admin com AAL2 vê o menu inteiro, como no pageGate', () => {
    expect(visibleModuleIds([], true)).toEqual(MODULES.map((module) => module.id));
  });

  it('mantém a ordem do menu', () => {
    const all = Object.values(PERMISSIONS);
    expect(visibleModuleIds(all, false)).toEqual(MODULES.map((module) => module.id));
  });
});
