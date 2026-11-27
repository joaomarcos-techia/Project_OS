import ts from 'typescript';

/** Syntax only: types, lint, database proofs and build remain separate gates. */
export function assertCompositionPatchSyntax(file: string, source: string): void {
  const { diagnostics = [] } = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve },
  });
  if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
    throw new Error(`Composed patch has invalid TypeScript syntax: ${file}`);
  }
}
