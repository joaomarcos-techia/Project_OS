/**
 * Deployment Protection da Vercel responde 302 para `vercel.com/sso-api` em
 * qualquer request não autenticado — inclusive os do Playwright, que então
 * capturaria a tela de SSO no lugar da aplicação.
 *
 * O bypass de automação troca a sessão SSO por um header. O header acompanha
 * todas as requests do contexto Playwright e também funciona em `fetch` do
 * Node. Não pedimos o cookie de bypass: essa opção responde com redirect para
 * a mesma URL e `fetch` não mantém o cookie, criando um loop antes do probe.
 * Sem `VERCEL_AUTOMATION_BYPASS_SECRET` isto devolve `{}` e localhost continua
 * igual.
 */
export function vercelBypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return {};
  return {
    'x-vercel-protection-bypass': secret,
  };
}
