/**
 * /configuracoes/perfil — dados da clínica para os documentos (nome/endereço/
 * telefone/CNPJ/CNES) + logo e cor do receituário (white-label do PDF, ADR-028).
 * Escrita via dbAdmin+audit no core (S5); gate manage:settings.
 */
import Link from 'next/link';

import { getProfessionalProfile } from '@/contexts/identity/queries';
import { getClinicProfile } from '@/contexts/tenancy/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { PerfilForm } from './perfil-form';
import { ProfessionalCredentialForm } from './professional-credential-form';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();

  const crumbs = [{ label: 'Configurações', href: '/configuracoes' }, { label: 'Perfil' }];
  const backLink = (
    <Link href="/configuracoes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      Voltar
    </Link>
  );

  if (!user.permissions.includes(PERMISSIONS.MANAGE_SETTINGS)) {
    return (
      <div>
        <PageHeader crumbs={crumbs} title="Perfil da clínica" actions={backLink} />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para editar os dados da clínica.
        </Alert>
      </div>
    );
  }

  const [profile, professionalProfile] = await Promise.all([
    getClinicProfile(clinicId),
    getProfessionalProfile(clinicId, user.userId),
  ]);
  if (!profile) {
    return (
      <div>
        <PageHeader crumbs={crumbs} title="Perfil da clínica" actions={backLink} />
        <Alert variant="danger" title="Clínica não encontrada">
          Não foi possível carregar os dados da clínica.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title="Perfil da clínica"
        description="Dados que aparecem no cabeçalho do receituário e dos documentos."
        actions={backLink}
      />
      <div className="stack" style={{ maxWidth: 560 }}>
        <PerfilForm initial={profile} />
        {professionalProfile ? <ProfessionalCredentialForm initial={professionalProfile} /> : null}
      </div>
    </div>
  );
}
