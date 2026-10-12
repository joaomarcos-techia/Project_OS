# Execução das 44 suítes `production-*` — 29/09–01/10/2026

Em 01/10, os 44 arquivos e 49 casos foram coletados novamente contra
`https://app.qoro.dev`, sem habilitar opt-ins mutáveis. A coleta terminou com
**46 SKIP + 3 PRECONDITION BLOCKED**: os três bloqueios são credenciais de contas
de teste ausentes, e não host incorreto. Nove specs foram então habilitados
isoladamente com pré-condições legítimas: oito passaram integralmente; a
fronteira anônima passou dois dos três casos e pulou somente o deep-link de
conversa porque produção não possui essa fixture. `SKIP` não é `PASS`, e o
consolidado abaixo usa somente a medição mais recente.

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
| `production-financial-lifecycle-a.spec.ts` | 1 | **PASS funcional isolado** | 53,4 s | Quatro valores inválidos recusados sem persistência; arredondamento 10,005 → 10,01; cancelamento; recebimentos 3,33 + 6,67; dois estornos e compensações totalizando 10; filtros e estado final conferidos. Cleanup removeu todos os registros marcados e o readback deu zero. |
| `production-founder-price.spec.ts` | 1 | **PASS isolado** | 6,7 s | preço fundador revalidado sem cobrança nem mutação Asaas |
| `production-hours-atomicity-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para horários sintéticos na Clínica A. |
| `production-invite-concurrency-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para convites sintéticos na Clínica A. |
| `production-lgpd-export-email.spec.ts` | 1 | **SKIP** | 2 ms | Exige E2E_PRODUCTION_LGPD_EXPORT=ALLOW_SYNTHETIC_EMAIL para enviar um e-mail controlado. |
| `production-lgpd-full-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_LGPD_LIFECYCLE=ALLOW_DESTRUCTIVE_CLINIC_A. |
| `production-mfa-lifecycle.spec.ts` | 1 | **PASS funcional isolado** | 16,9 s | Conta E2E owner: ativou TOTP, elevou para AAL2 e removeu o fator. Readback final: nenhum fator verificado ou pendente. |
| `production-password-recovery-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para recovery sintético na Clínica A. |
| `production-patient-idempotency.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_IDEMPOTENCY=ALLOW_SYNTHETIC_PATIENT para criar a fixture. |
| `production-patient-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_PATIENT_LIFECYCLE=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-permission-lifecycle.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_PERMISSIONS=ALLOW_TEST_ACCOUNTS para alterar overrides de teste. |
| `production-prontuario-direct-rbac-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_CLINICAL_RBAC=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-recurrence-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para recorrência sintética na Clínica A. |
| `production-report-matrix.spec.ts` | 1 | **SKIP** | 1 ms | Exige E2E_PRODUCTION_REPORT_MATRIX=ALLOW_READ_ONLY_PRODUCTION. |
| `production-role-journeys-a.spec.ts` | 4 | **SKIP** | 0 ms | Exige E2E_PRODUCTION_ROLE_JOURNEYS=ALLOW_SYNTHETIC_CLINIC_A. |
| `production-role-transition-matrix-a.spec.ts` | 1 | **PASS funcional isolado** | 1,2 min | Nove transições exigidas e três pontes: 12 sessões antigas recusadas, 12 claims novas e 12 bundles de banco conferidos; role final attendant. Convite/usuário/auditoria/outbox removidos com readback zero. |
| `production-scheduling-config-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-session-logout-replay-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para usuário sintético na Clínica A. |
| `production-subscription-cancellation-trial-a.spec.ts` | 1 | **SKIP** | 0 ms | Exige autorização explícita para a negativa controlada de assinatura. |
| `production-supplier-lifecycle-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para dados sintéticos na Clínica A. |
| `production-team-lifecycle.spec.ts` | 1 | **SKIP** | N/D | Exige opt-in e sessão owner descartável. O coletor foi corrigido para não ler `user.json` antes do `skip`; repetição: 1 skip, exit 0. |
| `production-unauthenticated-boundary.spec.ts` | 3 | **PARTIAL: 2 PASS + 1 SKIP** | 9,0 s | 28 rotas estáticas e cinco deep-links com IDs reais redirecionaram para `/login`; HSTS, CSP, nosniff e frame deny presentes. Só `/conversas/[id]` ficou SKIP porque `ai_conversations=0`. |
| `production-waitlist-a.spec.ts` | 1 | **SKIP** | 1 ms | Exige autorização explícita para lista de espera sintética na Clínica A. |
| `production-whatsapp-settings-rbac.spec.ts` | 1 | **PRECONDITION BLOCKED** | 1 ms | `E2E_DOCTOR_EMAIL` e `E2E_TENANT_PASSWORD` ausentes |

Consolidado por arquivo, combinando apenas execuções funcionais reais: **44 esperadas → 44 invocadas → 8 com PASS integral → 1 PARTIAL → 0 FAIL → 3 PRECONDITION BLOCKED → 32 SKIP**.

Consolidado por caso: **49 casos → 10 PASS → 0 FAIL → 3 PRECONDITION BLOCKED → 36 SKIP**.

As 32 suítes ainda em `SKIP` exigem uma ou mais destas pré-condições: opt-in
exato, senha comum de contas E2E, identidades owner/doctor/attendant/financial em
tenants descartáveis e fixtures clínicas próprias. Essas variáveis estão
ausentes. A clínica nominalmente de teste possui hoje três perfis ativos, mas os
specs de recovery/logout exigem quatro; criar uma role ou escolher um usuário
real só para obter verde alteraria a natureza da prova.

### Reexecução das três pré-condições de RBAC em 04/10/2026

As variáveis `E2E_TESTE_PROD_EMAIL`, `E2E_TESTE_PROD_PASSWORD`,
`E2E_TESTE_PROD_EMAIL_DOCTOR` e `E2E_TESTE_PROD_PASSWORD_DOCTOR` estavam presentes e foram
mapeadas apenas no processo para os aliases exigidos pelos três specs. O alvo foi
`https://app.qoro.dev`; os specs inspecionados fazem login de teste, SELECT e GET, sem mutação
de negócio. A invocação única dos specs `production-dashboard-financial-rbac`,
`production-dashboard-operational-a` e `production-whatsapp-settings-rbac` terminou exit 1:
os três interromperam antes das assertions funcionais porque o médico configurado não foi
encontrado. Uma transação `READ ONLY` independente no banco de produção confirmou, sem expor
identidades: a conta owner configurada existe e tem role `owner` ativa; o e-mail configurado
como médico **não existe em `auth.users` de produção** e não compartilha clínica ativa com o
owner. Classificação: **3 PRECONDITION BLOCKED, 0 PASS funcional, 0 FAIL de produto** nesta
reexecução. Para reexecutar, usar uma conta de médico de teste realmente existente na mesma
clínica e com credencial válida; não criar usuário em produção só para tornar a suíte verde.

A coleta conjunta sem opt-ins continua deliberadamente sem prova funcional:
**46 SKIP + 3 falhas de pré-condição e zero PASS**. Os dez PASS acima vieram de
execuções isoladas que satisfizeram os respectivos guardas. Essa separação evita
atribuir à coleta um resultado que ela não produziu.

### Revalidação em 05/10/2026 — médico existente, UI atual e 44 arquivos

As quatro variáveis `E2E_TESTE_PROD_EMAIL`, `E2E_TESTE_PROD_PASSWORD`,
`E2E_TESTE_PROD_EMAIL_DOCTOR` e `E2E_TESTE_PROD_PASSWORD_DOCTOR` foram carregadas
somente no processo de teste e mapeadas para os aliases esperados. Um `SELECT` em
transação `READ ONLY` no projeto Auth de produção confirmou que a conta de médico
**agora existe**, está ativa e tem role `doctor`. Portanto, o bloqueio por conta
inexistente registrado acima é histórico e não representa o estado de 05/10.
Nenhum valor de credencial nem identidade foi registrado.

As três suítes read-only antes bloqueadas foram executadas contra
`https://app.qoro.dev`: `production-dashboard-financial-rbac` **1 PASS**;
`production-dashboard-operational-a` **1 PASS** depois de corrigir expectativas
do próprio teste que ainda exigiam textos removidos da UI; e
`production-whatsapp-settings-rbac` **1 PASS** para negar as três páginas ao
médico sem `manage:settings`, mais **1 PRECONDITION BLOCKED** para comprovar
ocultação de metadados de um número efetivamente conectado. O `SELECT` de
pré-condição desse último caso contou **zero conexões ativas** na clínica do
médico. Não criar conexão em produção apenas para obter um verde.

Depois dessas correções de teste, os **44 arquivos** foram invocados novamente,
com todos os opt-ins de mutação `E2E_PRODUCTION_*` removidos do processo. A coleta
teve **50 casos: 3 PASS funcionais, 46 SKIP deliberados e 1 PRECONDITION BLOCKED**;
exit 1 decorre exclusivamente da asserção de fixture de conexão ativa. `SKIP`
não é PASS e a precondição não é bug de autorização do produto. A suíte
`production-unauthenticated-boundary` também foi reexecutada isoladamente com o
seu opt-in **somente leitura**: **2 PASS** (28 rotas estáticas, cinco deep-links,
headers de segurança) e **1 SKIP** porque não havia conversa real na fixture;
exit 0. Essa execução isolada não altera a contagem da coleta conjunta.

As 46 omissões da coleta conjunta continuam ligadas aos guardas individuais
descritos na tabela histórica. Não foram ativados os cenários que escrevem em
produção. A matriz ainda não comprova essas funcionalidades na versão atual; os
PASS históricos isolados não são reclassificados como PASS desta rodada.
