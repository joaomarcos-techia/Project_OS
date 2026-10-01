import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_LGPD_EXPORT === 'ALLOW_SYNTHETIC_EMAIL';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;
const controlledMailbox = process.env.E2E_CONTROLLED_EMAIL;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionSupabaseConfig(): { url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionSupabaseConfig();
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

function controlledAlias(mailbox: string, runId: string): string {
  const match = /^([^+@]+)(?:\+[^@]*)?@gmail\.com$/iu.exec(mailbox.trim().toLowerCase());
  if (!match?.[1]) {
    throw new Error('E2E_CONTROLLED_EMAIL deve ser uma caixa Gmail controlada.');
  }
  return `${match[1]}+clinicaos-pentest-${runId}@gmail.com`;
}

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '6').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

type RequestEvidence = {
  id: string;
  status: string;
  status_reason: string | null;
  requester_notified_at: string | null;
  requester_notification_channel: string | null;
  export_signed_url: string | null;
  export_signed_url_expires_at: string | null;
  outbox_status: string | null;
  outbox_attempts: number | null;
  outbox_last_error: string | null;
};

test.describe('produção: exportação LGPD e e-mail transacional', () => {
  test.describe.configure({ retries: 0 });

  test('gera PDF/JSON privados e entrega um e-mail sintético pelo worker real', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_LGPD_EXPORT=ALLOW_SYNTHETIC_EMAIL para enviar um e-mail controlado.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste LGPD só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword || !controlledMailbox) {
      throw new Error('Credencial B ou caixa controlada ausente.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-LGPD-${runId}]`;
    const patientName = `${marker} Paciente sintético`;
    const patientEmail = controlledAlias(controlledMailbox, runId);
    let clinicId: string | undefined;
    let patientId: string | undefined;
    let requestId: string | undefined;
    let patientIdempotencyKey: string | undefined;
    let exportIdempotencyKey: string | undefined;
    const storagePaths: string[] = [];
    const { url: supabaseUrl, key: adminSecret } = productionSupabaseConfig();
    const admin = createSsrClient(supabaseUrl, adminSecret, {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      const [identity] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ clinic_id: string }[]>`
          select p.clinic_id::text
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) = ${ownerEmail.toLowerCase()}
             and p.role = 'owner'
             and p.ativo = true
             and p.deleted_at is null
        `;
      });
      if (!identity) throw new Error('Owner B não encontrado.');
      clinicId = identity.clinic_id;

      await signInContext(context, ownerEmail, sharedPassword);
      await page.goto('/pacientes?novo=1');
      const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
      await expect(drawer).toBeVisible();
      await drawer.locator('input[name="nome"]').fill(patientName);
      await drawer.locator('input[name="cpf"]').fill(validCpf(runId));
      await drawer.locator('input[name="email"]').fill(patientEmail);
      const patientClientKey = await drawer.locator('input[name="idempotencyKey"]').inputValue();
      patientIdempotencyKey = `patient:create:${patientClientKey.replaceAll('-', '').toLowerCase()}`;
      await drawer.getByRole('button', { name: 'Criar paciente' }).click();
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
      patientId = new URL(page.url()).pathname.split('/').at(-1);
      expect(patientId).toMatch(/^[0-9a-f-]{36}$/iu);

      const exportButton = page.getByRole('button', { name: 'Exportar dados (LGPD)' });
      const exportForm = exportButton.locator('xpath=ancestor::form[1]');
      const exportClientKey = await exportForm.locator('input[name="idempotencyKey"]').inputValue();
      exportIdempotencyKey = `patient:lgpd_export:${exportClientKey.replaceAll('-', '').toLowerCase()}`;
      await exportButton.click();
      await expect(page.getByText(/Exportação solicitada/iu)).toBeVisible({ timeout: 30_000 });

      const [createdRequest] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string }[]>`
          select id::text
            from lgpd_requests
           where clinic_id = ${clinicId!}::uuid
             and patient_id = ${patientId!}::uuid
             and type = 'export'
           order by requested_at desc
           limit 1
        `;
      });
      if (!createdRequest) throw new Error('Solicitação LGPD não persistiu.');
      requestId = createdRequest.id;

      let evidence: RequestEvidence | undefined;
      await expect
        .poll(
          async () => {
            const [row] = await sql.begin(async (tx) => {
              await tx.unsafe('RESET ROLE');
              return tx<RequestEvidence[]>`
                select r.id::text,
                       r.status::text,
                       r.status_reason,
                       r.requester_notified_at::text,
                       r.requester_notification_channel::text,
                       r.export_signed_url,
                       r.export_signed_url_expires_at::text,
                       o.status::text as outbox_status,
                       o.attempts as outbox_attempts,
                       o.last_error as outbox_last_error
                  from lgpd_requests r
                  left join outbox o
                    on o.clinic_id = r.clinic_id
                   and o.event_type = 'patient.lgpd.export_requested'
                   and o.payload ->> 'requestId' = r.id::text
                 where r.id = ${requestId!}::uuid
              `;
            });
            evidence = row;
            return row?.status ?? 'missing';
          },
          { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
        )
        .toBe('completed');

      if (!evidence?.export_signed_url || !evidence.export_signed_url_expires_at) {
        throw new Error('Exportação concluída sem URL/expiração.');
      }
      expect(evidence.status_reason).toBe('export_ready_email_sent');
      expect(evidence.requester_notification_channel).toBe('email');
      expect(evidence.requester_notified_at).not.toBeNull();
      expect(evidence.outbox_status).toBe('processed');
      expect(evidence.outbox_attempts).toBeGreaterThanOrEqual(1);
      expect(evidence.outbox_last_error).toBeNull();

      const expiresInMs = new Date(evidence.export_signed_url_expires_at).getTime() - Date.now();
      expect(expiresInMs).toBeGreaterThan(22 * 60 * 60 * 1_000);
      expect(expiresInMs).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + 5 * 60 * 1_000);

      const signedPdf = await context.request.get(evidence.export_signed_url);
      expect(signedPdf.status()).toBe(200);
      expect(signedPdf.headers()['content-type']).toContain('application/pdf');
      const signedPdfBytes = await signedPdf.body();
      expect(signedPdfBytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
      await signedPdf.dispose();

      storagePaths.push(
        `${clinicId}/${patientId}/${requestId}.pdf`,
        `${clinicId}/${patientId}/${requestId}.json`,
      );
      const pdfDownload = await admin.storage.from('lgpd-exports').download(storagePaths[0]!);
      const jsonDownload = await admin.storage.from('lgpd-exports').download(storagePaths[1]!);
      if (pdfDownload.error || !pdfDownload.data || jsonDownload.error || !jsonDownload.data) {
        throw new Error('Artefatos LGPD não puderam ser baixados pelo canal administrativo.');
      }
      expect(pdfDownload.data.size).toBeGreaterThan(500);
      const exportedJson = JSON.parse(await jsonDownload.data.text()) as {
        patientId?: unknown;
        clinicId?: unknown;
        sections?: unknown;
      };
      expect(exportedJson.patientId).toBe(patientId);
      expect(exportedJson.clinicId).toBe(clinicId);
      expect(exportedJson.sections).toBeTruthy();

      console.log(
        `[lgpd-export] ${JSON.stringify({
          requestStatus: evidence.status,
          statusReason: evidence.status_reason,
          notificationChannel: evidence.requester_notification_channel,
          outboxStatus: evidence.outbox_status,
          outboxAttempts: evidence.outbox_attempts,
          signedPdfHttp: 200,
          pdfMagic: true,
          jsonMatchesFixture: true,
          recipient: 'controlled-gmail-alias',
          result: 'provider-accepted-and-artifacts-readable',
        })}`,
      );
    } finally {
      if (clinicId && patientId) {
        const requests = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          return tx<{ id: string }[]>`
            select id::text
              from lgpd_requests
             where clinic_id = ${clinicId!}::uuid
               and patient_id = ${patientId!}::uuid
               and type = 'export'
          `;
        });
        for (const row of requests) {
          storagePaths.push(
            `${clinicId}/${patientId}/${row.id}.pdf`,
            `${clinicId}/${patientId}/${row.id}.json`,
          );
        }
        const uniquePaths = [...new Set(storagePaths)];
        if (uniquePaths.length > 0) {
          const removed = await admin.storage.from('lgpd-exports').remove(uniquePaths);
          if (removed.error) throw new Error('Cleanup dos artefatos LGPD falhou.');
        }

        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const outbox = await tx<{ id: string }[]>`
            delete from outbox
             where clinic_id = ${clinicId!}::uuid
               and payload ->> 'patientId' = ${patientId!}
            returning id::text
          `;
          const audits = await tx<{ id: string }[]>`
            delete from audit_events
             where clinic_id = ${clinicId!}::uuid
               and (resource_id = ${patientId!}
                    or after ->> 'id' = ${patientId!}
                    or after ->> 'patientId' = ${patientId!})
            returning id::text
          `;
          const idempotencyKeys = [patientIdempotencyKey, exportIdempotencyKey].filter(
            (key): key is string => typeof key === 'string',
          );
          const idempotency =
            idempotencyKeys.length > 0
              ? await tx<{ key: string }[]>`
                  delete from idempotency_keys
                   where clinic_id = ${clinicId!}::uuid
                     and key in ${tx(idempotencyKeys)}
                  returning key
                `
              : [];
          const lgpd = await tx<{ id: string }[]>`
            delete from lgpd_requests
             where clinic_id = ${clinicId!}::uuid
               and patient_id = ${patientId!}::uuid
               and type = 'export'
            returning id::text
          `;
          const patients = await tx<{ id: string }[]>`
            delete from patients
             where id = ${patientId!}::uuid
               and clinic_id = ${clinicId!}::uuid
               and nome = ${patientName}
               and email = ${patientEmail}
            returning id::text
          `;
          return {
            outbox: outbox.length,
            audits: audits.length,
            idempotency: idempotency.length,
            lgpd: lgpd.length,
            patients: patients.length,
          };
        });
        const [remaining] = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          return tx<{ patients: number; requests: number; outbox: number }[]>`
            select
              (select count(*)::int from patients where id = ${patientId!}::uuid) as patients,
              (select count(*)::int from lgpd_requests where patient_id = ${patientId!}::uuid) as requests,
              (select count(*)::int from outbox where payload ->> 'patientId' = ${patientId!}) as outbox
          `;
        });
        expect(remaining).toEqual({ patients: 0, requests: 0, outbox: 0 });
        console.log(`[lgpd-export] cleanup ${JSON.stringify({ ...cleanup, remaining })}`);
      }
      await context.close();
      await sql.end();
    }
  });
});
