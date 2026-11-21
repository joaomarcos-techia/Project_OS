// @vitest-environment happy-dom
/**
 * A-02 (docs/otimização_ui_final.md, 33): o Radix Dialog põe `aria-describedby` no conteúdo
 * SEMPRE, apontando para o id da descrição. Sem `DialogDescription`/`DrawerDescription`, o
 * leitor de tela recebe uma referência para um elemento que não existe. Dois contratos:
 * 1. toda tela que abre gaveta ou diálogo tem descrição (ou desliga a referência de propósito);
 * 2. o ConfirmDialog sem descrição não deixa a referência pendurada.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

afterEach(cleanup);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/u.test(entry.name) && !/\.test\.tsx$/u.test(entry.name) ? [path] : [];
  });
}

describe('descrição acessível de gavetas e diálogos (A-02)', () => {
  it('toda tela que usa DrawerContent ou DialogContent tem descrição ou desliga a referência', () => {
    const root = resolve(process.cwd(), 'src');
    const offenders = sources(root)
      .filter((path) => !path.includes(`${sep}components${sep}ui${sep}`))
      .filter((path) => {
        const code = readFileSync(path, 'utf8');
        if (!/<(DrawerContent|DialogContent)\b/u.test(code)) return false;
        return !/<(DrawerDescription|DialogDescription)\b|aria-describedby/u.test(code);
      })
      .map((path) => relative(root, path).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('ConfirmDialog sem descrição não aponta para um id que não existe', () => {
    render(
      <ConfirmDialog
        open
        trigger={null}
        title="Excluir modelo?"
        confirmLabel="Excluir"
        onConfirm={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Excluir modelo?' });
    const describedBy = dialog.getAttribute('aria-describedby');
    if (describedBy) {
      for (const id of describedBy.split(' ')) expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('ConfirmDialog com descrição liga a descrição ao diálogo', () => {
    render(
      <ConfirmDialog
        open
        trigger={null}
        title="Excluir modelo?"
        description="O modelo deixa de aparecer nas novas prescrições."
        confirmLabel="Excluir"
        onConfirm={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Excluir modelo?' });
    const id = dialog.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(
      'O modelo deixa de aparecer nas novas prescrições.',
    );
  });
});
