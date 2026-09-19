/**
 * Leitura do estado da conta de pagamento — caminho TENANT (RLS).
 *
 * Diferente da escrita (que precisa de `dbAdmin`, ver `lib/payments/account-store`),
 * a leitura roda por `withTenant` de propósito: é a RLS que garante que uma clínica
 * não enxergue a conta da outra, e não uma cláusula que alguém pode esquecer.
 *
 * As colunas são listadas UMA A UMA. `SELECT *` aqui devolveria erro de permissão
 * (as colunas do segredo estão fora do grant de `authenticated`, migration 0081) —
 * o que é a proteção funcionando, mas quebraria a tela. Liste colunas.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { DEPOSIT_POLICY_OFF } from './policy';
import {
  EMPTY_PAYMENT_ACCOUNT,
  type DepositPolicyDTO,
  type PaymentAccountStatusDTO,
} from './types';

interface AccountRow {
  provider: string;
  account_name: string | null;
  key_version: number;
  active: boolean;
  connected_at: string | null;
  webhook_configured_at: string | null;
}

export async function getPaymentAccountStatus(clinicId: string): Promise<PaymentAccountStatusDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`
      SELECT provider, account_name, key_version, active, connected_at, webhook_configured_at
      FROM clinic_payment_accounts
      WHERE provider = 'asaas'
      LIMIT 1`),
  )) as unknown as AccountRow[];

  const row = rows[0];
  if (!row) return EMPTY_PAYMENT_ACCOUNT;

  return {
    provider: 'asaas',
    // Invariante do CHECK da 0081: ativa ⇒ existe chave. Ver types.ts.
    hasApiKey: row.active,
    webhookConfigured: row.webhook_configured_at !== null,
    accountName: row.account_name,
    keyVersion: row.key_version,
    connectedAt: row.connected_at,
  };
}

interface PolicyRow {
  enabled: boolean;
  percent: number;
  cancellation_window_hours: number;
  applies_to_first_visit: boolean;
  applies_to_return: boolean;
  updated_at: string | null;
}

/**
 * Política de sinal da clínica. **Clínica sem linha devolve a política DESLIGADA**
 * — não é um caso de erro, é o estado inicial de todo mundo, e é o que garante
 * que a 1.2 não muda comportamento nenhum enquanto ninguém configurar.
 */
export async function getDepositPolicy(clinicId: string): Promise<DepositPolicyDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`
      SELECT enabled, percent, cancellation_window_hours, applies_to_first_visit,
             applies_to_return, updated_at
      FROM clinic_deposit_policy
      LIMIT 1`),
  )) as unknown as PolicyRow[];

  const row = rows[0];
  if (!row) return { ...DEPOSIT_POLICY_OFF, updatedAt: null };

  return {
    enabled: row.enabled,
    percent: row.percent,
    cancellationWindowHours: row.cancellation_window_hours,
    appliesToFirstVisit: row.applies_to_first_visit,
    appliesToReturn: row.applies_to_return,
    updatedAt: row.updated_at,
  };
}
