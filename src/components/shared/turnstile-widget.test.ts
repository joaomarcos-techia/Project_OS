import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSiteKey } from './turnstile-widget';

/**
 * A regra de resolução da site key existe DUPLICADA no cliente (aqui) e no
 * servidor (`normalizeDevelopmentAliases`, em `src/lib/env.ts`), porque o
 * bundle do cliente nunca passa pelo `env.ts` — o Next inlina
 * `process.env.NEXT_PUBLIC_*` no build.
 *
 * Estes testes são o que impede as duas metades de divergirem em silêncio. Os
 * equivalentes do servidor estão em `src/lib/env.test.ts`, com os mesmos casos.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolução da site key no cliente', () => {
  it('fora de produção: _LOCAL vence _DEV, que vence o canônico', () => {
    // `localhost` e `*.vercel.app` são hostnames DIFERENTES na Cloudflare. Usar
    // a chave errada faz o Turnstile simplesmente não rodar: sem iframe, sem
    // token e sem callback de erro — o sintoma é indistinguível de "ainda
    // carregando". Custou uma hora de diagnóstico em 13/09.
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'canonica');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV', 'de-homologacao');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL', 'de-localhost');

    expect(resolveSiteKey()).toBe('de-localhost');
  });

  it('fora de produção, sem _LOCAL: cai no _DEV', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'canonica');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV', 'de-homologacao');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL', '');

    expect(resolveSiteKey()).toBe('de-homologacao');
  });

  it('fora de produção, sem alias nenhum: usa a canônica', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'canonica');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL', '');

    expect(resolveSiteKey()).toBe('canonica');
  });

  it('em produção NENHUM alias é lido — mesma regra do servidor', () => {
    // A Vercel constrói o PREVIEW com NODE_ENV=production. Se o cliente lesse
    // `_DEV` aqui e o servidor não, um Preview passaria a verificar o token com
    // um par de chaves incoerente: site key de um widget, secret de outro. O
    // erro seria `invalid-input-response` — que parece ataque, e é configuração.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'canonica');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV', 'de-homologacao');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL', 'de-localhost');

    expect(resolveSiteKey()).toBe('canonica');
  });

  it('sem chave nenhuma devolve undefined — o widget não renderiza nada', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL', '');

    expect(resolveSiteKey()).toBeFalsy();
  });
});
