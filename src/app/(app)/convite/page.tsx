import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';

import { ConviteForm, type InviteMeta } from './convite-form';

export const dynamic = 'force-dynamic';

function textMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;
}

export default async function ConvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  // Templates legados que apontam direto para /convite passam pelo mesmo
  // verifyOtp server-side do template canônico. Um ?code sem verifier não prova
  // posse do e-mail e não é trocado nesta página.
  if (tokenHash && (type === 'invite' || type === 'recovery')) {
    redirect(
      `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&next=%2Fconvite`,
    );
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  const profile = !error && data.user ? await readAuthoritativeProfile(data.user.id) : null;
  const valid = Boolean(
    profile && profile.ativo && !profile.deletedAt && !profile.inviteAcceptedAt,
  );
  const userMetadata = valid ? data.user?.user_metadata : null;
  const meta: InviteMeta | null = userMetadata
    ? {
        clinica: textMetadata(userMetadata.clinica),
        funcao: textMetadata(userMetadata.funcao),
        convidado_por: textMetadata(userMetadata.convidado_por),
      }
    : null;

  return <ConviteForm valid={valid} meta={meta} />;
}
