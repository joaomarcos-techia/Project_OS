import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderSignupCodeEmail } from './signup-code';

describe('renderSignupCodeEmail', () => {
  it('substitui o nome no cabeçalho pela logo SVG original, com imagem alternativa', () => {
    const { html } = renderSignupCodeEmail('12345678');
    const dataUrl = html.match(/<source type="image\/svg\+xml" srcset="([^"]+)"/u)?.[1];
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/u);
    if (!dataUrl) throw new Error('SVG logo source is missing');
    const encodedSvg = dataUrl.slice('data:image/svg+xml;base64,'.length);
    const svg = Buffer.from(encodedSvg, 'base64').toString('utf8');
    const component = readFileSync(path.resolve('src/components/shared/logo.tsx'), 'utf8');
    const svgPaths = [...svg.matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1]);
    const componentPaths = [...component.matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1]);
    expect(svgPaths).toEqual(componentPaths);
    expect(svgPaths).toHaveLength(6);
    expect(svg).toContain('viewBox="0 0 2411 857"');
    expect(svg).toContain('aria-label="Qoro"');
    expect(html).toContain('<picture>');
    expect(html).toContain('logo_master_blaster_powerrr.png');
    expect(html).toContain('alt="Qoro"');
    expect(html).not.toContain('font-size:26px">Qoro</p>');
  });

  it('preserva assunto, código, prazo e alternativa de texto do envio atual', () => {
    const { html, text, subject } = renderSignupCodeEmail('01234567');
    expect(subject).toBe('Seu código de confirmação — Qoro');
    expect(text).toMatch(/^01234567\n\n/u);
    expect(html.match(/01234567/gu)).toHaveLength(1);
    expect(text).toContain('10 minutos');
    expect(html).toContain('10 minutos');
    expect(text).toContain('Você continuará de onde parou.');
    expect(html).toContain('Você continuará de onde parou.');
    expect(html).not.toMatch(/<script|javascript:|token_hash|\{\{/iu);
  });

  it.each(['1234567', '123456789', '<script>', 'abcdefgh', '１２３４５６７８', '1234 5678'])(
    'recusa código inválido sem interpolar no HTML: %s',
    (code) => expect(() => renderSignupCodeEmail(code)).toThrow('invalid signup code'),
  );
});
