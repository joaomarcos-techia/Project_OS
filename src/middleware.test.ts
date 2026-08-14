/**
 * Middleware — o que sobrou depois do ADR-037.
 *
 * O teste anterior congelava `isSupabaseAuthCookie` (F-06: o heal precisava apagar
 * TODOS os fragmentos do cookie `sb-…-auth-token`). Esse predicado e o heal inteiro
 * foram DELETADOS: a revogação virou responsabilidade da porta única, que confere o
 * epoch por request. Não sobrou nada para o predicado guardar — teste de código
 * morto é dívida, não cobertura.
 *
 * O que passa a ser testado é o `matcher`, que é a única regra de verdade que
 * sobrou aqui — e a que JÁ quebrou produção: incluir `api/webhooks` fazia o
 * middleware de sessão responder 307 → /login para o webhook do Asaas/Meta, que
 * não tem sessão nenhuma.
 */
import { describe, expect, it } from 'vitest';

import { config } from './middleware';

/** Reproduz o casamento que o Next faz com `config.matcher`. */
function runsMiddlewareOn(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe('matcher — rotas que NÃO podem passar pelo middleware de sessão', () => {
  it.each([
    ['/api/webhooks/asaas', 'webhook: autentica por assinatura do provider, não tem sessão'],
    ['/api/webhooks/meta', 'idem'],
    ['/api/cron/outbox', 'cron: autentica por Bearer CRON_SECRET'],
    ['/api/health', 'healthcheck: precisa responder sem sessão'],
    ['/login', 'senão o redirect para /login vira loop'],
    ['/reset-password', 'destino do link de recovery — pré-sessão'],
    ['/auth/confirm', 'troca token_hash→sessão server-side — pré-sessão'],
    ['/auth/auth-error', 'tela de erro dos links de e-mail — pré-sessão'],
    ['/convite', 'aceite de convite: sessão sem claims (Hook deny-by-default)'],
    ['/join', 'onboarding público: não há sessão até o owner existir'],
    ['/join/abc123', 'compatibilidade temporária dos convites legados'],
    ['/auth/callback', 'troca de code por sessão'],
    ['/account/security', 'super_admin em AAL1 precisa chegar aqui para cadastrar o TOTP'],
    ['/monitoring', 'tunnelRoute do Sentry — interceptar quebra o report do client'],
    ['/favicon.ico', 'estático'],
    ['/_next/static/chunk.js', 'estático'],
  ])('%s é excluída (%s)', (path) => {
    expect(runsMiddlewareOn(path)).toBe(false);
  });
});

describe('matcher — rotas que PRECISAM do refresh de sessão', () => {
  it.each([
    ['/dashboard'],
    ['/pacientes'],
    ['/pacientes/123/prontuarios/456'],
    ['/equipe'],
    ['/admin'],
    ['/admin/clinicas'],
    ['/'],
  ])('%s passa pelo middleware', (path) => {
    expect(runsMiddlewareOn(path)).toBe(true);
  });

  it('/api que não é cron/webhook/health continua passando', () => {
    // Não é descuido: essas rotas TÊM sessão e dependem do refresh de cookie.
    expect(runsMiddlewareOn('/api/admin/algo')).toBe(true);
  });
});

describe('ADR-037 — o heal saiu de vez', () => {
  it('o módulo não exporta mais nada do heal (_healed / drift / cookie predicate)', async () => {
    const mod = await import('./middleware');
    expect(Object.keys(mod).sort()).toEqual(['config', 'middleware']);
  });

  it('o código-fonte não menciona mais os cookies do heal', async () => {
    // Guarda contra reintrodução silenciosa: se alguém trouxer `_healed` de volta,
    // traz junto a superfície forjável que o I-7 descreve.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8');
    const code = src.slice(src.indexOf('import {')); // ignora o docblock, que EXPLICA o histórico
    expect(code).not.toMatch(/_healed|_claim_check_at|claims_version/);
  });
});
