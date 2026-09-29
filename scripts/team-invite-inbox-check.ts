/**
 * Convite de equipe ponta a ponta em DEV:
 * serviço Qoro -> Resend enviado/recebido -> reenvio -> link -> aceite -> replay.
 *
 * Cria somente uma identidade sintética no projeto DEV fixado e prova o cleanup.
 * Não imprime e-mail, token, link, cookie ou secret.
 */
import './_env';

import { randomBytes, randomUUID } from 'node:crypto';

import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { inviteClinicMember, resendClinicInvite } from '@/contexts/identity/internal/members';
import { createAdminClient, findAdminUserByEmail } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import {
  createResendInboxAlias,
  listSentEmails,
  waitForResendEmail,
} from '@/lib/email/resend-inspector';
import { env } from '@/lib/env';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const databaseUrl = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
const inbox = process.env.E2E_RESEND_INBOX_ADDRESS;
const resendKey = env.RESEND_API_KEY;
const applicationUrl = process.env.E2E_BASE_URL ?? env.APP_BASE_URL;
const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (
  process.env.SUPABASE_PROJECT_ENV !== 'dev' ||
  !databaseUrl ||
  !inbox ||
  !resendKey ||
  !applicationUrl
) {
  throw new Error('[team-invite-inbox] DEV/inbox/email/application precondition missing');
}
const database = new URL(databaseUrl);
if (
  !database.username.endsWith(`.${DEV_PROJECT_REF}`) &&
  database.hostname !== `db.${DEV_PROJECT_REF}.supabase.co`
) {
  throw new Error('[team-invite-inbox] refusing a non-DEV database');
}
const applicationOrigin = new URL(applicationUrl).origin;
const applicationHost = new URL(applicationUrl).hostname;
const localApplication = ['localhost', '127.0.0.1'].includes(applicationHost);
const previewApplication = applicationHost.endsWith('.vercel.app');
if (!localApplication && !previewApplication) {
  throw new Error('[team-invite-inbox] application must be localhost or an isolated Preview');
}
if (previewApplication && !bypass) {
  throw new Error('[team-invite-inbox] protected Preview bypass is missing');
}

function confirmationLink(body: string): string | null {
  const links = [...body.matchAll(/href=["']([^"']+)["']/giu)].map((match) =>
    match[1]!.replaceAll('&amp;', '&'),
  );
  return links.find((link) => /\/auth\/confirm/iu.test(link)) ?? null;
}

async function browserContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (!previewApplication) return context;
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.hostname.endsWith('.vercel.app')) {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-protection-bypass': bypass!,
      },
    });
  });
  const bootstrap = new URL('/', applicationOrigin);
  bootstrap.searchParams.set('x-vercel-protection-bypass', bypass!);
  bootstrap.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  const page = await context.newPage();
  await page.goto(bootstrap.toString(), { timeout: 180_000 });
  if (new URL(page.url()).hostname === 'vercel.com') {
    throw new Error('[team-invite-inbox] Vercel bypass was rejected');
  }
  await page.close();
  return context;
}

async function waitForNewestSent(input: {
  email: string;
  sentAfter: Date;
}): Promise<{ subject: string; html: string | null; text: string | null }> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const summary = (await listSentEmails(resendKey!)).find(
      (candidate) =>
        candidate.to.some((address) => address.toLowerCase() === input.email.toLowerCase()) &&
        Date.parse(candidate.createdAt) >= input.sentAfter.getTime(),
    );
    if (summary) {
      return await waitForResendEmail({
        apiKey: resendKey!,
        to: input.email,
        subject: summary.subject,
        sentAfter: input.sentAfter,
        kind: 'sent',
        timeoutMs: 60_000,
        acceptedLastEvents: ['delivered', 'opened', 'clicked'],
        rejectedLastEvents: ['bounced', 'complained', 'canceled', 'failed'],
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('[team-invite-inbox] sent email was not found');
}

async function receivedLink(input: {
  email: string;
  subject: string;
  sentAfter: Date;
}): Promise<string> {
  const received = await waitForResendEmail({
    apiKey: resendKey!,
    to: input.email,
    subject: input.subject,
    sentAfter: input.sentAfter,
    kind: 'received',
    timeoutMs: 60_000,
  });
  const link = confirmationLink(received.html ?? received.text ?? '');
  if (!link) throw new Error('[team-invite-inbox] received email omitted confirmation link');
  const parsed = new URL(link);
  if (parsed.origin !== applicationOrigin || parsed.pathname !== '/auth/confirm' || parsed.search) {
    throw new Error('[team-invite-inbox] confirmation link has an invalid target');
  }
  return link;
}

async function expectRejected(browser: Browser, link: string): Promise<void> {
  const context = await browserContext(browser);
  try {
    const page = await context.newPage();
    await page.goto(link, { timeout: 180_000 });
    try {
      await page.waitForURL(/\/auth\/auth-error\?reason=/u, { timeout: 60_000 });
    } catch {
      const observed = new URL(page.url());
      throw new Error(
        `[team-invite-inbox] rejected link did not reach auth-error; path=${observed.pathname}; query_keys=${
          [...observed.searchParams.keys()].join(',') || 'none'
        }; fragment_present=${String(Boolean(observed.hash))}`,
      );
    }
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = createResendInboxAlias(inbox!, `team-${runId}`);
  const password = `Aa1!${randomBytes(18).toString('base64url')}`;
  const clientKey = randomUUID();
  const idemKey = `identity:invite_member:${clientKey.replaceAll('-', '')}`;
  const admin = createAdminClient();
  let userId: string | null = null;
  let browser: Browser | null = null;

  try {
    const [owner] = (await dbAdmin.execute(sql`
      SELECT p.id, p.clinic_id, c.nome AS clinic_name, p.nome AS inviter_name
      FROM public.profiles p
      JOIN public.clinics c ON c.id = p.clinic_id
      WHERE p.role = 'owner' AND p.ativo = true AND p.deleted_at IS NULL
        AND p.invite_accepted_at IS NOT NULL AND c.status = 'active'
      ORDER BY p.created_at
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      clinic_id: string;
      clinic_name: string;
      inviter_name: string;
    }>;
    if (!owner) throw new Error('[team-invite-inbox] active owner fixture is missing');

    const firstStarted = new Date(Date.now() - 1_000);
    const invited = await inviteClinicMember({
      clinicId: owner.clinic_id,
      nome: 'E2E Convite Inbox',
      email,
      role: 'attendant',
      clinicName: owner.clinic_name,
      inviterNome: owner.inviter_name,
      funcaoLabel: 'Atendente',
      invitedBy: owner.id,
      requestContext: {
        ip: '203.0.113.31',
        userAgent: 'qoro-e2e-team-invite',
        requestId: randomUUID(),
      },
      idempotencyKey: clientKey,
      seatLimit: Number.MAX_SAFE_INTEGER,
    });
    userId = invited.userId;
    const firstSent = await waitForNewestSent({ email, sentAfter: firstStarted });
    const firstLink = await receivedLink({
      email,
      subject: firstSent.subject,
      sentAfter: firstStarted,
    });

    const resendStarted = new Date(Date.now() - 1_000);
    const resent = await resendClinicInvite({
      clinicId: owner.clinic_id,
      userId,
      inviterRole: 'owner',
      invitedBy: owner.id,
      clinicName: owner.clinic_name,
      inviterNome: owner.inviter_name,
      requestContext: {
        ip: '203.0.113.32',
        userAgent: 'qoro-e2e-team-invite-resend',
        requestId: randomUUID(),
      },
    });
    const resendSent = await waitForNewestSent({ email, sentAfter: resendStarted });
    const resentLink = await receivedLink({
      email,
      subject: resendSent.subject,
      sentAfter: resendStarted,
    });
    if (resentLink !== resent.link || resentLink === firstLink) {
      throw new Error('[team-invite-inbox] resend did not rotate the one-time link');
    }

    browser = await chromium.launch();
    await expectRejected(browser, firstLink);
    const context = await browserContext(browser);
    const page = await context.newPage();
    await page.goto(resentLink, { timeout: 180_000 });
    await page.waitForURL(/\/convite$/u, { timeout: 180_000 });
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByLabel('Confirmar senha').fill(password);
    await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
    await page.waitForURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });
    await context.close();

    const [accepted] = (await dbAdmin.execute(sql`
      SELECT invite_accepted_at IS NOT NULL AS accepted
      FROM public.profiles WHERE id = ${userId}::uuid
    `)) as unknown as Array<{ accepted: boolean }>;
    if (accepted?.accepted !== true) {
      throw new Error('[team-invite-inbox] tenant acceptance was not persisted');
    }
    await expectRejected(browser, resentLink);
    console.log(
      '[team-invite-inbox] PASS initial=received resend=received old_link=rejected accepted=true replay=rejected tenant=true',
    );
  } finally {
    if (browser) await browser.close();
    const found = await findAdminUserByEmail(email);
    const cleanupId = userId ?? (found.kind === 'found' ? found.user.id : null);
    if (cleanupId) {
      await dbAdmin.execute(sql`DELETE FROM public.profiles WHERE id = ${cleanupId}::uuid`);
      const deleted = await admin.auth.admin.deleteUser(cleanupId);
      if (deleted.error) throw new Error('[team-invite-inbox] Auth cleanup failed');
    }
    await dbAdmin.execute(sql`DELETE FROM public.idempotency_keys WHERE key = ${idemKey}`);
    const [remaining] = cleanupId
      ? ((await dbAdmin.execute(
          sql`SELECT count(*)::int AS n FROM public.profiles WHERE id = ${cleanupId}::uuid`,
        )) as unknown as Array<{ n: number }>)
      : [{ n: 0 }];
    if ((remaining?.n ?? 0) !== 0) {
      throw new Error('[team-invite-inbox] profile cleanup readback failed');
    }
    console.log('[team-invite-inbox] cleanup=complete');
  }
}

void main().catch((error: unknown) => {
  console.error(
    '[team-invite-inbox] FAIL:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
