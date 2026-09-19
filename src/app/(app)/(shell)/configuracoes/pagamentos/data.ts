import 'server-only';

import {
  getDepositPolicy,
  getPaymentAccountStatus,
  type DepositPolicyDTO,
  type PaymentAccountStatusDTO,
} from '@/contexts/payments';
import { requireClinicId } from '@/lib/auth/tenant-context';

/**
 * Leitura tenant-scoped (RLS) da tela de pagamentos. Nem a conta nem a política
 * expõem segredo: a chave não é lida em nenhum ponto do caminho de leitura.
 */
export interface PagamentosPageData {
  account: PaymentAccountStatusDTO;
  policy: DepositPolicyDTO;
}

/**
 * Uma leitura só para a tela inteira. As duas consultas são independentes e
 * tenant-scoped; rodar em paralelo evita somar dois round-trips numa página
 * administrativa que já é `force-dynamic`.
 */
export async function loadPagamentosPage(): Promise<PagamentosPageData> {
  const clinicId = await requireClinicId();
  const [account, policy] = await Promise.all([
    getPaymentAccountStatus(clinicId),
    getDepositPolicy(clinicId),
  ]);
  return { account, policy };
}
