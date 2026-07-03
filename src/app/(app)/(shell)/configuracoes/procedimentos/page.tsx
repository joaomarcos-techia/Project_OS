/**
 * /configuracoes/procedimentos — catálogo de procedimentos da clínica (preço +
 * duração). É o que destrava a criação de atendimentos na Agenda para clínicas
 * reais (antes só existia via seed). Backend C6 pronto (createProcedure/update/
 * deactivate; procedure NUNCA é deletado — FK RESTRICT → só ativo=false).
 */
import Link from 'next/link';

import { listProcedures } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { ProceduresManager } from './procedures-manager';

export const dynamic = 'force-dynamic';

export default async function ProcedimentosPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();

  const backLink = (
    <Link href="/configuracoes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      Voltar
    </Link>
  );

  if (!user.permissions.includes(PERMISSIONS.MANAGE_PROCEDURES)) {
    return (
      <div>
        <PageHeader
          breadcrumb={
            <>
              <Link href="/configuracoes">Configurações</Link> <span className="sep">›</span>{' '}
              <b>Procedimentos</b>
            </>
          }
          title="Procedimentos"
          actions={backLink}
        />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar o catálogo de procedimentos.
        </Alert>
      </div>
    );
  }

  const procedures = await listProcedures(clinicId);

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/configuracoes">Configurações</Link> <span className="sep">›</span>{' '}
            <b>Procedimentos</b>
          </>
        }
        title="Procedimentos"
        description="Catálogo de procedimentos com preço e duração — base da Agenda e do faturamento."
        actions={backLink}
      />
      <ProceduresManager initial={procedures} />
    </div>
  );
}
