/**
 * Manifesto de composição: as migrations da FRONTEIRA entre #55 (convênios) e #53 (billing),
 * fixadas por tag, idx, `when` e sha256 (o mesmo hash que o Drizzle grava no ledger).
 *
 * Ordem obrigatória, a mesma do DEV compartilhado: main 0000–0135 → #53 0136–0142 → #55 0143–0158 →
 * #53 0159 (`saas_period_snapshot`) → #55 0160 (R54). As 0136–0142 são as do journal do #53 (hash e
 * `created_at` iguais ao ledger do DEV desde 11/11). Os valores da 0158 e da 0159 são os do `release-manifest.json` do #53
 * (docs/decoupling/asaas-to-abacatepay/migrations/, tissDependencies e financialEntry/financialSql);
 * a 0159 está aplicada no DEV com esse hash e esse `created_at` desde 13/11, a 0160 desde 14/11 e a
 * 0161 (P4.6) desde 15/11.
 *
 * A cauda inteira do #55 (0143–0158) é fixada, não só as pontas: o release do #53 congela esses 16
 * arquivos a partir do commit `tissHead` do seu release-manifest.json (4d0ed1d5, conferido byte a
 * byte em 14/11). Editar qualquer um deles aqui faria o lançamento do #53 levar à produção uma versão
 * diferente da do #55, e o guarda só recusaria no lançamento do TISS; com o pino, a CI recusa já no PR.
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
      tag: '0144_hi_clinic_setup',
      idx: 144,
      when: 1794367436665,
      sha256: 'b9ac6c7a0b335582f3bf69385a3b004cf9d0784955f27d7c3cd22776a4590589',
      owner: 'PR #55 (convênios)',
      requires: ['0143_tiss_catalog'],
    },
    {
      tag: '0145_hi_memberships',
      idx: 145,
      when: 1794391493822,
      sha256: '98425850e4c2dae613734aa337ce588df641e5c3b67476c055147cb9c82632c4',
      owner: 'PR #55 (convênios)',
      requires: ['0144_hi_clinic_setup'],
    },
    {
      tag: '0146_hi_authorizations',
      idx: 146,
      when: 1794395869610,
      sha256: '15cbf34c1439cc1d7a0ca4be40267729b44c1cdea1760d5090deb10288493cb6',
      owner: 'PR #55 (convênios)',
      requires: ['0145_hi_memberships'],
    },
    {
      tag: '0147_hi_guides',
      idx: 147,
      when: 1794399173366,
      sha256: 'a344a7e86074d90a4b13b007ef6f9e3357ac23e3b8bc43743158d131ca45238a',
      owner: 'PR #55 (convênios)',
      requires: ['0146_hi_authorizations'],
    },
    {
      tag: '0148_hi_coverage_copay',
      idx: 148,
      when: 1794405160338,
      sha256: '45f0b90b9307c5888e8e0ac61fab9685561f89a62cdf54ea60d2bd3becfdcb0b',
      owner: 'PR #55 (convênios)',
      requires: ['0147_hi_guides'],
    },
    {
      tag: '0149_hi_billing_gaps',
      idx: 149,
      when: 1794416643149,
      sha256: '56c0d5f29a409b65e0fe4fc1ac7512bbd8c979150c2252e375a375b85139d183',
      owner: 'PR #55 (convênios)',
      requires: ['0148_hi_coverage_copay'],
    },
    {
      tag: '0150_hi_batches',
      idx: 150,
      when: 1794418524711,
      sha256: 'e7dc279a073501a4f2e03dd95ff9773564cbc690ea2591a3e94a03f9a273c992',
      owner: 'PR #55 (convênios)',
      requires: ['0149_hi_billing_gaps'],
    },
    {
      tag: '0151_hi_premium_gate',
      idx: 151,
      when: 1794432173857,
      sha256: 'a0e446dbce4121c538c4a3e206a406e0977d5d1729ed14b03417a3937b71ae0b',
      owner: 'PR #55 (convênios)',
      requires: ['0150_hi_batches'],
    },
    {
      tag: '0152_hi_glosses_payments',
      idx: 152,
      when: 1794518573857,
      sha256: 'f16efcaabf8ed205b102005883c8627d3f1037edbcd91908f1d700123720766a',
      owner: 'PR #55 (convênios)',
      requires: ['0151_hi_premium_gate'],
    },
    {
      tag: '0153_hi_ledger_bridge',
      idx: 153,
      when: 1794604973857,
      sha256: 'ebb976532db49b2d36947cd5c37724a6b6b9c85713e2f92818fcefc992b23378',
      owner: 'PR #55 (convênios)',
      requires: ['0152_hi_glosses_payments'],
    },
    {
      tag: '0154_hi_premium_period_evidence',
      idx: 154,
      when: 1794691373857,
      sha256: '3e493911867aa5cf1157ee083a451a9bd1f86a084f371d36da5312d08676925a',
      owner: 'PR #55 (convênios)',
      requires: ['0153_hi_ledger_bridge'],
    },
    {
      tag: '0155_ledger_payment_sum_by_clinic',
      idx: 155,
      when: 1794777773857,
      sha256: 'aecc5c2d0b7cf36a3dbdcf7331d4247077acf8c7466cbc853e2d40dc905e1d33',
      owner: 'PR #55 (convênios)',
      requires: ['0154_hi_premium_period_evidence'],
    },
    {
      tag: '0156_hi_sadt_requests',
      idx: 156,
      when: 1794864173857,
      sha256: 'cdf3004b15a8a09d6e8f2065bf42be39a05b979eb4d12cd8a5ac1d32b492f860',
      owner: 'PR #55 (convênios)',
      requires: ['0155_ledger_payment_sum_by_clinic'],
    },
    {
      tag: '0157_hi_professional_payouts',
      idx: 157,
      when: 1794950573857,
      sha256: 'f39a58d0401b3d221b03cbe0b41c9f4b530947d0f03b4b3564929e11349b5f15',
      owner: 'PR #55 (convênios)',
      requires: ['0156_hi_sadt_requests'],
    },
    {
      tag: '0158_hi_copay_charge',
      idx: 158,
      when: 1795036973857,
      sha256: '40cc90493b5abf980c209485c83451f33c4cfc5931b87f3af7653f2091af63a2',
      owner: 'PR #55 (convênios)',
      requires: ['0157_hi_professional_payouts'],
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
    {
      // P4.6 (ajustes da Guia de Consulta). Fixada ao ser aplicada no DEV (15/11, coordenacao-migrations §18).
      tag: '0161_hi_guide_consulta_overrides',
      idx: 161,
      when: 1795209773857,
      sha256: 'acd23a73e25109c14c1514f6995fbcd81182a51f7338c1bd6c63127f8d0265c5',
      owner: 'PR #55 (convênios)',
      requires: ['0160_patient_external_refunds'],
      sentinel: 'function:public.hi_guide_guard_consulta_overrides()',
    },
    {
      // P1.12 (matriz I.2: 5 códigos, pacotes por papel, overrides R1–R4). Só inserções, sem DDL,
      // por isso sem sentinela de objeto. Autorizada para o DEV em 16/11 (coordenacao-migrations §23).
      tag: '0162_hi_permission_matrix',
      idx: 162,
      when: 1795296173857,
      sha256: 'eed2d0dee2b9d59be3b8f707d1c4963541d0b03e3597a73157be8766d481ec68',
      owner: 'PR #55 (convênios)',
      requires: ['0161_hi_guide_consulta_overrides'],
    },
    {
      // Revisão humana do repasse (contrato aprovado em 16/11). Fixada ao ser aplicada no DEV (16/11).
      tag: '0163_hi_payout_reviews',
      idx: 163,
      when: 1795382573857,
      sha256: 'd94b652d1a602167ea0444740f717fce72afada940c703444965a4b7087ce9be',
      owner: 'PR #55 (convênios)',
      requires: ['0162_hi_permission_matrix'],
      sentinel: 'relation:public.hi_payout_reviews',
    },
    {
      // Interruptor do módulo nos gatilhos do banco. Fixada ao ser aplicada no DEV (16/11).
      tag: '0164_hi_module_switch_guard',
      idx: 164,
      when: 1795468973857,
      sha256: 'da5f8b90fd45b0afe3b307be689f326a25b7719ddcc664f81a714f99341e6ec1',
      owner: 'PR #55 (convênios)',
      requires: ['0163_hi_payout_reviews'],
      sentinel: 'function:public.hi_module_guard()',
    },
    {
      // P7.5: cancelamento na operadora e substituição só com recibo. Fixada ao ser aplicada no DEV (16/11).
      tag: '0165_hi_guide_cancellations',
      idx: 165,
      when: 1795555373857,
      sha256: 'a3af4a973f14cc3fb3720423d4c03f71f32330024f028d07191f40f4077c64cb',
      owner: 'PR #55 (convênios)',
      requires: ['0164_hi_module_switch_guard'],
      sentinel: 'relation:public.hi_guide_cancellations',
    },
  ],
};
