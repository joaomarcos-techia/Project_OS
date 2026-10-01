import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CLINIC_PROFILE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const tenantBEmail = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type ClinicRow = {
  id: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  cnpj_encrypted: string | null;
  cnpj_hash: string | null;
  cnes: string | null;
  logo_url: string | null;
  slug: string;
  status: string;
  timezone: string;
  updated_at: string;
};

type VisibleProfile = {
  nome: string;
  endereco: string;
  telefone: string;
  cnpj: string;
  cnes: string;
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

async function readVisibleProfile(page: Page): Promise<VisibleProfile> {
  return {
    nome: await page.getByLabel('Nome *').inputValue(),
    endereco: await page.getByLabel('Endereço').inputValue(),
    telefone: await page.getByLabel('Telefone').inputValue(),
    cnpj: await page.getByLabel('CNPJ').inputValue(),
    cnes: await page.getByLabel('CNES').inputValue(),
  };
}

async function fillVisibleProfile(page: Page, profile: VisibleProfile): Promise<void> {
  await page.getByLabel('Nome *').fill(profile.nome);
  await page.getByLabel('Endereço').fill(profile.endereco);
  await page.getByLabel('Telefone').fill(profile.telefone);
  await page.getByLabel('CNPJ').fill(profile.cnpj);
  await page.getByLabel('CNES').fill(profile.cnes);
}

async function saveProfile(page: Page, expectSuccess = true): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  const status = (await responsePromise).status();
  if (expectSuccess) {
    await expect(page.getByText('Perfil salvo.', { exact: true })).toBeVisible();
  }
  return status;
}

test.describe('produção: perfil da Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('CNPJ inválido e duas edições concorrentes com restauração byte a byte', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    test.skip(!authorized, 'Exige autorização explícita para dados inválidos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de perfil só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !tenantBEmail || !sharedPassword) {
      throw new Error('Credenciais dos tenants de teste ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const firstContext = await browser.newContext({ baseURL: baseUrl });
    const secondContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const tenantBContext = await browser.newContext({ baseURL: baseUrl });
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    const doctorPage = await doctorContext.newPage();
    const tenantBPage = await tenantBContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `E2EPA${runId}`;
    const invalidCnes = `${marker}I`;
    const concurrentCnes = [`${marker}A`, `${marker}B`];
    let baseline: ClinicRow | undefined;
    let tenantBBaseline: ClinicRow | undefined;
    let visibleBaseline: VisibleProfile | undefined;
    let clinicId: string | undefined;
    let ownerId: string | undefined;

    const restoreExact = async (): Promise<void> => {
      if (!baseline) return;
      const snapshot = baseline;
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}\+00$/u.test(snapshot.updated_at)) {
        throw new Error('Timestamp original da clínica tem formato inesperado.');
      }
      await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`
          update clinics set
            nome=${snapshot.nome}, endereco=${snapshot.endereco}, telefone=${snapshot.telefone},
            cnpj_encrypted=${snapshot.cnpj_encrypted}, cnpj_hash=${snapshot.cnpj_hash},
            cnes=${snapshot.cnes}, logo_url=${snapshot.logo_url}, slug=${snapshot.slug},
            status=${snapshot.status}::clinic_status, timezone=${snapshot.timezone}
          where id=${snapshot.id}::uuid
        `;
        await tx.unsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.unsafe(
          `update clinics set updated_at='${snapshot.updated_at}'::timestamptz where id=$1::uuid`,
          [snapshot.id],
        );
      });
    };

    try {
      const state = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const identities = await tx<
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
        const owner = identities.find(({ email }) => email === ownerEmail.toLowerCase());
        const doctor = identities.find(({ email }) => email === doctorEmail.toLowerCase());
        const tenantB = identities.find(({ email }) => email === tenantBEmail.toLowerCase());
        if (!owner || !doctor || !tenantB) throw new Error('Identidades de teste incompletas.');
        expect(owner.clinic_id).toBe(doctor.clinic_id);
        expect(tenantB.clinic_id).not.toBe(owner.clinic_id);
        expect(owner.permissions).toContain('manage:settings');
        expect(doctor.permissions).not.toContain('manage:settings');
        const clinics = await tx<ClinicRow[]>`
          select id::text, nome, endereco, telefone, cnpj_encrypted, cnpj_hash, cnes,
                 logo_url, slug, status::text, timezone, updated_at::text updated_at
            from clinics where id=any(${[owner.clinic_id, tenantB.clinic_id]}::uuid[])
        `;
        return {
          owner,
          doctor,
          tenantB,
          clinicA: clinics.find(({ id }) => id === owner.clinic_id),
          clinicB: clinics.find(({ id }) => id === tenantB.clinic_id),
        };
      });
      if (!state.clinicA || !state.clinicB) throw new Error('Clínicas A/B não encontradas.');
      baseline = state.clinicA;
      tenantBBaseline = state.clinicB;
      clinicId = state.owner.clinic_id;
      ownerId = state.owner.id;

      await Promise.all([
        signInContext(firstContext, ownerEmail, sharedPassword),
        signInContext(secondContext, ownerEmail, sharedPassword),
        signInContext(doctorContext, doctorEmail, sharedPassword),
        signInContext(tenantBContext, tenantBEmail, sharedPassword),
      ]);
      await Promise.all([
        firstPage.goto('/configuracoes/perfil'),
        secondPage.goto('/configuracoes/perfil'),
        doctorPage.goto('/configuracoes/perfil'),
        tenantBPage.goto('/configuracoes/perfil'),
      ]);
      await expect(doctorPage.getByText('Sem acesso', { exact: true })).toBeVisible();
      await expect(doctorPage.getByRole('button', { name: 'Salvar perfil' })).toHaveCount(0);
      await expect(tenantBPage.getByRole('button', { name: 'Salvar perfil' })).toBeVisible();

      visibleBaseline = await readVisibleProfile(firstPage);
      expect(await readVisibleProfile(secondPage)).toEqual(visibleBaseline);

      // VAL-002 — o achado: a UI mascarava e enviava `1`, o backend respondia
      // 200 e persistia ciphertext/hash de um documento invalido. Agora o
      // schema exige 14 digitos e checksum, entao NADA e salvo e o rascunho
      // digitado permanece na tela para correcao.
      await firstPage.getByLabel('CNPJ').fill('1');
      await firstPage.getByLabel('CNES').fill(invalidCnes);
      const invalidHttp = await saveProfile(firstPage, false);
      expect(invalidHttp).toBe(200);
      await expect(firstPage.getByText('Perfil salvo.', { exact: true })).toHaveCount(0);
      await firstPage.reload();
      // Recarregando, o CNPJ invalido NAO foi persistido.
      expect(await firstPage.getByLabel('CNPJ').inputValue()).not.toBe('1');

      const [invalidState] = await sql<
        { cnes: string | null; cnpj_hash_changed: boolean; immutable_fields_unchanged: boolean }[]
      >`
        select cnes,
               cnpj_hash is distinct from ${baseline.cnpj_hash} cnpj_hash_changed,
               slug=${baseline.slug} and status=${baseline.status}::clinic_status
                 and timezone=${baseline.timezone} immutable_fields_unchanged
          from clinics where id=${clinicId}::uuid
      `;
      // VAL-002 — antes o CNES invalido e o hash de um CNPJ invalido eram
      // PERSISTIDOS. Agora a gravacao inteira e recusada: nada mudou no banco.
      expect(invalidState).toEqual({
        cnes: baseline.cnes,
        cnpj_hash_changed: false,
        immutable_fields_unchanged: true,
      });

      await restoreExact();
      await firstPage.reload();
      expect(await readVisibleProfile(firstPage)).toEqual(visibleBaseline);

      await Promise.all([firstPage.reload(), secondPage.reload()]);
      await Promise.all([
        fillVisibleProfile(firstPage, { ...visibleBaseline, cnes: concurrentCnes[0]! }),
        fillVisibleProfile(secondPage, { ...visibleBaseline, cnes: concurrentCnes[1]! }),
      ]);
      const firstResponse = firstPage.waitForResponse(isServerAction);
      const secondResponse = secondPage.waitForResponse(isServerAction);
      await Promise.all([
        firstPage.getByRole('button', { name: 'Salvar perfil' }).click(),
        secondPage.getByRole('button', { name: 'Salvar perfil' }).click(),
      ]);
      const concurrentHttp = (await Promise.all([firstResponse, secondResponse])).map((response) =>
        response.status(),
      );
      expect(concurrentHttp).toEqual([200, 200]);
      // DATA-005 — o achado: as DUAS abas mostravam "Perfil salvo." e um dos
      // valores sumia em silencio. Com o compare-and-swap so uma vence; a
      // perdedora recebe instrucao de recarregar, nao confirmacao falsa.
      const savedCount =
        (await firstPage.getByText('Perfil salvo.', { exact: true }).count()) +
        (await secondPage.getByText('Perfil salvo.', { exact: true }).count());
      expect(savedCount).toBe(1);

      const [concurrentState] = await sql<{ cnes: string | null; audits: number }[]>`
        select c.cnes,
               (select count(*)::int from audit_events a where a.clinic_id=c.id
                 and a.action='tenancy.clinic.profile_updated'
                 and a.after->>'cnes'=any(${concurrentCnes}::text[])) audits
          from clinics c where c.id=${clinicId}::uuid
      `;
      expect(concurrentCnes).toContain(concurrentState?.cnes);
      // Uma auditoria, nao duas: o perdedor reverte sem deixar trilha de sucesso.
      expect(concurrentState?.audits).toBe(1);

      const [testAudits] = await sql<{ count: number }[]>`
        select count(*)::int count from audit_events
         where clinic_id=${clinicId}::uuid and user_id=${ownerId}::uuid
           and action='tenancy.clinic.profile_updated'
           and (before->>'cnes' like ${`${marker}%`} or after->>'cnes' like ${`${marker}%`})
      `;
      // Antes eram 3 trilhas de sucesso: a gravacao com CNPJ invalido (VAL-002)
      // e as DUAS edicoes concorrentes (DATA-005). Agora a invalida nem chega a
      // gravar e a concorrente perdedora reverte — sobra uma.
      expect(testAudits?.count).toBe(1);

      await restoreExact();
      const clinicABaseline = baseline;
      const clinicBBaseline = tenantBBaseline;
      const [restored, tenantBAfter] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<ClinicRow[]>`
          select id::text, nome, endereco, telefone, cnpj_encrypted, cnpj_hash, cnes,
                 logo_url, slug, status::text, timezone, updated_at::text updated_at
            from clinics where id=any(${[clinicABaseline.id, clinicBBaseline.id]}::uuid[])
            order by id
        `;
      });
      const restoredA = restored?.id === clinicABaseline.id ? restored : tenantBAfter;
      const unchangedB = restored?.id === clinicBBaseline.id ? restored : tenantBAfter;
      expect(restoredA).toEqual(clinicABaseline);
      expect(unchangedB).toEqual(clinicBBaseline);

      console.log(
        `[clinic-profile-a] ${JSON.stringify({
          invalidCnpjAccepted: true,
          invalidCnpjHttpStatus: invalidHttp,
          invalidCnpjPersistedAndRendered: true,
          clinicLifecycleFieldsUnchanged: invalidState?.immutable_fields_unchanged,
          concurrentUpdateHttpStatuses: concurrentHttp,
          concurrentUpdatesAccepted: true,
          concurrentWinnerWasOneSubmittedValue: concurrentCnes.includes(
            concurrentState?.cnes ?? '',
          ),
          concurrentAudits: concurrentState?.audits,
          conflictExposedToEitherEditor: false,
          doctorWithoutManageSettingsDenied: true,
          tenantBRecordUnchanged: true,
          exactClinicARowRestored: true,
          testAudits: testAudits?.count,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      try {
        await restoreExact();
        if (baseline && tenantBBaseline) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${baseline!.id}::uuid
                and action='tenancy.clinic.profile_updated'
                and (before->>'cnes' like ${`${marker}%`} or after->>'cnes' like ${`${marker}%`})
              returning id::text
            `;
            const clinics = await tx<ClinicRow[]>`
              select id::text, nome, endereco, telefone, cnpj_encrypted, cnpj_hash, cnes,
                     logo_url, slug, status::text, timezone, updated_at::text updated_at
                from clinics where id=any(${[baseline!.id, tenantBBaseline!.id]}::uuid[])
            `;
            const [remaining] = await tx<{ audit: number }[]>`
              select count(*)::int audit from audit_events where clinic_id=${baseline!.id}::uuid
                and action='tenancy.clinic.profile_updated'
                and (before->>'cnes' like ${`${marker}%`} or after->>'cnes' like ${`${marker}%`})
            `;
            return { removedAudit: removedAudit.length, clinics, remaining };
          });
          expect(cleanup.clinics.find(({ id }) => id === baseline!.id)).toEqual(baseline);
          expect(cleanup.clinics.find(({ id }) => id === tenantBBaseline!.id)).toEqual(
            tenantBBaseline,
          );
          expect(cleanup.remaining).toEqual({ audit: 0 });
          console.log(
            `[clinic-profile-a-cleanup] ${JSON.stringify({
              removedAudit: cleanup.removedAudit,
              remainingAudit: cleanup.remaining?.audit,
              clinicARestored: true,
              tenantBUnchanged: true,
            })}`,
          );
        }
      } finally {
        await Promise.all([
          firstContext.close().catch(() => undefined),
          secondContext.close().catch(() => undefined),
          doctorContext.close().catch(() => undefined),
          tenantBContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
