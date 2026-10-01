import { expect, test } from '@playwright/test';
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

test.use({
  storageState: { cookies: [], origins: [] },
});

test.describe('produção: fronteira sem autenticação', () => {
  test.describe.configure({ retries: 0 });

  test('redireciona rotas estáticas e IDs reais antes de expor conteúdo', async ({ request }) => {
    test.setTimeout(180_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_UNAUTHENTICATED=ALLOW_READ_ONLY para consultar fixtures de PROD.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste sem sessão só pode apontar para app.qoro.dev.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
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
        const [conversation] = await tx<{ id: string }[]>`
          select id::text from ai_conversations order by created_at limit 1
        `;
        const [clinic] = await tx<{ id: string }[]>`
          select id::text from clinics order by created_at limit 1
        `;
        if (!patient || !prontuario || !prescription || !document || !conversation || !clinic) {
          throw new Error('Fixtures reais insuficientes para o boundary sem sessão.');
        }
        return { patient, prontuario, prescription, document, conversation, clinic };
      });

      const routes = [
        ...STATIC_PROTECTED_ROUTES,
        `/pacientes/${fixtures.patient.id}`,
        `/pacientes/${fixtures.prontuario.patient_id}/prontuarios/${fixtures.prontuario.id}`,
        `/prescricoes/${fixtures.prescription.id}/pdf`,
        `/documentos/${fixtures.document.id}/pdf`,
        `/conversas/${fixtures.conversation.id}`,
        `/admin/clinicas/${fixtures.clinic.id}`,
      ];
      const outcomes: Array<{ route: string; status: number; location: string }> = [];

      for (const route of routes) {
        const response = await request.get(route, { failOnStatusCode: false, maxRedirects: 0 });
        const status = response.status();
        const location = response.headers().location ?? '';
        expect([302, 303, 307, 308], `${route} respondeu ${status}`).toContain(status);
        expect(new URL(location, baseUrl).pathname, `${route} redirecionou para ${location}`).toBe(
          '/login',
        );
        outcomes.push({ route, status, location: '/login' });
        await response.dispose();
      }

      const loginResponse = await request.get('/login', { failOnStatusCode: false });
      expect(loginResponse.status()).toBe(200);
      const headers = loginResponse.headers();
      expect(headers['strict-transport-security']).toBeTruthy();
      expect(headers['x-content-type-options']?.toLowerCase()).toBe('nosniff');
      expect(headers['x-frame-options']?.toUpperCase()).toBe('DENY');

      console.log(
        `[unauthenticated-boundary] ${JSON.stringify({
          routes: outcomes.length,
          redirects: outcomes.filter((outcome) => outcome.location === '/login').length,
          statusCodes: [...new Set(outcomes.map((outcome) => outcome.status))],
          securityHeaders: {
            hsts: Boolean(headers['strict-transport-security']),
            noSniff: headers['x-content-type-options']?.toLowerCase() === 'nosniff',
            frameDeny: headers['x-frame-options']?.toUpperCase() === 'DENY',
            cspEnforced: Boolean(headers['content-security-policy']),
            cspReportOnly: Boolean(headers['content-security-policy-report-only']),
          },
          result: 'blocked-correctly',
        })}`,
      );
      await loginResponse.dispose();
    } finally {
      await sql.end();
    }
  });
});
