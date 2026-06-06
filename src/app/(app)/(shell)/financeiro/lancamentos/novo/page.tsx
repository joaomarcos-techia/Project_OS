import Link from 'next/link';

import { listPaymentMethods, listSuppliers } from '@/contexts/financial/queries';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { LancamentoForm } from './lancamento-form';

export const dynamic = 'force-dynamic';

export default async function NovoLancamentoPage() {
  const user = await requireUser();
  await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL) || !user.clinicId) {
    return (
      <>
        <PageHeader title="Novo lançamento" />
        <Alert variant="warning" title="Sem acesso">
          Apenas perfis com gestão financeira podem criar lançamentos manuais.
        </Alert>
      </>
    );
  }

  const [suppliers, methods] = await Promise.all([
    listSuppliers(user.clinicId, { onlyActive: true }),
    listPaymentMethods(user.clinicId),
  ]);

  return (
    <>
      <PageHeader
        title="Novo lançamento"
        description="Conta a receber ou a pagar (origem manual)."
        actions={
          <Link href="/financeiro" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            ← Financeiro
          </Link>
        }
      />
      <LancamentoForm suppliers={suppliers} methods={methods} />
    </>
  );
}
