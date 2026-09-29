import { expect, test } from '@playwright/test';

/**
 * "Esqueci a senha" de ponta a ponta: tela → e-mail REAL enviado → link → formulário.
 *
 * O defeito (29/09/2026): o e-mail saía pelo template "Reset Password" do painel
 * do Supabase, com `{{ .ConfirmationURL }}`. Esse link passa pelo
 * `/auth/v1/verify` do GoTrue, que consome o token e devolve a sessão na URL — e
 * `/reset-password` (AUTH-006) só aceita a prova emitida por `/auth/confirm`.
 * Todo pedido terminava em "Link inválido ou expirado".
 *
 * O spec lê a mensagem que de fato saiu, pela API do Resend, e abre o link DELA.
 * Não usa atalho: se o e-mail voltar a sair com o link errado, é aqui que quebra.
 *
 * Não troca a senha da conta de teste: para no formulário de nova senha, que só
 * aparece depois de `/auth/confirm` verificar o token e emitir o grant.
 *
 * Só em localhost (digita o e-mail da conta de teste e usa o Resend de DEV).
 *
 * Requisitos:
 *   E2E_BASE_URL=http://localhost:<porta>   app local ligado ao DEV
 *   E2E_PASSWORD_RESET=1                     opt-in (envia e-mail de verdade)
 *   E2E_USER_EMAIL                           conta de teste com perfil de clínica
 *   E2E_RESEND_API_KEY                       chave do Resend usada pelo app local
 */

const baseUrl = process.env.E2E_BASE_URL ?? '';
const email = process.env.E2E_USER_EMAIL ?? '';
const resendKey = process.env.E2E_RESEND_API_KEY ?? '';

function skipReason(): string | null {
  if (process.env.E2E_PASSWORD_RESET !== '1') return 'E2E_PASSWORD_RESET != 1';
  if (!email || !resendKey) return 'e-mail de teste ou chave do Resend ausentes';
  if (!baseUrl || !['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) {
    return 'só roda contra o app em localhost';
  }
  return null;
}

type ResendEmail = { id: string; to: string[]; subject: string; created_at: string };

async function resend<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  expect(res.status, `Resend ${path}`).toBe(200);
  return (await res.json()) as T;
}

/** A mensagem de redefinição enviada a `to` depois de `since`, lida no Resend. */
async function waitForResetEmail(to: string, since: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await resend<{ data: ResendEmail[] }>('/emails?limit=20');
    const found = list.data.find(
      (e) =>
        e.to.some((addr) => addr.toLowerCase() === to.toLowerCase()) &&
        e.subject === 'Redefinir senha — Qoro' &&
        Date.parse(e.created_at) >= since - 5_000,
    );
    if (found) return (await resend<{ html: string }>(`/emails/${found.id}`)).html;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('o e-mail de redefinição não apareceu no Resend');
}

test('esqueci a senha: o link do e-mail real abre o formulário de nova senha', async ({ page }) => {
  const skip = skipReason();
  test.skip(skip !== null, skip ?? '');
  test.setTimeout(8 * 60_000);

  const since = Date.now();
  await page.goto('/login', { timeout: 180_000 });
  await page.getByText('Esqueci a senha').click();
  await page.locator('#recovery-email').fill(email);
  await page.getByRole('button', { name: 'Enviar link seguro' }).click();
  await expect(page.getByText('Verifique seu e-mail')).toBeVisible({ timeout: 180_000 });

  const html = await waitForResetEmail(email, since);
  const href = /href="([^"]+)"[^>]*>Redefinir minha senha</u.exec(html)?.[1];
  expect(href, 'o e-mail precisa ter o botão com o link').toBeTruthy();
  const link = new URL(href!.replaceAll('&amp;', '&'));

  // O formato é o que /auth/confirm verifica — nunca o /auth/v1/verify do GoTrue.
  expect(link.origin).toBe(new URL(baseUrl).origin);
  expect(link.pathname).toBe('/auth/confirm');
  expect(link.search, 'o token não pode ir na query').toBe('');
  const fragment = new URLSearchParams(link.hash.slice(1));
  expect(fragment.get('type')).toBe('recovery');
  expect(fragment.get('next')).toBe('/reset-password');
  expect(html).not.toContain('/auth/v1/verify');

  await page.goto(link.toString(), { timeout: 180_000 });
  await expect(page).toHaveURL(/\/reset-password$/u, { timeout: 180_000 });
  await expect(page.getByText('Link inválido ou expirado')).toHaveCount(0);
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});
