import Link from 'next/link';

import { createServerClient } from '@/lib/auth/supabase-server';
import { listFactors } from '@/lib/auth/mfa';
import { requireUser } from '@/lib/auth/tenant-context';
import { mustHaveMFA } from '@/lib/auth/policies';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { SettingsNav } from '../../configuracoes/settings-nav';
import { visibleSettingsNavigation } from '../../configuracoes/settings-navigation';

import { TotpSetupDialog } from './security-dialog';
import { UnenrollForm } from './unenroll-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ force?: string; unenroll_error?: string; rate_limited?: string }>;
}

export default async function AccountSecurityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const supabase = await createServerClient();
  const factors = await listFactors(supabase);
  const verified = factors.filter((f) => f.status === 'verified');
  const required = mustHaveMFA(user.role);
  const forced = params.force === '1';
  // Esta rota é um dos treze destinos das configurações, mas vive fora de
  // `/configuracoes` — então o layout de lá não a alcança e ela ficava sem
  // navegação nenhuma: quem chegava aqui pela barra não tinha como voltar por
  // ela. A barra é montada aqui à mão pelo mesmo mapa, com o mesmo filtro de
  // permissão. Em sessão pré-MFA (super_admin em AAL1) sobram só os destinos
  // sem permissão exigida — degrada, não quebra.
  const settingsGroups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  return (
    <div>
      <SettingsNav groups={settingsGroups} />
      <PageHeader
        crumbs={[
          { label: 'Configurações', href: '/configuracoes' },
          { label: 'Segurança da conta' },
        ]}
        title="Segurança da conta"
        description="Autenticação em duas etapas (TOTP) da sua conta."
        actions={
          <Link href="/dashboard" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Voltar ao dashboard
          </Link>
        }
      />

      <div className="flex max-w-160 flex-col gap-(--sp-4)">
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

        {params.rate_limited ? (
          <Alert variant="danger">
            Muitas tentativas de segurança em pouco tempo. Aguarde alguns minutos e tente novamente
            — não é preciso refazer o login.
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Autenticação em duas etapas</CardTitle>
            <CardDescription>
              Um código de 6 dígitos gerado no seu celular, além da senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {verified.length > 0 ? (
              <div className="flex flex-col gap-(--sp-4)">
                <div className="flex flex-wrap items-center gap-(--sp-3)">
                  <Badge tone="green" dot>
                    Ativo
                  </Badge>
                  <p className="text-(length:--fs-body-sm) text-fg-muted">
                    TOTP ativo ({verified.length} factor). O código é pedido a cada login.
                  </p>
                </div>
                {verified.map((f) => (
                  <UnenrollForm key={f.id} factorId={f.id} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-(--sp-4)">
                <div className="flex flex-wrap items-center gap-(--sp-3)">
                  <Badge tone="gray">Inativo</Badge>
                  <p className="text-(length:--fs-body-sm) text-fg-muted">
                    Sua conta está protegida apenas pela senha.
                  </p>
                </div>
                <TotpSetupDialog />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
