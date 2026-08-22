import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(process.cwd(), 'src');

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}

function attribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function descendantAssociations(
  node: ts.JsxElement,
  sourceFile: ts.SourceFile,
): { ids: string[]; ariaNamedIds: string[] } {
  const ids: string[] = [];
  const ariaNamedIds: string[] = [];

  function visit(child: ts.Node) {
    const attributes = ts.isJsxElement(child)
      ? child.openingElement.attributes
      : ts.isJsxSelfClosingElement(child)
        ? child.attributes
        : null;
    const id = attributes ? attribute(attributes, 'id') : undefined;
    if (id?.initializer) {
      const idSource = id.initializer.getText(sourceFile);
      ids.push(idSource);
      if (
        attributes &&
        (attribute(attributes, 'aria-label') || attribute(attributes, 'aria-labelledby'))
      ) {
        ariaNamedIds.push(idSource);
      }
    }
    ts.forEachChild(child, visit);
  }

  node.children.forEach(visit);
  return { ids, ariaNamedIds };
}

type FieldAudit = {
  location: string;
  hasLabel: boolean;
  group: boolean;
  htmlFor: string | undefined;
  labelCanBeUndefined: boolean;
  descendantIds: string[];
  descendantAriaNamedIds: string[];
};

function auditFields(): FieldAudit[] {
  return tsxFiles(SRC_DIR).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const fields: FieldAudit[] = [];

    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'Field') {
        const attributes = node.openingElement.attributes;
        const label = attribute(attributes, 'label');
        const htmlFor = attribute(attributes, 'htmlFor');
        const descendants = descendantAssociations(node, sourceFile);
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        fields.push({
          location: `${relative(process.cwd(), file)}:${start.line + 1}`,
          hasLabel: Boolean(label),
          group: Boolean(attribute(attributes, 'group')),
          htmlFor: htmlFor?.initializer?.getText(sourceFile),
          labelCanBeUndefined:
            label?.initializer?.getText(sourceFile).includes('undefined') ?? false,
          descendantIds: descendants.ids,
          descendantAriaNamedIds: descendants.ariaNamedIds,
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return fields;
  });
}

describe('associação acessível dos Fields', () => {
  it('exige htmlFor nos controles simples e group nos conjuntos', () => {
    const violations = auditFields()
      .filter((field) => field.hasLabel && !field.group && !field.htmlFor)
      .map((field) => field.location);

    expect(violations).toEqual([]);
  });

  it('faz cada htmlFor apontar para um id descendente real', () => {
    const violations = auditFields()
      .filter(
        (field) =>
          field.htmlFor !== undefined && !field.descendantIds.some((id) => id === field.htmlFor),
      )
      .map((field) => `${field.location} -> ${field.htmlFor}`);

    expect(violations).toEqual([]);
  });

  it('mantém nome acessível quando um rótulo visual condicional desaparece', () => {
    const violations = auditFields()
      .filter(
        (field) =>
          field.labelCanBeUndefined &&
          field.htmlFor !== undefined &&
          !field.descendantAriaNamedIds.includes(field.htmlFor),
      )
      .map((field) => field.location);

    expect(violations).toEqual([]);
  });
});
