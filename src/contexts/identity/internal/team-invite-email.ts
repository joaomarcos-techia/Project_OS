import 'server-only';

import { createHmac } from 'node:crypto';

import { sendTransactionalEmail } from '@/lib/email/resend';
import { renderTeamInviteEmail } from '@/lib/email/templates/team-invite';
import { env } from '@/lib/env';
import { createAuthConfirmationUrl } from '@/lib/http/application-url';
import { metrics } from '@/lib/observability/metrics';

type DeliveryStage = 'initial' | 'resend';

function idempotencyKey(stage: DeliveryStage, tokenHash: string): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('team invite idempotency secret is unavailable');
  const digest = createHmac('sha256', secret)
    .update(`qoro/team-invite/${stage}/v1:${tokenHash}`, 'utf8')
    .digest('hex');
  return `team-invite:${stage}:${digest}`;
}

export async function deliverTeamInviteEmail(input: {
  email: string;
  tokenHash: string;
  stage: DeliveryStage;
  inviteeName: string;
  clinicName: string;
  roleLabel: string;
  inviterName: string;
}): Promise<{ link: string }> {
  const link = createAuthConfirmationUrl(input.tokenHash, 'recovery');
  const content = renderTeamInviteEmail({
    inviteUrl: link,
    expectedOrigin: env.APP_BASE_URL ?? '',
    inviteeName: input.inviteeName,
    clinicName: input.clinicName,
    roleLabel: input.roleLabel,
    inviterName: input.inviterName,
  });
  await sendTransactionalEmail({
    to: input.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    idempotencyKey: idempotencyKey(input.stage, input.tokenHash),
  });
  metrics.emit('auth.team_invite.sent', { stage: input.stage });
  return { link };
}
