import 'server-only';

import { inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import { profiles } from '@/contexts/identity/schema';
import { readSignupAuthBinding } from '@/contexts/onboarding';
import { signupSessions } from '@/contexts/onboarding/schema';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withQueryDeadline } from '@/lib/db/query-timeout';
import { logger } from '@/lib/observability/logger';

import type { SignupAccountDTO, SignupAccountPageDTO } from '../dto';

const AUTH_PAGE_SIZE = 100;
const MAX_AUTH_PAGE = 10_000;
const accountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  created_at: z.string().datetime({ offset: true }),
  email_confirmed_at: z.string().datetime({ offset: true }).nullish(),
  app_metadata: z.unknown(),
});

/** Read-only, called only after the Platform Admin AAL2 guard. Never exposes Auth metadata. */
export class SignupAccountRepository {
  async list(requestedPage = 1): Promise<SignupAccountPageDTO> {
    const page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= MAX_AUTH_PAGE
        ? requestedPage
        : 1;
    try {
      // GoTrue orders its admin list by created_at DESC. Paginate Auth before filtering;
      // an empty filtered page is not evidence that other pages contain no signups.
      const { data, error } = await createAdminClient().auth.admin.listUsers({
        page,
        perPage: AUTH_PAGE_SIZE,
      });
      if (error) throw new Error('admin_auth_read_unavailable');
      const candidates = [];
      for (const user of data.users) {
        const binding = readSignupAuthBinding(user);
        if (!binding) continue; // Invitations and ordinary accounts belong to other admin lists.
        candidates.push({
          ...accountSchema.parse(user),
          passwordState: binding.passwordState,
          signupRef: binding.signupRef,
        });
      }
      const items: SignupAccountDTO[] = [];
      if (candidates.length > 0) {
        const ids = candidates.map((user) => user.id);
        const [linked, drafts] = await withQueryDeadline(
          'admin.signupAccounts.data',
          Promise.all([
            dbAdmin.select({ id: profiles.id }).from(profiles).where(inArray(profiles.id, ids)),
            dbAdmin
              .select({
                userId: signupSessions.authUserId,
                signupRef: signupSessions.tokenHash,
                checkoutId: signupSessions.asaasCheckoutId,
                idleExpiresAt: signupSessions.idleExpiresAt,
                absoluteExpiresAt: signupSessions.absoluteExpiresAt,
              })
              .from(signupSessions)
              .where(
                or(
                  inArray(signupSessions.authUserId, ids),
                  inArray(
                    signupSessions.tokenHash,
                    candidates.map((user) => user.signupRef),
                  ),
                ),
              ),
          ]),
        );
        const linkedIds = new Set(linked.map((profile) => profile.id));
        const draftByRef = new Map(drafts.map((draft) => [draft.signupRef, draft]));
        const now = Date.now();
        for (const user of candidates) {
          if (linkedIds.has(user.id)) continue; // Includes disabled/deleted profiles: never invent a new clinic.
          const candidateDraft = draftByRef.get(user.signupRef);
          const draft =
            candidateDraft?.userId == null || candidateDraft.userId === user.id
              ? candidateDraft
              : undefined;
          const [local, domain] = user.email.split('@');
          items.push({
            id: user.id,
            maskedEmail: `${local?.slice(0, 2)}***@${domain}`,
            createdAt: user.created_at,
            stage: !user.email_confirmed_at
              ? 'email_pending'
              : user.passwordState === 'pending'
                ? 'password_pending'
                : draft?.checkoutId
                  ? 'checkout_pending'
                  : 'plan_pending',
            liveDraft: Boolean(
              draft &&
              draft.idleExpiresAt.getTime() > now &&
              draft.absoluteExpiresAt.getTime() > now,
            ),
          });
        }
      }
      return { ok: true, items, page, hasNextPage: page < data.lastPage };
    } catch {
      logger.warn('admin.signup_accounts.unavailable', {});
      return { ok: false };
    }
  }
}

export const signupAccountRepository = new SignupAccountRepository();
