import 'server-only';

import { getClinicAsaasClient } from '@/lib/payments/account-store';
import type { AsaasAccountFees } from '@/lib/payments/asaas';

/** A chave fica no servidor; só os números sanitizados das tarifas saem para a tela. */
export async function getPaymentAccountFees(clinicId: string): Promise<AsaasAccountFees | null> {
  const client = await getClinicAsaasClient(clinicId);
  return client ? client.getAccountFees({ attempts: 1 }) : null;
}
