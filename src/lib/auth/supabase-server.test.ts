/**
 * Atributos do cookie de sessão (auditoria 2026-09-10, item 7).
 *
 * O que se prova aqui: os três atributos que decidem se a sessão é utilizável
 * cross-site ou legível por script param de depender do default do
 * `@supabase/ssr` e passam a ser afirmados por este repositório. O que NÃO se
 * prova: o comportamento do Auth real — isto é a montagem das opções.
 */
import { describe, expect, it, vi } from 'vitest';

import { hardenCookie } from './supabase-server';

vi.mock('server-only', () => ({}));

describe('hardenCookie', () => {
  it('força httpOnly e SameSite=Lax mesmo quando a biblioteca pede o contrário', () => {
    // O caso que importa: uma atualização (ou um caller distraído) pedindo
    // `sameSite: 'none'` tornaria a sessão utilizável em requisição cross-site.
    const hardened = hardenCookie({ httpOnly: false, sameSite: 'none' as const });

    expect(hardened.httpOnly).toBe(true);
    expect(hardened.sameSite).toBe('lax');
  });

  it('preserva tudo o que é política de sessão do provedor', () => {
    // Nome, path, domain, maxAge e a fragmentação .0/.1 são do Supabase.
    // Endurecer não é reescrever.
    const hardened = hardenCookie({ path: '/', maxAge: 3600, domain: 'exemplo.test' });

    expect(hardened).toMatchObject({ path: '/', maxAge: 3600, domain: 'exemplo.test' });
  });

  it('aceita opções ausentes sem produzir undefined', () => {
    expect(hardenCookie(undefined)).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('secure acompanha o ambiente, para não quebrar login em http://localhost', () => {
    // Em teste, NODE_ENV não é 'production' — cookie gravável em loopback.
    // Forçar secure sempre transformaria o login local num workaround.
    expect(hardenCookie({}).secure).toBe(false);
  });
});
