import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from './content-security-policy';

const SUPABASE = 'https://abcdefghijklmnop.supabase.co';

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';
}

describe('buildContentSecurityPolicy', () => {
  it('permite o Vercel Toolbar somente em Preview', () => {
    const policy = buildContentSecurityPolicy('preview', SUPABASE);

    expect(directive(policy, 'script-src')).toContain('https://vercel.live');
    expect(directive(policy, 'frame-src')).toContain('https://vercel.live');
    // O toolbar também abre WebSocket próprio; sem isto ele quebra em Preview.
    expect(directive(policy, 'connect-src')).toContain('wss://ws-us3.pusher.com');
  });

  it('não amplia a política de Production para vercel.live', () => {
    const policy = buildContentSecurityPolicy('production', SUPABASE);

    expect(policy).not.toContain('vercel.live');
    expect(policy).not.toContain('pusher.com');
    expect(directive(policy, 'frame-src')).not.toContain('vercel');
  });

  it('permite o SDK do Facebook usado pelo Embedded Signup', () => {
    const policy = buildContentSecurityPolicy('production', SUPABASE);

    // Script, XHR do SDK e o iframe de comunicação cross-domain: os três
    // precisam estar liberados ou a conexão do WhatsApp para de funcionar.
    expect(directive(policy, 'script-src')).toContain('https://connect.facebook.net');
    expect(directive(policy, 'connect-src')).toContain('https://graph.facebook.com');
    expect(directive(policy, 'frame-src')).toContain('https://staticxx.facebook.com');
  });
});

describe('fechamento dos canais de exfiltração (auditoria 2026-09-10, item 10)', () => {
  const policy = buildContentSecurityPolicy('production', SUPABASE);

  it('connect-src nomeia as origens em vez de aceitar https: genérico', () => {
    const connect = directive(policy, 'connect-src');

    // O achado: `https: wss:` permitia POST do prontuário para qualquer host.
    expect(connect).not.toMatch(/(?:^|\s)https:(?:$|\s)/);
    expect(connect).not.toMatch(/(?:^|\s)wss:(?:$|\s)/);
    expect(connect).toContain("'self'");
    expect(connect).toContain(SUPABASE);
    // Realtime é WebSocket no MESMO host do projeto.
    expect(connect).toContain('wss://abcdefghijklmnop.supabase.co');
  });

  it('img-src não aceita https: genérico — imagem também exfiltra', () => {
    const img = directive(policy, 'img-src');

    expect(img).not.toMatch(/(?:^|\s)https:(?:$|\s)/);
    expect(img).toContain("'self'");
    expect(img).toContain('data:');
    expect(img).toContain(SUPABASE);
  });

  it('script-src perdeu unsafe-eval', () => {
    // Medido: nenhum dos 161 chunks do build de produção usa eval/new Function.
    expect(directive(policy, 'script-src')).not.toContain('unsafe-eval');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('não libera o host de ingestão do Sentry: o browser sai pelo túnel', () => {
    // tunnelRoute '/monitoring' é same-origin. Liberar ingest.*.sentry.io
    // devolveria um destino de exfiltração — e o DSN é público.
    expect(policy).not.toContain('sentry.io');
  });

  it('mantém as diretivas estruturais que já valiam', () => {
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
  });

  it('URL de Supabase inválida não vira curinga', () => {
    // Fail-closed: a política sai sem a origem (app quebra visivelmente em dev)
    // em vez de ganhar `https:` de volta por um fallback silencioso.
    const broken = buildContentSecurityPolicy('production', 'nao-e-url');
    expect(directive(broken, 'connect-src')).toBe(
      "connect-src 'self' https://www.facebook.com https://graph.facebook.com",
    );
    expect(broken).not.toContain('*');
  });
});
