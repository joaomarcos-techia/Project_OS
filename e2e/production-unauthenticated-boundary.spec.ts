import { expect, test, type APIRequestContext } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_UNAUTHENTICATED === 'ALLOW_READ_ONLY';
const baseUrl = process.env.E2E_BASE_URL;

const STATIC_PROTECTED_ROUTES = [
  '/dashboard',
  '/agenda',
  '/agenda/ausencias',
  '/agenda/importar',
  '/agenda/lista-espera',
  '/caixa',
  '/financeiro',
  '/financeiro/fornecedores',
  '/configuracoes',
  '/configuracoes/assinatura',
  '/configuracoes/horarios',
  '/configuracoes/perfil',
  '/configuracoes/procedimentos',
  '/configuracoes/recursos',
  '/configuracoes/sugestoes',
  '/configuracoes/lgpd',
  '/configuracoes/whatsapp',
  '/equipe',
  '/pacientes',
  '/consultorio',
  '/conversas',
  '/documentos',
  '/modelos-receita',
  '/relatorios',
  '/relatorios/pdf?periodo=30d',
  '/account/security',
  '/admin',
  '/admin/clinicas',
] as const;

test.use({ storageState: { cookies: [], origins: [] } });

function assertPreconditions(): { baseUrl: string; databaseUrl: string } {
  test.skip(
    !authorized,
    'Exige E2E_PRODUCTION_UNAUTHENTICATED=ALLOW_READ_ONLY para consultar fixtures de PROD.',
  );
  if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
    throw new Error('O teste sem sessão só pode apontar para app.qoro.dev.');
  }
  const databaseUrl = process.env.DATABASE_URL_PROD;
  if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');
  return { baseUrl, databaseUrl };
}

async function assertLoginRedirects(
  request: APIRequestContext,
  routes: readonly string[],
  expectedBaseUrl: string,
): Promise<void> {
  for (const route of routes) {
    const response = await request.get(route, { failOnStatusCode: false, maxRedirects: 0 });
    const status = response.status();
    const location = response.headers().location ?? '';
    expect([302, 303, 307, 308], `${route} respondeu ${status}`).toContain(status);
    expect(
      new URL(location, expectedBaseUrl).pathname,
      `${route} redirecionou para ${location}`,
    ).toBe('/login');
    await response.dispose();
  }
}

test.describe('produção: fronteira sem autenticação', () => {
  test.describe.configure({ retries: 0 });

  test('redireciona todas as rotas estáticas e mantém headers de segurança', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const config = assertPreconditions();
    await assertLoginRedirects(request, STATIC_PROTECTED_ROUTES, config.baseUrl);

    const loginResponse = await request.get('/login', { failOnStatusCode: false });
    expect(loginResponse.status()).toBe(200);
    const headers = loginResponse.headers();
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['x-content-type-options']?.toLowerCase()).toBe('nosniff');
    expect(headers['x-frame-options']?.toUpperCase()).toBe('DENY');
    console.log(
      `[unauthenticated-boundary-static] ${JSON.stringify({
        routes: STATIC_PROTECTED_ROUTES.length,
        redirects: STATIC_PROTECTED_ROUTES.length,
        securityHeaders: {
          hsts: Boolean(headers['strict-transport-security']),
          noSniff: true,
          frameDeny: true,
          cspEnforced: Boolean(headers['content-security-policy']),
          cspReportOnly: Boolean(headers['content-security-policy-report-only']),
        },
        result: 'blocked-correctly',
      })}`,
    );
    await loginResponse.dispose();
  });

  test('redireciona deep-links com IDs clínicos reais disponíveis', async ({ request }) => {
    test.setTimeout(120_000);
    const config = assertPreconditions();
    const sql = postgres(config.databaseUrl, { max: 1, ssl: 'require', prepare: false });
    try {
      const fixtures = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [patient] = await tx<{ id: string }[]>`
          select id::text from patients where deleted_at is null order by created_at limit 1
        `;
        const [prontuario] = await tx<{ id: string; patient_id: string }[]>`
          select id::text, patient_id::text from prontuarios order by created_at limit 1
        `;
        const [prescription] = await tx<{ id: string }[]>`
          select id::text from prescriptions where pdf_storage_path is not null order by created_at limit 1
        `;
        const [document] = await tx<{ id: string }[]>`
          select id::text from medical_documents where pdf_storage_path is not null order by created_at limit 1
        `;
        const [clinic] = await tx<{ id: string }[]>`
          select id::text from clinics order by created_at limit 1
        `;
        if (!patient || !prontuario || !prescription || !document || !clinic) {
          throw new Error('Fixtures clínicas reais insuficientes para os deep-links sem sessão.');
        }
        return { patient, prontuario, prescription, document, clinic };
      });
      const routes = [
        `/pacientes/${fixtures.patient.id}`,
        `/pacientes/${fixtures.prontuario.patient_id}/prontuarios/${fixtures.prontuario.id}`,
        `/prescricoes/${fixtures.prescription.id}/pdf`,
        `/documentos/${fixtures.document.id}/pdf`,
        `/admin/clinicas/${fixtures.clinic.id}`,
      ];
      await assertLoginRedirects(request, routes, config.baseUrl);
      console.log(
        `[unauthenticated-boundary-clinical] ${JSON.stringify({ routes: routes.length, result: 'blocked-correctly' })}`,
      );
    } finally {
      await sql.end();
    }
  });

  test('redireciona conversa real quando existe fixture em produção', async ({ request }) => {
    test.setTimeout(60_000);
    const config = assertPreconditions();
    const sql = postgres(config.databaseUrl, { max: 1, ssl: 'require', prepare: false });
    try {
      const [conversation] = await sql<{ id: string }[]>`
        select id::text from ai_conversations order by created_at limit 1
      `;
      test.skip(!conversation, 'Produção não possui conversa real para validar /conversas/[id].');
      const route = `/conversas/${conversation!.id}`;
      await assertLoginRedirects(request, [route], config.baseUrl);
      console.log(
        '[unauthenticated-boundary-conversation] {"routes":1,"result":"blocked-correctly"}',
      );
    } finally {
      await sql.end();
    }
  });
});
