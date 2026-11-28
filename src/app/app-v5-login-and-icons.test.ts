import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(file), 'utf8');
const css = read('src/app/globals.css');

function iconMotionBlock(): string {
  const start = css.indexOf('Microanimação dos ícones');
  const end = css.indexOf('@keyframes qoro-icon-pop');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('microanimação dos ícones', () => {
  it('só dispara com movimento permitido', () => {
    const block = iconMotionBlock();
    const media = block.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(media).toBeGreaterThan(-1);
    // Fora do @media ficam só as variáveis: nenhuma regra liga a animação antes.
    expect(block.slice(0, media)).not.toMatch(/^\s*animation\s*:/mu);
    expect(block.slice(media)).toMatch(/animation:\s*var\(--icon-motion/u);
  });

  it('não sobrescreve ícone que já gira nem controle desabilitado', () => {
    const block = iconMotionBlock();
    expect(block).toContain(":not(.animate-spin, [class*='lucide-loader'])");
    expect(block).toContain(":not(:disabled, [aria-disabled='true'])");
  });

  it('todo ícone tem animação, mesmo sem família própria', () => {
    expect(iconMotionBlock()).toContain('var(--icon-motion, qoro-icon-pop)');
  });

  it('não vale no admin: só no app da clínica e no login', () => {
    const block = iconMotionBlock();
    expect(block).toContain(
      ":is(body:has([data-qoro-shell='tenant']), body:has([data-qoro-tokens='app-v5']))",
    );
  });

  it('cada família usada tem o keyframe declarado', () => {
    const used = new Set([...iconMotionBlock().matchAll(/--icon-motion:\s*(qoro-icon-[a-z-]+)/gu)]);
    expect(used.size).toBeGreaterThan(10);
    for (const [, name] of used) expect(css).toContain(`@keyframes ${name} {`);
  });
});

describe('telas públicas no design atual', () => {
  it('a moldura pública traz os tokens do app', () => {
    expect(read('src/components/shared/signup-frame.tsx')).toContain('data-qoro-tokens="app-v5"');
  });

  it.each([
    'src/app/(app)/cadastro/page.tsx',
    'src/app/(app)/cadastro/plano/page.tsx',
    'src/app/(app)/cadastro/continuar/page.tsx',
    'src/app/(app)/cadastro/confirmado/page.tsx',
    'src/app/(app)/cadastro/pagamento/page.tsx',
    'src/app/(app)/cadastro/verificacao/page.tsx',
  ])('%s usa a moldura pública, sem os tokens de setembro', (file) => {
    const source = read(file);
    expect(source).toContain('<PublicPage>');
    expect(source).not.toContain('qorov2');
  });

  it.each(['src/app/(app)/login/page.tsx', 'src/app/(app)/login/mfa/page.tsx'])(
    '%s usa a tela dividida do login',
    (file) => {
      expect(read(file)).toContain('<LoginFrame');
    },
  );

  it('os tokens do app também alcançam o marcador do login, em claro e escuro', () => {
    expect(css).toMatch(/body:has\(\[data-qoro-tokens='app-v5'\]\) \{\s*\/\* Superfícies \*\//u);
    expect(css).toMatch(/\.dark body:has\(\[data-qoro-tokens='app-v5'\]\) \{\s*--shell-bg/u);
  });
});
