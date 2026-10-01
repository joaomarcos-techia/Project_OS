import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

const READ_ONLY_ROUTES = [
  { route: '/dashboard', heading: /Bom dia|Boa tarde|Boa noite|Visão operacional/u },
  { route: '/agenda', heading: 'Agenda' },
  { route: '/agenda/ausencias', heading: 'Ausências médicas' },
  { route: '/agenda/importar', heading: 'Importar histórico da agenda' },
  { route: '/agenda/lista-espera', heading: 'Lista de espera' },
  { route: '/caixa', heading: 'Caixa' },
  { route: '/financeiro', heading: 'Financeiro' },
  { route: '/financeiro/fornecedores', heading: 'Fornecedores' },
  // O índice É a tela: desde a remoção das rotas de categoria, `/configuracoes`
  // é a lista única e não redireciona para lugar nenhum.
  { route: '/configuracoes', heading: 'Configurações' },
  { route: '/configuracoes/agente', heading: 'Agente de IA' },
  { route: '/configuracoes/assinatura', heading: 'Assinatura' },
  { route: '/configuracoes/horarios', heading: /Horários(?: de atendimento)?/u },
  { route: '/configuracoes/perfil', heading: 'Perfil da clínica' },
  { route: '/configuracoes/procedimentos', heading: 'Procedimentos' },
  { route: '/configuracoes/recursos', heading: 'Salas e equipamentos' },
  { route: '/configuracoes/sugestoes', heading: 'Sugestões' },
  { route: '/configuracoes/lgpd', heading: 'Solicitações LGPD' },
  { route: '/configuracoes/whatsapp', heading: 'WhatsApp' },
  { route: '/equipe', heading: 'Equipe & Permissões' },
  { route: '/pacientes', heading: 'Pacientes' },
  { route: '/consultorio', heading: 'Consultório' },
  { route: '/conversas', heading: 'Conversas IA' },
  { route: '/documentos', heading: 'Documentos emitidos' },
  { route: '/modelos-receita', heading: 'Modelos de receita' },
  { route: '/relatorios', heading: 'Relatórios' },
  { route: '/account/security', heading: 'Segurança da conta' },
] as const;

type RouteInventory = {
  route: string;
  status: number;
  heading: string;
};

async function assertFirstDynamicRoute(
  page: Page,
  listRoute: string,
  linkSelector: string,
  dynamicRouteLabel: string,
  emptyState: RegExp,
  testInfo: TestInfo,
  toDynamicHref: (href: string) => string = (href) => href,
): Promise<string> {
  const listResponse = await page.goto(listRoute);
  expect(listResponse?.status(), `${listRoute} não respondeu 200`).toBe(200);
  const link = page.locator(linkSelector).first();
  if ((await link.count()) === 0) {
    await expect(
      page.getByText(emptyState).first(),
      `${listRoute} sem fixture e sem estado vazio`,
    ).toBeVisible();
    await testInfo.attach(`empty-state-${listRoute.replaceAll('/', '-')}.txt`, {
      body:
        `Estado vazio validado em ${listRoute}, mas isso não cobre ${dynamicRouteLabel}. ` +
        'A suíte exige uma fixture própria para não transformar ausência de dado em PASS dinâmico.',
      contentType: 'text/plain',
    });
    expect(
      await link.count(),
      `${listRoute} não contém fixture para exercitar a rota dinâmica ${dynamicRouteLabel}`,
    ).toBeGreaterThan(0);
  }

  const href = await link.getAttribute('href');
  expect(href, `${listRoute} expôs link dinâmico inválido`).toBeTruthy();
  const dynamicHref = toDynamicHref(href!);
  const response = await page.goto(dynamicHref);
  expect(response?.status(), `${dynamicHref} não respondeu 200`).toBe(200);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Página não encontrada', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Sem acesso', { exact: true })).toHaveCount(0);
  return dynamicHref;
}

function conversationDeepLink(href: string): string {
  const id = new URL(href, 'https://e2e.invalid').searchParams.get('conversation');
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
  ) {
    throw new Error('A lista de conversas não expôs um id UUID válido.');
  }
  return `/conversas/${id}`;
}

test.describe('auditoria autenticada somente-leitura', () => {
  test('todas as rotas estáticas do shell renderizam sem erro de servidor', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);

    const inventory: RouteInventory[] = [];
    for (const expectation of READ_ONLY_ROUTES) {
      const { route, heading } = expectation;
      const response = await page.goto(route);
      const status = response?.status();
      expect(status, `${route} não respondeu 200`).toBe(200);
      await expect(page, `${route} redirecionou indevidamente para login`).not.toHaveURL(
        /\/login(?:\?|$)/,
      );
      await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
      const title = page.getByRole('heading', { level: 1, name: heading });
      await expect(title, `${route} não renderizou o contrato visual da página`).toBeVisible();
      await expect(
        page.getByText('Sem acesso', { exact: true }),
        `${route} foi negada à conta que deveria cobrir as rotas operacionais`,
      ).toHaveCount(0);
      await expect(page.getByText('Página não encontrada', { exact: true })).toHaveCount(0);

      inventory.push({
        route,
        status: status!,
        heading: (await title.innerText()).trim(),
      });
    }

    await testInfo.attach('authenticated-readonly-route-inventory.json', {
      body: JSON.stringify(inventory, null, 2),
      contentType: 'application/json',
    });
    console.log(`[readonly-route-audit] ${JSON.stringify(inventory)}`);
  });

  test('as rotas dinâmicas existentes mantêm a sessão e renderizam', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);

    const outcomes = {
      patient: await assertFirstDynamicRoute(
        page,
        '/pacientes',
        'a[href^="/pacientes/"]',
        '/pacientes/[id]',
        /Nenhum paciente/u,
        testInfo,
      ),
      conversation: await assertFirstDynamicRoute(
        page,
        '/conversas',
        'a[href^="/conversas?"][href*="conversation="]',
        '/conversas/[id]',
        /Nenhuma conversa/u,
        testInfo,
        conversationDeepLink,
      ),
    };

    await testInfo.attach('authenticated-dynamic-route-outcomes.json', {
      body: JSON.stringify(outcomes, null, 2),
      contentType: 'application/json',
    });
    console.log(`[dynamic-route-audit] ${JSON.stringify(outcomes)}`);
  });
});
