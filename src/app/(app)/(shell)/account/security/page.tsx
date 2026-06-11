import { createServerClient } from '@/lib/auth/supabase-server';
import { listFactors } from '@/lib/auth/mfa';
import { requireUser } from '@/lib/auth/tenant-context';
import { mustHaveMFA } from '@/lib/auth/policies';

import { EnrollFlow } from './enroll-flow';
import { UnenrollForm } from './unenroll-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ force?: string; unenroll_error?: string }>;
}

export default async function AccountSecurityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const supabase = await createServerClient();
  const factors = await listFactors(supabase);
  const verified = factors.filter((f) => f.status === 'verified');
  const required = mustHaveMFA(user.role);
  const forced = params.force === '1';

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Segurança da conta</h1>

      {forced && required && verified.length === 0 ? (
        <p className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">
          MFA é OBRIGATÓRIO para a role <b>{user.role}</b>. Ative TOTP abaixo antes de
          continuar.
        </p>
      ) : null}

      {params.unenroll_error ? (
        <p className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">
          Não foi possível remover o MFA. Conclua a verificação TOTP (sessão completa) e
          tente novamente.
        </p>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">
          TOTP (Authy / Google Authenticator)
        </h2>
        {verified.length > 0 ? (
          <div className="rounded border border-gray-300 p-4">
            <p className="mb-3 text-sm">✅ TOTP ativo ({verified.length} factor).</p>
            {verified.map((f) => (
              <UnenrollForm key={f.id} factorId={f.id} />
            ))}
          </div>
        ) : (
          <EnrollFlow />
        )}
      </section>

      <p className="text-xs text-gray-600">
        <a href="/dashboard" className="underline">
          Voltar ao dashboard
        </a>
      </p>
    </main>
  );
}
