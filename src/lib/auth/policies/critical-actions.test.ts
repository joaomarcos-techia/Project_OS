import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CRITICAL_ACTIONS } from './critical-actions';

/**
 * F-14 (arch-test, AST — NÃO grep textual): para cada Server Action listada em
 * CRITICAL_ACTIONS, exige que ela chame `await requireFreshPermission(...)` como
 * STATEMENT DE NÍVEL SUPERIOR do corpo — não aninhado em if/try/loop (código morto
 * como `if (false) { requireFreshPermission() }` NÃO conta).
 *
 * B4 (auditoria de APIs) — dois furos fechados:
 *   1. A lista de arquivos era fixa (4 caminhos). Uma action crítica escrita fora
 *      deles escapava do gate em silêncio. Agora: descoberta por varredura.
 *   2. Só `FunctionDeclaration` era reconhecida. As 6 transitions de
 *      `scheduling/actions.ts` chamam `requireFreshPermission` mas são consts
 *      vindas de uma factory — invisíveis ao gate.
 *
 * ESCOPO DELIBERADAMENTE CONTIDO: reconhece as TRÊS formas que existem no repo hoje
 * (declaração; arrow/function expression; const = factory(...) com a factory no
 * MESMO arquivo, um hop, sem recursão). Não é um analisador de AST genérico e não
 * deve virar um. Forma desconhecida → o teste FALHA ALTO pedindo intervenção
 * humana; nunca tenta adivinhar. Se o diff deste arquivo começar a crescer, é sinal
 * de que a resposta certa é simplificar o código de produção, não o parser.
 */
const ROOTS = [join('src', 'contexts'), join('src', 'app')];

/** Todo `actions*.ts` sob contexts/ e app/ — a superfície onde Server Actions vivem. */
function actionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^actions.*\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
    }
  };
  for (const root of ROOTS) walk(join(process.cwd(), root));
  return out;
}

function isTopLevelRequireFresh(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isAwaitExpression(expr)) return false;
  if (!ts.isCallExpression(expr.expression)) return false;
  const callee = expr.expression.expression;
  return ts.isIdentifier(callee) && callee.text === 'requireFreshPermission';
}

function guardsAtTopLevel(body: ts.Block): boolean {
  return body.statements.some(isTopLevelRequireFresh);
}

/** Declaração local de função com este nome (para resolver a factory — 1 hop). */
function findFunctionDeclaration(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | null {
  let hit: ts.FunctionDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) hit = node;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hit;
}

/** O corpo da função que a factory retorna (`return async function (…) { … }`). */
function returnedFunctionBody(fn: ts.FunctionDeclaration): ts.Block | null {
  if (!fn.body) return null;
  for (const stmt of fn.body.statements) {
    if (!ts.isReturnStatement(stmt) || !stmt.expression) continue;
    const e = stmt.expression;
    if ((ts.isFunctionExpression(e) || ts.isArrowFunction(e)) && e.body && ts.isBlock(e.body)) {
      return e.body;
    }
  }
  return null;
}

type Located =
  | { kind: 'found'; body: ts.Block; file: string; shape: string }
  | { kind: 'missing' }
  | { kind: 'unrecognized'; file: string; detail: string };

/** Resolve o corpo da action pelas 3 formas conhecidas. Nunca adivinha. */
function locate(actionName: string): Located {
  for (const file of actionFiles()) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let found: Located | null = null;

    const visit = (node: ts.Node): void => {
      if (found) return;

      // Forma 1 — `export async function nome() { … }`
      if (ts.isFunctionDeclaration(node) && node.name?.text === actionName) {
        found = node.body
          ? { kind: 'found', body: node.body, file, shape: 'function declaration' }
          : { kind: 'unrecognized', file, detail: 'declaração sem corpo' };
        return;
      }

      // Formas 2 e 3 — `export const nome = …`
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === actionName
      ) {
        const init = node.initializer;
        if (!init) {
          found = { kind: 'unrecognized', file, detail: 'const sem inicializador' };
          return;
        }
        // 2 — arrow / function expression direto.
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) {
          found = { kind: 'found', body: init.body, file, shape: 'arrow/function expression' };
          return;
        }
        // 3 — `const nome = factory(...)`, factory declarada no MESMO arquivo.
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          const factoryName = init.expression.text;
          const factory = findFunctionDeclaration(sf, factoryName);
          const body = factory ? returnedFunctionBody(factory) : null;
          found = body
            ? { kind: 'found', body, file, shape: `factory ${factoryName}()` }
            : {
                kind: 'unrecognized',
                file,
                detail: `const = ${factoryName}(...), mas a factory não foi encontrada no arquivo ou não retorna uma função com corpo em bloco`,
              };
          return;
        }
        found = { kind: 'unrecognized', file, detail: 'inicializador de forma desconhecida' };
        return;
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sf, visit);
    if (found) return found;
  }
  return { kind: 'missing' };
}

describe('CRITICAL_ACTIONS (F-14) — enforcement via AST', () => {
  for (const action of CRITICAL_ACTIONS) {
    it(`${action} chama await requireFreshPermission(...) no nível superior`, () => {
      const r = locate(action);

      // "não achei" e "não entendi" são falhas DIFERENTES. Antes ambas viravam
      // `found: false` → "Server Action não encontrada", o que empurra o mantenedor
      // a tirar o nome da lista em vez de consertar o visitor. Este erro pede o
      // oposto: ou simplifique a action, ou ensine a forma nova aqui — de propósito.
      if (r.kind === 'unrecognized') {
        throw new Error(
          `'${action}' foi encontrada em ${r.file}, mas o arch-test NÃO reconheceu a forma ` +
            `(${r.detail}). NÃO remova o nome de CRITICAL_ACTIONS para silenciar isto — o gate ` +
            `de CI ficaria cego. Prefira escrever a action numa das formas conhecidas ` +
            `(declaração, arrow/function expression, ou const = factory() no mesmo arquivo); ` +
            `só ensine a forma nova aqui se ela for realmente necessária.`,
        );
      }
      expect(
        r.kind === 'found',
        `Server Action '${action}' não encontrada em nenhum actions*.ts sob ${ROOTS.join(', ')}`,
      ).toBe(true);

      const hit = r as Extract<Located, { kind: 'found' }>;
      expect(
        guardsAtTopLevel(hit.body),
        `'${action}' (${hit.shape} em ${hit.file}) não chama requireFreshPermission no nível ` +
          `superior do corpo (revalidação fresh obrigatória)`,
      ).toBe(true);
    });
  }

  it('controle negativo: requireFreshPermission em código morto NÃO conta', () => {
    const snippet = `export async function bad() { if (false) { await requireFreshPermission('x'); } }`;
    const sf = ts.createSourceFile('x.ts', snippet, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fn = findFunctionDeclaration(sf, 'bad');
    expect(fn).not.toBeNull();
    // A chamada está DENTRO de if(false) → não é statement de nível superior.
    expect(guardsAtTopLevel(fn!.body!)).toBe(false);
  });

  it('a varredura enxerga os arquivos de actions dos contexts e do app', () => {
    const files = actionFiles().map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, '/'));
    // Sanity: se a varredura quebrar, os testes acima passariam vazios.
    expect(files).toContain('src/contexts/scheduling/actions.ts');
    expect(files).toContain('src/contexts/patient/actions.ts');
    expect(files.some((f) => f.includes('equipe/actions.ts'))).toBe(true);
    expect(files.length).toBeGreaterThan(4); // era uma lista fixa de 4
  });
});
