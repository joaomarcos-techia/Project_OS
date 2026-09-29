import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_FEEDBACK === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const tenantBEmail = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type Identity = {
  id: string;
  clinicId: string;
  role: string;
  permissions: string[];
};

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { databaseUrl: string; url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const key = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !key) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, key };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const { url, key } = productionConfig();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

function feedbackForm(page: Page): Locator {
  return page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Enviar sugestão' }) });
}

async function setIdempotencyKey(form: Locator, key: string): Promise<void> {
  const input = form.locator('input[name="idempotencyKey"]');
  await expect(input).not.toHaveValue('');
  await input.evaluate((element, value) => {
    (element as HTMLInputElement).value = value;
  }, key);
}

async function fillFeedback(
  page: Page,
  input: {
    title: string;
    description: string;
    category?: 'feature' | 'improvement' | 'bug' | 'other';
    priority?: 'low' | 'medium' | 'high';
    idempotencyKey?: string;
  },
): Promise<Locator> {
  const form = feedbackForm(page);
  await form.getByLabel('Título').fill(input.title);
  await form.getByLabel('Descrição').fill(input.description);
  await form.getByLabel('Categoria').selectOption(input.category ?? 'feature');
  await form.getByLabel('Prioridade percebida').selectOption(input.priority ?? 'medium');
  if (input.idempotencyKey) await setIdempotencyKey(form, input.idempotencyKey);
  return form;
}

async function submitFeedback(form: Locator): Promise<number> {
  const page = form.page();
  const responsePromise = page.waitForResponse(isServerAction);
  await form.getByRole('button', { name: 'Enviar sugestão' }).click();
  return (await responsePromise).status();
}

async function setRlsIdentity(tx: postgres.TransactionSql, identity: Identity): Promise<void> {
  await tx.unsafe('SET LOCAL ROLE authenticated');
  await tx`select set_config('app.current_clinic', ${identity.clinicId}, true)`;
  await tx`select set_config('app.current_user', ${identity.id}, true)`;
  await tx`select set_config('request.jwt.claim.sub', ${identity.id}, true)`;
  await tx`select set_config(
    'request.jwt.claims',
    ${JSON.stringify({
      sub: identity.id,
      clinic_id: identity.clinicId,
      app_role: identity.role,
      permissions: identity.permissions,
      role: 'authenticated',
    })},
    true
  )`;
}

async function rlsCounts(
  sql: postgres.Sql,
  identity: Identity,
  ids: string[],
): Promise<{ suggestions: number; history: number }> {
  return sql.begin(async (tx) => {
    await setRlsIdentity(tx, identity);
    const [counts] = await tx<{ suggestions: number; history: number }[]>`
      select
        (select count(*)::int from feedback_suggestions where id::text=any(${ids}::text[])) suggestions,
        (select count(*)::int from feedback_history where feedback_id::text=any(${ids}::text[])) history
    `;
    if (!counts) throw new Error('Contagem RLS ausente.');
    return counts;
  });
}

async function spoofedInsertDenied(
  sql: postgres.Sql,
  identity: Identity,
  targetClinicId: string,
  targetUserId: string,
  title: string,
): Promise<boolean> {
  try {
    await sql.begin(async (tx) => {
      await setRlsIdentity(tx, identity);
      await tx`
        insert into feedback_suggestions
          (clinic_id, user_id, title, description, category, priority)
        values
          (${targetClinicId}::uuid, ${targetUserId}::uuid, ${title},
           'Tentativa sintética deve ser negada por RLS.', 'bug', 'high')
      `;
      throw new Error('UNEXPECTED_FEEDBACK_INSERT');
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNEXPECTED_FEEDBACK_INSERT') return false;
    return (error as { code?: string }).code === '42501';
  }
  return false;
}

test.describe('produção: privacidade e idempotência de sugestões', () => {
  test.describe.configure({ retries: 0 });

  test('valida inputs, autor privado, A↔B, replay concorrente e RLS de escrita', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(360_000);
    test.skip(!authorized, 'Exige autorização explícita para sugestões sintéticas na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de feedback só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !tenantBEmail || !sharedPassword) {
      throw new Error('Credenciais dos tenants de teste ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('owner-video') },
    });
    const replayContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('replay-video') },
    });
    const doctorContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('doctor-video') },
    });
    const tenantBContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('tenant-b-video') },
    });
    const ownerPage = await ownerContext.newPage();
    const replayPage = await replayContext.newPage();
    const doctorPage = await doctorContext.newPage();
    const tenantBPage = await tenantBContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-FEEDBACK-A-${runId}]`;
    const invalidTitle = `${marker} ${'X'.repeat(170)}`;
    const ownerTitle = `${marker} Owner <svg onload=globalThis.__feedbackXss=1>`;
    const ownerConflictTitle = `${marker} Owner conflito`;
    const doctorTitle = `${marker} Médico privado`;
    const spoofTitle = `${marker} spoof RLS`;
    const ownerDescription = `${marker} descrição Unicode çã 😀 e SQL-like ' OR 1=1 --`;
    const doctorDescription = `${marker} descrição visível apenas ao médico autor.`;
    const ownerKey = randomUUID();
    const doctorKey = randomUUID();
    let owner: Identity | undefined;
    let doctor: Identity | undefined;
    let tenantB: Identity | undefined;
    const feedbackIds = new Set<string>();

    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          { id: string; email: string; clinic_id: string; role: string; permissions: string[] }[]
        >`
          select ep.user_id::text id, lower(u.email) email, ep.clinic_id::text,
                 ep.role::text, ep.permissions
            from auth.users u join effective_permissions_v ep on ep.user_id=u.id
           where lower(u.email)=any(${[
             ownerEmail.toLowerCase(),
             doctorEmail.toLowerCase(),
             tenantBEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo=true and ep.deleted_at is null
        `;
      });
      const asIdentity = (email: string): Identity | undefined => {
        const row = rows.find((candidate) => candidate.email === email.toLowerCase());
        return row
          ? { id: row.id, clinicId: row.clinic_id, role: row.role, permissions: row.permissions }
          : undefined;
      };
      owner = asIdentity(ownerEmail);
      doctor = asIdentity(doctorEmail);
      tenantB = asIdentity(tenantBEmail);
      if (!owner || !doctor || !tenantB) throw new Error('Identidades de teste incompletas.');
      expect(owner.clinicId).toBe(doctor.clinicId);
      expect(tenantB.clinicId).not.toBe(owner.clinicId);

      const [preexisting] = await sql<{ count: number }[]>`
        select count(*)::int count from feedback_suggestions where title like ${`${marker}%`}
      `;
      expect(preexisting?.count).toBe(0);

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(replayContext, ownerEmail, sharedPassword),
        signInContext(doctorContext, doctorEmail, sharedPassword),
        signInContext(tenantBContext, tenantBEmail, sharedPassword),
      ]);
      await Promise.all([
        ownerPage.goto('/configuracoes/sugestoes'),
        replayPage.goto('/configuracoes/sugestoes'),
        doctorPage.goto('/configuracoes/sugestoes'),
        tenantBPage.goto('/configuracoes/sugestoes'),
      ]);

      const invalidForm = await fillFeedback(ownerPage, {
        title: invalidTitle,
        description: `${marker} descrição válida para isolar o título longo.`,
      });
      await invalidForm
        .getByLabel('Título')
        .evaluate((element) => element.removeAttribute('maxlength'));
      await invalidForm.getByLabel('Título').fill(invalidTitle);
      const invalidHttp = await submitFeedback(invalidForm);
      expect(invalidHttp).toBe(200);
      await expect(invalidForm.getByRole('alert')).toBeVisible();
      const [invalidPersisted] = await sql<{ count: number }[]>`
        select count(*)::int count from feedback_suggestions where title=${invalidTitle}
      `;
      expect(invalidPersisted?.count).toBe(0);

      const ownerForm = await fillFeedback(ownerPage, {
        title: ownerTitle,
        description: ownerDescription,
        category: 'bug',
        priority: 'high',
        idempotencyKey: ownerKey,
      });
      const replayForm = await fillFeedback(replayPage, {
        title: ownerTitle,
        description: ownerDescription,
        category: 'bug',
        priority: 'high',
        idempotencyKey: ownerKey,
      });
      const ownerResponse = ownerPage.waitForResponse(isServerAction);
      const replayResponse = replayPage.waitForResponse(isServerAction);
      await Promise.all([
        ownerForm.getByRole('button', { name: 'Enviar sugestão' }).click(),
        replayForm.getByRole('button', { name: 'Enviar sugestão' }).click(),
      ]);
      const concurrentHttp = (await Promise.all([ownerResponse, replayResponse])).map((response) =>
        response.status(),
      );
      expect(concurrentHttp).toEqual([200, 200]);
      await Promise.all([
        expect(ownerPage.getByText(/Sugestão recebida/u)).toBeVisible(),
        expect(replayPage.getByText(/Sugestão recebida/u)).toBeVisible(),
      ]);

      await ownerPage.reload();
      await expect(ownerPage.getByText(ownerTitle, { exact: true })).toBeVisible();
      expect(await ownerPage.evaluate(() => globalThis.__feedbackXss ?? 0)).toBe(0);

      const conflictForm = await fillFeedback(ownerPage, {
        title: ownerConflictTitle,
        description: ownerDescription,
        category: 'bug',
        priority: 'high',
        idempotencyKey: ownerKey,
      });
      const conflictHttp = await submitFeedback(conflictForm);
      expect(conflictHttp).toBe(200);
      await expect(
        conflictForm.getByText('Não foi possível enviar sua sugestão agora. Tente novamente.'),
      ).toBeVisible();

      const doctorForm = await fillFeedback(doctorPage, {
        title: doctorTitle,
        description: doctorDescription,
        category: 'improvement',
        priority: 'low',
        idempotencyKey: doctorKey,
      });
      const doctorHttp = await submitFeedback(doctorForm);
      expect(doctorHttp).toBe(200);
      await expect(doctorPage.getByText(/Sugestão recebida/u)).toBeVisible();

      await Promise.all([ownerPage.reload(), doctorPage.reload(), tenantBPage.reload()]);
      await expect(ownerPage.getByText(ownerTitle, { exact: true })).toBeVisible();
      await expect(ownerPage.getByText(doctorTitle, { exact: true })).toHaveCount(0);
      await expect(doctorPage.getByText(doctorTitle, { exact: true })).toBeVisible();
      await expect(doctorPage.getByText(ownerTitle, { exact: true })).toHaveCount(0);
      await expect(tenantBPage.getByText(ownerTitle, { exact: true })).toHaveCount(0);
      await expect(tenantBPage.getByText(doctorTitle, { exact: true })).toHaveCount(0);

      const persisted = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const suggestions = await tx<
          { id: string; user_id: string; title: string; attachments: unknown }[]
        >`
          select id::text, user_id::text, title, attachments
            from feedback_suggestions
           where clinic_id=${owner!.clinicId}::uuid and title like ${`${marker}%`}
           order by title
        `;
        for (const suggestion of suggestions) feedbackIds.add(suggestion.id);
        const ids = suggestions.map(({ id }) => id);
        const [counts] = await tx<
          { history: number; audits: number; idempotency: number; conflict_rows: number }[]
        >`
          select
            (select count(*)::int from feedback_history where feedback_id::text=any(${ids}::text[])) history,
            (select count(*)::int from audit_events where clinic_id=${owner!.clinicId}::uuid
              and action='feedback.submitted' and after->>'id'=any(${ids}::text[])) audits,
            (select count(*)::int from idempotency_keys where key=any(${[
              `feedback:submit:${ownerKey.replaceAll('-', '')}`,
              `feedback:submit:${doctorKey.replaceAll('-', '')}`,
            ]}::text[])) idempotency,
            (select count(*)::int from feedback_suggestions where title=${ownerConflictTitle}) conflict_rows
        `;
        return { suggestions, counts };
      });
      expect(persisted.suggestions).toHaveLength(2);
      expect(persisted.suggestions.filter(({ user_id }) => user_id === owner!.id)).toHaveLength(1);
      expect(persisted.suggestions.filter(({ user_id }) => user_id === doctor!.id)).toHaveLength(1);
      expect(
        persisted.suggestions.every(({ attachments }) => JSON.stringify(attachments) === '[]'),
      ).toBe(true);
      expect(persisted.counts).toEqual({
        history: 2,
        audits: 2,
        idempotency: 2,
        conflict_rows: 0,
      });

      const ids = [...feedbackIds];
      const [ownerRls, doctorRls, tenantBRls] = await Promise.all([
        rlsCounts(sql, owner, ids),
        rlsCounts(sql, doctor, ids),
        rlsCounts(sql, tenantB, ids),
      ]);
      expect(ownerRls).toEqual({ suggestions: 1, history: 1 });
      expect(doctorRls).toEqual({ suggestions: 1, history: 1 });
      expect(tenantBRls).toEqual({ suggestions: 0, history: 0 });

      const [sameTenantSpoofDenied, crossTenantSpoofDenied] = await Promise.all([
        spoofedInsertDenied(sql, owner, owner.clinicId, doctor.id, `${spoofTitle} same-tenant`),
        spoofedInsertDenied(sql, owner, tenantB.clinicId, owner.id, `${spoofTitle} cross-tenant`),
      ]);
      expect(sameTenantSpoofDenied).toBe(true);
      expect(crossTenantSpoofDenied).toBe(true);

      console.log(
        `[feedback-privacy-a] ${JSON.stringify({
          longTitleHttpStatus: invalidHttp,
          longTitleRejectedWithoutPersistence: invalidPersisted?.count === 0,
          concurrentReplayHttpStatuses: concurrentHttp,
          concurrentReplayProducedOneOwnerSuggestion: true,
          sameKeyDifferentPayloadHttpStatus: conflictHttp,
          sameKeyDifferentPayloadRejected: persisted.counts?.conflict_rows === 0,
          doctorSubmissionHttpStatus: doctorHttp,
          htmlLikeTitleRenderedAsText: true,
          ownerCannotSeeDoctorSuggestion: true,
          doctorCannotSeeOwnerSuggestion: true,
          tenantBCannotSeeClinicASuggestions: true,
          ownerRls,
          doctorRls,
          tenantBRls,
          sameTenantUserSpoofDenied: sameTenantSpoofDenied,
          crossTenantSpoofDenied,
          suggestions: persisted.suggestions.length,
          history: persisted.counts?.history,
          audits: persisted.counts?.audits,
          idempotency: persisted.counts?.idempotency,
          attachmentsStayedEmpty: true,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      try {
        if (owner) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const discovered = await tx<{ id: string }[]>`
              select id::text from feedback_suggestions
               where clinic_id=${owner!.clinicId}::uuid and title like ${`${marker}%`}
            `;
            for (const { id } of discovered) feedbackIds.add(id);
            const ids = [...feedbackIds];
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${owner!.clinicId}::uuid
                and action='feedback.submitted' and after->>'id'=any(${ids}::text[])
              returning id::text
            `;
            const keys = [
              `feedback:submit:${ownerKey.replaceAll('-', '')}`,
              `feedback:submit:${doctorKey.replaceAll('-', '')}`,
            ];
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id=${owner!.clinicId}::uuid
                and key=any(${keys}::text[]) returning key
            `;
            const removedSuggestions = await tx<{ id: string }[]>`
              delete from feedback_suggestions where clinic_id=${owner!.clinicId}::uuid
                and id::text=any(${ids}::text[]) returning id::text
            `;
            const [remaining] = await tx<
              { suggestions: number; history: number; audit: number; idempotency: number }[]
            >`
              select
                (select count(*)::int from feedback_suggestions
                  where clinic_id=${owner!.clinicId}::uuid and title like ${`${marker}%`}) suggestions,
                (select count(*)::int from feedback_history
                  where feedback_id::text=any(${ids}::text[])) history,
                (select count(*)::int from audit_events where clinic_id=${owner!.clinicId}::uuid
                  and action='feedback.submitted' and after->>'id'=any(${ids}::text[])) audit,
                (select count(*)::int from idempotency_keys where clinic_id=${owner!.clinicId}::uuid
                  and key=any(${keys}::text[])) idempotency
            `;
            return {
              removed: {
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                suggestions: removedSuggestions.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            suggestions: 0,
            history: 0,
            audit: 0,
            idempotency: 0,
          });
          console.log(`[feedback-privacy-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await Promise.all([
          ownerContext.close().catch(() => undefined),
          replayContext.close().catch(() => undefined),
          doctorContext.close().catch(() => undefined),
          tenantBContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});

declare global {
  var __feedbackXss: number | undefined;
}
