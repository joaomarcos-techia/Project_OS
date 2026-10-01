# Execução das 44 suítes `production-*` — 29/09–01/10/2026

Em 01/10, os 44 arquivos e 47 casos foram coletados novamente contra
`https://app.qoro.dev`, sem habilitar opt-ins mutáveis. A coleta terminou com
**44 SKIP + 3 PRECONDITION BLOCKED**: os três bloqueios são credenciais de contas
de teste ausentes, e não host incorreto. Seis specs foram então habilitados
isoladamente com pré-condições legítimas: cinco passaram, e a fronteira anônima ficou bloqueada
porque produção não possui uma conversa fixture. `SKIP` não é
`PASS`, e o consolidado abaixo usa somente a medição mais recente.

| Suíte | Casos | Estado atual | Duração observada | Pré-condição/evidência |
| --- | ---: | --- | ---: | --- |
| `production-all-permission-overrides.spec.ts` | 1 | **SKIP** | 9 ms | Exige E2E_PRODUCTION_ALL_PERMISSIONS=ALLOW_TEST_ACCOUNT para alterar o atendente de teste. |
| `production-appointment-concurrency.spec.ts` | 1 | **SKIP** | 6 ms | Exige E2E_PRODUCTION_SCHEDULING_CONCURRENCY=ALLOW_SYNTHETIC_APPOINTMENT. |
| `production-appointment-import-a.spec.ts` | 1 | **SKIP** | 10 ms | Exige autorização explícita para importação histórica sintética na Clínica A. |
| `production-appointment-recovery-a.spec.ts` | 1 | **SKIP** | 261 ms | Exige E2E_PRODUCTION_APPOINTMENT_RECOVERY=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-authorized-mutations.spec.ts` | 1 | **PASS funcional isolado** | 59,2 s | Paciente, edição, procedimento, agenda, cancelamento excepcional, consultório, prontuário, prescrição, documento, assinatura, encerramento, recebimento, reembolso e LGPD. Cleanup externo da fixture sintética com readback zero. |
| `production-clinic-profile-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para dados inválidos na Clínica A. |
| `production-collection-case-a.spec.ts` | 1 | **SKIP** | 62 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-consultorio-attendant-integrity-a.spec.ts` | 1 | **SKIP** | 67 ms | Exige E2E_PRODUCTION_CONSULTORIO_INTEGRITY=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-consultorio-no-show-a.spec.ts` | 1 | **SKIP** | 67 ms | Exige E2E_PRODUCTION_CONSULTORIO_NO_SHOW=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-convenio-payment-a.spec.ts` | 1 | **SKIP** | 2 ms | Exige E2E_PRODUCTION_CONVENIO=ALLOW_TEST_ACCOUNT. |
| `production-conversation-handoff-a.spec.ts` | 1 | **SKIP** | 2 ms | Exige autorização explícita para conversa sintética na Clínica A. |
| `production-cross-tenant-clinical-idor.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_CLINICAL_IDOR=ALLOW_READ_ONLY para consultar fixtures de PROD. |
| `production-cross-tenant-patients.spec.ts` | 1 | **SKIP** | 2 ms | Exige E2E_PRODUCTION_CROSS_TENANT=ALLOW_TEST_ACCOUNTS para fixtures sintéticas. |
| `production-cross-tenant-rls-matrix.spec.ts` | 1 | **PASS read-only isolado** | 6,1 s | 109 tabelas tenant-scoped; 47 com fixture, zero vazamento cross-tenant |
| `production-cross-tenant-rls-mutations.spec.ts` | 1 | **PASS rollback isolado** | 2,0 min | 150 probes transacionais; 150 negações cross-tenant; nenhuma mutação persistida |
| `production-dashboard-financial-rbac.spec.ts` | 1 | **PRECONDITION BLOCKED** | 1 ms | `E2E_DOCTOR_EMAIL` e `E2E_TENANT_PASSWORD` ausentes |
| `production-dashboard-nonzero-a.spec.ts` | 1 | **PASS isolado** | 9,6 s | Login real pela UI; cinco consultas sintéticas produziram os indicadores esperados; cleanup restaurou baseline zero. |
| `production-dashboard-operational-a.spec.ts` | 1 | **PRECONDITION BLOCKED** | 4 ms | credenciais owner/doctor da Clínica A ausentes |
| `production-feedback-privacy-a.spec.ts` | 1 | **SKIP** | 9 ms | Exige autorização explícita para sugestões sintéticas na Clínica A. |
| `production-financial-concurrency-a.spec.ts` | 1 | **SKIP** | 106 ms | Exige E2E_PRODUCTION_FINANCIAL_CONCURRENCY=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-financial-lifecycle-a.spec.ts` | 1 | **SKIP** | 69 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-founder-price.spec.ts` | 1 | **PASS isolado** | 6,7 s | preço fundador revalidado sem cobrança nem mutação Asaas |
| `production-hours-atomicity-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para horários sintéticos na Clínica A. |
| `production-invite-concurrency-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para convites sintéticos na Clínica A. |
| `production-lgpd-export-email.spec.ts` | 1 | **SKIP** | 2 ms | Exige E2E_PRODUCTION_LGPD_EXPORT=ALLOW_SYNTHETIC_EMAIL para enviar um e-mail controlado. |
| `production-lgpd-full-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_LGPD_LIFECYCLE=ALLOW_DESTRUCTIVE_CLINIC_A. |
| `production-mfa-lifecycle.spec.ts` | 1 | **SKIP** | 141 ms | Exige E2E_PRODUCTION_MFA=ALLOW_TEST_ACCOUNT para alterar a conta de teste. |
| `production-password-recovery-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para recovery sintético na Clínica A. |
| `production-patient-idempotency.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_IDEMPOTENCY=ALLOW_SYNTHETIC_PATIENT para criar a fixture. |
| `production-patient-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_PATIENT_LIFECYCLE=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-permission-lifecycle.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_PERMISSIONS=ALLOW_TEST_ACCOUNTS para alterar overrides de teste. |
| `production-prontuario-direct-rbac-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_CLINICAL_RBAC=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-recurrence-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para recorrência sintética na Clínica A. |
| `production-report-matrix.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_REPORT_MATRIX=ALLOW_READ_ONLY_PRODUCTION. |
| `production-role-journeys-a.spec.ts` | 4 | **SKIP** | 0 ms | Exige E2E_PRODUCTION_ROLE_JOURNEYS=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-role-transition-matrix-a.spec.ts` | 1 | **SKIP** | 77 ms | Exige E2E_PRODUCTION_ROLE_MATRIX=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-scheduling-config-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-session-logout-replay-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para usuário sintético na Clínica A. |
| `production-subscription-cancellation-trial-a.spec.ts` | 1 | **SKIP** | 0 ms | Exige autorização explícita para a negativa controlada de assinatura. |
| `production-supplier-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-team-lifecycle.spec.ts` | 1 | **SKIP** | N/D | Exige opt-in e sessão owner descartável. O coletor foi corrigido para não ler `user.json` antes do `skip`; repetição: 1 skip, exit 0. |
| `production-unauthenticated-boundary.spec.ts` | 1 | **PRECONDITION BLOCKED** | 2,3 s | há pacientes/PDFs/prontuários, mas `ai_conversations=0`; o spec exige todos os tipos de ID real |
| `production-waitlist-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para lista de espera sintética na Clínica A. |
| `production-whatsapp-settings-rbac.spec.ts` | 1 | **PRECONDITION BLOCKED** | 1 ms | `E2E_DOCTOR_EMAIL` e `E2E_TENANT_PASSWORD` ausentes |

Consolidado por arquivo: **44 esperadas → 44 invocadas → 5 com PASS funcional → 0 FAIL → 4 PRECONDITION BLOCKED → 35 SKIP**.

Consolidado por caso: **47 casos → 5 PASS → 0 FAIL → 4 PRECONDITION BLOCKED → 38 SKIP**.

As 35 suítes ainda em `SKIP` exigem uma ou mais destas pré-condições: opt-in
exato, senha comum de contas E2E, identidades owner/doctor/attendant/financial em
tenants descartáveis e fixtures clínicas próprias. Essas variáveis estão
ausentes. A clínica nominalmente de teste possui hoje três perfis ativos, mas os
specs de recovery/logout exigem quatro; criar uma role ou escolher um usuário
real só para obter verde alteraria a natureza da prova.
