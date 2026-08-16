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

const authorized = process.env.E2E_PRODUCTION_CONVERSATION_HANDOFF === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
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

async function clickAction(button: Locator): Promise<number> {
  const responsePromise = button.page().waitForResponse(isServerAction);
  await button.click();
  return (await responsePromise).status();
}

async function submitDisabledReply(page: Page, text: string): Promise<number> {
  const form = page.locator('form').filter({ has: page.getByLabel('Resposta ao paciente') });
  const responsePromise = page.waitForResponse(isServerAction);
  await form.evaluate((element, value) => {
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'text';
    hidden.value = value;
    element.appendChild(hidden);
    (element as HTMLFormElement).requestSubmit();
  }, text);
  return (await responsePromise).status();
}

test.describe('produção: handoff humano de conversa sintética na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('assume, prioriza, reatribui, nega ator antigo e devolve sem enviar mensagem', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    test.skip(!authorized, 'Exige autorização explícita para conversa sintética na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de conversa só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !attendantEmail || !sharedPassword) {
      throw new Error('Credenciais da Clínica A ausentes.');
    }

    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
    process.env.DATABASE_URL_DEV = process.env.DATABASE_URL_PROD;
    const { encryptForTenant, hashForLookup } = await import('../src/lib/crypto');
    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const attendantContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const intent = `e2e_handoff_${runId}`;
    const syntheticPhone = `+5511${runId}`;
    let clinicId: string | undefined;
    let conversationId: string | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; email: string; clinic_id: string; permissions: string[] }[]>`
          select ep.user_id::text id, lower(u.email) email, ep.clinic_id::text, ep.permissions
            from auth.users u join effective_permissions_v ep on ep.user_id=u.id
           where lower(u.email)=any(${[
             ownerEmail.toLowerCase(),
             attendantEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo=true and ep.deleted_at is null
        `;
      });
      const owner = identities.find(({ email }) => email === ownerEmail.toLowerCase());
      const attendant = identities.find(({ email }) => email === attendantEmail.toLowerCase());
      if (!owner || !attendant) throw new Error('Owner/atendente não encontrados.');
      expect(owner.clinic_id).toBe(attendant.clinic_id);
      expect(owner.permissions).toContain('manage:conversations');
      expect(attendant.permissions).toContain('manage:conversations');
      clinicId = owner.clinic_id;
      const testClinicId = owner.clinic_id;
      const testAttendantId = attendant.id;

      const phoneEncrypted = await encryptForTenant(testClinicId, syntheticPhone);
      const phoneHash = await hashForLookup(syntheticPhone);
      const [created] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string }[]>`
          insert into ai_conversations
            (clinic_id, patient_phone_hash, patient_phone_encrypted, status, intent_atual,
             fallback_count, started_at, last_message_at, expires_at)
          values
            (${testClinicId}::uuid, ${phoneHash}, ${phoneEncrypted}, 'active', ${intent}, 0,
             now(), now(), now() + interval '1 day')
          returning id::text
        `;
      });
      if (!created) throw new Error('Conversa sintética não foi criada.');
      conversationId = created.id;
      const testConversationId = created.id;

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(attendantContext, attendantEmail, sharedPassword),
      ]);
      await ownerPage.goto(`/conversas/${testConversationId}`);
      await expect(ownerPage.getByText('Agente respondendo', { exact: true })).toBeVisible();
      await expect(
        ownerPage.getByText('Nenhuma mensagem nesta conversa.', { exact: true }),
      ).toBeVisible();

      const assumeHttp = await clickAction(
        ownerPage.getByRole('button', { name: 'Assumir atendimento' }),
      );
      expect(assumeHttp).toBe(200);
      await expect(
        ownerPage.getByText('Atendimento sob sua responsabilidade', { exact: true }),
      ).toBeVisible();
      await expect(
        ownerPage.getByText('Janela de 24h da Meta expirada', { exact: true }),
      ).toBeVisible();
      await expect(ownerPage.getByLabel('Resposta ao paciente')).toBeDisabled();

      const priorityForm = ownerPage
        .locator('form')
        .filter({ has: ownerPage.getByRole('button', { name: 'Atualizar' }) });
      await priorityForm.getByLabel('Prioridade').selectOption('urgent');
      const priorityHttp = await clickAction(
        priorityForm.getByRole('button', { name: 'Atualizar' }),
      );
      expect(priorityHttp).toBe(200);
      await expect(ownerPage.getByText(/prioridade urgente/u)).toBeVisible();

      const manualNegativeHttp = await submitDisabledReply(
        ownerPage,
        `[E2E-HANDOFF-${runId}] não deve sair`,
      );
      expect(manualNegativeHttp).toBe(200);
      await expect(ownerPage.getByText('Não foi possível enviar', { exact: true })).toBeVisible();
      await expect(ownerPage.getByText(/A janela de 24h da Meta expirou/u)).toBeVisible();

      await attendantPage.goto(`/conversas/${testConversationId}`);
      const reassignHttp = await clickAction(
        attendantPage.getByRole('button', { name: 'Reatribuir para mim' }),
      );
      expect(reassignHttp).toBe(200);
      await expect(
        attendantPage.getByText('Atendimento sob sua responsabilidade', { exact: true }),
      ).toBeVisible();

      const staleReturnHttp = await clickAction(
        ownerPage.getByRole('button', { name: 'Devolver ao agente' }),
      );
      expect(staleReturnHttp).toBe(200);
      await expect(ownerPage.getByText('Não foi possível devolver', { exact: true })).toBeVisible();
      await expect(ownerPage.getByText(/Assuma formalmente esta conversa antes/u)).toBeVisible();

      const returnHttp = await clickAction(
        attendantPage.getByRole('button', { name: 'Devolver ao agente' }),
      );
      expect(returnHttp).toBe(200);
      await expect(
        attendantPage.getByRole('button', { name: 'Assumir atendimento' }),
      ).toBeVisible();

      const [state] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<
          {
            status: string;
            handoffs: number;
            open_handoffs: number;
            priority: string;
            assigned_to_attendant: boolean;
            messages: number;
            outbox: number;
            audits: number;
            idempotency: number;
          }[]
        >`
          select c.status::text,
                 (select count(*)::int from ai_handoff_queue h
                   where h.conversation_id=c.id) handoffs,
                 (select count(*)::int from ai_handoff_queue h
                   where h.conversation_id=c.id and h.resolved_at is null) open_handoffs,
                 coalesce((select h.priority::text from ai_handoff_queue h
                   where h.conversation_id=c.id order by h.created_at desc limit 1), 'none') priority,
                 coalesce((select h.assigned_to=${testAttendantId}::uuid from ai_handoff_queue h
                   where h.conversation_id=c.id order by h.created_at desc limit 1), false) assigned_to_attendant,
                 (select count(*)::int from ai_messages m where m.conversation_id=c.id) messages,
                 (select count(*)::int from outbox o where o.clinic_id=c.clinic_id
                   and coalesce(o.payload::text,'') like ${`%${testConversationId}%`}) outbox,
                 (select count(*)::int from audit_events a where a.clinic_id=c.clinic_id
                   and a.resource_id=c.id::text) audits,
                 (select count(*)::int from idempotency_keys i where i.clinic_id=c.clinic_id
                   and i.response::text like ${`%${testConversationId}%`}) idempotency
            from ai_conversations c where c.id=${testConversationId}::uuid
              and c.clinic_id=${testClinicId}::uuid
        `;
        return rows;
      });
      expect(state).toEqual({
        status: 'active',
        handoffs: 1,
        open_handoffs: 0,
        priority: 'urgent',
        assigned_to_attendant: true,
        messages: 0,
        outbox: 0,
        audits: 4,
        idempotency: 4,
      });

      console.log(
        `[conversation-handoff-a] ${JSON.stringify({
          assumeHttpStatus: assumeHttp,
          priorityHttpStatus: priorityHttp,
          manualReplyOutsideWindowHttpStatus: manualNegativeHttp,
          reassignHttpStatus: reassignHttp,
          staleOwnerReturnHttpStatus: staleReturnHttp,
          assignedAttendantReturnHttpStatus: returnHttp,
          ownerAssignedThenAttendantReassigned: state?.assigned_to_attendant,
          staleOwnerRejectedByBackend: true,
          manualReplyOutsideWindowRejectedByBackend: true,
          finalStatus: state?.status,
          handoffs: state?.handoffs,
          openHandoffs: state?.open_handoffs,
          finalPriority: state?.priority,
          messages: state?.messages,
          outbox: state?.outbox,
          audits: state?.audits,
          idempotency: state?.idempotency,
          metaMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId && conversationId) {
          const testClinicId = clinicId;
          const testConversationId = conversationId;
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${testClinicId}::uuid
                and resource_id=${testConversationId} returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id=${testClinicId}::uuid
                and response::text like ${`%${testConversationId}%`} returning key
            `;
            const removedConversation = await tx<{ id: string }[]>`
              delete from ai_conversations where id=${testConversationId}::uuid
                and clinic_id=${testClinicId}::uuid returning id::text
            `;
            const [remaining] = await tx<
              {
                conversations: number;
                handoffs: number;
                messages: number;
                audit: number;
                idempotency: number;
                outbox: number;
              }[]
            >`
              select
                (select count(*)::int from ai_conversations where id=${testConversationId}::uuid) conversations,
                (select count(*)::int from ai_handoff_queue where conversation_id=${testConversationId}::uuid) handoffs,
                (select count(*)::int from ai_messages where conversation_id=${testConversationId}::uuid) messages,
                (select count(*)::int from audit_events where clinic_id=${testClinicId}::uuid
                  and resource_id=${testConversationId}) audit,
                (select count(*)::int from idempotency_keys where clinic_id=${testClinicId}::uuid
                  and response::text like ${`%${testConversationId}%`}) idempotency,
                (select count(*)::int from outbox where clinic_id=${testClinicId}::uuid
                  and coalesce(payload::text,'') like ${`%${testConversationId}%`}) outbox
            `;
            return {
              removed: {
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                conversations: removedConversation.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            conversations: 0,
            handoffs: 0,
            messages: 0,
            audit: 0,
            idempotency: 0,
            outbox: 0,
          });
          console.log(`[conversation-handoff-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await Promise.all([
          ownerContext.close().catch(() => undefined),
          attendantContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
