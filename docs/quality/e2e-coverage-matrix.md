# Matriz de cobertura E2E

## Status

Canonical histórica — base atualizada em 2026-09-15, com adendo de execução em
28/09/2026. Companheira de
[`e2e-coverage-audit.md`](e2e-coverage-audit.md).

Resultados atuais usam `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, `NOT TESTED` e
`ADIADO_WHATSAPP`. As categorias antigas de cobertura abaixo continuam úteis
para localizar specs, mas não equivalem a resultado atual. Evidência corrente:
[`auditoria-integral-execucao.md`](auditoria-integral-execucao.md).

## Como ler

A coluna **Status** usa cinco valores, e a diferença entre eles é o ponto do
documento:

| Valor                 | Significa                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| **Coberto**           | Há spec que exercita a ação **e** prova o efeito (banco ou reload).                             |
| **Parcial**           | Há spec, mas falta um lado: o negativo, a persistência, ou uma role.                            |
| **Superficial**       | A rota é visitada; a funcionalidade não é exercitada. Conta como **não coberto**.               |
| **Não coberto**       | Nenhum spec toca.                                                                               |
| **Fora do navegador** | Coberto por script de smoke/live-check, não por Playwright — por decisão, não por esquecimento. |

`Roles` lista as personas efetivamente exercitadas no spec, não as que
_poderiam_ estar.

---

## 1. Autenticação e sessão

| Funcionalidade       | Ação                                    | Roles       | Positivo | Negativo                       | E2E existente                                       | Novo E2E                             | Status  |
| -------------------- | --------------------------------------- | ----------- | -------- | ------------------------------ | --------------------------------------------------- | ------------------------------------ | ------- |
| Login                | entrar                                  | qualquer    | sim      | senha errada, conta desativada | `login-and-navigation`, `production-team-lifecycle` | `public-surface` (estrutura do form) | Coberto |
| Login                | rate limit dual (IP+e-mail)             | —           | —        | sim                            | — (unitário)                                        | —                                    | Parcial |
| Login                | captcha do Supabase                     | qualquer    | —        | reprovado ≠ senha errada       | —                                                   | `login/actions.test.ts`              | Parcial |
| MFA                  | ativar / elevar AAL2 / remover          | owner       | sim      | fator órfão                    | `production-mfa-lifecycle`                          | —                                    | Coberto |
| MFA                  | desafio na tela `/login/mfa`            | super_admin | sim      | —                              | —                                                   | `admin-superadmin-journey`           | Coberto |
| Recuperação de senha | solicitar                               | qualquer    | sim      | anti-enumeração                | `production-password-recovery-a`                    | —                                    | Coberto |
| Recuperação de senha | prova de recovery, uso único, revogação | owner       | sim      | replay, token inválido         | `production-password-recovery-a`                    | —                                    | Coberto |
| Logout               | revogar refresh, dois dispositivos      | owner       | sim      | replay do cookie               | `production-session-logout-replay-a`                | —                                    | Coberto |
| Fronteira sem sessão | 28 rotas + deep-links reais             | anônimo     | —        | sim                            | `production-unauthenticated-boundary` (só prod)     | `public-surface` (qualquer ambiente) | Coberto |
| Cabeçalhos           | CSP, sem curinga, Turnstile             | anônimo     | sim      | —                              | `headers-gate.test.ts` (unitário)                   | `public-surface` (HTTP real)         | Coberto |

## 2. Cadastro autônomo (ADR-060)

| Funcionalidade                             | Ação                                                                                  | Roles                  | Positivo                                    | Negativo                                                                          | E2E existente          | Novo E2E                                                                                | Status            |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| Sessão anônima                             | abrir                                                                                 | anônimo                | sim                                         | corpo inválido, campo extra, corpo grande                                         | —                      | `signup-session-api`                                                                    | Coberto           |
| Sessão anônima                             | cookie `__Host-`                                                                      | anônimo                | atributos                                   | Domain ausente                                                                    | —                      | `signup-session-api`                                                                    | Coberto           |
| Sessão anônima                             | ler a própria (`/me`)                                                                 | anônimo                | sim                                         | 410 indistinguível                                                                | —                      | `signup-session-api`                                                                    | Coberto           |
| Risco                                      | cross-site → 403                                                                      | anônimo                | —                                           | sim                                                                               | —                      | `signup-session-api`                                                                    | Coberto           |
| Risco                                      | origem ausente → desafio                                                              | anônimo                | —                                           | sim                                                                               | —                      | `signup-session-api`                                                                    | Coberto           |
| Turnstile                                  | verificação do token                                                                  | anônimo                | sim                                         | forjado                                                                           | —                      | `signup-session-api` + `turnstile.test.ts`                                              | Parcial (¹)       |
| Janitor                                    | purga de sessões vencidas                                                             | cron                   | sim                                         | —                                                                                 | `smoke:signup-session` | —                                                                                       | Fora do navegador |
| Teto de sessões vivas                      | recusa em 503                                                                         | anônimo                | —                                           | sim                                                                               | `load:signup-degraded` | —                                                                                       | Fora do navegador |
| Quatro respostas                           | persistir e reler por `/answers` + `/me`                                              | anônimo                | banco + reload                              | schema, 410, 409/CAS, 429, rede                                                   | —                      | `scripts/security/signup-regression.ts --browser` (local)                               | Coberto           |
| Tela `/cadastro`                           | responder sem PII                                                                     | anônimo                | teclado, labels, duas abas, reload          | foco, duplo envio, expiração, desafio                                             | —                      | `scripts/security/signup-regression.ts --browser` + `signup-questions.test.tsx` (local) | Coberto           |
| Identidade + aceite + nome da clínica O-3a | staging sem Auth, conforme [ADR-062](../adr/062-identidade-consentimento-cadastro.md) | anônimo                | SQL + reload após resposta perdida          | aceite, schema/cap/origem, CAS, TTL, gate/limiter, congelamento                   | janitor sintético      | `signup-regression.ts --browser` + testes HTTP/UI/limiter (local)                       | Coberto           |
| Envio inicial Auth O-3b.1                  | reservar antes de `signUp`, resposta pública uniforme e espera congelada              | anônimo com staging    | Next/SDK/Postgres/Chromium local            | concorrência, timeout/5xx, sessão inesperada, resposta perdida, 429/503           | —                      | `signup-regression.ts --browser` + testes HTTP/writer/limiter/cookie/UI                 | Coberto           |
| Confirmação OTP + retomada O-3b.2          | validar link e restringir pré-tenant                                                  | verificado sem profile | SDK/Next/Chromium local                     | `next` hostil, anônimo/não verificado, OTP inválido/expirado, profile/MFA/convite | —                      | `signup-regression.ts --browser` + testes de callback/seam/login/página                 | Coberto           |
| Ownership + consumo O-3b.3                 | confirmar dados e consumir/vincular uma vez                                           | verificado pré-tenant  | Postgres/Next/Auth sintético/Chromium local | A→B, e-mail/versão divergentes, unique, consumo/replay, TTL e restart             | janitor sintético      | `signup-regression.ts --browser` + testes de rota/writer/seam/limiter                   | **Coberto**       |
| Reenvio Auth O-3b.4                        | intenção explícita após cooldown, sem repetir signup                                  | anônimo com staging    | Postgres/SDK/Redis sintético/Chromium local | completed/uncertain/reserved, concorrência, cooldown, 5xx/timeout, 429/503        | —                      | `signup-regression.ts --browser` + testes de rota/writer/limiter                        | **Coberto**       |
| UI e fechamento O-3b.5–6                  | senha sem retenção, espera, revisão e reconciliação sem retry                          | anônimo/pré-tenant     | Next/SDK/Postgres/Chromium local            | senha fraca, respostas perdidas, reload, cooldown, link/restart, provider indisponível | —                   | `signup-regression.ts --browser` + testes UI/HTTP/SDK e suíte integral                   | **Coberto**       |
| Clínica e plano O-4                        | listar catálogo elegível e salvar `selected_plan_id` por CAS                           | verificado pré-tenant  | Postgres/Next/Chromium/SDKs sintéticos      | payload de preço/trial, campanha, inativo, versão concorrente, retry e TTL        | —                      | `signup-regression.ts --browser` + testes de domínio/rota/UI                            | **Coberto**       |
| Retomada entre aparelhos (ADR-062 §10)     | reencontrar o cadastro pelo e-mail verificado, sem cookie anônimo                      | verificado pré-tenant  | Postgres/Next/Chromium/SDKs sintéticos      | e-mail divergente, reserva órfã, disputa de abas, TTL vencido, cross-site, recomeço | —                      | `signup-regression.ts --browser` + `signup-draft`/rota/UI                                | **Coberto**       |
| Assinatura recorrente O-5                  | reservar antes do I/O, criar sem cartão e ativar por readback                          | verificado pré-tenant  | Postgres local + provedor sintético         | 4xx, timeout/creation_unknown, readback divergente, CAS perdido                     | `signup-regression --browser` | `signup-checkout.test.ts` + `checkout/route.test.ts`                                     | Parcial (²)       |
| Provisionamento O-6                        | criar tenant/owner/config uma vez e consumir a sessão                                  | verificado pré-tenant  | —                                           | duas abas, sessão sem assinatura, slug reservado/colidente                          | —                      | `signup-provision.test.ts` (só o slug)                                                   | Não coberto (³)   |
| Uma pergunta por tela (ADR-062 §10)        | avançar, voltar e salvar só na quarta tela                                              | anônimo                | teclado, progresso, reload, duas abas       | escolha ausente, CAS perdido, 429, rede                                            | —                      | `signup-regression.ts --browser` + `signup-questions.test.tsx`                           | **Coberto**       |
| Respostas do cadastro no `/admin`          | listar perfil declarado sem e-mail, hash ou id interno                                  | super_admin + AAL2     | render com dados e vazio                     | leitura indisponível                                                               | `admin-superadmin-journey` | `admin/page.test.tsx` + `clinics.repo`                                              | Coberto           |

O-3a, O-3b.1–O-3b.6 e O-4 têm prova local em Postgres descartável/Next/Chromium, com Auth e Redis REST
sintéticos pelos SDKs instalados. As migrations 0099–0102 estão aplicadas e relidas no DEV. A prova
real consentida de Supabase/SMTP/callback do O-3b está na ADR-062 §9.14; o O-4 ainda não foi publicado
ou exercitado no Preview. Upstash externo do O-4 e produção permanecem **NOT TESTED**. Evidências em
Qoro v2 §§35.10, 35.12–35.20. A prova local do O-4 não comprova provider externo.

¹ Com chaves de **teste** da Cloudflare, o token forjado é aceito de propósito.
Ver R4 da auditoria.

² A metade mutante só roda com a clínica DESCONECTADA. A do Preview já tem conta
conectada, e conectar por cima seria "Trocar chave" — substituiria a configuração
de quem usa o ambiente e deixaria um webhook órfão na conta antiga. Skip anotado,
nunca verde.

## 3. Onboarding por convite (`/join`)

| Funcionalidade    | Ação                                  | Roles     | Positivo | Negativo                 | E2E existente                                                  | Novo E2E | Status            |
| ----------------- | ------------------------------------- | --------- | -------- | ------------------------ | -------------------------------------------------------------- | -------- | ----------------- |
| Wizard            | salvar passo (clinic/owner/plan)      | anônimo   | sim      | versão conflitante       | `production-founder-price`                                     | —        | Parcial           |
| Preço de fundador | tabela riscada + desconto no servidor | anônimo   | sim      | —                        | `production-founder-price`                                     | —        | Coberto           |
| Checkout          | ativar clínica (cartão real)          | anônimo   | —        | —                        | `asaas-checkout-e2e`                                           | —        | Fora do navegador |
| Checkout          | auto-login pós-ativação               | owner     | não      | não                      | —                                                              | —        | **Não coberto**   |
| Convite de equipe | aceitar                               | convidado | sim      | concorrência, vaga única | `production-invite-concurrency-a`, `production-team-lifecycle` | —        | Coberto           |

## 4. Pacientes

| Funcionalidade | Ação                                           | Roles              | Positivo | Negativo                           | E2E existente                      | Status          |
| -------------- | ---------------------------------------------- | ------------------ | -------- | ---------------------------------- | ---------------------------------- | --------------- |
| Paciente       | criar                                          | owner, attendant   | sim      | 121 chars, e-mail inválido, CPF    | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | criar (idempotência)                           | tenant B           | sim      | mesma chave, payload diferente     | `production-patient-idempotency`   | Coberto         |
| Paciente       | buscar (Unicode, XSS, SQLi)                    | owner              | sim      | sim                                | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | editar (concorrente)                           | owner, attendant   | sim      | vencedor único                     | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | vincular / desvincular responsável             | owner              | sim      | auto-vínculo adulterado            | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | mesclar                                        | owner              | sim      | auto-merge, ID desconhecido        | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | registrar óbito                                | owner              | sim      | data futura                        | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | excluir / restaurar                            | owner, attendant   | sim      | ausência de recovery indevido      | `production-patient-lifecycle-a`   | Coberto         |
| Paciente       | isolamento A↔B                                 | tenant A/B         | —        | listagem, detalhe, CRUD adulterado | `production-cross-tenant-patients` | Coberto         |
| LGPD           | exportar (PDF/JSON privados)                   | controlled         | sim      | A↔B                                | `production-lgpd-export-email`     | Coberto         |
| LGPD           | ciclo destrutivo (reter, eliminar, anonimizar) | controlled, doctor | sim      | —                                  | `production-lgpd-full-lifecycle-a` | Coberto         |
| LGPD           | fila em `/configuracoes/lgpd`                  | owner              | sim      | —                                  | `tenant-settings-screens`          | Coberto         |
| Consentimento  | conceder / revogar                             | —                  | não      | não                                | —                                  | **Não coberto** |

## 5. Agenda e Consultório

| Funcionalidade           | Ação                                       | Roles                        | Positivo | Negativo                                                | E2E existente                                       | Status  |
| ------------------------ | ------------------------------------------ | ---------------------------- | -------- | ------------------------------------------------------- | --------------------------------------------------- | ------- |
| Atendimento              | criar                                      | attendant                    | sim      | conflito de horário                                     | `mutation-flows`, `production-authorized-mutations` | Coberto |
| Atendimento              | double booking simultâneo                  | tenant B                     | —        | vencedor único                                          | `production-appointment-concurrency`                | Coberto |
| Atendimento              | recorrência                                | attendant                    | sim      | limites, duplicidade, rollback                          | `production-recurrence-a`                           | Coberto |
| Atendimento              | transferir / replay / cancelar / reabrir   | owner, doctor, attendant     | sim      | entrada inválida                                        | `production-appointment-recovery-a`                 | Coberto |
| Atendimento              | no-show inalcançável                       | owner, doctor, attendant     | —        | sim                                                     | `production-consultorio-no-show-a`                  | Coberto |
| Importação histórica     | RBAC, rollback, proveniência, idempotência | owner, attendant, owner B    | sim      | sim                                                     | `production-appointment-import-a`                   | Coberto |
| Lista de espera          | criar, ofertar, cancelar, encerrar         | attendant                    | sim      | validação                                               | `production-waitlist-a`                             | Coberto |
| Ausência médica          | criar (própria agenda)                     | doctor, owner                | sim      | agenda de terceiro                                      | `production-scheduling-config-a`                    | Coberto |
| Consultório              | chamar, check-in, ausência, encerrar       | attendant, doctor, financial | sim      | atendente não encerra; médico exige prontuário assinado | `production-consultorio-attendant-integrity-a`      | Coberto |
| Horários                 | expediente, pausa, feriado, remoção        | owner                        | sim      | conflito parcial                                        | `production-hours-atomicity-a`                      | Coberto |
| Procedimentos / recursos | criar, desativar, reativar                 | owner, doctor, tenant B      | sim      | tenant estrangeiro                                      | `production-scheduling-config-a`                    | Coberto |

## 6. Clínico

| Funcionalidade                 | Ação                                         | Roles                        | Positivo | Negativo       | E2E existente                                  | Status  |
| ------------------------------ | -------------------------------------------- | ---------------------------- | -------- | -------------- | ---------------------------------------------- | ------- |
| Prontuário                     | criar, assinar                               | doctor                       | sim      | —              | `production-consultorio-attendant-integrity-a` | Coberto |
| Prontuário                     | deep-link sem `view:prontuario`              | attendant, financial, doctor | —        | sim            | `production-prontuario-direct-rbac-a`          | Coberto |
| Prontuário                     | IDOR A↔B                                     | tenant A/B                   | —        | sim            | `production-cross-tenant-clinical-idor`        | Coberto |
| Template clínico (Psiquiatria) | selecionar, preencher, persistir             | doctor                       | sim      | —              | `psychiatry-template`                          | Coberto |
| Documentos fora da consulta    | emitir e convergir 3 telas                   | doctor                       | sim      | —              | `clinical-standalone-documents`                | Coberto |
| PDFs (prescrição/documento)    | acesso autenticado                           | —                            | sim      | ID estrangeiro | `production-cross-tenant-clinical-idor`        | Coberto |
| Modelos de receita             | criar, persistir e excluir (com confirmação) | owner                        | sim      | —              | `tenant-settings-screens`                      | Coberto |

## 7. Financeiro

| Funcionalidade         | Ação                                                                | Roles                      | Positivo | Negativo                               | E2E existente                              | Status      |
| ---------------------- | ------------------------------------------------------------------- | -------------------------- | -------- | -------------------------------------- | ------------------------------------------ | ----------- |
| Lançamento             | criar manual                                                        | owner, financial           | sim      | valores inválidos, arredondamento      | `production-financial-lifecycle-a`         | Coberto     |
| Lançamento             | confirmar recebimento                                               | financial, attendant       | sim      | duplo recebimento simultâneo           | `production-financial-concurrency-a`       | Coberto     |
| Lançamento             | cancelar, estornar multipartes                                      | owner                      | sim      | sim                                    | `production-financial-lifecycle-a`         | Coberto     |
| Convênio               | faturar e receber                                                   | tenant A                   | sim      | —                                      | `production-convenio-payment-a`            | Coberto     |
| Cobrança (fila humana) | replay, quitação, resolução                                         | owner, tenant B            | sim      | guarda de tenant                       | `production-collection-case-a`             | Coberto     |
| Fornecedores           | criar, editar concorrente, desativar                                | owner, financial, tenant B | sim      | CNPJ, isolamento                       | `production-supplier-lifecycle-a`          | Coberto     |
| Dashboard financeiro   | KPIs sem `view:financial`                                           | doctor                     | —        | sim                                    | `production-dashboard-financial-rbac`      | Coberto     |
| Relatórios             | períodos, totais, PDFs, tenant binding                              | 5 roles                    | sim      | período inválido, clinicId estrangeiro | `production-report-matrix`                 | Coberto     |
| Export contábil        | CSV da ADR-058                                                      | autenticado, anônimo       | sim      | mês malformado, sem sessão             | `accounting-export`                        | Coberto     |
| Conectar conta Asaas   | chave inválida recusada, estado intacto, chave não volta ao browser | manage:financial           | —        | sim                                    | `payments-account-lifecycle`               | Coberto     |
| Conectar conta Asaas   | ciclo conectar → persistir → desconectar                            | manage:financial           | sim      | —                                      | `payments-account-lifecycle` (condicional) | Parcial (²) |

## 8. Equipe e permissões

| Funcionalidade    | Ação                                      | Roles                   | Positivo | Negativo              | E2E existente                                                  | Status  |
| ----------------- | ----------------------------------------- | ----------------------- | -------- | --------------------- | -------------------------------------------------------------- | ------- |
| Convidar membro   | criar, reenviar, cancelar                 | team owner              | sim      | concorrência          | `production-team-lifecycle`, `production-invite-concurrency-a` | Coberto |
| Membro            | ativar / desativar                        | team owner              | sim      | —                     | `production-team-lifecycle`                                    | Coberto |
| Role              | as 9 transições                           | owner                   | sim      | invalidação de sessão | `production-role-transition-matrix-a`                          | Coberto |
| Overrides         | as 28 permissions, negar e conceder       | permission owner/target | sim      | sim                   | `production-all-permission-overrides`                          | Coberto |
| Permissões        | revogação de sessão, replay, autoelevação | permission owner/target | —        | sim                   | `production-permission-lifecycle`                              | Coberto |
| Jornadas por role | atendente, médico, financeiro             | 3 roles                 | sim      | bloqueios             | `production-role-journeys-a`                                   | Coberto |

## 9. Conversas, agente e WhatsApp

| Funcionalidade   | Ação                                     | Roles            | Positivo | Negativo           | E2E existente                       | Status            |
| ---------------- | ---------------------------------------- | ---------------- | -------- | ------------------ | ----------------------------------- | ----------------- |
| Handoff          | assumir, priorizar, reatribuir, devolver | owner, attendant | sim      | ator antigo negado | `production-conversation-handoff-a` | Coberto           |
| Config do agente | convênios (salvar, reler, restaurar)     | manage:agent     | sim      | —                  | `agent-convenios`                   | Coberto           |
| WhatsApp         | estado e controles sem `manage:settings` | doctor           | —        | sim                | `production-whatsapp-settings-rbac` | Coberto           |
| WhatsApp         | conectar/desconectar (Embedded Signup)   | —                | não      | não                | `smoke:c10`, `wa:connect`           | Fora do navegador |
| Webhook Meta     | recebimento, idempotência, fora de ordem | —                | sim      | sim                | `smoke:c10`, `smoke:c12`            | Fora do navegador |
| Agente           | resposta pelo pipeline real              | —                | sim      | adversarial        | `smoke:c11`, `ai:adversarial`       | Fora do navegador |

## 10. Assinatura e plataforma

| Funcionalidade                         | Ação                                      | Roles                   | Positivo | Negativo      | E2E existente                                  | Status            |
| -------------------------------------- | ----------------------------------------- | ----------------------- | -------- | ------------- | ---------------------------------------------- | ----------------- |
| Cancelamento no trial                  | owner abre confirmação; doctor é negado; abrir/fechar não muta | owner, doctor           | sim      | sim           | `production-subscription-cancellation-trial-a`, `subscription-cancellation` | Coberto em código; produção não executada |
| Troca de plano / reativação            | —                                         | não                     | não      | —             | —                                              | **Não coberto**   |
| Webhook Asaas (billing)                | pago, dunning, suspensão                  | —                       | sim      | sim           | `smoke:c13`, `billing:live-roundtrip`          | Fora do navegador |
| Sugestões                              | enviar, autor privado, A↔B, replay        | owner, doctor, tenant B | sim      | sim           | `production-feedback-privacy-a`                | Coberto           |
| Perfil da clínica                      | editar, concorrência                      | owner, doctor, tenant B | sim      | CNPJ inválido | `production-clinic-profile-a`                  | Coberto           |
| Auditoria (`/configuracoes/auditoria`) | exportar CSV de verdade, colunas travadas | owner                   | sim      | —             | `tenant-settings-screens`                      | Coberto           |

## 11. Plataforma — `super_admin` (`/admin`)

| Funcionalidade                        | Ação                                                   | Roles            | E2E existente                               | Status            |
| ------------------------------------- | ------------------------------------------------------ | ---------------- | ------------------------------------------- | ----------------- |
| Painel                                | ver com AAL2                                           | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Clínicas                              | listar e abrir                                         | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Impersonate                           | iniciar (step-up TOTP)                                 | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Impersonate                           | encerrar pelo banner, com auditoria                    | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Impersonate                           | **revogar a linha mata a sessão com o cookie intacto** | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Kill-switch                           | flag **e** auditoria na mesma transação                | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Kill-switches / flags                 | alterar (nível de banco)                               | super_admin      | `smoke:admin-config`                        | Fora do navegador |
| Anúncio (broadcast)                   | publicar / desativar                                   | super_admin      | `smoke:admin-config`                        | Fora do navegador |
| Billing da plataforma                 | ver                                                    | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Auditoria da plataforma               | ver                                                    | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Métricas / Saúde                      | ver                                                    | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Feedbacks                             | ver a fila                                             | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Conversas IA                          | ver                                                    | super_admin      | `admin-superadmin-journey`                  | Coberto           |
| Fronteira anônima de `/admin`         | redirect                                               | anônimo          | `public-surface` (8 rotas)                  | Coberto           |
| **Fronteira autenticada de `/admin`** | **deny com sessão de clínica válida**                  | owner de clínica | `admin-boundary-rbac` (9 rotas + deep-link) | **Coberto**       |

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

| Status            | Linhas |
| ----------------- | ------ |
| Coberto           | 90     |
| Parcial           | 5      |
| Superficial       | **0**  |
| Não coberto       | **3**  |
| Fora do navegador | 9      |

**De 14 para 3 em 14/09**, e "superficial" zerou — a categoria existia para nomear cobertura
aparente (rota visitada, `status < 500`), e não sobrou nenhuma.

**Atualização de 16/09:** as quatro perguntas/staging O-3a, O-3b.1–O-3b.6 e a seleção de clínica/plano
O-4 possuem prova local (90 cobertas). Ownership/consumo, reenvio, UI, fechamento integrado e seleção
server-side de plano saíram da lista pendente; permanecem somente as três dependências externas abaixo.

Os três que restam não sobraram por esquecimento; cada um tem um motivo que não se resolve
escrevendo mais teste:

| O que falta                            | Por que não foi coberto                                                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-login pós-checkout**            | Exige um checkout pago completo. Além disso, a fatia vai mudar: a decisão de 14/09 troca o checkout transparente pelo hospedado do Asaas, e o provisionamento passa a ser por webhook. Cobrir agora seria testar código com data de validade. |
| **Consentimento (conceder / revogar)** | Toca dado de PACIENTE. Exige fixture própria e cleanup provado; um teste não deve decidir exercitar revogação de consentimento sem isso, nem em Preview.                                                                                      |
| **Troca de plano / reativação**        | Muta estado de billing da clínica no Asaas. Precisa de assinatura sandbox dedicada — a mesma razão que manteve o ciclo de `payments-account-lifecycle` condicional.                                                                           |

(²) Provedor é stub local com SDK real; **contrato do Asaas Sandbox continua NOT TESTED**.
(³) A transação existe e tem teste de unidade do slug; falta exercício contra Postgres com as tabelas de tenant (clinics/profiles/ai_clinic_config/billing_customers/subscriptions/outbox), que o harness de cadastro ainda não cria.

## 12. Matriz corrente — lote de harness e fronteiras (28/09/2026)

O denominador deste lote é 10 contratos auditados. Esta tabela não declara a
auditoria integral concluída; ela separa implementação, execução e lacuna.

| ID | Domínio | Funcionalidade / ação | Contrato e fonte | Ator / tenant | Pré-condição e estado inicial | Resultado e efeitos esperados |
| --- | --- | --- | --- | --- | --- | --- |
| AIT-M01 | shell | abrir 26 rotas estáticas | página real deve responder 200 e renderizar heading próprio | owner descartável no próprio tenant | sessão válida e permissões operacionais | UI própria; sem login, 404 ou “Sem acesso”; nenhuma escrita |
| AIT-M02 | pacientes/conversas | abrir primeiro deep-link | rota dinâmica só conta com fixture real; vazio é cenário separado | owner descartável no próprio tenant | ao menos um paciente e uma conversa próprios | detalhe 200; sem negativa/404; zero escrita |
| AIT-M03 | plataforma | tenant acessa `/admin/*` | ADR-037 + guard único: 404 anti-enumeração | owner tenant, não super_admin | controle `/dashboard` 200 | HTML 404; RSC transporta `NEXT_HTTP_ERROR_FALLBACK;404`; nenhum dado admin |
| AIT-M04 | pagamentos | chave Asaas inválida | segredo não persiste nem volta ao cliente | `manage:financial`, tenant próprio | Preview DEV isolado; estado conhecido | alerta; campo/HTML sem chave; estado preservado |
| AIT-M05 | pagamentos | conectar e desconectar conta sandbox | persistência cifrada e restauração obrigatória | `manage:financial`, tenant próprio | Preview DEV + Sandbox + opt-in; começa vazio | conecta, persiste, não expõe chave, desconecta; cleanup verificado |
| AIT-M06 | clínico | criar e apagar modelo | mutação persiste e fixture sempre é removida | owner no próprio tenant | Preview isolado | aparece após reload e some após exclusão/reload |
| AIT-M07 | agenda | request inválido para cancelar série | autenticar e autorizar antes de ler entrada | cookie inválido | nenhuma sessão e payload ausente | negativa controlada; domínio/DB não chamados; sem detalhe interno |
| AIT-M08 | harness | artefatos autenticados | captura somente com opt-in explícito | operador E2E | `E2E_ARTIFACTS` ausente/0 | nenhum trace, vídeo ou screenshot |
| AIT-M09 | clínico | autosave com cookie inválido e entrada ausente | autenticar antes de validar conteúdo clínico | cookie inválido | nenhuma sessão | negativa genérica; sem lista Zod; zero escrita |
| AIT-M10 | cadastro | abrir sessão na autoridade solicitada pelo navegador | origem same-site deve ser comparada ao `Host` efetivo | anônimo | Next pode reconstruir `req.url` com hostname interno diferente | 201 e cookie `__Host-`; origem realmente divergente continua 403 |
| AIT-M11 | pagamentos | ciclo direto no adapter Sandbox | criação, estado e cleanup precisam de readback | runner com credencial de homologação | host/path oficiais Sandbox e fixtures próprias | 18 passos; três cobranças, webhook/customer ausentes/deleted; baixa desfeita; IDs sanitizados |
| AIT-M12 | billing SaaS | criar e cancelar assinatura Sandbox | nenhum recurso live pode sobreviver ao runner | runner com credencial de homologação | host oficial Sandbox e customer descartável | assinatura `ACTIVE` → `INACTIVE`; customer ausente |
| AIT-M13 | IA/e-mail | comprovar comportamento live sem promover configuração a resultado | cada provider tem veredito próprio | runner externo sanitizado | classificação DEV positiva quando houver envio | Gemini feliz PASS; adversarial/quota e Resend registrados separadamente |

| ID | Teste / asserção | Ambiente executado | Persistência / proibidos | Lacuna | Evidência | Status atual |
| --- | --- | --- | --- | --- | --- | --- |
| AIT-M01 | `authenticated-readonly-routes.spec.ts` | build local + DEV | read-only | owner practitioner sintético | 26/26 rotas 200 com heading; 1/1 caso | PASS DEV |
| AIT-M02 | mesmo spec, helper dinâmico fail-closed | build local + DEV | paciente e conversa reais; ausência de fixture não passa | fixtures cifradas e browser | `/pacientes/[id]` e `/conversas/[id]` 200; cleanup 0/0/0/0 | PASS DEV |
| AIT-M03 | `admin-boundary-rbac.spec.ts` | build local + DEV | nenhum body/RSC admin; quatro handlers negados | owner sintético com sessão real | 1/1 em 50,2 s; cleanup SQL/Auth zero | PASS DEV |
| AIT-M04 | `payments-account-lifecycle.spec.ts` | Preview publicado + DEV | chave inválida ausente do campo/HTML; estado igual | nenhuma | Playwright funcional, caso 1/2 | PASS Preview |
| AIT-M05 | mesmo spec, fixture isolada e cleanup agregado | Preview publicado + DEV + Asaas Sandbox | clínica/Auth removidos com readback zero; conta desconectada | nenhuma | Playwright funcional, caso 2/2 | PASS Preview |
| AIT-M06 | `tenant-settings-screens.spec.ts` | build local + DEV | modelo sintético criado e removido; readback 0/0/0 | nenhuma no escopo executado | CSV real, fila LGPD e CRUD de modelo | PASS DEV 3/3 |
| AIT-M07 | `actions-auth-order.test.ts` + `security:http` | Vitest + build/HTTP local | zero chamada ao domínio; sem erro JS | nenhuma local | 2/2 + 306 requests | PASS |
| AIT-M08 | `e2e-artifact-policy.test.ts` | Vitest local + Playwright final | nenhum artefato automático | nenhuma local | 2/2; 6 browser PASS; 6 CI PASS e 2 skips declarados | PASS |
| AIT-M09 | `prontuarios/actions-auth-order.test.ts` + ratchet HTTP | Vitest + build/HTTP local | zero validação pré-auth; sem detalhe Zod | nenhuma local | 1/1 + 306 requests | PASS |
| AIT-M10 | `route.test.ts`, `signup-risk.test.ts`, `signup-regression.ts --browser` | Postgres descartável + Next + Chromium + fixtures loopback | cross-site negado; cleanup zero | providers externos continuam fora desta prova | 25 focais + 24 checks da jornada | PASS local |
| AIT-M11 | `payments:live-check` | Asaas Sandbox | cleanup obrigatório e readback; nenhuma produção | refund após pagamento real | 1 → 0 por DELETE 500 transitório; final 18/18; um cenário não verificável | PARTIAL |
| AIT-M12 | `billing:live-check` | Asaas Sandbox | assinatura `INACTIVE`; customer ausente | checkout/settlement não faz parte deste runner | exit 0 + readback | PASS Sandbox |
| AIT-M13 | `ai:live-check`, `ai:adversarial`, `email:live-check` | providers externos | sem persistência; uma mensagem para caixa consentida | Gemini adversarial bloqueado por 429; inbox não observado | Gemini/Resend exit 0; adversarial exit 1 explícito | PARTIAL |

## 13. Estado de execução independente — 29/09/2026

Esta fotografia separa **teste existente**, **teste executado** e **resultado**.
Ela prevalece sobre a coluna histórica “Coberto” quando a pergunta for se o
comportamento foi realmente comprovado nesta auditoria.

| Domínio | Existe teste | Executado agora | Resultado medido |
| --- | --- | --- | --- |
| `/admin`, caminho positivo | sim | sim | **PASS 12/12** nos cenários super_admin executados |
| `/admin`, negativa com tenant | sim | sim | **PASS 1/1**: 11 páginas/deep-links, RSC e quatro handlers negados; fixture DEV removida com readback zero |
| Shell autenticado read-only | sim | sim | **PASS 2/2**: 26 rotas estáticas e dois deep-links com fixtures reais; cleanup clínica/Auth/paciente/conversa zero |
| Resend / inbox | sim, incluindo inspector por API | sim | **PASS**: envio, `delivered`, leitura inbound e conteúdo/nonce; nenhum secret ou corpo impresso |
| Cadastro por e-mail | sim | local completo; Preview tentado | **5/5 PASS local**; Preview atual **BLOCKED** por deployment sem a correção de autoridade `Host` |
| Recovery por e-mail com TOTP | sim | sim, DEV | **PASS**: mensagem recebida, link real, HIBP, `insufficient_aal` recuperado após grant/CAS, retorno ao login e fixture preservada |
| Convite de equipe recebido | sim | sim, DEV local | **PASS**: inicial/reenvio recebidos, rotação, aceite, tenant, replay e cleanup; Preview antigo **BLOCKED** |
| Gemini, corpus original 3–50 | sim | 3–28 | **25 PASS (3–27), 1 BLOCKED (28 por provider 429), 22 NOT RUN (29–50)** |
| Turnstile condicional | sim | sim | **PASS 2/2** com as chaves oficiais de teste, cobrindo token aceito e token recusado |
| Supabase Storage externo DEV | sim | sim | **PASS** para upload/leitura/alteração/remoção próprios, signed URL e expiração; anônimo, role inadequada e cross-tenant negados; cleanup zero |
| Checkout/estorno PIX e cartão | sim | sim até o provider | **BLOCKED** pelo reCAPTCHA do checkout hospedado; tentativas canceladas no Sandbox, sem cobrança residual |
| 44 arquivos `production-*` | sim | todos invocados; quatro reexecutados com pré-condições legítimas | **4 PASS funcionais; 37 suítes com SKIP; 3 PRECONDITION BLOCKED**. Em 47 casos: 4 PASS, 40 SKIP e 3 bloqueios; ver `production-44-execution.md` |
| WhatsApp → IA → resposta real | sim para partes internas | não ponta a ponta | **BLOCKED**: callback do app Meta compartilhado aponta para PROD enquanto número/tenant autorizado é DEV; guarda fail-closed impede cruzar ambientes |
| RBAC DEV, bundles de 5 roles | sim | sim | **PASS 1/1**: bundles reais conferem com `role_permissions` |
| RBAC DEV, 5 roles × 15 áreas | sim | sim | **PASS 1/1** contra `next start`: 75 combinações percorridas com pathname exato e gate permitido/negado comparado ao bundle efetivo do banco |
| RBAC dinâmico, grant/revoke e sessão antiga | sim | sim | **PASS 1/1**: owner concedeu e removeu `manage:procedures`; a sessão antiga foi revogada nas duas transições de `claims_version` |
| Feedback de assinatura já cancelada | sim | sim | **PASS 47/47** focados; aviso persistente, fechamento do diálogo e repetição idempotente cobertos |

As fixtures RBAC interrompidas e a fixture da prova dinâmica foram removidas com
readback: zero clínicas e zero perfis residuais ao final.

## 14. Atualização medida — 30/09/2026

| Domínio | Existe teste | Executado nesta rodada | PASS | FAIL | BLOCKED | SKIP | NOT RUN |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Regressão Vitest | sim | integral | 4.507 | 0 | 0 | 0 | 0 |
| Build/type/lint | sim | integral | 3 gates | 0 | 0 | 0 | 0 |
| Playwright CI local | sim | 8 casos coletados | 6 | 0 | 0 | 2 | 0 |
| Gemini 3–50 | sim | 3–28 | 25 | 0 | 1 | 0 | 22 |
| `production-*` | sim | 47 casos invocados e quatro habilitados legitimamente | 4 | 0 | 3 | 40 | 0 |
| Conta de pagamentos Preview | sim | dois casos | 1 | 0 | 1 | 0 | 0 |
| Resend recebido | sim | envio, entrega e inbound | 1 | 0 | 0 | 0 | 0 |
| Cadastro por e-mail | sim | local completo; Preview antigo tentado | 5 local | 0 | 1 Preview | 0 | 0 |
| Recovery TOTP por e-mail | sim | DEV completo | 1 | 0 | 0 | 0 | 0 |
| Convite de equipe por e-mail | sim | DEV local completo; Preview antigo tentado | 1 local | 0 | 1 Preview | 0 | 0 |
| Asaas PIX | sim | pagamento confirmado; refund iniciado | 1 | 0 | 1 | 0 | 0 |
| Asaas cartão | sim | pagamento confirmado; refund recusado | 1 | 0 | 1 | 0 | 0 |
| Google Ads | sim na landing | 49 gates locais | 49 | 0 | 1 final externo | 0 | 0 |
| WhatsApp real | parcial | não, reservado ao agente concorrente | 0 | 0 | 0 | 0 | 1 |
| Política de artefatos | sim | configs principal + CI e readback de arquivos | 2 | 0 | 0 | 0 | 0 |

`production-*` continua sendo contado por **caso**, não apenas por arquivo: 44
arquivos geram 47 casos porque `production-role-journeys-a` possui quatro.
`PRECONDITION BLOCKED` não é convertido em `SKIP` mesmo quando o Playwright usa
`test.skip` para impedir uma mutação sem fixture segura.

## 15. Atualização medida — 01/10/2026

| Domínio | Execução | PASS | FAIL | BLOCKED | SKIP | Evidência |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Gemini 3–50 | provider real, 48 chamadas | 48 | 0 | 0 | 0 | zero resposta final insegura; custo calculado US$ 0,096410 |
| Conta de pagamentos | Preview + DEV + Asaas Sandbox | 2 | 0 | 0 | 0 | chave inválida negada; conectar/desconectar; cleanup Auth/DB zero |
| Refund cartão | Asaas Sandbox | 1 | 0 | 0 | 0 | `CONFIRMED` → refund terminal; replay sem duplicata |
| Refund PIX | Asaas Sandbox | 0 | 1 | 0 | 0 | `RECEIVED`; dois refunds de R$ 10 terminaram `CANCELLED`; transações Pix `CREDIT_REFUND/REFUSED` com motivo genérico do provider; retomada não criou terceiro POST |
| `production-*` | 44 arquivos / 47 casos | 3 | 0 | 4 | 40 | RLS leitura, RLS rollback e founder PASS; credenciais/conversa bloqueiam quatro |
| Supavisor atual | 48 conexões PROD read-only probe | 48 | 0 | 0 | 0 | zero sessão contaminada; dois backends; p95 2,6 s |
| Incidentes de conexão | ratchets locais | 23 | 0 | 0 | 0 | mitigação/observabilidade PASS; causa externa continua não comprovada |

O estado `PASS` do probe Supavisor significa saúde no momento da medição. Ele não
é evidência da causa raiz dos incidentes históricos nem de que uma falha externa
de conexão não possa reaparecer.

## 16. Integração WhatsApp e Google Ads — 01/10/2026

| Domínio | Execução | PASS | FAIL | BLOCKED | SKIP | Evidência |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| WhatsApp v4/coexistência, regressão direcionada | Vitest local integrado | 268 | 0 | 0 | 0 | webhook por field, ecos, handoff, v4, retenção e journal |
| WhatsApp Preview sem número ativo | Playwright autenticado | 2 | 0 | 0 | 4 | tela sem 5xx e estado desconectado; casos de perfil não aplicáveis |
| WhatsApp real nesta rodada | Meta + Preview | 0 | 0 | 0 | 0 | **NOT RUN**: conexão de teste havia sido desconectada após a prova anterior |
| Google Ads, sinal técnico | produção `qoro.dev` | 1 | 0 | 0 | 0 | gtag carregado, request de conversão observado e chegada em `/cadastro` |
| Google Ads, crédito da ação | painel Ads | 0 | 0 | 1 | 0 | campanha inativa |
| Regressão global | Vitest | 4577 | 0 | 0 | 0 | 442 arquivos, exit 0 no CI final |
| Fronteira HTTP de Server Actions | build isolado + HTTP local | 328 requests | 0 | 0 | 0 | 52 respostas `200` com negativa explícita; `fetchOpenHandoffs` coberto |

O resultado do Playwright não substitui a jornada real da Meta: quatro casos
foram pulados porque não havia número conectado. A prova externa do agente
anterior é mantida como evidência histórica separada, sem ser recontada como uma
execução desta rodada.

## 17. Fechamento do Preview — 01/10/2026

| Domínio | Execução | PASS | FAIL | BLOCKED | SKIP | Evidência |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Convite por e-mail | Preview + Resend inbound + Auth DEV | 1 | 0 | 0 | 0 | inicial e reenvio recebidos; token antigo negado; novo aceito; tenant e replay conferidos; cleanup completo |
| Conta de pagamentos | Preview + DEV + Asaas Sandbox | 2 | 0 | 0 | 0 | chave inválida negada; conectar, persistir e desconectar; fixture removida |
| Gemini 3–50 | provider real | 48 | 0 | 0 | 0 | 48 chamadas, zero resposta final insegura; custo US$ 0,096414 |
| WhatsApp perfil em coexistência | Preview autenticado | 4 | 0 | 0 | 3 | leitura funcional; escrita não aplicável porque Graph devolve 403 nesse modo |
| `production-*` | 44 arquivos / 47 casos | 5 | 0 | 4 | 38 | cinco provas funcionais; mutações autorizadas PASS 1/1 em 59,2 s; cleanup externo com readback zero |
| Refund PIX | Asaas Sandbox | 0 | 0 | 1 | 0 | refund novo aguarda autorização crítica; execução fez somente readback |
| Regressão global | Vitest | 4583 | 0 | 0 | 0 | 442 arquivos, exit 0 |
| Build Next | modo production | 1 | 0 | 0 | 0 | 18 páginas estáticas, exit 0; mesmo commit verde no CI/Vercel |

`production-authorized-mutations` agora separa o orçamento do `afterEach`,
espera a hidratação das telas cliente e usa os contratos atuais da agenda e do
caixa. A execução real terminou 1/1 PASS e a limpeza transacional posterior
removeu paciente, atendimentos, prontuários, documentos, lançamentos e eventos
sintéticos; o readback final encontrou zero resíduo atual.

## 18. Execução adicional das suítes de produção — 01/10/2026

| Domínio | Execução | PASS | FAIL | BLOCKED | SKIP | Evidência |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| MFA | produção, conta E2E owner | 1 | 0 | 0 | 0 | TOTP ativado, AAL2 comprovado, fator removido e readback zero |
| Financeiro | produção, fixture sintética isolada | 1 | 0 | 0 | 0 | inválidos, arredondamento, cancelamento, duas parcelas, dois estornos, filtros e cleanup zero |
| Transições de role | produção, membro sintético convidado | 1 | 0 | 0 | 0 | 12 transições/ponte, sessão antiga recusada e claims/bundle atuais; cleanup zero |
| Fronteira anônima | produção | 2 | 0 | 0 | 1 | 28 rotas estáticas + 5 deep-links negados; conversa sem fixture ficou SKIP |
| `production-*` consolidado | 44 arquivos / 49 casos | 10 | 0 | 3 | 36 | 8 arquivos PASS integral, 1 PARTIAL, 3 PRECONDITION BLOCKED e 32 SKIP |

A coleta conjunta sem opt-ins produziu **46 SKIP + 3 PRECONDITION BLOCKED** e
zero PASS. Os dez PASS do consolidado pertencem a execuções isoladas com os
guardas satisfeitos; não foram inferidos da coleta. Os três bloqueios continuam
sendo credenciais doctor/owner específicas ausentes. O caso de conversa é SKIP
justificado pela inexistência de `ai_conversations` em produção.

## 19. Fotografia funcional adicional — 05/10/2026

| Domínio | Ambiente e execução | PASS | FAIL | BLOCKED | SKIP | Limite da prova |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Cadastro e Checkout SaaS | Preview HTTPS + Supabase DEV + Resend + Asaas Sandbox | 1 | 0 | 0 | 0 | Abriu Checkout e persistiu `checkout_pending`; pagamento/webhook não executados |
| Conta Asaas e política financeira | Preview HTTPS + fixture DEV/Sandbox; `payments-account-lifecycle.spec.ts` | 3 | 0 | 0 | 0 | Chave inválida, conexão/desconexão, preços e repasse Pro, bloqueio Solo na UI e Action, retorno Clínica; fixture eliminada |
| Guardas de preço e Checkout no PostgreSQL | DEV; dois smokes isolados | 2 | 0 | 0 | 0 | Segundo smoke usa provider sintético e handler da fixture, sem worker global |
| `production-*` | 44 arquivos / 50 casos na coleta atual | 3 | 0 | 1 | 46 | A maioria continuou sem pré-condição de execução; ver [relatório específico](production-44-execution.md) |

Os resultados de 01/10 acima são fotografias históricas, não os totais da coleta
de 05/10. A [especificação financeira](../specs/politica-financeira-camadas.md)
registra as falhas de teste corrigidas, os comandos, a limpeza e as pendências
externas sem converter um Checkout aberto em pagamento concluído.
