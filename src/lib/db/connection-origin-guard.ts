/**
 * Connection-origin guard (F-01) — PURE AST detection, no fs/policy.
 *
 * Detects every way a file can pull in a DB connection origin so the multi-tenant
 * boundary is enforced fail-closed by tooling (not convention). The runtime `db`
 * pool connects with a BYPASSRLS role, so `withTenant` (SET LOCAL ROLE
 * authenticated) is the principal isolation defense — FORCE RLS does NOT stop a
 * BYPASSRLS role (ADR-007). A forgotten `withTenant` therefore must be impossible
 * to reach, including via dynamic import / require / re-export chains.
 *
 * This module is split out from scripts/arch-db-check.ts so it can be unit-tested
 * with synthetic snippets (see connection-origin-guard.test.ts). It is NEVER
 * imported by app runtime code (only by the arch script + its test), so the
 * `typescript` dependency is not bundled.
 */
import ts from 'typescript';

/** What an importer's module specifier resolves to, from the caller's view. */
export interface SpecifierClass {
  /** bare `postgres` driver. */
  postgresDriver?: boolean;
  /** `drizzle` factory from `drizzle-orm/postgres-js`. */
  drizzlePgFactory?: boolean;
  /** resolves to the db connection origin OR a transitively-tainted re-exporter. */
  poolOrigin?: boolean;
}

export type Classify = (specifier: string) => SpecifierClass;

export type OriginUsageKind =
  | 'postgres' // imported the bare postgres driver
  | 'drizzle-pg' // imported { drizzle } from drizzle-orm/postgres-js
  | 'pool-import' // import { db|dbAdmin|dbWorker } from origin/tainted
  | 'pool-namespace' // import * as x from origin/tainted
  | 'pool-reexport' // export { db } from origin  /  export * from origin
  | 'dynamic' // await import('origin'|'postgres'|...)
  | 'require'; // require('origin'|'postgres'|...)

export interface OriginUsage {
  line: number;
  kind: OriginUsageKind;
  /** pool name for 'pool-import'/'pool-reexport' when known. */
  name?: string;
  excerpt: string;
}

const POOL_NAMES = new Set(['db', 'dbAdmin', 'dbWorker']);

/**
 * Scan one source file's AST and return every connection-origin usage.
 * Policy (which files are allowed) is applied by the caller — this is pure.
 */
export function findOriginUsages(
  sourceText: string,
  fileName: string,
  classify: Classify,
): OriginUsage[] {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  const out: OriginUsage[] = [];
  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const excerpt = (node: ts.Node) => node.getText(sf).replace(/\s+/g, ' ').slice(0, 120);

  const visit = (node: ts.Node): void => {
    // static import
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = classify(node.moduleSpecifier.text);
      const ic = node.importClause;
      const typeOnly = ic?.isTypeOnly ?? false;
      if (c.postgresDriver) out.push({ line: lineOf(node), kind: 'postgres', excerpt: excerpt(node) });
      if (c.drizzlePgFactory && ic && !typeOnly) {
        const nb = ic.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (!el.isTypeOnly && (el.propertyName ?? el.name).text === 'drizzle') {
              out.push({ line: lineOf(node), kind: 'drizzle-pg', excerpt: excerpt(node) });
            }
          }
        }
      }
      if (c.poolOrigin && ic && !typeOnly) {
        const nb = ic.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) {
          out.push({ line: lineOf(node), kind: 'pool-namespace', excerpt: excerpt(node) });
        } else if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (el.isTypeOnly) continue;
            const orig = (el.propertyName ?? el.name).text;
            if (POOL_NAMES.has(orig)) {
              out.push({ line: lineOf(node), kind: 'pool-import', name: orig, excerpt: excerpt(node) });
            }
          }
        }
      }
    }

    // re-export with source
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const c = classify(node.moduleSpecifier.text);
      if (c.poolOrigin) {
        if (!node.exportClause) {
          out.push({ line: lineOf(node), kind: 'pool-reexport', excerpt: excerpt(node) });
        } else if (ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const orig = (el.propertyName ?? el.name).text;
            if (POOL_NAMES.has(orig)) {
              out.push({ line: lineOf(node), kind: 'pool-reexport', name: orig, excerpt: excerpt(node) });
            }
          }
        }
      }
    }

    // dynamic import('...')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const c = classify(arg.text);
        if (c.poolOrigin || c.postgresDriver || c.drizzlePgFactory) {
          out.push({ line: lineOf(node), kind: 'dynamic', excerpt: excerpt(node) });
        }
      }
    }

    // require('...')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const c = classify(arg.text);
        if (c.poolOrigin || c.postgresDriver || c.drizzlePgFactory) {
          out.push({ line: lineOf(node), kind: 'require', excerpt: excerpt(node) });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** Does an export-from declaration re-export a pool name (or `*`) from origin/tainted? */
export function reExportsPool(sourceText: string, fileName: string, classify: Classify): boolean {
  return findOriginUsages(sourceText, fileName, classify).some((u) => u.kind === 'pool-reexport');
}
