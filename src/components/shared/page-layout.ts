export type PageLayoutMode = 'workspace' | 'data' | 'read';

const WORKSPACE_ROUTES = ['/agenda', '/consultorio', '/conversas'];

function matchesSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * Escolhe a largura pelo trabalho executado, não pelo tamanho do monitor.
 * Rotas desconhecidas ficam no modo data: é o contrato mais seguro para o shell.
 *
 * Não existe mais um modo `form`. Ele estreitava a coluna para 960px em
 * `/configuracoes`, `/equipe` e `/modelos-receita`, e o efeito visível era o
 * cabeçalho dessas telas começar 112px à direita do de todas as outras — a
 * mesma sidebar, réguas diferentes. Os formulários de dentro já se limitam
 * sozinhos (`max-width` próprio), então alinhar a coluna não estica nenhum.
 */
export function resolvePageLayout(pathname: string): PageLayoutMode {
  if (WORKSPACE_ROUTES.some((route) => matchesSection(pathname, route))) return 'workspace';
  if (pathname.startsWith('/pacientes/')) return 'read';
  return 'data';
}
