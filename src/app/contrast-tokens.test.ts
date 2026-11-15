import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
  A-01 (docs/otimização_ui_final.md, 33): o Badge e o Alert âmbar escrevem `--warning-700` sobre
  `--warning-50`. O par tem de passar o AA de texto pequeno (4,5:1) no `:root` (fora do shell) e nos
  tokens do shell v5, claro e escuro. O contraste é calculado do próprio `globals.css`.
*/
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Último bloco de nível 0 com o seletor que define o token: é o que vale na cascata. */
function block(selector: string, name = '--warning-700'): string {
  const header = `\n${selector} {`;
  let found: string | null = null;
  for (let at = css.indexOf(header); at >= 0; at = css.indexOf(header, at + 1)) {
    const body = css.slice(at, css.indexOf('\n}', at + 1));
    if (body.includes(`${name}:`)) found = body;
  }
  if (!found) throw new Error(`${name} ausente em ${selector}`);
  return found;
}

function token(source: string, name: string): string {
  const match = new RegExp(`${name}:([^;]+);`).exec(source);
  if (!match) throw new Error(`token ausente: ${name}`);
  return match[1]!.trim();
}

/** sRGB linear (0–1) de `#rrggbb` ou `oklch(L C h)`. */
function linearRgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const channels = hex[1]!.match(/../g)!.map((pair) => parseInt(pair, 16) / 255);
    return channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
      number,
      number,
      number,
    ];
  }
  const oklch = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (!oklch) throw new Error(`cor não suportada: ${value}`);
  const [L, C, h] = oklch.slice(1).map(Number) as [number, number, number];
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const [r, g, b] = linearRgb(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe('contraste dos tokens âmbar (A-01)', () => {
  it.each([
    [':root', ':root'],
    ['shell v5 claro', "body:has([data-qoro-tokens='app-v5'])"],
    ['shell v5 escuro', ".dark body:has([data-qoro-tokens='app-v5'])"],
  ])('%s: --warning-700 sobre --warning-50 passa 4,5:1', (_label, selector) => {
    const source = block(selector);
    const ratio = contrast(token(source, '--warning-700'), token(source, '--warning-50'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('a conversão reproduz o valor reprovado antes da correção', () => {
    expect(contrast('oklch(0.56 0.11 58)', 'oklch(0.974 0.03 84)')).toBeLessThan(4.5);
    expect(contrast('#7a4a00', '#fff3d6')).toBeGreaterThan(6.7);
  });
});
