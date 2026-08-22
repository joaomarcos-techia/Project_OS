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
});
