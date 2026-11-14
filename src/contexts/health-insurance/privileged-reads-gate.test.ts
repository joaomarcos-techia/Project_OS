/**
 * Gate permanente das LEITURAS PRIVILEGIADAS do módulo de Convênios e da reconciliação financeira
 * (docs/convenios/auditoria-leituras-privilegiadas.md, P6 de 14/11).
 *
 * `dbAdmin` lê fora da RLS. Cada uso nesses módulos foi auditado nas 15 perguntas (menor
 * privilégio, escopo de clínica, identidade, revogação, clínica suspensa, trial, usuário excluído,
 * job adulterado, leitura mínima, auditoria, isolamento) e tem prova adversarial. Este teste
 * reprova:
 *  - um arquivo NOVO que use `dbAdmin` nesses módulos;
 *  - um uso a MAIS (`dbAdmin.`) num arquivo já auditado;
 *  - um arquivo auditado que a auditoria deixe de citar.
 * Para passar: documentar o caminho na auditoria, acrescentar a prova e só então atualizar a lista.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCOPES = ['src/contexts/health-insurance', 'src/app/api/cron/financial-reconcile'];

/** Arquivo auditado → número de usos `dbAdmin.` (transações/consultas) auditados. */
const AUDITED: Record<string, number> = {
  // §1 leitura delegada da exportação assíncrona (permissão de quem pediu).
  'src/contexts/health-insurance/internal/delegation-permission.ts': 1,
  // §2 varreduras do financial-reconcile: convênio sem guia e coparticipação.
  'src/contexts/health-insurance/billing-gap-candidates.ts': 2,
  // §2 e §3: a 3ª transação é a varredura do estorno externo (R54), que roda dentro dela.
  'src/app/api/cron/financial-reconcile/route.ts': 3,
};

/** Recebem a transação privilegiada do chamador (sem uso próprio), e também precisam estar na auditoria. */
const RUNS_INSIDE_AUDITED = ['src/app/api/cron/financial-reconcile/external-refund-sweep.ts'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name) ? [full] : [];
  });
}

/** Usos reais: sem comentários de linha/bloco, só `dbAdmin.` (o import sozinho não lê nada). */
function usages(file: string): number {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
  return (code.match(/\bdbAdmin\s*\./gu) ?? []).length;
}

const found = Object.fromEntries(
  SCOPES.flatMap((scope) => walk(join(ROOT, scope)))
    .map((f) => [relative(ROOT, f).split(sep).join('/'), usages(f)] as const)
    .filter(([, n]) => n > 0),
);

describe('leituras privilegiadas auditadas (gate permanente)', () => {
  it('nenhum uso de dbAdmin fora dos caminhos auditados, nem a mais dentro deles', () => {
    expect(found).toEqual(AUDITED);
  });

  it('a auditoria cita cada arquivo auditado', () => {
    const doc = readFileSync(
      join(ROOT, 'docs/convenios/auditoria-leituras-privilegiadas.md'),
      'utf8',
    );
    const missing = [...Object.keys(AUDITED), ...RUNS_INSIDE_AUDITED].filter(
      (f) => !doc.includes(f.split('/').at(-1)!),
    );
    expect(missing).toEqual([]);
  });
});
