/** Operator seam for real Preview recovery E2E. Never accepts Production or a real recipient. */
import { z } from 'zod';

import { assertSignupConfirmationE2EEnvironment } from '../run-signup-confirmation-e2e';

assertSignupConfirmationE2EEnvironment(process.env);
const origin = new URL(process.env.E2E_SIGNUP_ALLOWED_ORIGIN ?? '').origin;
if (!origin.endsWith('.vercel.app'))
  throw new Error('Recovery operator requires an allowed Preview');
process.env.DATABASE_URL = process.env.DATABASE_URL_DEV;
process.env.APP_BASE_URL = origin;
process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_BRANCH_URL = new URL(origin).hostname;

const schema = z
  .object({
    userId: z.string().uuid(),
    operationKey: z.string().startsWith('e2e-signup-recovery:').max(200),
    purpose: z.enum(['verify_email', 'resume_signup']),
    priorMessageId: z.string().uuid(),
  })
  .strict();

async function main(): Promise<void> {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 4096) throw new Error('Operator input too large');
  }
  const input = schema.safeParse(JSON.parse(text));
  if (!input.success) throw new Error('Invalid operator input');
  const { createAdminClient } = await import('../../src/lib/auth/supabase-admin');
  const account = await createAdminClient().auth.admin.getUserById(input.data.userId);
  if (
    account.error ||
    !account.data.user?.email ||
    !/^delivered\+qoro-recovery-[a-z0-9-]+@resend\.dev$/u.test(account.data.user.email)
  )
    throw new Error('Operator refuses recipients outside its synthetic fixture');
  const { sendSignupLeadRecovery } = await import('../../src/contexts/onboarding');
  const { dbAdmin } = await import('../../src/lib/db');
  try {
    const result = await sendSignupLeadRecovery({ ...input.data, publicOrigin: origin });
    console.log(JSON.stringify({ kind: 'signup-recovery-dev-receipt', ...result }));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await dbAdmin.$client.end({ timeout: 5 });
  }
}

void main().catch(() => {
  console.error('Synthetic Preview recovery operator failed; sensitive details suppressed');
  process.exitCode = 1;
});
