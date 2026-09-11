/**
 * Fase 3 do endurecimento local — trava de cabeçalhos e de origem.
 *
 * O que este arquivo protege não é o estado ideal: é o estado ATUAL contra
 * regressão silenciosa. `next.config.ts` é lido como TEXTO de propósito —
 * importá-lo dispara a validação de env do produto e o plugin do Sentry, o que
 * transformaria um gate estático em teste de ambiente. A política em si é
 * exercitada pela função real (`buildContentSecurityPolicy`).
 *
 * Fora de escopo, e dito no relatório em vez de simulado aqui: o cabeçalho que
 * o deployment realmente devolve. Isto prova o que o repositório declara.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '../http/content-security-policy';

const config = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';
}

describe('gate: cabeçalhos de segurança não somem do next.config', () => {
  it('a CSP é BLOQUEANTE e não pode regredir para Report-Only', () => {
    // O gate pedido pela auditoria, na forma que ele só tem sentido depois de
    // 2026-09-10: Report-Only não bloqueia nada, então voltar a ele é desligar
    // a proteção sem remover uma linha de cabeçalho — a regressão mais fácil
    // de passar despercebida em review.
    expect(config, 'next.config deixou de declarar CSP').toContain(
      "key: 'Content-Security-Policy'",
    );
    expect(config, 'CSP voltou para Report-Only').not.toContain(
      'Content-Security-Policy-Report-Only',
    );
  });

  it('mantém os cabeçalhos bloqueantes que já existiam', () => {
    for (const [key, value] of [
      ['Strict-Transport-Security', 'max-age=63072000'],
      ['X-Frame-Options', 'DENY'],
      ['X-Content-Type-Options', 'nosniff'],
      ['Referrer-Policy', 'strict-origin-when-cross-origin'],
      ['Permissions-Policy', 'camera=()'],
    ] as const) {
      expect(config, `${key} sumiu ou foi enfraquecido`).toContain(`key: '${key}'`);
      expect(config, `${key} perdeu o valor esperado`).toContain(value);
    }
  });

  it('não deixa a superfície de Server Action aceitar origem coringa', () => {
    // `allowedOrigins` ausente = checagem nativa do Next contra o próprio host.
    // Declará-la com '*' (ou qualquer curinga) desliga a única defesa default
    // de CSRF de Server Action. O gate cobre as duas grafias de wildcard.
    const serverActions = /serverActions:\s*\{[^}]*\}/s.exec(config)?.[0] ?? '';
    expect(serverActions).not.toContain('allowedOrigins');
    for (const wildcard of ["'*'", '"*"', "'.*'", "'*.'"]) {
      expect(config, `origem coringa ${wildcard} em next.config`).not.toContain(
        `allowedOrigins: [${wildcard}`,
      );
    }
  });

  it('allowedDevOrigins continua restrita a loopback', () => {
    const dev = /allowedDevOrigins:\s*\[[^\]]*\]/s.exec(config)?.[0] ?? '';
    expect(dev, 'allowedDevOrigins sumiu do config').not.toBe('');
    const origins = [...dev.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(origins).toEqual(['127.0.0.1', 'localhost']);
  });
});

describe('gate: a política não pode afrouxar', () => {
  /** Projeto sintético: o gate não depende do `.env` de ninguém. */
  const SUPABASE = 'https://abcdefghijklmnop.supabase.co';

  for (const env of [undefined, 'production', 'preview'] as const) {
    const label = env ?? 'sem VERCEL_ENV';
    const policy = buildContentSecurityPolicy(env, SUPABASE);

    it(`[${label}] mantém as diretivas estruturais`, () => {
      // Estas cinco valem mesmo com 'unsafe-inline' em script-src: bloqueiam
      // reescrita de <base>, POST para fora, enquadramento e plugin legado.
      expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
      expect(directive(policy, 'form-action')).toBe("form-action 'self'");
      expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(directive(policy, 'object-src')).toBe("object-src 'none'");
      expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    });

    it(`[${label}] nenhuma diretiva volta a aceitar esquema genérico ou curinga`, () => {
      // Regressão principal do item 10: `connect-src https: wss:` e
      // `img-src https:` transformavam qualquer script em canal de
      // exfiltração. Nenhuma diretiva pode reintroduzir esquema solto.
      for (const name of [
        'default-src',
        'script-src',
        'frame-src',
        'object-src',
        'base-uri',
        'connect-src',
        'img-src',
        'font-src',
        'style-src',
      ]) {
        const value = directive(policy, name);
        expect(value, `${name} aceita curinga`).not.toMatch(/(?:^|\s)\*(?:$|\s)/);
        expect(value, `${name} aceita https: genérico`).not.toMatch(/(?:^|\s)https:(?:$|\s)/);
        expect(value, `${name} aceita wss: genérico`).not.toMatch(/(?:^|\s)wss:(?:$|\s)/);
        expect(value, `${name} aceita http: em claro`).not.toMatch(/(?:^|\s)http:/);
      }
      expect(directive(policy, 'script-src'), 'script-src aceita data:').not.toContain('data:');
      expect(policy, "'unsafe-eval' voltou").not.toContain('unsafe-eval');
    });

    it(`[${label}] só libera terceiros nomeados`, () => {
      const allowed = new Set([
        SUPABASE,
        'https://connect.facebook.net',
        'https://www.facebook.com',
        'https://web.facebook.com',
        'https://graph.facebook.com',
        'https://staticxx.facebook.com',
        // Preview-only (Vercel Toolbar).
        'https://vercel.live',
        'https://vercel.com',
        'https://sockjs-us3.pusher.com',
        'https://assets.vercel.com',
      ]);
      const externals = [...policy.matchAll(/https:\/\/[^\s;]+/g)].map((match) => match[0]);
      expect(externals.filter((origin) => !allowed.has(origin))).toEqual([]);
    });
  }

  it('vercel.live continua exclusivo de Preview', () => {
    expect(buildContentSecurityPolicy('production', SUPABASE)).not.toContain('vercel.live');
    expect(buildContentSecurityPolicy(undefined, SUPABASE)).not.toContain('vercel.live');
    expect(buildContentSecurityPolicy('preview', SUPABASE)).toContain('https://vercel.live');
  });
});

/**
 * A CSP e o túnel do Sentry são UM contrato, não duas configurações.
 *
 * `connect-src` não libera o host de ingestão do Sentry — o browser deve sair
 * pelo túnel same-origin (`tunnelRoute: '/monitoring'`). Só que o SDK **não**
 * tunela sempre: o código gerado no bundle de produção decide por
 * `host.match(/^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$/)` e, quando não
 * casa, envia direto para o DSN — que a CSP bloqueia.
 *
 * Isto foi observado, não deduzido: o build isolado usa um DSN canário em
 * loopback (que não casa o padrão) e o console do browser registrou o bloqueio.
 * Com o DSN real, o host casa e o túnel engata. Este gate impede que a próxima
 * troca de DSN — self-hosted, outra região, proxy — mate silenciosamente todo
 * o relato de erro do cliente.
 */
const SUPABASE_FOR_TUNNEL = 'https://abcdefghijklmnop.supabase.co';

describe('gate: CSP sem host do Sentry exige que o túnel engate', () => {
  const TUNNEL_HOST = /^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$/;

  it('next.config mantém tunnelRoute configurado', () => {
    expect(config, 'tunnelRoute sumiu: o browser passaria a sair direto').toContain(
      "tunnelRoute: '/monitoring'",
    );
  });

  it('o DSN embutido no cliente casa o padrão que ativa o túnel', () => {
    const client = fs.readFileSync(
      path.join(process.cwd(), 'src/instrumentation-client.ts'),
      'utf8',
    );
    const dsn = /https?:\/\/[^'"@\s]+@([^'"/\s]+)\//.exec(client)?.[1];
    expect(dsn, 'não foi possível ler o host do DSN em instrumentation-client.ts').toBeDefined();
    expect(
      TUNNEL_HOST.test(dsn ?? ''),
      `host ${dsn} não ativa o túnel; ou volte a um host o<id>.ingest[.<cc>].sentry.io, ou libere-o em connect-src assumindo o destino de exfiltração`,
    ).toBe(true);
  });

  it('a política continua sem liberar sentry.io', () => {
    // Se um dia liberar, esta linha cai junto — e a decisão fica explícita.
    expect(buildContentSecurityPolicy('production', SUPABASE_FOR_TUNNEL)).not.toContain(
      'sentry.io',
    );
  });
});
