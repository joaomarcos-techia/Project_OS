import Link from 'next/link';

import { createServerClient } from '@/lib/auth/supabase-server';
import { listFactors } from '@/lib/auth/mfa';
import { requireUser } from '@/lib/auth/tenant-context';
import { mustHaveMFA } from '@/lib/auth/policies';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

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
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Conta <span className="sep">›</span> <b>Segurança</b>
          </>
        }
        title="Segurança da conta"
        description="Autenticação em duas etapas (TOTP) da sua conta."
        actions={
          <Link href="/dashboard" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Voltar ao dashboard
          </Link>
        }
      />

      <div className="stack" style={{ maxWidth: 640 }}>
        {forced && required && verified.length === 0 ? (
          <Alert variant="danger">
            MFA é OBRIGATÓRIO para a role <b>{user.role}</b>. Ative TOTP abaixo antes de continuar.
          </Alert>
        ) : null}

        {params.unenroll_error ? (
          <Alert variant="danger">
            Não foi possível remover o MFA. Conclua a verificação TOTP (sessão completa) e tente
            novamente.
          </Alert>
        ) : null}

        <div className="cardblock wrap-pad">
          <h4 className="mb-3 text-sm font-semibold">TOTP (Authy / Google Authenticator)</h4>
          {verified.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">✅ TOTP ativo ({verified.length} factor).</p>
              {verified.map((f) => (
                <UnenrollForm key={f.id} factorId={f.id} />
              ))}
            </div>
          ) : (
            <EnrollFlow />
          )}
        </div>
      </div>
    </div>
  );
}
