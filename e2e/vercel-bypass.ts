/**
 * Deployment Protection da Vercel responde 302 para `vercel.com/sso-api` em
 * qualquer request não autenticado — inclusive os do Playwright, que então
 * capturaria a tela de SSO no lugar da aplicação.
 *
 * O bypass de automação troca a sessão SSO por um header. Sem
 * `VERCEL_AUTOMATION_BYPASS_SECRET` no ambiente isto devolve `{}` e nada muda,
 * então rodar contra localhost continua igual.
 */
export function vercelBypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return {};
  return {
    'x-vercel-protection-bypass': secret,
    // Fixa o cookie de bypass na primeira resposta: subrecursos e navegações
    // seguintes deixam de depender do header.
    'x-vercel-set-bypass-cookie': 'true',
  };
}
