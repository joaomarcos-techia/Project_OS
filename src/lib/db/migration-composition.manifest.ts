/**
 * Manifesto de composição: as migrations da FRONTEIRA entre #55 (convênios) e #53 (billing),
 * fixadas por tag, idx, `when` e sha256 (o mesmo hash que o Drizzle grava no ledger).
 *
 * Ordem obrigatória, a mesma do DEV compartilhado: main 0000–0135 → #53 0136–0142 → #55 0143–0158 →
 * #53 0159 (`saas_period_snapshot`) → #55 0160 (R54). As 0136–0142 são as do journal do #53 (hash e
 * `created_at` iguais ao ledger do DEV desde 11/11). Os valores da 0158 e da 0159 são os do `release-manifest.json` do #53
 * (docs/decoupling/asaas-to-abacatepay/migrations/, tissDependencies e financialEntry/financialSql);
 * a 0159 está aplicada no DEV com esse hash e esse `created_at` desde 13/11, e a 0160 desde 14/11.
 *
 * Mudar um valor aqui é mudar uma migration já aplicada no DEV: só com nova coordenação
 * (docs/convenios/coordenacao-migrations.md).
 */
import type { CompositionManifest } from './migration-composition';

export const MIGRATION_COMPOSITION_MANIFEST: CompositionManifest = {
  version: 1,
  hashStrictFromIdx: 136,
  pinned: [
    {
      tag: '0136_trial_resource_limits',
      idx: 136,
      when: 1794096000000,
      sha256: '43bb658055c581eae20788c6df87d50fc16ec00e472a73da52500d4a22e2fe10',
      owner: 'PR #53 (billing AbacatePay)',
      requires: [],
      sentinel: 'relation:public.trial_access_policies',
    },
    {
      tag: '0137_trial_service_role_privileges',
      idx: 137,
      when: 1794168300000,
      sha256: 'e1515b18deebdfd1dac558d9f02d5024655e81ad3ea196ad38ed12e3f3e9aaa7',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0136_trial_resource_limits'],
    },
    {
      tag: '0138_saas_gateway_bindings',
      idx: 138,
      when: 1794171600000,
      sha256: '22e4c7f622ee269d17b51b97238489d77d6cde5c385a765df8c613278219a69f',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0137_trial_service_role_privileges'],
      sentinel: 'relation:billing_gateway.bindings',
    },
    {
      tag: '0139_saas_gateway_recontracts',
      idx: 139,
      when: 1794189600000,
      sha256: 'aa935cd0cadcf6156636f9c7c98fe6201bdba5c1384f556ff026ebb4eb95d4be',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0138_saas_gateway_bindings'],
      sentinel: 'relation:billing_gateway.recontracts',
    },
    {
      tag: '0140_saas_recurring_payment_observations',
      idx: 140,
      when: 1794199882765,
      sha256: '98269c83b754785a7e9ecf0b2b4b142ff121cc22b56b8f3055575299ba8ca330',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0139_saas_gateway_recontracts'],
      sentinel: 'relation:billing_gateway.recurring_payment_observations',
    },
    {
      tag: '0141_saas_scheduled_plan_changes',
      idx: 141,
      when: 1794222981810,
      sha256: 'a13faef1aa291981c3e4c337cbde868225d9d1433bdeed8dd320fd7a74fdf5fd',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0140_saas_recurring_payment_observations'],
      sentinel: 'relation:billing_gateway.plan_changes',
    },
    {
      tag: '0142_saas_review_replays',
      idx: 142,
      when: 1794326400000,
      sha256: '410c61834e2a1eb1bf11331b71f7660205fa426b76d1a9fa566e6b13d7d3fb3d',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0141_saas_scheduled_plan_changes'],
      sentinel: 'relation:billing_gateway.review_replays',
    },
    {
      tag: '0143_tiss_catalog',
      idx: 143,
      when: 1794330000000,
      sha256: '9f9b483aaeff60a9ca4f5b182c3b071408a7d3eec9ecea7cfe8f98bcf602e807',
      owner: 'PR #55 (convênios)',
      requires: ['0142_saas_review_replays'],
      sentinel: 'relation:public.tiss_terminology_versions',
    },
    {
      tag: '0158_hi_copay_charge',
      idx: 158,
      when: 1795036973857,
      sha256: '40cc90493b5abf980c209485c83451f33c4cfc5931b87f3af7653f2091af63a2',
      owner: 'PR #55 (convênios)',
      requires: [],
      sentinel: 'function:public.hi_copay_sync_charge(uuid,uuid)',
    },
    {
      tag: '0159_saas_period_snapshot',
      idx: 159,
      when: 1795036973858,
      sha256: 'eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74',
      owner: 'PR #53 (billing AbacatePay)',
      requires: ['0158_hi_copay_charge'],
      sentinel: 'relation:billing_gateway.renewal_api_readbacks',
    },
    {
      tag: '0160_patient_external_refunds',
      idx: 160,
      when: 1795123373857,
      sha256: '718190feffe57a0f0b7ceaf7c28686793209f0c0cb9f4b7bfd6480d4ac1ef306',
      owner: 'PR #55 (convênios)',
      requires: ['0159_saas_period_snapshot'],
      sentinel: 'relation:public.patient_external_refunds',
    },
  ],
};
