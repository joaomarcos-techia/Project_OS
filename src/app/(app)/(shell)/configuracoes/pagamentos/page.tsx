import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';

import { loadPagamentosPage } from './data';
import { DepositPolicyForm } from './deposit-policy-form';
import { PaymentAccountPanel } from './payment-account-panel';

export const dynamic = 'force-dynamic';

/**
 * /configuracoes/pagamentos — conexão da conta Asaas DA CLÍNICA (ADR-049).
 *
 * O gate precede a leitura, como nas demais telas de Configurações: mesmo o
 * metadado (nome da conta, desde quando está conectada) é informação
 * administrativa de recebimento. A MESMA permissão é exigida de novo dentro da
 * Server Action — a tela some para quem não pode ver, e a ação recusa quem tentar
 * chamá-la direto, sem depender da tela ter sumido.
 */
export default async function PagamentosSettingsPage() {
  const gate = await pageGate([PERMISSIONS.MANAGE_FINANCIAL]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Gestão', href: '/configuracoes/gestao' }, { label: 'Pagamentos' }]}
        title="Pagamentos"
        description="Seu perfil não tem permissão para configurar o recebimento da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }

  const { account, policy } = await loadPagamentosPage();
  return (
    <div className="flex flex-col gap-6">
      <PaymentAccountPanel status={account} />
      <DepositPolicyForm policy={policy} hasAccount={account.hasApiKey} />
    </div>
  );
}
