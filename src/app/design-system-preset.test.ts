import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'components.json'), 'utf8'),
) as Record<string, unknown>;

describe('preset shadcn b5J5Qtmtc integrado de forma controlada', () => {
  it('configura Nova/Radix, zinc e Lucide sem duplicar o helper cn', () => {
    expect(config).toMatchObject({
      style: 'radix-nova',
      iconLibrary: 'lucide',
      tailwind: { css: 'src/app/globals.css', baseColor: 'zinc', cssVariables: true },
      aliases: { utils: '@/lib/ui/cn', ui: '@/components/ui' },
      menuColor: 'default',
      menuAccent: 'subtle',
    });
  });

  it('aplica os tokens exatos de blue, zinc, sky e radius medium', () => {
    expect(css).toContain('--primary: oklch(0.488 0.243 264.376);');
    expect(css).toContain('--primary: oklch(0.424 0.199 265.638);');
    expect(css).toContain('--foreground: oklch(0.141 0.005 285.823);');
    expect(css).toContain('--chart-1: oklch(0.828 0.111 230.318);');
    expect(css).toContain('--chart-5: oklch(0.443 0.11 240.79);');
    expect(css).toContain('--radius: 0.625rem;');
  });

  it('separa o accent neutro do orchid reservado à IA', () => {
    expect(css).toContain('--accent: oklch(0.967 0.001 286.375);');
    expect(css).toContain('--brand-accent-500: oklch(0.64 0.188 321);');
    expect(css).toContain('--ai: var(--brand-accent-600);');
    expect(css).not.toMatch(/--accent-(?:50|100|200|300|400|500|600|700|800):/u);
  });

  it('preserva DM Sans no admin e disponibiliza as fontes da referência para o tenant', () => {
    expect(layout).toContain('DM_Sans');
    expect(layout).toContain("variable: '--font-dm-sans'");
    expect(layout).toContain('IBM_Plex_Mono');
    expect(layout).toContain('Hanken_Grotesk');
    expect(layout).toContain("variable: '--font-hanken'");
    expect(layout).toContain("variable: '--font-inter'");
    expect(css).toContain('--font-heading: var(--font-sans);');
  });
});
