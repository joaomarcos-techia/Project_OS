export type PageLayoutMode = 'workspace' | 'data' | 'form' | 'read';

const WORKSPACE_ROUTES = ['/agenda', '/consultorio', '/conversas'];
const FORM_ROUTES = ['/configuracoes', '/equipe', '/modelos-receita'];

function matchesSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * Escolhe a largura pelo trabalho executado, não pelo tamanho do monitor.
 * Rotas desconhecidas ficam no modo data: é o contrato mais seguro para o shell.
 */
export function resolvePageLayout(pathname: string): PageLayoutMode {
  if (WORKSPACE_ROUTES.some((route) => matchesSection(pathname, route))) return 'workspace';
  if (pathname.startsWith('/pacientes/')) return 'read';
  if (FORM_ROUTES.some((route) => matchesSection(pathname, route))) return 'form';
  return 'data';
}
