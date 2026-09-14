# Matriz de cobertura E2E

## Status

Canonical — 2026-09-13. Companheira de [`e2e-coverage-audit.md`](e2e-coverage-audit.md).

## Como ler

A coluna **Status** usa cinco valores, e a diferença entre eles é o ponto do
documento:

| Valor | Significa |
| --- | --- |
| **Coberto** | Há spec que exercita a ação **e** prova o efeito (banco ou reload). |
| **Parcial** | Há spec, mas falta um lado: o negativo, a persistência, ou uma role. |
| **Superficial** | A rota é visitada; a funcionalidade não é exercitada. Conta como **não coberto**. |
| **Não coberto** | Nenhum spec toca. |
| **Fora do navegador** | Coberto por script de smoke/live-check, não por Playwright — por decisão, não por esquecimento. |

`Roles` lista as personas efetivamente exercitadas no spec, não as que
*poderiam* estar.

---

## 1. Autenticação e sessão

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Novo E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login | entrar | qualquer | sim | senha errada, conta desativada | `login-and-navigation`, `production-team-lifecycle` | `public-surface` (estrutura do form) | Coberto |
| Login | rate limit dual (IP+e-mail) | — | — | sim | — (unitário) | — | Parcial |
| Login | captcha do Supabase | qualquer | — | reprovado ≠ senha errada | — | `login/actions.test.ts` | Parcial |
| MFA | ativar / elevar AAL2 / remover | owner | sim | fator órfão | `production-mfa-lifecycle` | — | Coberto |
| MFA | desafio na tela `/login/mfa` | super_admin | sim | — | — | `admin-superadmin-journey` | Coberto |
| Recuperação de senha | solicitar | qualquer | sim | anti-enumeração | `production-password-recovery-a` | — | Coberto |
| Recuperação de senha | prova de recovery, uso único, revogação | owner | sim | replay, token inválido | `production-password-recovery-a` | — | Coberto |
| Logout | revogar refresh, dois dispositivos | owner | sim | replay do cookie | `production-session-logout-replay-a` | — | Coberto |
| Fronteira sem sessão | 22 rotas protegidas | anônimo | — | sim | `production-unauthenticated-boundary` (só prod) | `public-surface` (qualquer ambiente) | Coberto |
| Cabeçalhos | CSP, sem curinga, Turnstile | anônimo | sim | — | `headers-gate.test.ts` (unitário) | `public-surface` (HTTP real) | Coberto |

## 2. Cadastro autônomo (ADR-060)

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Novo E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sessão anônima | abrir | anônimo | sim | corpo inválido, campo extra, corpo grande | — | `signup-session-api` | Coberto |
| Sessão anônima | cookie `__Host-` | anônimo | atributos | Domain ausente | — | `signup-session-api` | Coberto |
| Sessão anônima | ler a própria (`/me`) | anônimo | sim | 410 indistinguível | — | `signup-session-api` | Coberto |
| Risco | cross-site → 403 | anônimo | — | sim | — | `signup-session-api` | Coberto |
| Risco | origem ausente → desafio | anônimo | — | sim | — | `signup-session-api` | Coberto |
| Turnstile | verificação do token | anônimo | sim | forjado | — | `signup-session-api` + `turnstile.test.ts` | Parcial (¹) |
| Janitor | purga de sessões vencidas | cron | sim | — | `smoke:signup-session` | — | Fora do navegador |
| Teto de sessões vivas | recusa em 503 | anônimo | — | sim | `load:signup-degraded` | — | Fora do navegador |
| Tela das 3 perguntas | — | — | — | — | — | — | **Não existe ainda** |

¹ Com chaves de **teste** da Cloudflare, o token forjado é aceito de propósito.
Ver R4 da auditoria.

² A metade mutante só roda com a clínica DESCONECTADA. A do Preview já tem conta
conectada, e conectar por cima seria "Trocar chave" — substituiria a configuração
de quem usa o ambiente e deixaria um webhook órfão na conta antiga. Skip anotado,
nunca verde.

## 3. Onboarding por convite (`/join`)

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Novo E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wizard | salvar passo (clinic/owner/plan) | anônimo | sim | versão conflitante | `production-founder-price` | — | Parcial |
| Preço de fundador | tabela riscada + desconto no servidor | anônimo | sim | — | `production-founder-price` | — | Coberto |
| Checkout | ativar clínica (cartão real) | anônimo | — | — | `asaas-checkout-e2e` | — | Fora do navegador |
| Checkout | auto-login pós-ativação | owner | não | não | — | — | **Não coberto** |
| Convite de equipe | aceitar | convidado | sim | concorrência, vaga única | `production-invite-concurrency-a`, `production-team-lifecycle` | — | Coberto |

## 4. Pacientes

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Paciente | criar | owner, attendant | sim | 121 chars, e-mail inválido, CPF | `production-patient-lifecycle-a` | Coberto |
| Paciente | criar (idempotência) | tenant B | sim | mesma chave, payload diferente | `production-patient-idempotency` | Coberto |
| Paciente | buscar (Unicode, XSS, SQLi) | owner | sim | sim | `production-patient-lifecycle-a` | Coberto |
| Paciente | editar (concorrente) | owner, attendant | sim | vencedor único | `production-patient-lifecycle-a` | Coberto |
| Paciente | vincular / desvincular responsável | owner | sim | auto-vínculo adulterado | `production-patient-lifecycle-a` | Coberto |
| Paciente | mesclar | owner | sim | auto-merge, ID desconhecido | `production-patient-lifecycle-a` | Coberto |
| Paciente | registrar óbito | owner | sim | data futura | `production-patient-lifecycle-a` | Coberto |
| Paciente | excluir / restaurar | owner, attendant | sim | ausência de recovery indevido | `production-patient-lifecycle-a` | Coberto |
| Paciente | isolamento A↔B | tenant A/B | — | listagem, detalhe, CRUD adulterado | `production-cross-tenant-patients` | Coberto |
| LGPD | exportar (PDF/JSON privados) | controlled | sim | A↔B | `production-lgpd-export-email` | Coberto |
| LGPD | ciclo destrutivo (reter, eliminar, anonimizar) | controlled, doctor | sim | — | `production-lgpd-full-lifecycle-a` | Coberto |
| LGPD | fila em `/configuracoes/lgpd` | owner | sim | — | `tenant-settings-screens` | Coberto |
| Consentimento | conceder / revogar | — | não | não | — | **Não coberto** |

## 5. Agenda e Consultório

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Atendimento | criar | attendant | sim | conflito de horário | `mutation-flows`, `production-authorized-mutations` | Coberto |
| Atendimento | double booking simultâneo | tenant B | — | vencedor único | `production-appointment-concurrency` | Coberto |
| Atendimento | recorrência | attendant | sim | limites, duplicidade, rollback | `production-recurrence-a` | Coberto |
| Atendimento | transferir / replay / cancelar / reabrir | owner, doctor, attendant | sim | entrada inválida | `production-appointment-recovery-a` | Coberto |
| Atendimento | no-show inalcançável | owner, doctor, attendant | — | sim | `production-consultorio-no-show-a` | Coberto |
| Importação histórica | RBAC, rollback, proveniência, idempotência | owner, attendant, owner B | sim | sim | `production-appointment-import-a` | Coberto |
| Lista de espera | criar, ofertar, cancelar, encerrar | attendant | sim | validação | `production-waitlist-a` | Coberto |
| Ausência médica | criar (própria agenda) | doctor, owner | sim | agenda de terceiro | `production-scheduling-config-a` | Coberto |
| Consultório | chamar, check-in, ausência, encerrar | attendant, doctor, financial | sim | atendente não encerra; médico exige prontuário assinado | `production-consultorio-attendant-integrity-a` | Coberto |
| Horários | expediente, pausa, feriado, remoção | owner | sim | conflito parcial | `production-hours-atomicity-a` | Coberto |
| Procedimentos / recursos | criar, desativar, reativar | owner, doctor, tenant B | sim | tenant estrangeiro | `production-scheduling-config-a` | Coberto |

## 6. Clínico

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Prontuário | criar, assinar | doctor | sim | — | `production-consultorio-attendant-integrity-a` | Coberto |
| Prontuário | deep-link sem `view:prontuario` | attendant, financial, doctor | — | sim | `production-prontuario-direct-rbac-a` | Coberto |
| Prontuário | IDOR A↔B | tenant A/B | — | sim | `production-cross-tenant-clinical-idor` | Coberto |
| Template clínico (Psiquiatria) | selecionar, preencher, persistir | doctor | sim | — | `psychiatry-template` | Coberto |
| Documentos fora da consulta | emitir e convergir 3 telas | doctor | sim | — | `clinical-standalone-documents` | Coberto |
| PDFs (prescrição/documento) | acesso autenticado | — | sim | ID estrangeiro | `production-cross-tenant-clinical-idor` | Coberto |
| Modelos de receita | criar, persistir e excluir (com confirmação) | owner | sim | — | `tenant-settings-screens` | Coberto |

## 7. Financeiro

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Lançamento | criar manual | owner, financial | sim | valores inválidos, arredondamento | `production-financial-lifecycle-a` | Coberto |
| Lançamento | confirmar recebimento | financial, attendant | sim | duplo recebimento simultâneo | `production-financial-concurrency-a` | Coberto |
| Lançamento | cancelar, estornar multipartes | owner | sim | sim | `production-financial-lifecycle-a` | Coberto |
| Convênio | faturar e receber | tenant A | sim | — | `production-convenio-payment-a` | Coberto |
| Cobrança (fila humana) | replay, quitação, resolução | owner, tenant B | sim | guarda de tenant | `production-collection-case-a` | Coberto |
| Fornecedores | criar, editar concorrente, desativar | owner, financial, tenant B | sim | CNPJ, isolamento | `production-supplier-lifecycle-a` | Coberto |
| Dashboard financeiro | KPIs sem `view:financial` | doctor | — | sim | `production-dashboard-financial-rbac` | Coberto |
| Relatórios | períodos, totais, PDFs, tenant binding | 5 roles | sim | período inválido, clinicId estrangeiro | `production-report-matrix` | Coberto |
| Export contábil | CSV da ADR-058 | autenticado, anônimo | sim | mês malformado, sem sessão | `accounting-export` | Coberto |
| Conectar conta Asaas | chave inválida recusada, estado intacto, chave não volta ao browser | manage:financial | — | sim | `payments-account-lifecycle` | Coberto |
| Conectar conta Asaas | ciclo conectar → persistir → desconectar | manage:financial | sim | — | `payments-account-lifecycle` (condicional) | Parcial (²) |

## 8. Equipe e permissões

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Convidar membro | criar, reenviar, cancelar | team owner | sim | concorrência | `production-team-lifecycle`, `production-invite-concurrency-a` | Coberto |
| Membro | ativar / desativar | team owner | sim | — | `production-team-lifecycle` | Coberto |
| Role | as 9 transições | owner | sim | invalidação de sessão | `production-role-transition-matrix-a` | Coberto |
| Overrides | as 28 permissions, negar e conceder | permission owner/target | sim | sim | `production-all-permission-overrides` | Coberto |
| Permissões | revogação de sessão, replay, autoelevação | permission owner/target | — | sim | `production-permission-lifecycle` | Coberto |
| Jornadas por role | atendente, médico, financeiro | 3 roles | sim | bloqueios | `production-role-journeys-a` | Coberto |

## 9. Conversas, agente e WhatsApp

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Handoff | assumir, priorizar, reatribuir, devolver | owner, attendant | sim | ator antigo negado | `production-conversation-handoff-a` | Coberto |
| Config do agente | convênios (salvar, reler, restaurar) | manage:agent | sim | — | `agent-convenios` | Coberto |
| WhatsApp | estado e controles sem `manage:settings` | doctor | — | sim | `production-whatsapp-settings-rbac` | Coberto |
| WhatsApp | conectar/desconectar (Embedded Signup) | — | não | não | `smoke:c10`, `wa:connect` | Fora do navegador |
| Webhook Meta | recebimento, idempotência, fora de ordem | — | sim | sim | `smoke:c10`, `smoke:c12` | Fora do navegador |
| Agente | resposta pelo pipeline real | — | sim | adversarial | `smoke:c11`, `ai:adversarial` | Fora do navegador |

## 10. Assinatura e plataforma

| Funcionalidade | Ação | Roles | Positivo | Negativo | E2E existente | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Cancelamento na trial | UI não oferece | owner, doctor | — | sim | `production-subscription-cancellation-trial-a` | Coberto |
| Troca de plano / reativação | — | não | não | — | — | **Não coberto** |
| Webhook Asaas (billing) | pago, dunning, suspensão | — | sim | sim | `smoke:c13`, `billing:live-roundtrip` | Fora do navegador |
| Sugestões | enviar, autor privado, A↔B, replay | owner, doctor, tenant B | sim | sim | `production-feedback-privacy-a` | Coberto |
| Perfil da clínica | editar, concorrência | owner, doctor, tenant B | sim | CNPJ inválido | `production-clinic-profile-a` | Coberto |
| Auditoria (`/configuracoes/auditoria`) | exportar CSV de verdade, colunas travadas | owner | sim | — | `tenant-settings-screens` | Coberto |

## 11. Plataforma — `super_admin` (`/admin`)

| Funcionalidade | Ação | Roles | E2E existente | Status |
| --- | --- | --- | --- | --- |
| Painel | ver com AAL2 | super_admin | `admin-superadmin-journey` | Coberto |
| Clínicas | listar e abrir | super_admin | `admin-superadmin-journey` | Coberto |
| Impersonate | iniciar (step-up TOTP) | super_admin | `admin-superadmin-journey` | Coberto |
| Impersonate | encerrar pelo banner, com auditoria | super_admin | `admin-superadmin-journey` | Coberto |
| Impersonate | **revogar a linha mata a sessão com o cookie intacto** | super_admin | `admin-superadmin-journey` | Coberto |
| Kill-switch | flag **e** auditoria na mesma transação | super_admin | `admin-superadmin-journey` | Coberto |
| Kill-switches / flags | alterar (nível de banco) | super_admin | `smoke:admin-config` | Fora do navegador |
| Anúncio (broadcast) | publicar / desativar | super_admin | `smoke:admin-config` | Fora do navegador |
| Billing da plataforma | ver | super_admin | `admin-superadmin-journey` | Coberto |
| Auditoria da plataforma | ver | super_admin | `admin-superadmin-journey` | Coberto |
| Métricas / Saúde | ver | super_admin | `admin-superadmin-journey` | Coberto |
| Feedbacks | ver a fila | super_admin | `admin-superadmin-journey` | Coberto |
| Conversas IA | ver | super_admin | `admin-superadmin-journey` | Coberto |
| Fronteira anônima de `/admin` | redirect | anônimo | `public-surface` (8 rotas) | Coberto |
| **Fronteira autenticada de `/admin`** | **deny com sessão de clínica válida** | owner de clínica | `admin-boundary-rbac` (9 rotas + deep-link) | **Coberto** |

**O buraco foi fechado em 14/09.** `admin-boundary-rbac.spec.ts`
cobre o lado que mais importa em segurança: uma sessão de clínica **válida**
(JWT legítimo, cookie presente) batendo direto nas 9 rotas de plataforma e no
deep-link de clínica por ID. O middleware deixa passar de propósito — ele só
confere presença de cookie (ADR-037) — então quem nega é a porta única no
servidor, e é essa decisão que o teste exercita.

O caminho **positivo** — o que o `super_admin` faz depois de entrar — passou a ser
coberto por `admin-superadmin-journey`, contra o **Preview** e usando apenas
clínicas `Smoke %`. Ele exercita login com step-up de TOTP até AAL2, kill-switch
(flag **e** auditoria juntas), e o ciclo inteiro de impersonate.

O que continua fora: `/admin/billing`, `/admin/audit`, `/admin/metricas`,
`/admin/saude`, `/admin/feedbacks` e `/admin/conversas-ia` como TELAS. São
leitura, e o risco delas é o de qualquer página autenticada — não o risco
particular de `/admin`, que era impersonate e kill-switch.

---

## Contagem

Contadas do próprio arquivo, não estimadas.

| Status | Linhas |
| --- | --- |
| Coberto | 81 |
| Parcial | 5 |
| Superficial | **0** |
| Não coberto | **3** |
| Fora do navegador | 9 |
| Não existe ainda (tela das 3 perguntas) | 1 |

**De 14 para 3 em 14/09**, e "superficial" zerou — a categoria existia para nomear cobertura
aparente (rota visitada, `status < 500`), e não sobrou nenhuma.

Os três que restam não sobraram por esquecimento; cada um tem um motivo que não se resolve
escrevendo mais teste:

| O que falta | Por que não foi coberto |
| --- | --- |
| **Auto-login pós-checkout** | Exige um checkout pago completo. Além disso, a fatia vai mudar: a decisão de 14/09 troca o checkout transparente pelo hospedado do Asaas, e o provisionamento passa a ser por webhook. Cobrir agora seria testar código com data de validade. |
| **Consentimento (conceder / revogar)** | Toca dado de PACIENTE. Exige fixture própria e cleanup provado; um teste não deve decidir exercitar revogação de consentimento sem isso, nem em Preview. |
| **Troca de plano / reativação** | Muta estado de billing da clínica no Asaas. Precisa de assinatura sandbox dedicada — a mesma razão que manteve o ciclo de `payments-account-lifecycle` condicional. |

O mesmo vale para a **tela das 3 perguntas**: não há o que testar porque ela ainda não existe.
