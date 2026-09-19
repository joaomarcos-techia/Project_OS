import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_PERMISSIONS === 'ALLOW_TEST_ACCOUNTS';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_PERMISSION_OWNER_EMAIL;
const targetEmail = process.env.E2E_PERMISSION_TARGET_EMAIL;
const sharedPassword = process.env.E2E_PERMISSION_PASSWORD;

const MANAGE_PROCEDURES = 'manage:procedures';
const VIEW_PATIENT = 'view:patient';
const VIEW_AGENDA = 'view:agenda';
const VIEW_CONSULTORIO = 'view:consultorio';
const VIEW_CONVERSATIONS = 'view:conversations';
const VIEW_FINANCIAL = 'view:financial';
const VIEW_PRONTUARIO = 'view:prontuario';
const VIEW_PRESCRIPTION = 'view:prescription';
const MANAGE_PERMISSIONS = 'manage:permissions';
const TESTED_OVERRIDES = [
  MANAGE_PROCEDURES,
  VIEW_PATIENT,
  VIEW_AGENDA,
  VIEW_CONSULTORIO,
  VIEW_CONVERSATIONS,
  VIEW_FINANCIAL,
] as const;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

type Identity = {
  userId: string;
  clinicId: string;
  name: string;
  role: string;
};

type PermissionState = {
  claimsVersion: number;
  permissions: string[];
  override: boolean | null;
};

type CapturedAction = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

class RollbackProbe extends Error {
  constructor(readonly changedRows: number) {
    super('rollback authorization probe');
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function productionSupabaseConfig(): { url: string; key: string } {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret };
}

async function runAuthSessionOperation(
  context: BrowserContext,
  operation: (
    client: ReturnType<typeof createSsrClient>,
  ) => Promise<{ error: { message: string } | null; data: { session: unknown } }>,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const sourceCookies = await context.cookies();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionSupabaseConfig();
  const client = createSsrClient(url, key, {
    cookies: {
      getAll: () => sourceCookies.map(({ name, value }) => ({ name, value })),
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const result = await operation(client);
  if (result.error || !result.data.session || nextCookies.length === 0) {
    throw new Error(result.error?.message ?? 'Operação Auth não produziu cookies de sessão.');
  }

  await context.clearCookies();
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

async function signInAuthenticatedContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  await runAuthSessionOperation(context, (client) =>
    client.auth.signInWithPassword({ email, password }),
  );
}

async function refreshAuthenticatedContext(context: BrowserContext): Promise<void> {
  await runAuthSessionOperation(context, (client) => client.auth.refreshSession());
}

function sessionClaims(cookies: Array<{ name: string; value: string }>): Record<string, unknown> {
  const value = cookies
    .filter((cookie) => cookie.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => cookie.value)
    .join('');
  if (!value.startsWith('base64-')) throw new Error('Cookie Auth inesperado.');
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
  };
  if (typeof session.access_token !== 'string') throw new Error('Access token ausente.');
  const payload = session.access_token.split('.')[1];
  if (!payload) throw new Error('JWT malformado.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function assertStaleSessionRevoked(page: Page, route: string): Promise<void> {
  const response = await page.goto(route);
  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });
}

async function setOverride(
  ownerPage: Page,
  targetName: string,
  permissionLabel: string,
  value: 'default' | 'grant' | 'deny',
  captureAction = false,
): Promise<CapturedAction | undefined> {
  await ownerPage.goto('/equipe');
  const row = ownerPage.getByText(targetName, { exact: true }).locator('xpath=ancestor::tr[1]');
  await row.getByRole('button', { name: `Ações de ${targetName}` }).click();
  await ownerPage.getByRole('menuitem', { name: 'Permissões individuais' }).click();
  const dialog = ownerPage.getByRole('dialog', { name: `Permissões de ${targetName}` });
  await expect(dialog).toBeVisible();
  const select = dialog.getByLabel(permissionLabel, { exact: true });

  const requestPromise = captureAction
    ? ownerPage.waitForRequest(
        (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
      )
    : undefined;
  await select.selectOption(value);
  await expect(ownerPage.getByText('Permissão atualizada', { exact: true }).last()).toBeVisible({
    timeout: 30_000,
  });

  let captured: CapturedAction | undefined;
  if (requestPromise) {
    const request = await requestPromise;
    const body = request.postDataBuffer();
    if (!body) throw new Error('Server Action sem corpo capturável.');
    const sourceHeaders = request.headers();
    const allowedHeaders = [
      'accept',
      'content-type',
      'next-action',
      'next-router-state-tree',
      'next-url',
      'origin',
      'referer',
    ];
    captured = {
      url: request.url(),
      headers: Object.fromEntries(
        allowedHeaders.flatMap((header) =>
          sourceHeaders[header] ? [[header, sourceHeaders[header]]] : [],
        ),
      ),
      body,
    };
  }

  const close = dialog.getByRole('button', { name: 'Fechar' });
  if ((await close.count()) === 1) await close.click();
  return captured;
}

async function replayAction(
  requestContext: APIRequestContext,
  action: CapturedAction,
): Promise<number> {
  const response = await requestContext.fetch(action.url, {
    method: 'POST',
    headers: action.headers,
    data: action.body,
    failOnStatusCode: false,
  });
  return response.status();
}

test.describe('produção: ciclo de permissões granulares', () => {
  test.describe.configure({ retries: 0 });

  test('revoga sessão, bloqueia replay/autoelevação e aplica deny de leitura', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(480_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_PERMISSIONS=ALLOW_TEST_ACCOUNTS para alterar overrides de teste.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O ciclo de permissões só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !targetEmail || !sharedPassword || ownerEmail === targetEmail) {
      throw new Error('Credenciais owner/target distintas são obrigatórias.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({
      baseURL: baseUrl,
      storageState: { cookies: [], origins: [] },
    });
    const targetContext = await browser.newContext({
      baseURL: baseUrl,
      storageState: { cookies: [], origins: [] },
    });
    const ownerPage = await ownerContext.newPage();
    const targetPage = await targetContext.newPage();
    let target: Identity | undefined;
    let ownsOverrideLifecycle = false;

    const loadIdentities = async (): Promise<{ owner: Identity; target: Identity }> => {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            email: string;
            user_id: string;
            clinic_id: string;
            name: string;
            role: string;
          }[]
        >`select lower(u.email) as email, p.id::text as user_id,
                   p.clinic_id::text as clinic_id, p.nome as name, p.role::text as role
              from auth.users u
              join profiles p on p.id = u.id
             where lower(u.email) in (${ownerEmail.toLowerCase()}, ${targetEmail.toLowerCase()})
               and p.ativo = true and p.deleted_at is null`;
      });
      const owner = rows.find((row) => row.email === ownerEmail.toLowerCase());
      const selectedTarget = rows.find((row) => row.email === targetEmail.toLowerCase());
      if (!owner || !selectedTarget || owner.clinic_id !== selectedTarget.clinic_id) {
        throw new Error('Owner e target não pertencem ao mesmo tenant de teste.');
      }
      if (owner.role !== 'owner' || selectedTarget.role !== 'attendant') {
        throw new Error('Roles de teste divergentes do cenário owner→attendant.');
      }
      return {
        owner: {
          userId: owner.user_id,
          clinicId: owner.clinic_id,
          name: owner.name,
          role: owner.role,
        },
        target: {
          userId: selectedTarget.user_id,
          clinicId: selectedTarget.clinic_id,
          name: selectedTarget.name,
          role: selectedTarget.role,
        },
      };
    };

    const permissionState = async (permission: string): Promise<PermissionState> => {
      const currentTarget = target;
      if (!currentTarget) throw new Error('Target não carregado.');
      return sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [effective] = await tx<
          {
            claims_version: number;
            permissions: string[];
          }[]
        >`select claims_version, permissions
              from effective_permissions_v
             where user_id = ${currentTarget.userId}::uuid`;
        const overrides = await tx<{ granted: boolean }[]>`
          select granted
            from user_permission_overrides
           where user_id = ${currentTarget.userId}::uuid
             and permission_code = ${permission}
        `;
        if (!effective || overrides.length > 1) throw new Error('Estado de permissão inválido.');
        return {
          claimsVersion: effective.claims_version,
          permissions: effective.permissions,
          override: overrides[0]?.granted ?? null,
        };
      });
    };

    const rlsMutationDenied = async (
      mutate: (tx: postgres.TransactionSql) => Promise<number>,
    ): Promise<boolean> => {
      const currentTarget = target;
      if (!currentTarget) throw new Error('Target não carregado.');
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE authenticated');
          await tx`select set_config('app.current_clinic', ${currentTarget.clinicId}, true)`;
          await tx`select set_config('app.current_user', ${currentTarget.userId}, true)`;
          await tx`select set_config('request.jwt.claim.sub', ${currentTarget.userId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ sub: currentTarget.userId, clinic_id: currentTarget.clinicId, role: 'authenticated' })},
            true
          )`;
          throw new RollbackProbe(await mutate(tx));
        });
      } catch (error) {
        if (error instanceof RollbackProbe) return error.changedRows === 0;
        if (postgresErrorCode(error) === '42501') return true;
        throw error;
      }
      return false;
    };

    try {
      const identities = await loadIdentities();
      const targetIdentity = identities.target;
      target = targetIdentity;
      const initialOverrides = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ permission_code: string }[]>`
          select permission_code
            from user_permission_overrides
           where user_id = ${targetIdentity.userId}::uuid
             and permission_code in ${sql([...TESTED_OVERRIDES])}
        `;
      });
      if (initialOverrides.length !== 0) {
        throw new Error(
          'Overrides preexistentes: cenário recusado para preservar o estado inicial.',
        );
      }
      ownsOverrideLifecycle = true;

      await signInAuthenticatedContext(ownerContext, ownerEmail, sharedPassword);
      await signInAuthenticatedContext(targetContext, targetEmail, sharedPassword);
      await ownerPage.goto('/dashboard');
      await targetPage.goto('/dashboard');
      await expect(ownerPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      await expect(targetPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      expect(sessionClaims(await targetContext.cookies()).app_role).toBe('attendant');

      const initialManage = await permissionState(MANAGE_PROCEDURES);
      expect(initialManage.override).toBeNull();
      expect(initialManage.permissions).not.toContain(MANAGE_PROCEDURES);
      await targetPage.goto('/configuracoes/procedimentos');
      await expect(
        targetPage.getByText(
          'Seu perfil não tem permissão para gerenciar o catálogo de procedimentos.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(targetPage.getByRole('button', { name: 'Novo procedimento' })).toHaveCount(0);

      const capturedGrant = await setOverride(
        ownerPage,
        targetIdentity.name,
        'Gerenciar procedimentos',
        'grant',
        true,
      );
      if (!capturedGrant) throw new Error('Server Action de concessão não capturada.');
      await expect
        .poll(async () => permissionState(MANAGE_PROCEDURES))
        .toMatchObject({ override: true });
      const grantedManage = await permissionState(MANAGE_PROCEDURES);
      expect(grantedManage.permissions).toContain(MANAGE_PROCEDURES);
      expect(grantedManage.claimsVersion).toBeGreaterThan(initialManage.claimsVersion);

      await assertStaleSessionRevoked(targetPage, '/configuracoes/procedimentos');
      await refreshAuthenticatedContext(targetContext);
      await targetPage.goto('/dashboard');
      await expect(targetPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      expect(sessionClaims(await targetContext.cookies()).permissions).toContain(MANAGE_PROCEDURES);
      await targetPage.goto('/configuracoes/procedimentos');
      await expect(targetPage.getByRole('button', { name: 'Novo procedimento' })).toBeVisible();

      await setOverride(ownerPage, targetIdentity.name, 'Gerenciar procedimentos', 'default');
      await expect
        .poll(async () => permissionState(MANAGE_PROCEDURES))
        .toMatchObject({ override: null });
      const revokedManage = await permissionState(MANAGE_PROCEDURES);
      expect(revokedManage.permissions).not.toContain(MANAGE_PROCEDURES);
      expect(revokedManage.claimsVersion).toBeGreaterThan(grantedManage.claimsVersion);

      await assertStaleSessionRevoked(targetPage, '/configuracoes/procedimentos');
      await refreshAuthenticatedContext(targetContext);
      await targetPage.goto('/dashboard');
      await expect(targetPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      await targetPage.goto('/configuracoes/procedimentos');
      await expect(
        targetPage.getByText(
          'Seu perfil não tem permissão para gerenciar o catálogo de procedimentos.',
          { exact: true },
        ),
      ).toBeVisible();

      const replayStatus = await replayAction(targetContext.request, capturedGrant);
      const afterReplay = await permissionState(MANAGE_PROCEDURES);
      expect(afterReplay.override).toBeNull();
      expect(afterReplay.permissions).not.toContain(MANAGE_PROCEDURES);

      const directOverrideDenied = await rlsMutationDenied(async (tx) => {
        const inserted = await tx<{ id: string }[]>`
          insert into user_permission_overrides
            (id, user_id, clinic_id, permission_code, granted)
          values
            (${randomUUID()}::uuid, ${targetIdentity.userId}::uuid, ${targetIdentity.clinicId}::uuid,
             ${MANAGE_PERMISSIONS}, true)
          returning id
        `;
        return inserted.length;
      });
      const directRoleDenied = await rlsMutationDenied(async (tx) => {
        const updated = await tx<{ id: string }[]>`
          update profiles set role = 'owner' where id = ${targetIdentity.userId}::uuid returning id
        `;
        return updated.length;
      });
      expect(directOverrideDenied).toBe(true);
      expect(directRoleDenied).toBe(true);

      const initialView = await permissionState(VIEW_PATIENT);
      expect(initialView.override).toBeNull();
      expect(initialView.permissions).toContain(VIEW_PATIENT);
      const [patientSample] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; name: string }[]>`
          select id::text, nome as name
            from patients
           where clinic_id = ${targetIdentity.clinicId}::uuid
             and deleted_at is null
           order by created_at
           limit 1
        `;
      });
      if (!patientSample)
        throw new Error('Tenant A sem paciente ativo para provar leitura negada.');

      await setOverride(ownerPage, targetIdentity.name, 'Ver pacientes', 'deny');
      await expect
        .poll(async () => permissionState(VIEW_PATIENT))
        .toMatchObject({ override: false });
      const deniedView = await permissionState(VIEW_PATIENT);
      expect(deniedView.permissions).not.toContain(VIEW_PATIENT);
      await assertStaleSessionRevoked(targetPage, '/pacientes');
      await refreshAuthenticatedContext(targetContext);
      await targetPage.goto('/dashboard');
      await expect(targetPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      expect(sessionClaims(await targetContext.cookies()).permissions).not.toContain(VIEW_PATIENT);
      await targetPage.goto('/pacientes');
      const patientVisibleWithoutPermission =
        (await targetPage.getByText(patientSample.name, { exact: true }).count()) > 0;

      await targetPage.goto(`/pacientes/${patientSample.id}`);
      const patientDetailVisibleWithoutPermission =
        (await targetPage.getByRole('heading', { name: patientSample.name, exact: true }).count()) >
        0;
      // AUTHZ-001 — com `view:patient` negada a pagina nao renderiza mais o
      // detalhe do paciente, entao o campo CPF simplesmente nao existe. Ler sem
      // guarda estourava timeout; a ausencia E o resultado correto.
      const cpfCell = targetPage
        .getByText('CPF', { exact: true })
        .locator('xpath=following-sibling::dd[1]');
      const cpfValue = (await cpfCell.count()) > 0 ? ((await cpfCell.textContent()) ?? '') : '';
      const decryptedCpfVisibleWithoutPermission = /\d{11}/u.test(cpfValue.replace(/\D/gu, ''));

      for (const [permission, label] of [
        [VIEW_AGENDA, 'Ver agenda'],
        [VIEW_CONSULTORIO, 'Ver consultório'],
        [VIEW_CONVERSATIONS, 'Ver conversas IA'],
        [VIEW_FINANCIAL, 'Ver financeiro'],
      ] as const) {
        await setOverride(ownerPage, targetIdentity.name, label, 'deny');
        await expect
          .poll(async () => permissionState(permission))
          .toMatchObject({
            override: false,
          });
      }

      await assertStaleSessionRevoked(targetPage, '/agenda');
      await refreshAuthenticatedContext(targetContext);
      await targetPage.goto('/dashboard');
      await expect(targetPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      const readDeniedClaims = sessionClaims(await targetContext.cookies()).permissions;
      for (const permission of [
        VIEW_PATIENT,
        VIEW_AGENDA,
        VIEW_CONSULTORIO,
        VIEW_CONVERSATIONS,
        VIEW_FINANCIAL,
        VIEW_PRONTUARIO,
        VIEW_PRESCRIPTION,
      ]) {
        expect(readDeniedClaims).not.toContain(permission);
      }

      const [appointmentSample] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ day: string; patient_name: string }[]>`
          select to_char(a.scheduled_at at time zone c.timezone, 'YYYY-MM-DD') as day,
                 p.nome as patient_name
            from appointments a
            join clinics c on c.id = a.clinic_id
            join patients p on p.id = a.patient_id and p.deleted_at is null
           where a.clinic_id = ${targetIdentity.clinicId}::uuid
           order by a.scheduled_at desc
           limit 1
        `;
      });
      let agendaPatientVisibleWithoutPermission = false;
      if (appointmentSample) {
        await targetPage.goto(`/agenda?view=day&date=${appointmentSample.day}`);
        agendaPatientVisibleWithoutPermission =
          (await targetPage.getByText(appointmentSample.patient_name, { exact: true }).count()) > 0;
      } else {
        await targetPage.goto('/agenda');
      }
      const agendaRouteVisibleWithoutPermission =
        (await targetPage.getByRole('heading', { name: 'Agenda', exact: true }).count()) > 0 &&
        (await targetPage.getByText(/não tem permissão.*agenda/iu).count()) === 0;

      await targetPage.goto('/consultorio');
      const consultorioDenied =
        (await targetPage
          .getByText('Seu perfil não tem permissão para o consultório.', { exact: true })
          .count()) > 0;
      await targetPage.goto('/conversas');
      const conversationsDenied =
        (await targetPage.getByText(/não tem permissão para ver as conversas/u).count()) > 0;
      await targetPage.goto('/financeiro');
      const financialDenied =
        (await targetPage
          .getByText('Seu perfil não tem permissão para o financeiro.', { exact: true })
          .count()) > 0;

      const [clinicalDocumentSample] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ patient_name: string }[]>`
          select patient_name
            from (
              select snapshot_patient_nome as patient_name, created_at
                from prescriptions
               where clinic_id = ${targetIdentity.clinicId}::uuid
              union all
              select snapshot_patient_nome as patient_name, created_at
                from medical_documents
               where clinic_id = ${targetIdentity.clinicId}::uuid
            ) feed
           order by created_at desc
           limit 1
        `;
      });
      await targetPage.goto('/documentos');
      // AUTHZ-003 — medir o TITULO era falso positivo: `PageNoAccess` tambem
      // renderiza "Documentos" no cabecalho, entao a tela de NEGACAO contava
      // como rota exposta. O que importa e se o feed aparece.
      const documentsDenied =
        (await targetPage.getByText(/n.o tem permiss.o para ver receitas/iu).count()) > 0;
      const documentsRouteVisibleWithoutPermission = !documentsDenied;
      const clinicalDocumentVisibleWithoutPermission = clinicalDocumentSample
        ? (await targetPage
            .getByText(clinicalDocumentSample.patient_name, { exact: true })
            .count()) > 0
        : null;

      const [prontuarioSample] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; patient_id: string }[]>`
          select pr.id::text, pr.patient_id::text
            from prontuarios pr
            join patients p on p.id = pr.patient_id
           where pr.clinic_id = ${targetIdentity.clinicId}::uuid
             and p.deleted_at is null
           order by pr.updated_at desc
           limit 1
        `;
      });
      let prontuarioRouteVisibleWithoutPermission: boolean | null = null;
      let prontuarioDecryptedContentVisibleWithoutPermission: boolean | null = null;
      if (prontuarioSample) {
        await targetPage.goto(
          `/pacientes/${prontuarioSample.patient_id}/prontuarios/${prontuarioSample.id}`,
        );
        prontuarioRouteVisibleWithoutPermission =
          (await targetPage.getByRole('heading', { name: /Prontuário/u }).count()) > 0;
        const visibleContent = await targetPage
          .locator('textarea')
          .evaluateAll((elements) =>
            elements.map((element) => (element as HTMLTextAreaElement).value.trim()),
          );
        prontuarioDecryptedContentVisibleWithoutPermission = visibleContent.some(Boolean);
      }

      const [pdfSample] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; kind: 'document' | 'prescription'; patient_name: string }[]>`
          select id::text, kind, patient_name
            from (
              select id, 'prescription'::text as kind,
                     snapshot_patient_nome as patient_name, created_at
                from prescriptions
               where clinic_id = ${targetIdentity.clinicId}::uuid
                 and pdf_storage_path is not null
              union all
              select id, 'document'::text as kind,
                     snapshot_patient_nome as patient_name, created_at
                from medical_documents
               where clinic_id = ${targetIdentity.clinicId}::uuid
                 and pdf_storage_path is not null
            ) pdfs
           order by created_at desc
           limit 1
        `;
      });
      let clinicalPdfRouteVisibleWithoutPermission: boolean | null = null;
      let clinicalPdfReadableWithoutPermission: boolean | null = null;
      if (pdfSample) {
        const pdfRoute =
          pdfSample.kind === 'prescription'
            ? `/prescricoes/${pdfSample.id}/pdf`
            : `/documentos/${pdfSample.id}/pdf`;
        await targetPage.goto(pdfRoute);
        clinicalPdfRouteVisibleWithoutPermission =
          (await targetPage.getByText(pdfSample.patient_name, { exact: true }).count()) > 0;
        // AUTHZ-003 — sem a permissao clinica a pagina nao emite mais a signed
        // URL, entao nao ha iframe. A ausencia E o resultado correto; ler sem
        // guarda estourava timeout.
        const pdfFrame = targetPage.locator('iframe');
        const signedUrl = (await pdfFrame.count()) > 0 ? await pdfFrame.getAttribute('src') : null;
        if (signedUrl) {
          const pdfResponse = await targetContext.request.get(signedUrl, {
            failOnStatusCode: false,
          });
          clinicalPdfReadableWithoutPermission =
            pdfResponse.status() === 200 &&
            (pdfResponse.headers()['content-type'] ?? '').toLowerCase().includes('application/pdf');
          await pdfResponse.dispose();
        } else {
          clinicalPdfReadableWithoutPermission = false;
        }
      }

      await targetPage.goto('/modelos-receita');
      const templatesCreateVisibleWithoutPermission =
        (await targetPage.getByRole('button', { name: 'Novo modelo' }).count()) > 0;

      await testInfo.attach('permission-lifecycle-sanitized.json', {
        body: JSON.stringify(
          {
            grantRevokeManageProcedures: true,
            staleSessionRevokedAfterGrant: true,
            staleSessionRevokedAfterRevoke: true,
            replayStatus,
            replayPersisted: afterReplay.override !== null,
            directOverrideDenied,
            directRoleDenied,
            viewPatientClaimDenied: true,
            patientVisibleWithoutPermission,
            patientDetailVisibleWithoutPermission,
            decryptedCpfVisibleWithoutPermission,
            agendaFixtureAvailable: Boolean(appointmentSample),
            agendaRouteVisibleWithoutPermission,
            agendaPatientVisibleWithoutPermission,
            consultorioDenied,
            conversationsDenied,
            financialDenied,
            documentsRouteVisibleWithoutPermission,
            clinicalDocumentFixtureAvailable: Boolean(clinicalDocumentSample),
            clinicalDocumentVisibleWithoutPermission,
            prontuarioFixtureAvailable: Boolean(prontuarioSample),
            prontuarioRouteVisibleWithoutPermission,
            prontuarioDecryptedContentVisibleWithoutPermission,
            clinicalPdfFixtureAvailable: Boolean(pdfSample),
            clinicalPdfRouteVisibleWithoutPermission,
            clinicalPdfReadableWithoutPermission,
            templatesCreateVisibleWithoutPermission,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });

      console.log(
        `[permission-lifecycle] ${JSON.stringify({
          grantRevokeManageProcedures: true,
          replayStatus,
          replayPersisted: false,
          directOverrideDenied,
          directRoleDenied,
          patientVisibleWithoutPermission,
          patientDetailVisibleWithoutPermission,
          decryptedCpfVisibleWithoutPermission,
          agendaRouteVisibleWithoutPermission,
          agendaPatientVisibleWithoutPermission,
          consultorioDenied,
          conversationsDenied,
          financialDenied,
          documentsRouteVisibleWithoutPermission,
          clinicalDocumentVisibleWithoutPermission,
          prontuarioRouteVisibleWithoutPermission,
          prontuarioDecryptedContentVisibleWithoutPermission,
          clinicalPdfRouteVisibleWithoutPermission,
          clinicalPdfReadableWithoutPermission,
          templatesCreateVisibleWithoutPermission,
        })}`,
      );

      await targetPage.goto('/account/security');
      if (
        patientVisibleWithoutPermission ||
        patientDetailVisibleWithoutPermission ||
        decryptedCpfVisibleWithoutPermission ||
        agendaRouteVisibleWithoutPermission ||
        agendaPatientVisibleWithoutPermission ||
        documentsRouteVisibleWithoutPermission ||
        clinicalDocumentVisibleWithoutPermission === true ||
        prontuarioRouteVisibleWithoutPermission === true ||
        prontuarioDecryptedContentVisibleWithoutPermission === true ||
        clinicalPdfRouteVisibleWithoutPermission === true ||
        clinicalPdfReadableWithoutPermission === true ||
        templatesCreateVisibleWithoutPermission
      ) {
        throw new Error(
          'PERMISSION BYPASS: uma ou mais rotas retornaram dados/controles sem a permissão efetiva correspondente.',
        );
      }
    } finally {
      if (target && ownsOverrideLifecycle) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const removed = await tx<{ permission_code: string }[]>`
            delete from user_permission_overrides
             where user_id = ${target!.userId}::uuid
               and permission_code in ${sql([...TESTED_OVERRIDES])}
            returning permission_code
          `;
          const remaining = await tx<{ count: number }[]>`
            select count(*)::int as count
              from user_permission_overrides
             where user_id = ${target!.userId}::uuid
               and permission_code in ${sql([...TESTED_OVERRIDES])}
          `;
          return { removed: removed.length, remaining: remaining[0]?.count ?? -1 };
        });
        expect(cleanup.remaining).toBe(0);
        console.log(`[permission-lifecycle] cleanup ${JSON.stringify(cleanup)}`);
      }
      await ownerContext.close();
      await targetContext.close();
      await sql.end();
    }
  });
});
