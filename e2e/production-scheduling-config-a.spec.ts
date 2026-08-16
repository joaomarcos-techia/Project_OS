import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_SCHEDULING_CONFIG === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const tenantBEmail = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'on',
  screenshot: 'only-on-failure',
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

function isServerAction(response: {
  request(): { method(): string; headers(): Record<string, string> };
}) {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

async function clickServerAction(page: Page, button: Locator): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await button.click();
  return (await responsePromise).status();
}

function procedureRow(page: Page, description: string): Locator {
  return page
    .getByText(description, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"listrow")][1]');
}

function resourceRow(page: Page, name: string): Locator {
  return page
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"listrow")][1]');
}

async function openAppointmentDrawer(page: Page): Promise<Locator> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe('produção: configurações de scheduling na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('procedimentos, recursos e ausência global criada por médico', async ({ browser }) => {
    test.setTimeout(540_000);
    test.skip(!authorized, 'Exige autorização explícita para dados sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de configuração só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !tenantBEmail || !sharedPassword) {
      throw new Error('Credenciais dos tenants de teste ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const tenantBContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const doctorPage = await doctorContext.newPage();
    const tenantBPage = await tenantBContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-CONFIG-A-${runId}]`;
    const procedureCode = `CFG${runId}`.slice(0, 40);
    const procedureDescription = `${marker} <img src=x onerror=globalThis.__configXss=1>`;
    const resourceName = `${marker} Sala compartilhada`;
    const absenceReason = `${marker} prova de escopo global sem agenda afetada`;
    let clinicId: string | undefined;
    let ownerId: string | undefined;
    let doctorId: string | undefined;
    let procedureId: string | undefined;
    let resourceId: string | undefined;
    let absenceId: string | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            id: string;
            email: string;
            clinic_id: string;
            role: string;
            permissions: string[];
            practitioner: boolean;
          }[]
        >`
          select p.id::text, lower(u.email) email, ep.clinic_id::text, ep.role::text,
                 ep.permissions,
                 (p.role = 'doctor' or (p.crm is not null and btrim(p.crm) <> '')) practitioner
            from auth.users u join profiles p on p.id = u.id
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = any(${[
             ownerEmail.toLowerCase(),
             doctorEmail.toLowerCase(),
             tenantBEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true and ep.deleted_at is null
        `;
      });
      const owner = identities.find(({ email }) => email === ownerEmail.toLowerCase());
      const doctor = identities.find(({ email }) => email === doctorEmail.toLowerCase());
      const tenantB = identities.find(({ email }) => email === tenantBEmail.toLowerCase());
      if (!owner || !doctor || !tenantB) throw new Error('Identidades de teste incompletas.');
      expect(owner.clinic_id).toBe(doctor.clinic_id);
      expect(tenantB.clinic_id).not.toBe(owner.clinic_id);
      expect(owner.practitioner).toBe(true);
      expect(doctor.practitioner).toBe(true);
      expect(doctor.permissions).toContain('manage:availability');
      expect(doctor.permissions).not.toContain('manage:procedures');
      clinicId = owner.clinic_id;
      ownerId = owner.id;
      doctorId = doctor.id;

      const [futureAppointments] = await sql<{ count: number }[]>`
        select count(*)::int count from appointments
         where clinic_id = ${clinicId}::uuid
           and doctor_id = ${ownerId}::uuid
           and scheduled_at >= '2099-01-01T13:00:00Z'::timestamptz
           and scheduled_at < '2099-01-01T14:00:00Z'::timestamptz
           and status in ('agendado','confirmado')
      `;
      expect(futureAppointments?.count).toBe(0);

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(doctorContext, doctorEmail, sharedPassword),
        signInContext(tenantBContext, tenantBEmail, sharedPassword),
      ]);

      await doctorPage.goto('/configuracoes/procedimentos');
      await expect(doctorPage.getByText('Sem acesso', { exact: true })).toBeVisible();
      await expect(doctorPage.getByRole('button', { name: 'Novo procedimento' })).toHaveCount(0);

      await ownerPage.goto('/configuracoes/procedimentos');
      await ownerPage.getByRole('button', { name: 'Novo procedimento' }).click();
      let editor = ownerPage.getByText('Novo procedimento', { exact: true }).locator('..');
      const longCode = 'X'.repeat(41);
      const longCodeInput = editor.getByPlaceholder(/Código/u);
      await longCodeInput.evaluate((element) => element.removeAttribute('maxlength'));
      await longCodeInput.fill(longCode);
      await editor.getByPlaceholder(/Descrição/u).fill(`${marker} inválido`);
      await editor.getByText('Valor padrão (R$)').locator('..').locator('input').fill('1');
      await editor.getByText('Duração (min)').locator('..').locator('input').fill('30');
      const invalidHttp = await clickServerAction(
        ownerPage,
        editor.getByRole('button', { name: 'Salvar' }),
      );
      expect(invalidHttp).toBe(500);
      const [invalidPersisted] = await sql<{ count: number }[]>`
        select count(*)::int count from procedures
         where clinic_id = ${clinicId}::uuid and codigo = ${longCode}
      `;
      expect(invalidPersisted?.count).toBe(0);
      await editor.getByRole('button', { name: 'Cancelar' }).click();

      await ownerPage.getByRole('button', { name: 'Novo procedimento' }).click();
      editor = ownerPage.getByText('Novo procedimento', { exact: true }).locator('..');
      await editor.getByPlaceholder(/Código/u).fill(procedureCode);
      await editor.getByPlaceholder(/Descrição/u).fill(procedureDescription);
      await editor.getByPlaceholder(/Categoria/u).fill("Categoria ' OR 1=1 --");
      await editor.getByText('Valor padrão (R$)').locator('..').locator('input').fill('10,005');
      await editor.getByText('Duração (min)').locator('..').locator('input').fill('45');
      const createProcedureHttp = await clickServerAction(
        ownerPage,
        editor.getByRole('button', { name: 'Salvar' }),
      );
      expect(createProcedureHttp).toBeLessThan(500);
      await expect(ownerPage.getByText(procedureDescription, { exact: true })).toBeVisible();

      const [procedure] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; valor: string; duration: number; active: boolean }[]>`
          select id::text, valor_padrao::text valor, duracao_padrao_min duration, ativo active
            from procedures where clinic_id = ${clinicId!}::uuid and codigo = ${procedureCode}
        `;
      });
      if (!procedure) throw new Error('Procedimento sintético não persistiu.');
      procedureId = procedure.id;
      expect(procedure).toMatchObject({ valor: '10.01', duration: 45, active: true });
      expect(await ownerPage.evaluate(() => Boolean(globalThis.__configXss))).toBe(false);

      await ownerPage.getByRole('button', { name: 'Novo procedimento' }).click();
      editor = ownerPage.getByText('Novo procedimento', { exact: true }).locator('..');
      await editor.getByPlaceholder(/Código/u).fill(procedureCode);
      await editor.getByPlaceholder(/Descrição/u).fill(`${marker} duplicado`);
      await editor.getByText('Valor padrão (R$)').locator('..').locator('input').fill('20');
      await editor.getByText('Duração (min)').locator('..').locator('input').fill('30');
      const duplicateHttp = await clickServerAction(
        ownerPage,
        editor.getByRole('button', { name: 'Salvar' }),
      );
      expect(duplicateHttp).toBe(500);
      const [duplicates] = await sql<{ count: number }[]>`
        select count(*)::int count from procedures
         where clinic_id = ${clinicId}::uuid and codigo = ${procedureCode}
      `;
      expect(duplicates?.count).toBe(1);
      await editor.getByRole('button', { name: 'Cancelar' }).click();

      await ownerPage.goto('/configuracoes/recursos');
      const resourceInput = ownerPage.getByPlaceholder('Nome (ex.: Sala de ultrassom)');
      await resourceInput.fill(resourceName);
      await ownerPage.getByLabel('Tipo de recurso').selectOption('room');
      const createResourceHttp = await clickServerAction(
        ownerPage,
        ownerPage.getByRole('button', { name: 'Cadastrar' }),
      );
      expect(createResourceHttp).toBeLessThan(500);
      await expect(ownerPage.getByText(resourceName, { exact: true })).toBeVisible();

      const [resource] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; active: boolean }[]>`
          select id::text, active from schedulable_resources
           where clinic_id = ${clinicId!}::uuid and name = ${resourceName}
        `;
      });
      if (!resource) throw new Error('Recurso sintético não persistiu.');
      resourceId = resource.id;

      await tenantBPage.goto('/configuracoes/procedimentos');
      await expect(tenantBPage.getByText(procedureDescription, { exact: true })).toHaveCount(0);
      await tenantBPage.goto('/configuracoes/recursos');
      await expect(tenantBPage.getByText(resourceName, { exact: true })).toHaveCount(0);

      let appointmentDrawer = await openAppointmentDrawer(ownerPage);
      await expect(
        appointmentDrawer.getByLabel('Procedimento').getByRole('option', {
          name: procedureDescription,
        }),
      ).toHaveCount(1);
      await expect(appointmentDrawer.getByText(resourceName, { exact: true })).toBeVisible();

      await ownerPage.goto('/configuracoes/procedimentos');
      ownerPage.once('dialog', (confirmation) => confirmation.accept());
      const deactivateProcedureHttp = await clickServerAction(
        ownerPage,
        procedureRow(ownerPage, procedureDescription).getByRole('button', { name: 'Desativar' }),
      );
      expect(deactivateProcedureHttp).toBeLessThan(500);

      // AUTHZ-007 — sala/equipamento e recurso COMPARTILHADO: desativar um
      // afeta a agenda da clinica inteira. O spec afirmava que um MEDICO
      // conseguia desativar; agora a subrota exige a mesma capacidade
      // administrativa que a action passou a exigir.
      await doctorPage.goto('/configuracoes/recursos');
      await expect(doctorPage.getByText('Sem acesso', { exact: true })).toBeVisible();
      const doctorCanSeeGlobalResource = await doctorPage
        .getByText(resourceName, { exact: true })
        .isVisible();
      expect(doctorCanSeeGlobalResource).toBe(false);
      await expect(doctorPage.getByRole('button', { name: 'Desativar' })).toHaveCount(0);

      // Quem administra a equipe desativa — o resto do roteiro continua valendo.
      await ownerPage.goto('/configuracoes/recursos');
      const deactivateResourceHttp = await clickServerAction(
        ownerPage,
        resourceRow(ownerPage, resourceName).getByRole('button', { name: 'Desativar' }),
      );
      expect(deactivateResourceHttp).toBeLessThan(500);

      const [inactive] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            procedure_active: boolean;
            resource_active: boolean;
            resource_actor_is_doctor: boolean;
          }[]
        >`
          select p.ativo procedure_active, r.active resource_active,
            exists(select 1 from audit_events a where a.clinic_id=${clinicId!}::uuid
              and a.action='scheduling.resource.active_changed' and a.resource_id=${resourceId!}
              and a.user_id=${doctorId!}::uuid) resource_actor_is_doctor
          from procedures p cross join schedulable_resources r
          where p.id=${procedureId!}::uuid and r.id=${resourceId!}::uuid
        `;
      });
      expect(inactive).toEqual({
        procedure_active: false,
        resource_active: false,
        // AUTHZ-007 — quem desativou foi o owner, nao o medico: o recurso
        // compartilhado deixou de ser administravel por quem so gere a propria
        // agenda.
        resource_actor_is_doctor: false,
      });

      appointmentDrawer = await openAppointmentDrawer(ownerPage);
      await expect(
        appointmentDrawer.getByLabel('Procedimento').getByRole('option', {
          name: procedureDescription,
        }),
      ).toHaveCount(0);
      await expect(appointmentDrawer.getByText(resourceName, { exact: true })).toHaveCount(0);

      await doctorPage.goto('/agenda/ausencias');
      const absenceForm = doctorPage
        .getByRole('button', { name: 'Registrar e reorganizar agenda' })
        .locator('xpath=ancestor::form[1]');
      // AUTHZ-007 — o medico so administra a PROPRIA agenda: o owner nao e mais
      // uma opcao do seletor. Antes, um medico com `manage:availability`
      // registrava ausencia do owner e o fluxo cancelava/transferia todas as
      // consultas dele atomicamente.
      await expect(
        absenceForm.locator(`select[name="doctorId"] option[value="${ownerId}"]`),
      ).toHaveCount(0);
      // O seletor comeca vazio e e `required`: sem escolher, o submit nem sai.
      // A unica opcao disponivel e o proprio medico — que e o ponto do AUTHZ-007.
      await absenceForm.locator('select[name="doctorId"]').selectOption(doctorId!);
      await absenceForm.locator('select[name="strategy"]').selectOption('cancel');
      await absenceForm.locator('input[name="startsAt"]').fill('2099-01-01T10:00');
      await absenceForm.locator('input[name="endsAt"]').fill('2099-01-01T11:00');
      await absenceForm.locator('textarea[name="reason"]').fill(absenceReason);
      const absenceHttp = await clickServerAction(
        doctorPage,
        absenceForm.getByRole('button', { name: 'Registrar e reorganizar agenda' }),
      );
      expect(absenceHttp).toBeLessThan(500);
      await expect(doctorPage.getByText('Ausência registrada', { exact: true })).toBeVisible();

      const [absence] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            id: string;
            target_is_owner: boolean;
            creator_is_doctor: boolean;
            affected: number;
            strategy: string;
          }[]
        >`
          select id::text, doctor_id=${ownerId!}::uuid target_is_owner,
                 created_by=${doctorId!}::uuid creator_is_doctor,
                 affected_appointments affected, strategy::text
            from doctor_absences
           where clinic_id=${clinicId!}::uuid and reason=${absenceReason}
        `;
      });
      if (!absence) throw new Error('Ausência sintética não persistiu.');
      absenceId = absence.id;
      // AUTHZ-007 — o alvo agora e o PROPRIO medico, nunca o owner. Antes o
      // spec afirmava `target_is_owner: true`, que era o achado: um medico com
      // `manage:availability` registrava ausencia da agenda alheia.
      expect(absence).toMatchObject({
        target_is_owner: false,
        creator_is_doctor: true,
        affected: 0,
        strategy: 'cancel',
      });
      const absenceItem = doctorPage.getByText(absenceReason, { exact: true }).locator('..');
      await expect(
        absenceItem.getByRole('button', { name: /remover|cancelar|excluir/iu }),
      ).toHaveCount(0);

      await ownerPage.goto('/configuracoes/procedimentos');
      await ownerPage
        .getByPlaceholder('Buscar por código, descrição ou categoria')
        .fill(procedureCode);
      await ownerPage.getByText('Mostrar inativos', { exact: true }).locator('input').check();
      const reactivateProcedureHttp = await clickServerAction(
        ownerPage,
        procedureRow(ownerPage, procedureDescription).getByRole('button', { name: 'Reativar' }),
      );
      expect(reactivateProcedureHttp).toBeLessThan(500);

      // AUTHZ-007 — reativar tambem e administracao de recurso compartilhado.
      await ownerPage.goto('/configuracoes/recursos');
      await ownerPage.getByText('Mostrar inativos', { exact: true }).locator('input').check();
      const reactivateResourceHttp = await clickServerAction(
        ownerPage,
        resourceRow(ownerPage, resourceName).getByRole('button', { name: 'Reativar' }),
      );
      expect(reactivateResourceHttp).toBeLessThan(500);

      appointmentDrawer = await openAppointmentDrawer(ownerPage);
      await expect(
        appointmentDrawer.getByLabel('Procedimento').getByRole('option', {
          name: procedureDescription,
        }),
      ).toHaveCount(1);
      await expect(appointmentDrawer.getByText(resourceName, { exact: true })).toBeVisible();

      const [trails] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ audits: number; idempotency: number; history: number }[]>`
          select
            (select count(*)::int from audit_events a where a.clinic_id=${clinicId!}::uuid
              and (a.resource_id=any(${[procedureId!, resourceId!, absenceId!]}::text[])
                   or coalesce(a.after::text,'') like any(${[
                     `%${procedureId}%`,
                     `%${resourceId}%`,
                     `%${absenceId}%`,
                   ]}::text[]))) audits,
            (select count(*)::int from idempotency_keys i where i.clinic_id=${clinicId!}::uuid
              and i.response::text like any(${[
                `%${procedureId}%`,
                `%${resourceId}%`,
                `%${absenceId}%`,
              ]}::text[])) idempotency,
            (select count(*)::int from procedure_history h where h.procedure_id=${procedureId!}::uuid) history
        `;
      });
      expect(trails).toMatchObject({ audits: 7, idempotency: 7, history: 2 });

      console.log(
        `[scheduling-config-a] ${JSON.stringify({
          longProcedureCodeRejected: true,
          longProcedureCodeHttpStatus: invalidHttp,
          duplicateProcedureCodeRejected: true,
          duplicateProcedureCodeHttpStatus: duplicateHttp,
          threeDecimalValueRoundedTo: Number(procedure.valor),
          htmlLikeProcedureRenderedAsText: true,
          crossTenantProcedureAndResourceHidden: true,
          inactiveItemsHiddenFromAgenda: true,
          reactivatedItemsRestoredToAgenda: true,
          doctorProcedureManagementDenied: true,
          doctorCanSeeGlobalResource,
          doctorChangedGlobalResource: inactive?.resource_actor_is_doctor,
          doctorCreatedAbsenceForOwner: absence.target_is_owner && absence.creator_is_doctor,
          absenceAffectedAppointments: absence.affected,
          absencePeriodPrevalidatedEmpty: futureAppointments?.count === 0,
          absenceRecoveryControlExposed: false,
          audits: trails?.audits,
          idempotency: trails?.idempotency,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const procedures = await tx<{ id: string }[]>`
              select id::text from procedures where clinic_id=${clinicId!}::uuid
                and (codigo=${procedureCode} or descricao like ${`${marker}%`})
            `;
            const resources = await tx<{ id: string }[]>`
              select id::text from schedulable_resources where clinic_id=${clinicId!}::uuid
                and name=${resourceName}
            `;
            const absences = await tx<{ id: string }[]>`
              select id::text from doctor_absences where clinic_id=${clinicId!}::uuid
                and reason=${absenceReason}
            `;
            const procedureIds = procedures.map(({ id }) => id);
            const resourceIds = resources.map(({ id }) => id);
            const absenceIds = absences.map(({ id }) => id);
            const allIds = [...procedureIds, ...resourceIds, ...absenceIds];
            const patterns = allIds.map((id) => `%${id}%`);
            const removedHistory = await tx<{ id: string }[]>`
              delete from procedure_history where clinic_id=${clinicId!}::uuid
                and procedure_id::text=any(${procedureIds}::text[]) returning id::text
            `;
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${clinicId!}::uuid
                and (resource_id=any(${allIds}::text[])
                     or coalesce(before::text,'') like ${`%${marker}%`}
                     or coalesce(after::text,'') like ${`%${marker}%`}
                     or coalesce(after::text,'') like any(${patterns}::text[])) returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id=${clinicId!}::uuid
                and (response::text like ${`%${marker}%`}
                     or response::text like any(${patterns}::text[])) returning key
            `;
            const removedAbsences = await tx<{ id: string }[]>`
              delete from doctor_absences where clinic_id=${clinicId!}::uuid
                and id::text=any(${absenceIds}::text[]) returning id::text
            `;
            const removedResources = await tx<{ id: string }[]>`
              delete from schedulable_resources where clinic_id=${clinicId!}::uuid
                and id::text=any(${resourceIds}::text[]) returning id::text
            `;
            const removedProcedures = await tx<{ id: string }[]>`
              delete from procedures where clinic_id=${clinicId!}::uuid
                and id::text=any(${procedureIds}::text[]) returning id::text
            `;
            const [remaining] = await tx<
              {
                procedures: number;
                resources: number;
                absences: number;
                history: number;
                audit: number;
                idempotency: number;
              }[]
            >`
              select
                (select count(*)::int from procedures where clinic_id=${clinicId!}::uuid
                  and (codigo=${procedureCode} or descricao like ${`${marker}%`})) procedures,
                (select count(*)::int from schedulable_resources where clinic_id=${clinicId!}::uuid
                  and name=${resourceName}) resources,
                (select count(*)::int from doctor_absences where clinic_id=${clinicId!}::uuid
                  and reason=${absenceReason}) absences,
                (select count(*)::int from procedure_history where clinic_id=${clinicId!}::uuid
                  and procedure_id::text=any(${procedureIds}::text[])) history,
                (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid
                  and (resource_id=any(${allIds}::text[])
                       or coalesce(after::text,'') like ${`%${marker}%`})) audit,
                (select count(*)::int from idempotency_keys where clinic_id=${clinicId!}::uuid
                  and response::text like any(${patterns}::text[])) idempotency
            `;
            return {
              removed: {
                history: removedHistory.length,
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                absences: removedAbsences.length,
                resources: removedResources.length,
                procedures: removedProcedures.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            procedures: 0,
            resources: 0,
            absences: 0,
            history: 0,
            audit: 0,
            idempotency: 0,
          });
          console.log(`[scheduling-config-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await Promise.all([
          ownerContext.close().catch(() => undefined),
          doctorContext.close().catch(() => undefined),
          tenantBContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});

declare global {
  var __configXss: number | undefined;
}
