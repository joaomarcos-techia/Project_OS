/**
 * O journal é a LISTA DE EMBARQUE das migrations — e ela pode divergir dos arquivos.
 *
 * Aconteceu nesta branch: `0103_signup_billing_attempt` e `0104_onboarding_progress`
 * foram escritas à mão (sem `drizzle-kit generate`) e o `meta/_journal.json` ficou
 * parado na 0102. Os dois arquivos estavam commitados, o `check:migrations` passava
 * — ele varre `*.sql`, não o journal —, a suíte estava verde e o CI também. Mesmo
 * assim, `pnpm db:migrate:dev` e `db:migrate:prod` aplicariam 103 migrations e
 * PULARIAM as duas, em silêncio, porque o migrator do drizzle lê o journal e não o
 * diretório.
 *
 * Um schema que existe no repositório e não existe no banco é pior do que uma
 * migration que falha: o código sobe acreditando na tabela, e a descoberta vem em
 * runtime, no ambiente mais caro possível. Era exatamente essa a causa do
 * `500 em /dashboard` no Preview.
 *
 * Este teste é a paridade que faltava. Ele não substitui o `check:migrations`
 * (aquele olha o CONTEÚDO, procurando operações destrutivas); olha a LISTA.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = resolve(process.cwd(), 'drizzle/migrations');

type Entrada = { idx: number; version: string; when: number; tag: string };

const journal = JSON.parse(readFileSync(resolve(DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: Entrada[];
};

const arquivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/u, ''))
  .sort();

const tags = journal.entries.map((e) => e.tag).sort();

describe('paridade entre drizzle/migrations/*.sql e meta/_journal.json', () => {
  it('toda migration em disco está no journal (senão o migrator a ignora)', () => {
    const ausentes = arquivos.filter((a) => !tags.includes(a));
    expect(ausentes, `migrations fora do journal: ${ausentes.join(', ')}`).toEqual([]);
  });

  it('toda entrada do journal tem arquivo em disco (senão o migrator quebra)', () => {
    const orfas = tags.filter((t) => !arquivos.includes(t));
    expect(orfas, `entradas sem arquivo: ${orfas.join(', ')}`).toEqual([]);
  });

  it('o `idx` da entrada casa com o prefixo numérico do arquivo', () => {
    const divergentes = journal.entries
      .filter((e) => e.idx !== Number(e.tag.slice(0, 4)))
      .map((e) => `${e.idx} != ${e.tag}`);
    expect(divergentes).toEqual([]);
  });

  it('`when` é estritamente crescente — é ele que define o que ainda falta aplicar', () => {
    // O migrator compara o `when` de cada entrada com o timestamp da última
    // migration registrada no banco. Um `when` fora de ordem faz uma migration
    // nova nascer "no passado" e nunca ser aplicada.
    const foraDeOrdem = journal.entries
      .filter((e, i) => i > 0 && e.when <= journal.entries[i - 1]!.when)
      .map((e) => e.tag);
    expect(foraDeOrdem).toEqual([]);
  });

  it('as duas migrations do Track O estão listadas', () => {
    // Regressão explícita do incidente: sem estas, o Track O sobe sem banco.
    expect(tags).toContain('0103_signup_billing_attempt');
    expect(tags).toContain('0104_onboarding_progress');
  });
});
