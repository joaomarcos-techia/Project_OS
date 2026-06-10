import Link from 'next/link';

import { listSuppliers } from '@/contexts/financial/queries';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { FornecedoresView } from './fornecedores-view';

export const dynamic = 'force-dynamic';

export default async function FornecedoresPage() {
  const user = await requireUser();
  await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL) || !user.clinicId) {
    return (
      <>
        <PageHeader title="Fornecedores" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para o financeiro.
        </Alert>
      </>
    );
  }

  const suppliers = await listSuppliers(user.clinicId);
  const canManage = user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description="Cadastro de fornecedores para contas a pagar."
        actions={
          <Link href="/financeiro" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            ← Financeiro
          </Link>
        }
      />
      <FornecedoresView suppliers={suppliers} canManage={canManage} />
    </>
  );
}
