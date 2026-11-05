import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = 'af677c00cfb9a4faa8474ddbf1d69d489d8c8849';
const SOURCE = `https://github.com/joaomarcos-techia/Project_OS/blob/${BASELINE}/docs/`;
const GENERATED = new Set(['catalog.md', 'catalog.json']);

export function navigationPages(value) {
  if (Array.isArray(value)) return value.flatMap(navigationPages);
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ['pages', 'groups', 'tabs', 'navigation'].includes(key) ? navigationPages(child) : [],
  );
}

export function validSlug(slug) {
  return (
    /^[a-z0-9][a-z0-9/-]*$/u.test(slug) &&
    !slug.includes('//') &&
    !slug.split('/').includes('..') &&
    !slug.endsWith('/')
  );
}

export function classify(file, navigation) {
  if (navigation.has(file)) return 'portal';
  if (file.startsWith('tooling/')) return 'tooling';
  if (!/\.mdx?$/u.test(file)) return 'asset';
  if (/^adr\/\d/u.test(file)) return 'decision';
  if (file === 'security/acoes.md') return 'generated';
  if (/^(quality|audits|achados|evidence|c16)\//u.test(file)) return 'evidence';
  if (/^(specs|implementation|remediation)\//u.test(file)) return 'specification';
  if (file.startsWith('runbooks/')) return 'procedure';
  if (file.startsWith('prompts/')) return 'prompt';
  if (/^(archive\/|handoff-|qorov2\.md$|discovery-log\.md$|desing_novo\.md$)/u.test(file))
    return 'historical';
  if (
    file.endsWith('README.md') ||
    [
      'CURRENT-STATE.md',
      'VisãoGeral.md',
      'CONVENTIONS.md',
      'PROGRESS.md',
      'testesC15.md',
      'AUDITORIA_C0_C10_COMPLETA.md',
      'onboarding-spec.md',
    ].includes(file)
  )
    return 'bridge';
  return 'reference';
}

async function filesUnder(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        const file = `${prefix}${entry.name}`;
        if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), `${file}/`);
        return GENERATED.has(file) ? [] : [file];
      }),
  );
  return lists.flat().sort((a, b) => a.localeCompare(b, 'en'));
}

const LABELS = {
  portal: 'Manual organizado — páginas da navegação',
  decision: 'Decisões registradas — contexto e data originais',
  procedure: 'Procedimentos específicos — conferir janela e autorização',
  specification: 'Especificações e planos — confrontar implementação',
  evidence: 'Evidências datadas — não representam saúde atual',
  historical: 'Histórico e checkpoints preservados',
  reference: 'Referências complementares do repositório',
  bridge: 'Índices anteriores e pontes de compatibilidade',
  generated: 'Inventário gerado — não editar manualmente',
  prompt: 'Prompts e instruções de tarefas anteriores',
  tooling: 'Ferramentas locais da documentação',
  asset: 'Diagramas, configurações e arquivos de apoio',
};

export async function inventory(root = DOCS_ROOT) {
  const baselineFiles = new Set(
    execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', BASELINE, '--', 'docs'],
      {
        cwd: path.dirname(root),
        encoding: 'utf8',
      },
    )
      .split(/\r?\n/u)
      .map((file) => file.replace(/^docs\//u, '')),
  );
  const config = JSON.parse(await readFile(path.join(root, 'docs.json'), 'utf8'));
  const pages = navigationPages(config.navigation);
  const navigation = new Set(pages.map((slug) => `${slug}.md`));
  const files = await filesUnder(root);
  const entries = [];
  for (const file of files) {
    const text = /\.mdx?$/u.test(file) ? await readFile(path.join(root, file), 'utf8') : '';
    const title =
      text.match(/^title:\s*"(.*)"\s*$/mu)?.[1] ??
      text.match(/^#\s+(.+)$/mu)?.[1] ??
      path.posix.basename(file);
    entries.push({
      path: file,
      category: classify(file, navigation),
      title,
      source: baselineFiles.has(file) ? 'baseline' : 'checkout',
    });
  }
  return { config, pages, entries };
}

export function catalogMarkdown(entries) {
  const lines = [
    '---',
    'title: "Catálogo completo"',
    'description: "Todos os documentos e arquivos de apoio, classificados por função; histórico preservado e separado do manual."',
    'docType: "index"',
    '---',
    '',
    'Este catálogo cobre os arquivos de `docs/`, exceto ele próprio e seu manifesto',
    '`catalog.json`. Arquivos ocultos de configuração são verificados separadamente.',
    'Nada do acervo anterior foi excluído. A classificação indica finalidade, **não**',
    'certifica que cada parágrafo histórico foi revalidado.',
    '',
    'As páginas do manual abrem no portal local. Registros anteriores apontam para',
    'a revisão-base `' + BASELINE.slice(0, 8) + '` no GitHub, preservando sua data e contexto.',
    'Ferramentas e templates novos são consultados pelo arquivo no checkout.',
    '',
    'O portal não foi publicado e exclusão da navegação não é controle de acesso.',
    '',
  ];
  for (const [category, label] of Object.entries(LABELS)) {
    const group = entries.filter((entry) => entry.category === category);
    if (!group.length) continue;
    lines.push(`## ${label}`, '', '| Arquivo | Assunto |', '| --- | --- |');
    for (const entry of group) {
      const title = entry.title.replaceAll('|', '\\|').replaceAll('`', '');
      const target =
        category === 'portal'
          ? `/${entry.path.replace(/\.mdx?$/u, '')}`
          : entry.source === 'checkout' ||
              category === 'tooling' ||
              entry.path.startsWith('assets/') ||
              entry.path === 'docs.json'
            ? null
            : SOURCE + entry.path.split('/').map(encodeURIComponent).join('/');
      const labelPath = target ? `[${entry.path}](${target})` : `\`${entry.path}\``;
      lines.push(`| ${labelPath} | ${title} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function validate(root = DOCS_ROOT) {
  const { config, pages, entries } = await inventory(root);
  const errors = [];
  if (!config.name || !config.theme || !config.colors?.primary)
    errors.push('docs.json: configuração obrigatória incompleta');
  if (new Set(pages).size !== pages.length) errors.push('Navegação com página duplicada');
  const slugs = new Set(pages);
  for (const slug of pages) {
    if (!validSlug(slug)) {
      errors.push(`Slug inválido: ${slug}`);
      continue;
    }
    let text;
    try {
      text = await readFile(path.join(root, `${slug}.md`), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      errors.push(`Página ausente: ${slug}`);
      continue;
    }
    const metadata = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u)?.[1] ?? '';
    for (const field of ['title', 'description', 'docType']) {
      if (!new RegExp(`^${field}:\\s*"[^"\\n]+"`, 'mu').test(metadata))
        errors.push(`${slug}: metadado ${field} ausente`);
    }
    if (/^# /mu.test(text)) errors.push(`${slug}: título H1 duplicado`);
    const body = text.replace(/```[\s\S]*?```/gu, '');
    for (const match of body.matchAll(/(?<!!)\[[^\]\n]*\]\(([^\s)]+)\)/gu)) {
      const href = match[1];
      if (/^(https?:|mailto:|#)/u.test(href)) continue;
      if (!href.startsWith('/')) {
        errors.push(`${slug}: link não canônico ${href}`);
        continue;
      }
      const target = decodeURIComponent(href.split('#')[0].slice(1));
      if (!slugs.has(target)) errors.push(`${slug}: destino fora da navegação ${href}`);
    }
  }
  try {
    await access(path.join(root, config.favicon.replace(/^\//u, '')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    errors.push('Favicon ausente');
  }
  const expectedManifest = JSON.stringify({ baseline: BASELINE, entries }, null, 2) + '\n';
  const expectedCatalog = catalogMarkdown(entries);
  for (const [file, expected] of [
    ['catalog.json', expectedManifest],
    ['catalog.md', expectedCatalog],
  ]) {
    const actual = await readFile(path.join(root, file), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (actual.replaceAll('\r\n', '\n') !== expected)
      errors.push(`${file}: execute node docs/tooling/catalog.mjs --write`);
  }
  return { errors, pages: pages.length, files: entries.length };
}

async function main() {
  if (process.argv.includes('--write')) {
    const { entries } = await inventory();
    await writeFile(
      path.join(DOCS_ROOT, 'catalog.json'),
      JSON.stringify({ baseline: BASELINE, entries }, null, 2) + '\n',
    );
    await writeFile(path.join(DOCS_ROOT, 'catalog.md'), catalogMarkdown(entries));
  }
  const result = await validate();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
