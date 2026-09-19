import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_ENV_ALIASES } from './env-aliases';

/**
 * A tabela de aliases já foi copiada em dois arquivos e divergiu — as chaves do
 * Turnstile entraram no `env.ts` e não no `scripts/_env.ts`, o que faria um
 * script local usar a chave de PRODUÇÃO em silêncio. Estes testes existem para
 * que isso não volte.
 */
describe('tabela de aliases de desenvolvimento', () => {
  const canonicos: string[] = DEVELOPMENT_ENV_ALIASES.map(([c]) => c);
  const aliases: string[] = DEVELOPMENT_ENV_ALIASES.flatMap(([, ...rest]) => rest);

  it('não tem entrada duplicada nem alias repetido', () => {
    expect(new Set(canonicos).size, 'nome canônico repetido').toBe(canonicos.length);
    expect(new Set(aliases).size, 'alias repetido').toBe(aliases.length);
  });

  it('nenhum alias colide com um nome canônico', () => {
    // `FOO_DEV` que também fosse canônico de outra entrada criaria promoção
    // dependente da posição na lista — comportamento que ninguém consegue prever
    // lendo o `.env.local`.
    const canonicosSet = new Set(canonicos);
    for (const alias of aliases) {
      expect(canonicosSet.has(alias), `${alias} é alias e canônico ao mesmo tempo`).toBe(false);
    }
  });

  it('toda entrada tem pelo menos um alias', () => {
    // Entrada só com o canônico não promove nada — é linha morta que parece
    // configuração.
    for (const entrada of DEVELOPMENT_ENV_ALIASES) {
      expect(entrada.length, `${entrada[0]} não tem alias`).toBeGreaterThan(1);
    }
  });

  it('os dois consumidores usam a tabela, e nenhum mantém lista própria', () => {
    // Checagem de TEXTO de propósito: o que se quer impedir é alguém acrescentar
    // um par "só aqui" de novo. Um teste de comportamento não pegaria isso —
    // passaria feliz com duas listas coerentes por coincidência.
    const raiz = process.cwd();
    const consumidores = ['src/lib/env.ts', 'scripts/_env.ts'];

    for (const arquivo of consumidores) {
      const fonte = readFileSync(path.join(raiz, arquivo), 'utf8');
      expect(fonte, `${arquivo} não importa a tabela compartilhada`).toContain(
        'DEVELOPMENT_ENV_ALIASES',
      );
      // Um par literal `['FOO', 'FOO_DEV']` no arquivo significa lista própria.
      expect(fonte, `${arquivo} voltou a declarar pares próprios`).not.toMatch(
        /\[\s*'[A-Z0-9_]+'\s*,\s*'[A-Z0-9_]+_DEV'\s*\]/u,
      );
    }
  });

  /** Aliases de um canônico, na ordem declarada (que é a de precedência). */
  const aliasesDe = (canonico: string): string[] =>
    DEVELOPMENT_ENV_ALIASES.find(([c]) => c === canonico)?.slice(1) ?? [];

  it('promove SUPER_ADMIN_EMAIL/PASSWORD — a conta de dev não pode virar a de prod', () => {
    // `seed-super-admin` promove um e-mail a super_admin. Sem o alias, o mesmo
    // nome canônico serve dev e produção no mesmo `.env.local`, e um `pnpm
    // seed:super-admin` distraído promove a conta errada.
    expect(aliasesDe('SUPER_ADMIN_EMAIL')).toEqual(['SUPER_ADMIN_EMAIL_DEV']);
    expect(aliasesDe('SUPER_ADMIN_PASSWORD')).toEqual(['SUPER_ADMIN_PASSWORD_DEV']);
  });

  it('Turnstile tem TRÊS níveis, e _LOCAL vem antes de _DEV', () => {
    // A ordem é a precedência. Invertê-la mandaria o localhost usar a chave de
    // homologação, e o Turnstile não roda com hostname trocado — falha muda.
    expect(aliasesDe('NEXT_PUBLIC_TURNSTILE_SITE_KEY')).toEqual([
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV',
    ]);
    expect(aliasesDe('TURNSTILE_SECRET_KEY')).toEqual([
      'TURNSTILE_SECRET_KEY_LOCAL',
      'TURNSTILE_SECRET_KEY_DEV',
    ]);
  });
});
