import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const css = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:css|tsx?)$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}

describe('fundação de movimento e alvos de interação', () => {
  it('não usa transition-all nem transition: all no código de interface', () => {
    const broadTransition = /(?:\btransition-all\b|\btransition\s*:\s*all(?:\s|;))/u;
    expect(broadTransition.test('transition-all')).toBe(true);
    expect(broadTransition.test('transition: all 180ms ease;')).toBe(true);

    const offenders = sourceFiles(resolve(root, 'src/app'))
      .concat(sourceFiles(resolve(root, 'src/components')))
      .filter((path) => broadTransition.test(readFileSync(path, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('reduz animações e rolagem quando o sistema operacional solicita', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important;');
    expect(css).toContain('transition-duration: 0.01ms !important;');
    expect(css).toContain('scroll-behavior: auto !important;');
  });

  it('mantém 40 px no desktop e 44 px em ponteiros de toque', () => {
    expect(css).toContain('--hit-target: 40px;');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('--hit-target: 44px;');

    for (const path of [
      'src/components/ui/table-pager.tsx',
      'src/components/ui/dialog.tsx',
      'src/components/ui/drawer.tsx',
      'src/components/shared/shell-chrome.tsx',
    ]) {
      expect(readFileSync(resolve(root, path), 'utf8')).toContain('--hit-target');
    }

    const button = readFileSync(resolve(root, 'src/components/ui/button.tsx'), 'utf8');
    const input = readFileSync(resolve(root, 'src/components/ui/input.tsx'), 'utf8');
    expect(button).toContain('h-(--control-h) min-h-(--hit-target)');
    expect(input).toContain('h-(--control-h) min-h-(--hit-target)');

    for (const path of ['src/components/ui/checkbox.tsx', 'src/components/ui/switch.tsx']) {
      const source = readFileSync(resolve(root, path), 'utf8');
      expect(source).toContain('relative');
      expect(source).toContain('before:size-(--hit-target)');
      expect(source).toContain("before:content-['']");
    }
  });

  // UX-018 (docs/otimização_ui_final.md): os links legais do login tinham 19,5 px.
  it('dá 24 px de alvo aos links do rodapé do login', () => {
    const loginCss = readFileSync(
      resolve(root, 'src/components/shared/login-frame.module.css'),
      'utf8',
    );
    const regra = loginCss.match(/\.foot a \{[^}]*\}/)?.[0] ?? '';
    expect(regra).toContain('min-height: 24px');
    expect(regra).toContain('display: inline-flex');
    // Ciclo 3: o "Criar conta" do topo (23 px na sonda do Preview) ganhou o mesmo alvo.
    const topo = loginCss.match(/\.top p a \{[^}]*\}/)?.[0] ?? '';
    expect(topo).toContain('min-height: 24px');
    expect(topo).toContain('display: inline-flex');
  });

  // UX-021: no celular as ações ficam na linha do nome da tela, antes da busca (ordem 1).
  it('põe as ações do cabeçalho na linha do nome da tela abaixo de 720 px', () => {
    // O bloco de 720 px que reorganiza o cabeçalho (há outros blocos de 720 px no arquivo).
    const inicio = css.lastIndexOf('@media (max-width: 720px)', css.indexOf('UX-021 (17/11/2026)'));
    expect(inicio).toBeGreaterThan(-1);
    const bloco = css.slice(inicio);
    const regra = bloco.match(/\[data-slot='page-header-actions'\] \{[^}]*\}/u)?.[0] ?? '';
    expect(regra).toContain('order: 1;');
    const busca = bloco.match(/\[data-slot='page-header-search'\] \{[^}]*\}/u)?.[0] ?? '';
    expect(busca).toContain('order: 2;');
  });
});
