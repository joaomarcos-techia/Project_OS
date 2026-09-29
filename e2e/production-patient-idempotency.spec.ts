import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_IDEMPOTENCY === 'ALLOW_SYNTHETIC_PATIENT';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type CapturedAction = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

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

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '8').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

function capturedAction(request: import('@playwright/test').Request): CapturedAction {
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
  return {
    url: request.url(),
    headers: Object.fromEntries(
      allowedHeaders.flatMap((header) =>
        sourceHeaders[header] ? [[header, sourceHeaders[header]]] : [],
      ),
    ),
    body,
  };
}

function replaceOnce(body: Buffer, from: string, to: string): Buffer {
  const source = Buffer.from(from, 'utf8');
  const replacement = Buffer.from(to, 'utf8');
  if (source.length !== replacement.length)
    throw new Error('Payload alternativo mudou de tamanho.');
  const first = body.indexOf(source);
  if (first < 0 || body.indexOf(source, first + source.length) >= 0) {
    throw new Error('Nome sintético não apareceu exatamente uma vez no payload capturado.');
  }
  const changed = Buffer.from(body);
  replacement.copy(changed, first);
  return changed;
}

test.describe('produção: idempotência concorrente de paciente', () => {
  test.describe.configure({ retries: 0 });

  test('deduplica payload igual e rejeita a mesma chave com payload diferente', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_IDEMPOTENCY=ALLOW_SYNTHETIC_PATIENT para criar a fixture.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de idempotência só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword) throw new Error('Credencial do owner B ausente.');
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    const runId = String(Date.now()).slice(-10);
    const patientName = `[E2E-IDEMP-${runId}]-PATIENT-A`;
    const conflictName = `[E2E-IDEMP-${runId}]-PATIENT-B`;
    const patientEmail = `e2e-idemp-${runId}@example.test`;
    let clinicId: string | undefined;
    let patientId: string | undefined;
    let clientKey: string | undefined;

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
      clientKey = await drawer.locator('input[name="idempotencyKey"]').inputValue();
      expect(clientKey).toMatch(/^[0-9a-f-]{36}$/iu);

      const requestPromise = page.waitForRequest(
        (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
      );
      const submitPromise = drawer.getByRole('button', { name: 'Criar paciente' }).click();
      const action = capturedAction(await requestPromise);
      const duplicateResponsesPromise = Promise.all(
        Array.from({ length: 5 }, () =>
          context.request.fetch(action.url, {
            method: 'POST',
            headers: action.headers,
            data: action.body,
            failOnStatusCode: false,
          }),
        ),
      );
      await submitPromise;
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
      const duplicateResponses = await duplicateResponsesPromise;
      const duplicateStatuses = duplicateResponses.map((response) => response.status());
      for (const status of duplicateStatuses) expect(status).toBeLessThan(500);
      for (const response of duplicateResponses) await response.dispose();

      patientId = new URL(page.url()).pathname.split('/').at(-1);
      expect(patientId).toMatch(/^[0-9a-f-]{36}$/iu);
      const idempotencyKey = `patient:create:${clientKey.replaceAll('-', '').toLowerCase()}`;

      const conflictBody = replaceOnce(action.body, patientName, conflictName);
      const conflictResponse = await context.request.fetch(action.url, {
        method: 'POST',
        headers: action.headers,
        data: conflictBody,
        failOnStatusCode: false,
      });
      expect(conflictResponse.status()).toBeLessThan(500);
      expect(await conflictResponse.text()).toContain('Os dados mudaram');
      await conflictResponse.dispose();

      const evidence = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const patients = await tx<{ id: string; name: string }[]>`
          select id::text, nome as name
            from patients
           where clinic_id = ${clinicId!}::uuid
             and email = ${patientEmail}
        `;
        const [audit] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from audit_events
           where clinic_id = ${clinicId!}::uuid
             and action = 'patient.core.created'
             and after ->> 'id' = ${patientId!}
        `;
        const [outbox] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from outbox
           where clinic_id = ${clinicId!}::uuid
             and event_type = 'patient.core.created'
             and payload ->> 'patientId' = ${patientId!}
        `;
        const idem = await tx<{ payload_hash: string; response_id: string | null }[]>`
          select payload_hash, response ->> 'id' as response_id
            from idempotency_keys
           where clinic_id = ${clinicId!}::uuid
             and key = ${idempotencyKey}
        `;
        return {
          patientCount: patients.length,
          patientIdMatches: patients[0]?.id === patientId,
          originalPayloadWon: patients[0]?.name === patientName,
          conflictPayloadCreated: patients.some((patient) => patient.name === conflictName),
          auditCount: audit?.n ?? -1,
          outboxCount: outbox?.n ?? -1,
          idempotencyRows: idem.length,
          responseIdMatches: idem[0]?.response_id === patientId,
        };
      });

      expect(evidence).toEqual({
        patientCount: 1,
        patientIdMatches: true,
        originalPayloadWon: true,
        conflictPayloadCreated: false,
        auditCount: 1,
        outboxCount: 1,
        idempotencyRows: 1,
        responseIdMatches: true,
      });

      console.log(
        `[patient-idempotency] ${JSON.stringify({
          concurrentRequests: 6,
          duplicateStatuses,
          conflictStatus: conflictResponse.status(),
          ...evidence,
          result: 'deduplicated-and-conflict-rejected',
        })}`,
      );
    } finally {
      if (clinicId) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const removed = await tx<{ id: string }[]>`
            update patients
               set deleted_at = coalesce(deleted_at, now())
             where clinic_id = ${clinicId!}::uuid
               and email = ${patientEmail}
               and nome like ${`[E2E-IDEMP-${runId}]%`}
            returning id
          `;
          const [active] = await tx<{ n: number }[]>`
            select count(*)::int as n
              from patients
             where clinic_id = ${clinicId!}::uuid
               and email = ${patientEmail}
               and deleted_at is null
          `;
          return { matched: removed.length, active: active?.n ?? -1 };
        });
        expect(cleanup.active).toBe(0);
        console.log(`[patient-idempotency] cleanup ${JSON.stringify(cleanup)}`);
      }
      await context.close();
      await sql.end();
    }
  });
});
