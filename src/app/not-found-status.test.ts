/**
 * HTTP-001 — recurso inexistente tem de responder 404 de verdade.
 *
 * O achado: id malformado, UUID inexistente e paciente soft-deletado
 * renderizavam a tela de "não encontrado", mas a navegação respondia HTTP 200.
 * Monitoramento, caches e clientes automatizados não conseguiam distinguir
 * ausência de sucesso.
 *
 * A causa não estava no `notFound()` — estava no `loading.tsx` do MESMO
 * segmento. Ele envolve a página num Suspense, então o App Router emite o shell
 * (com status 200) antes de a página resolver; o `notFound()` posterior troca a
 * UI dentro do stream, mas os headers já foram enviados.
 *
 * Este teste é o guard permanente da CLASSE (regra #62): qualquer página que
 * chame `notFound()` não pode ter um `loading.tsx` irmão, senão o soft-404
 * volta silenciosamente na próxima rota criada.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_DIR = resolve(process.cwd(), 'src/app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(APP_DIR);
const pages = files.filter((f) => f.endsWith(`${'page'}.tsx`));

/** Páginas que decidem ausência de recurso via `notFound()`. */
const notFoundPages = pages.filter((f) => readFileSync(f, 'utf8').includes('notFound()'));

describe('HTTP-001 — 404 antes do commit dos headers', () => {
  it('existem páginas que sinalizam ausência (o teste não é vazio)', () => {
    expect(notFoundPages.length).toBeGreaterThan(0);
  });

  it.each(notFoundPages.map((f) => relative(APP_DIR, f)))(
    '%s não tem loading.tsx em NENHUM segmento ancestral',
    (relativePage) => {
      // A primeira correção olhou só o irmão e não bastou: em produção a rota
      // continuou 200. `loading.tsx` cria o Suspense para o segmento E TODA a
      // subárvore, então um boundary no PAI (`/pacientes/loading.tsx`) também
      // faz o shell sair antes de a página resolver.
      let dir = join(APP_DIR, relativePage, '..');
      const offenders: string[] = [];
      while (dir.startsWith(APP_DIR)) {
        if (readdirSync(dir).includes('loading.tsx')) {
          offenders.push(relative(APP_DIR, dir) || '.');
        }
        const parent = join(dir, '..');
        if (parent === dir) break;
        dir = parent;
      }
      expect(offenders, `boundaries de streaming acima de ${relativePage}`).toEqual([]);
    },
  );

  it('a página do paciente continua tratando os três casos de ausência', () => {
    // A correção NÃO relaxou nenhuma verificação: id malformado, inexistente e
    // soft-deletado seguem levando a `notFound()` — o que mudou foi o momento
    // em que a resposta é emitida.
    const page = readFileSync(join(APP_DIR, '(app)/(shell)/pacientes/[id]/page.tsx'), 'utf8');
    expect(page).toContain('z.string().uuid().safeParse(id)');
    expect(page).toContain('if (!parsedId.success) notFound()');
    expect(page).toContain('if (!p) notFound()');
    expect(page).toContain('if (p.deletedAt) notFound()');
  });

  it('a leitura do paciente continua tenant-scoped — ausência ≠ enumeração', () => {
    // Um id de OUTRO tenant não pode responder diferente de um inexistente: a
    // query roda sob RLS com o clinicId do gate, então os dois caem no mesmo
    // `!p → notFound()`.
    const page = readFileSync(join(APP_DIR, '(app)/(shell)/pacientes/[id]/page.tsx'), 'utf8');
    expect(page).toContain('getPatientWithDecryptedFields(clinicId, parsedId.data)');
    expect(page).toContain('pageGate([PERMISSIONS.VIEW_PATIENT])');
  });

  it('a UX de not-found continua existindo', () => {
    const notFoundPage = files.find((f) => f.endsWith(`${'not-found'}.tsx`));
    expect(notFoundPage).toBeDefined();
  });
});
