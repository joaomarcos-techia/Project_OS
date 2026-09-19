import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Gate mecânico do Design System Contract (docs/design/CONTRACT.md).
 *
 * Cobre o que dá para verificar sozinho — token, escala, duplicata. NÃO cobre
 * qualidade visual: conformidade técnica é o piso, não o teto (Contract §4).
 *
 * Fora da varredura, tudo por escopo declarado no plano: `/admin` (console
 * separado), telas de auth e onboarding, e PDFs — `@react-pdf/renderer` não lê
 * CSS custom property e precisa de cor literal.
 */
const OUT_OF_SCOPE = ['admin', 'login', 'join', 'convite', 'reset-password', 'auth'];
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

const IN_SCOPE = walk('src/components')
  .concat(walk(join('src', 'app', '(app)')))
  .filter((f) => !f.split(sep).some((s) => OUT_OF_SCOPE.includes(s)) && !/pdf/iu.test(f))
  .map((f) => ({
    path: relative(process.cwd(), f).split(sep).join('/'),
    src: readFileSync(f, 'utf8'),
  }));

describe('Design System Contract — tokens', () => {
  it('varre um conjunto de arquivos não vazio', () => {
    // Sem isto, um erro no walk faria os testes abaixo passarem sem olhar nada.
    expect(IN_SCOPE.length).toBeGreaterThan(80);
  });

  it('zero cor hardcoded', () => {
    const offenders = IN_SCOPE.filter(({ src }) =>
      /(?<!&)#[0-9a-fA-F]{3,8}\b|\brgba?\(/u.test(src),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('zero tipografia arbitrária em px', () => {
    const offenders = IN_SCOPE.filter(({ src }) => /text-\[[0-9.]+px\]/u.test(src)).map(
      ({ path }) => path,
    );
    expect(offenders).toEqual([]);
  });

  it('zero quarter-step de espaçamento fora da escala', () => {
    const rx =
      /(?<![\w.-])(?:gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|size|h|w)-\d+\.(?:25|75)(?![\w.])/u;
    const offenders = IN_SCOPE.filter(({ src }) => rx.test(src)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('não reintroduz o font-mono em rótulo ou numeral de KPI', () => {
    const kpi = IN_SCOPE.find(({ path }) => path.endsWith('components/ui/stat-card.tsx'));
    expect(kpi?.src).not.toContain('font-mono');
  });
});

describe('Design System Contract — sem duplicata', () => {
  it('o Metric local do caixa não voltou', () => {
    const caixa = IN_SCOPE.find(({ path }) => path.endsWith('caixa/caixa-view.tsx'));
    expect(caixa?.src).not.toMatch(/^function Metric\(/mu);
  });

  it('nenhuma tela monta a própria moldura de tabela paginada', () => {
    // `TableFoot` + `TablePager` juntos numa página é o cerco que o DataTable
    // existe para resolver; se voltar, a contagem volta a divergir por rota.
    const offenders = IN_SCOPE.filter(
      ({ path, src }) =>
        path.startsWith('src/app/') && src.includes('<TableFoot') && src.includes('<TablePager'),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
