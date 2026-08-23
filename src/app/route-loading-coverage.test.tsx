// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AgendaImportLoading from './(app)/(shell)/agenda/importar/loading';
import AssinaturaLoading from './(app)/(shell)/configuracoes/assinatura/loading';
import ConfiguracoesLoading from './(app)/(shell)/configuracoes/loading';
import ProcedimentosLoading from './(app)/(shell)/configuracoes/procedimentos/loading';
import RecursosLoading from './(app)/(shell)/configuracoes/recursos/loading';
import SugestoesLoading from './(app)/(shell)/configuracoes/sugestoes/loading';
import FornecedoresLoading from './(app)/(shell)/financeiro/fornecedores/loading';
import ModelosReceitaLoading from './(app)/(shell)/modelos-receita/loading';

afterEach(cleanup);

type SkeletonVariant = 'cards' | 'detail' | 'list' | 'table';

const COVERAGE: Array<{
  route: string;
  source: string;
  variant: SkeletonVariant;
  Loading: ComponentType;
}> = [
  {
    route: '/modelos-receita',
    source: '(app)/(shell)/modelos-receita/loading.tsx',
    variant: 'table',
    Loading: ModelosReceitaLoading,
  },
  {
    route: '/configuracoes',
    source: '(app)/(shell)/configuracoes/loading.tsx',
    variant: 'list',
    Loading: ConfiguracoesLoading,
  },
  {
    route: '/configuracoes/assinatura',
    source: '(app)/(shell)/configuracoes/assinatura/loading.tsx',
    variant: 'cards',
    Loading: AssinaturaLoading,
  },
  {
    route: '/configuracoes/procedimentos',
    source: '(app)/(shell)/configuracoes/procedimentos/loading.tsx',
    variant: 'table',
    Loading: ProcedimentosLoading,
  },
  {
    route: '/configuracoes/recursos',
    source: '(app)/(shell)/configuracoes/recursos/loading.tsx',
    variant: 'table',
    Loading: RecursosLoading,
  },
  {
    route: '/configuracoes/sugestoes',
    source: '(app)/(shell)/configuracoes/sugestoes/loading.tsx',
    variant: 'detail',
    Loading: SugestoesLoading,
  },
  {
    route: '/agenda/importar',
    source: '(app)/(shell)/agenda/importar/loading.tsx',
    variant: 'detail',
    Loading: AgendaImportLoading,
  },
  {
    route: '/financeiro/fornecedores',
    source: '(app)/(shell)/financeiro/fornecedores/loading.tsx',
    variant: 'table',
    Loading: FornecedoresLoading,
  },
];

describe('P-15/P-35 — cobertura de loading por anatomia', () => {
  it.each(COVERAGE)(
    '$route usa PageSkeleton/$variant e não duplica markup de skeleton',
    (entry) => {
      const source = readFileSync(resolve(process.cwd(), 'src/app', entry.source), 'utf8');

      expect(source).toContain("import { PageSkeleton } from '@/components/ui/page-skeleton'");
      expect(source).toContain(`<PageSkeleton variant="${entry.variant}" />`);
      expect(source).not.toContain('<Skeleton');
    },
  );

  it.each(COVERAGE)('$route anuncia carregamento para tecnologia assistiva', ({ Loading }) => {
    const { container, unmount } = render(<Loading />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    unmount();
  });
});
