import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CRITICAL_ACTIONS } from './critical-actions';

/**
 * F-14 (arch-test, AST — NÃO grep textual): para cada Server Action listada em
 * CRITICAL_ACTIONS, exige que ela chame `await requireFreshPermission(...)` como
 * STATEMENT DE NÍVEL SUPERIOR no corpo da função — não aninhado em if/try/loop
 * (código morto como `if (false) { requireFreshPermission() }` NÃO conta).
 *
 * Onde as Server Actions críticas vivem. Adicionar arquivos aqui se ações
 * críticas surgirem em outros contexts (o teste falha se um nome não for achado).
 */
const ACTION_FILES = ['src/contexts/patient/actions.ts'];

function isTopLevelRequireFresh(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isAwaitExpression(expr)) return false;
  if (!ts.isCallExpression(expr.expression)) return false;
  const callee = expr.expression.expression;
  return ts.isIdentifier(callee) && callee.text === 'requireFreshPermission';
}

function findAction(actionName: string): { found: boolean; topLevelGuard: boolean } {
  for (const rel of ACTION_FILES) {
    const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let result: { found: boolean; topLevelGuard: boolean } | null = null;
    const visit = (node: ts.Node): void => {
      if (result) return;
      if (ts.isFunctionDeclaration(node) && node.name?.text === actionName && node.body) {
        result = {
          found: true,
          topLevelGuard: node.body.statements.some(isTopLevelRequireFresh),
        };
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    if (result) return result;
  }
  return { found: false, topLevelGuard: false };
}

describe('CRITICAL_ACTIONS (F-14) — enforcement via AST', () => {
  for (const action of CRITICAL_ACTIONS) {
    it(`${action} chama await requireFreshPermission(...) no nível superior`, () => {
      const r = findAction(action);
      expect(r.found, `Server Action '${action}' não encontrada em ${ACTION_FILES.join(', ')}`).toBe(true);
      expect(
        r.topLevelGuard,
        `'${action}' não chama requireFreshPermission no nível superior do corpo (revalidação fresh obrigatória)`,
      ).toBe(true);
    });
  }

  it('controle negativo: requireFreshPermission em código morto NÃO conta', () => {
    const snippet = `export async function bad() { if (false) { await requireFreshPermission('x'); } }`;
    const sf = ts.createSourceFile('x.ts', snippet, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let topLevel = false;
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'bad' && node.body) {
        topLevel = node.body.statements.some(isTopLevelRequireFresh);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    // A chamada está DENTRO de if(false) → não é statement de nível superior.
    expect(topLevel).toBe(false);
  });
});
