/**
 * Compatibilidade temporária para links emitidos antes da migração para
 * `/join#invite=<token>`. O request legado ainda contém token no path uma vez;
 * convites novos nunca usam esta rota.
 */
import { redirect } from 'next/navigation';

import {
  createOnboardingInvitePath,
  isOnboardingInviteToken,
} from '@/lib/auth/onboarding-invite-fragment';

export default async function LegacyJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(isOnboardingInviteToken(token) ? createOnboardingInvitePath(token) : '/join');
}
