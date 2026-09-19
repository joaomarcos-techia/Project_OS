import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { describe, expect, it } from 'vitest';

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

describe('sessão Supabase não entra em Client Components', () => {
  it('nenhum helper transitivo leva SDK ao browser sem barreira server-only ou Server Action', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) throw new Error('tsconfig.json ausente');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error('tsconfig.json inválido');
    const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
    const modules = new Map<string, { client: boolean; barrier: boolean; imports: string[] }>();
    for (const file of productionSourceFiles(sourceRoot)) {
      const code = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
      const imports: string[] = [];
      function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const specifier = node.moduleSpecifier.text;
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          const allNamedTypes =
            !clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly);
          if (!clause?.isTypeOnly && !allNamedTypes) {
            imports.push(specifier);
          }
        } else if (
          ts.isExportDeclaration(node) &&
          !node.isTypeOnly &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          imports.push(node.moduleSpecifier.text);
        } else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
          node.arguments.length === 1
        ) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      const directives = source.statements.flatMap((statement) =>
        ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
          ? [statement.expression.text]
          : [],
      );
      modules.set(path.resolve(file), {
        client: directives.includes('use client'),
        barrier: imports.includes('server-only') || directives.includes('use server'),
        imports,
      });
    }
    const offenders = new Set<string>();
    const visited = new Set<string>();
    function walk(file: string): void {
      if (visited.has(file)) return;
      visited.add(file);
      const sourceModule = modules.get(file);
      if (!sourceModule || sourceModule.barrier) return;
      for (const specifier of sourceModule.imports) {
        if (specifier.startsWith('@supabase/')) offenders.add(path.relative(sourceRoot, file));
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
          if (resolved) walk(path.resolve(resolved.resolvedFileName));
        }
      }
    }
    for (const [file, sourceModule] of modules) if (sourceModule.client) walk(file);
    expect([...offenders].sort()).toEqual([]);
  });

  it('não importa SDK de Auth/Realtime nem cliente SSR browser em código enviado ao navegador', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const offenders = productionSourceFiles(sourceRoot).filter((file) => {
      const code = fs.readFileSync(file, 'utf8');
      if (!/^['"]use client['"];?/m.test(code)) return false;
      return /(?:from|import\s*\()\s*['"](?:@supabase\/|@\/lib\/auth\/supabase-browser)/.test(code);
    });
    expect(offenders.map((file) => path.relative(sourceRoot, file))).toEqual([]);
  });
});
