import 'server-only';

import { billingApiV1 } from '@/contexts/billing/api';
import {
  getDepositPolicy,
  getPaymentAccountStatus,
  type DepositPolicyDTO,
  type PaymentAccountStatusDTO,
} from '@/contexts/payments';
import {
  getProfessionalPayoutPolicy,
  listActiveProfessionalPayoutRules,
} from '@/contexts/financial/payout-queries';
import type { ProfessionalPayoutPolicyDTO, ProfessionalPayoutRuleDTO } from '@/contexts/financial';
import { isPractitioner } from '@/contexts/identity';
import { listEmployees } from '@/contexts/identity/queries';
import { schedulingApiV1, type ProcedureSummary } from '@/contexts/scheduling';
import { requireClinicId } from '@/lib/auth/tenant-context';

/**
 * Leitura tenant-scoped (RLS) da tela de pagamentos. Nem a conta nem a política
 * expõem segredo: a chave não é lida em nenhum ponto do caminho de leitura.
 */
export interface PagamentosPageData {
  account: PaymentAccountStatusDTO;
  policy: DepositPolicyDTO;
  advancedPoliciesEnabled: boolean;
  payoutPolicy: ProfessionalPayoutPolicyDTO;
  payoutRules: ProfessionalPayoutRuleDTO[];
  professionals: Array<{ id: string; name: string }>;
  procedures: ProcedureSummary[];
}

/**
 * Uma leitura só para a tela inteira. As duas consultas são independentes e
 * tenant-scoped; rodar em paralelo evita somar dois round-trips numa página
 * administrativa que já é `force-dynamic`.
 */
export async function loadPagamentosPage(): Promise<PagamentosPageData> {
  const clinicId = await requireClinicId();
  const [account, policy, advancedPoliciesEnabled] = await Promise.all([
    getPaymentAccountStatus(clinicId),
    getDepositPolicy(clinicId),
    billingApiV1.hasAdvancedFinancialPolicies(clinicId),
  ]);
  if (!advancedPoliciesEnabled) {
    return {
      account,
      policy,
      advancedPoliciesEnabled,
      payoutPolicy: { basis: 'gross', updatedAt: null },
      payoutRules: [],
      professionals: [],
      procedures: [],
    };
  }
  const [payoutPolicy, payoutRules, employees, procedures] = await Promise.all([
    getProfessionalPayoutPolicy(clinicId),
    listActiveProfessionalPayoutRules(clinicId),
    listEmployees(clinicId),
    schedulingApiV1.listProcedures(clinicId, { limit: 200 }),
  ]);
  const professionals = employees
    .filter(
      (employee) =>
        employee.ativo &&
        !employee.pending &&
        employee.role !== 'owner' &&
        isPractitioner({ role: employee.role, crm: employee.crm }),
    )
    .map((employee) => ({ id: employee.id, name: employee.nome }));
  return {
    account,
    policy,
    advancedPoliciesEnabled,
    payoutPolicy,
    payoutRules,
    professionals,
    procedures,
  };
}
