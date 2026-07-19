# Auditoria de Banco de Dados — ClinicaOS_V2 / Qoro

> ## ✅ REMEDIAÇÃO CONCLUÍDA — 2026-07-17
>
> Todos os achados acionáveis foram fechados (resolvidos na causa-raiz ou aceitos
> por decisão documentada em ADR). **Aplicado e verificado em dev E EM PRODUÇÃO**
> (migrations 0044–0050 em prod na janela manual de **2026-07-18**; provas de
> catálogo abaixo). Detalhe por achado na
> **[§8 — Remediação](#8-remediação-2026-07-17)**. Resumo:
>
> | Achado | Sev. | Estado |
> |---|---|---|
> | A1 conteúdo clínico em claro | ALTA | ✅ Cifrado (ADR-044) — `content`/`medicamentos`/`observacoes` dropados |
> | A2 mensageria sem teto | ALTA | ✅ Retenção 90/180d (ADR-043) — particionar quebraria exactly-once |
> | A3 bypass service_role | ALTA | ✅ Já fechado (D1/`qoro_runtime` em prod 2026-07-17) |
> | A5 retenção IA não aplicada | MÉDIA | ✅ Purga real de `ai_*` vencidas |
> | A6 FK sem índice | MÉDIA | ✅ Índices liderados nos deletes reais; catálogos deixados de fora, justificado |
> | A7 partição depende de cron | MÉDIA | ✅ Alerta ativo + monitor por contiguidade; 9 órfãs do dev remediadas |
> | A8 PII de negócio em claro | MÉDIA | ✅ `clinics.cnpj` + `billing_customers.document` cifrados |
> | A11 CNPJ sem UNIQUE | BAIXA | 🟡 `cnpj_hash` populada; UNIQUE adiado — falta **normalizar** CNPJ (gatilho: 1º cliente self-serve) |
> | A13 grants amplos `anon` | MÉDIA | ✅ Causa-raiz (default ACL) fechada, não só as 87 tabelas |
> | A14 initplan | MÉDIA | ✅ 57→**0** no advisor (65 policies + `profiles_self_select`) |
> | A15 resíduo RPC | MÉDIA | ✅ `record_login_attempt` revogada de `authenticated` |
> | A16 search_path | BAIXA | ✅ Já fechado (0038) |
> | **N1** tenant sem índice em `clinic_id` (novo) | — | ✅ `appointment_state_log`/`procedure_history` indexadas |
> | **N2** monitor de partição cego a lacunas (novo) | — | ✅ cálculo por contiguidade |
> | A4/A9/A10/A12 | BAIXA | ⚪ Aceitos como limites conhecidos (a auditoria manda não agir) |
>
> **Migrations:** 0044–0050. **ADRs novos:** 042, 043, 044. **Dívida:** D6 fechada
> (journal contíguo 51/51); D8 (preview→prod) corrigida pelo founder, falta exercer.

- **Data:** 2026-07-12
- **Escopo:** modelo de dados, schema, isolamento multi-tenant, segurança (RLS,
  grants, funções), integridade, performance/escala, histórico/auditoria,
  recursos Supabase e lógica de negócio no banco.
- **Método:** auditoria estática sobre o repositório — 11 schemas Drizzle de
  contexto (`src/contexts/*/schema.ts`), 11 arquivos de schema de infraestrutura
  (`src/lib/db/schema/infra/*`), as 38 migrations SQL
  ([drizzle/migrations/](../../drizzle/migrations/) `0000`–`0037`), helpers de RLS
  ([rls.ts](../../src/lib/db/rls.ts)) e tenant ([tenant.ts](../../src/lib/db/tenant.ts)),
  crons de retenção/partição ([api/cron/](../../src/app/api/cron/)) e ADRs
  (002, 007–013, 017, 021, 024, 025, 032).
- **Validação ao vivo:** o MCP do Supabase estava **indisponível** nesta sessão
  (não conectado; OAuth não roda em sessão não-interativa). A verificação ao vivo
  foi feita mesmo assim, por um **caminho equivalente**: `psql` (PostgreSQL 17
  client) contra o banco via `DATABASE_URL` do `.env.local`, **estritamente
  read-only** (SELECT/catálogo — nenhum write, migração ou `EXPLAIN ANALYZE` de
  mutação). Resultados na [§6](#6-validação-no-banco-vivo). **Contexto (2026-07-12):**
  o produto **ainda NÃO está em produção** — está em fase de testes pré-go-live. O
  banco auditado é o **ambiente de teste** (volume baixíssimo: 4 pacientes, 2
  clínicas), então achados de escala são **estruturais/projetados**, não observados
  no volume atual. **Este é o momento ideal** para fechar os itens estruturais e de
  hardening (A1, A2, A6, A7, A13) — todos muito mais baratos com as tabelas ainda
  vazias e antes de entrar dado real de paciente.
- **Regra do trabalho:** auditar e recomendar. **Nenhuma** alteração de schema,
  migração ou correção foi executada.

---

## 1. Resumo Executivo

### Saúde geral: **EXCELENTE** (para o estágio do produto)

Este é um dos bancos multi-tenant mais bem projetados que se encontra num produto
em fase de crescimento. O isolamento entre clínicas é **sólido por construção** e
**não foi encontrada nenhuma falha CRÍTICA de vazamento cross-tenant**. As
decisões estão documentadas em ADRs, os padrões de RLS são congelados num único
helper, e há disciplina consistente de índices, constraints, snapshots imutáveis e
append-only.

**Pontos fortes (NÃO mexer — ver [§7](#7-o-que-está-certo-e-não-deve-ser-refatorado)):**

- **Isolamento por RLS `FORCE` + dual-context.** Toda tabela tenant-scoped usa o
  mesmo predicado congelado em [rls.ts:84-94](../../src/lib/db/rls.ts#L84-L94):
  `clinic_id = current_setting('app.current_clinic') OR clinic_id = current_clinic_id() OR is_super_admin()`.
  `FORCE ROW LEVEL SECURITY` é a defesa principal (sobrevive a mudança de role do
  pooler). Cobertura de RLS é **praticamente total** — só `_schema_version` é
  isento, por design ([0001:141-142](../../drizzle/migrations/0001_tenancy_foundation.sql#L141-L142)).
- **`clinic_id` é claim de JWT injetado server-side**, derivado da tabela
  `profiles` pelo `custom_access_token_hook`
  ([0006:143-194](../../drizzle/migrations/0006_identity_postrest_compat.sql#L143-L194)) —
  **nunca de `user_metadata`** (editável pelo usuário). Isso elimina o vetor
  clássico de forja de claim em Supabase. O claim de papel é `app_role`, não
  `role` (que o PostgREST reserva) — bug sutil já resolvido em
  [0006](../../drizzle/migrations/0006_identity_postrest_compat.sql).
- A view `effective_permissions_v` foi corrigida para `security_invoker=on`
  ([0006:111-112](../../drizzle/migrations/0006_identity_postrest_compat.sql#L111-L112)),
  fechando o vazamento de RLS que uma view padrão causaria. Todas as funções
  `SECURITY DEFINER` têm `search_path` fixo e grants least-privilege; nenhum grant
  perigoso a `anon`.
- Dinheiro sempre em `numeric` (nunca float), snapshots imutáveis via trigger,
  imutabilidade jurídica de prontuário assinado
  ([0017:216-245](../../drizzle/migrations/0017_clinical_core.sql#L216-L245)),
  append-only reforçado no nível de privilégio (o `REVOKE DELETE` de
  [0021](../../drizzle/migrations/0021_financial_grants_hardening.sql) mostra
  ciência da armadilha de default-privileges do Supabase), e `audit_events` +
  `ai_messages` **particionadas por mês** com cron de provisionamento à frente.

### Principais riscos (os 3 mais relevantes)

1. **[ALTA] Dado clínico sensível em texto claro no banco.** CPF/telefone/endereço
   do paciente são cifrados (ADR-012), mas o **prontuário, prescrições, documentos
   médicos e dados clínicos** (a categoria mais sensível, LGPD Art. 11) ficam em
   `jsonb`/`text` **em claro**. Um vazamento de backup expõe o registro médico
   inteiro. Inversão de proteção.
2. **[ALTA] Tabelas raw de mensageria crescem sem teto** — não particionadas e
   fora do cron de retenção. No cenário "milhões de mensagens WhatsApp", tornam-se
   as maiores tabelas do banco sem partição nem arquivamento.
3. **[ALTA] Superfície de bypass do `dbAdmin`/`service_role`** — todo acesso via
   `service_role` (BYPASSRLS) depende de o código filtrar `clinic_id` manualmente;
   uma única omissão é um vazamento cross-tenant que o RLS não intercepta.

A validação ao vivo ([§6](#6-validação-no-banco-vivo)) — `psql` + o lint oficial
**`get_advisors`** em **dev e prod** — **confirmou os pontos fortes** (0 tabelas sem
RLS, 0 função `SECURITY DEFINER` sem `search_path`, view única com `security_invoker`,
e um **event trigger `rls_auto_enable`** que liga RLS automaticamente em toda tabela
nova — guardrail que já cobre o pior caso do A13). Ela também **acrescentou achados
que a revisão estática/`psql` não pegava**:

- **A14 [MÉDIA, perf]** — o `get_advisors` marca **57× `auth_rls_initplan`**: o
  predicado do RLS re-avalia os helpers de auth **por linha** (fix barato: envolver em
  subquery escalar no helper único → beneficia todas as queries). É o maior ROI.
- **A15/A16 [hardening]** — funções trigger/internas executáveis por `anon` via RPC
  (default do Supabase), e 2 funções sem `search_path` fixo.
- **A13 [MÉDIA→BAIXA]** — grants amplos default do Supabase a `anon` (incl.
  `TRUNCATE`, que o RLS não cobre); mitigado pelo `rls_auto_enable`, resta o
  least-privilege.
- **Só prod:** `leaked password protection` (HaveIBeenPwned) **desligado** — ativar
  antes do go-live. Prod está **limpo de partições órfãs** (as 9 são artefato do dev).

Os demais achados são majoritariamente **riscos de trajetória de escala** e de
**evolução futura** — não defeitos de correção atuais.

---

## 2. Inventário do Schema

Legenda de problemas: 🔴 achado ALTA · 🟠 MÉDIA · 🟡 BAIXA · ✅ sem problema
relevante. Os números entre parênteses referem os achados da [§3](#3-achados-técnicos).

### Tenancy — [src/contexts/tenancy/schema.ts](../../src/contexts/tenancy/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `clinics` | Tenant raiz | 🟡 `cnpj` sem UNIQUE/NOT NULL (A11) |
| `clinic_units` | Sub-unidades | ✅ |
| `_reserved_slugs` | Subdomínios reservados (global) | ✅ |

### Identity — [src/contexts/identity/schema.ts](../../src/contexts/identity/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `profiles` | Usuário + role + clínica | 🟠 `clinic_id` escalar → 1 user = 1 clínica (A4) |
| `permissions` | Catálogo de permissions (global) | ✅ |
| `role_permissions` | Bundles por role (global) | ✅ |
| `user_permission_overrides` | Grant/deny por usuário | ✅ |
| `login_attempts` | Rate-limit / forense pré-auth | ✅ retenção 90d (data-retention) |

### Patient — [src/contexts/patient/schema.ts](../../src/contexts/patient/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `patients` | Cadastro (CPF/tel/email) | ✅ CPF/tel cifrados + hash de lookup |
| `patient_consents` | Consentimentos LGPD | ✅ |
| `patient_clinical_data` | Alergias/medicamentos/doenças | 🔴 conteúdo clínico em claro (A1) |
| `patient_addresses` | Endereços | ✅ cifrado |
| `patient_emergency_contacts` | Contatos de emergência | ✅ tel cifrado |
| `suppression_list` | Opt-out (desacoplada — sobrevive a delete) | ✅ |
| `lgpd_requests` | Export/delete LGPD | ✅ |

### Scheduling — [src/contexts/scheduling/schema.ts](../../src/contexts/scheduling/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `procedures` | Catálogo de procedimentos | ✅ |
| `procedure_history` | Log de mudanças | 🟡 append-only cresce (escala) |
| `doctor_availability` | Janelas recorrentes | ✅ EXCLUDE anti-overlap |
| `clinic_holidays` | Bloqueios de agenda | ✅ |
| `appointments` | Agendamentos | 🟠 `procedure_id` sem índice dedicado (A6) |
| `appointment_state_log` | Log de transições | 🟡 append-only cresce (escala) |

### Clinical — [src/contexts/clinical/schema.ts](../../src/contexts/clinical/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `prontuarios` | Prontuário eletrônico | 🔴 `content` em claro (A1); 🟠 `doctor_id`/`signed_by` sem índice (A6) |
| `prontuario_versions` | Histórico jurídico (append-only) | 🔴 `content` em claro (A1) |
| `prescriptions` | Prescrições | 🔴 `medicamentos` em claro (A1); 🟠 `doctor_id` sem índice (A6) |
| `medical_documents` | Atestados/exames/etc. | 🔴 `content` em claro (A1); 🟠 `doctor_id` sem índice (A6) |
| `prescription_templates` | Modelos por médico | ✅ |

### Financial — [src/contexts/financial/schema.ts](../../src/contexts/financial/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `payment_methods` | Catálogo global | ✅ |
| `suppliers` | Fornecedores | 🟠 `cnpj` PII em claro (A8) |
| `lancamentos` | Caixa (receber/pagar) | 🟠 `supplier_id` sem índice (A6) |
| `payment_proofs` | Comprovantes (append-only) | ✅ |
| `faturamento_pendencias` | Ledger de pendências | ✅ |
| `cash_flow_daily` | Rollup diário | ✅ |

### Messaging — [src/contexts/messaging/schema.ts](../../src/contexts/messaging/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `clinic_whatsapp_numbers` | Estado do número | ✅ token cifrado, service_role-only |
| `inbound_messages_raw` | Mensagens recebidas | 🔴 sem partição + sem retenção (A2) |
| `outbound_messages` | Mensagens enviadas | 🔴 sem partição + sem retenção (A2) |
| `provider_status_events_raw` | Callbacks de status | 🔴 sem partição + sem retenção (A2) |
| `inbound_messages_orphaned` | Quarentena (super_admin) | ✅ |

### Billing — [src/contexts/billing/schema.ts](../../src/contexts/billing/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `plans` / `prices` / `plan_limits` | Catálogo global | ✅ |
| `billing_customers` | Cliente Asaas | 🟠 `document` PII em claro (A8) |
| `subscriptions` / `subscription_history` | Assinatura + histórico | 🟡 histórico cresce |
| `invoices` / `invoice_items` / `payment_attempts` | Faturas | ✅ append-only por grant |
| `setup_fees` / `annual_prepayments` | Taxas/pré-pagamento | ✅ |
| `usage_metrics` / `usage_counter_ledger` | Medição de uso | ✅ |
| `checkout_sessions` | Lead pré-clínica | 🟠 `document` PII em claro (A8) |
| `tenant_provisioning` / `processed_webhooks` / `billing_reconciliation_runs` | Plataforma (service_role-only) | ✅ |
| `billing_events` | Timeline da conta (append-only) | 🟡 cresce |

### AI-Agent — [src/contexts/ai-agent/schema.ts](../../src/contexts/ai-agent/schema.ts) · [proactive-jobs](../../src/contexts/ai-agent/proactive-jobs/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `ai_conversations` | Conversa ativa por contato | 🟠 retenção 30d não aplicada por job (A5) |
| `ai_messages` | Mensagens (PARTICIONADA/mês) | 🟠 retenção 30d/DETACH não automatizada (A5) |
| `ai_clinic_config` | Config por clínica (PK=clinic_id) | ✅ |
| `ai_handoff_queue` | Fila de atendimento humano | ✅ |
| `ai_agent_failures` | Dead letter de IA | 🟡 cresce |
| `ai_proactive_jobs` | Fila de jobs pré-datados | ✅ |

### Onboarding — [src/contexts/onboarding/schema.ts](../../src/contexts/onboarding/schema.ts)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `clinic_invites` | Convite mágico pré-clínica | ✅ token só como HMAC, service_role-only |

### Infra — [src/lib/db/schema/infra/](../../src/lib/db/schema/infra/)

| Tabela | Responsabilidade | Problemas |
|---|---|---|
| `audit_events` | Log forense (PARTICIONADA/mês) | 🟠 provisionamento depende do cron (A7) |
| `outbox` | Fila de eventos cross-context | ✅ retenção 30d |
| `idempotency_keys` | Exactly-once | ✅ retenção por TTL |
| `super_admin_actions` | Log cross-tenant (super_admin) | ✅ |
| `impersonation_sessions` | Sessões de impersonate | ✅ |
| `platform_settings` / `platform_announcements` / `cron_heartbeats` / `system_metrics_daily` | Meta de plataforma | ✅ |
| `_schema_version` | Versão de schema (sem RLS, por design) | ✅ |

Notas transversais de integridade referencial (positivas): FKs cross-context são
adicionadas nas migrations com semântica deliberada — `RESTRICT` para registro
legal (prontuário/prescrição não deixam apagar paciente/médico —
[0017:139-146](../../drizzle/migrations/0017_clinical_core.sql#L139-L146)),
`SET NULL` para vínculos opcionais, `CASCADE` para `clinic_id` (teardown de
tenant). Colunas de atribuição `*_by` são propositalmente sem FK (achado A9).

Nota transversal (achado A13, mede ao vivo em **todas** as tabelas): os privilégios
default do Supabase concedem `anon`/`authenticated` ALL (incl. `TRUNCATE`) em cada
tabela do `public` — hoje neutralizado pelo RLS onipresente, mas é hardening a fazer
e um footgun para tabelas futuras (ver [A13](#a13--privilégios-amplos-de-anonauthenticated-no-public-default-do-supabase-incluindo-truncate-que-o-rls-não-cobre)).

---

## 3. Achados Técnicos

### A1 — Dado clínico sensível persistido em texto claro

- **Severidade:** ALTA
- **Categoria:** Segurança / Dados (LGPD)
- **Local:** [clinical/schema.ts:82](../../src/contexts/clinical/schema.ts#L82)
  (`prontuarios.content`), [:132](../../src/contexts/clinical/schema.ts#L132)
  (`prontuario_versions.content`), [:169](../../src/contexts/clinical/schema.ts#L169)
  (`prescriptions.medicamentos`), [:216](../../src/contexts/clinical/schema.ts#L216)
  (`medical_documents.content`); [patient/schema.ts:156-160](../../src/contexts/patient/schema.ts#L156-L160)
  (`patient_clinical_data`). Escopo de cifragem em
  [ADR-012:35-37](../../docs/adr/012-encryption-strategy.md#L35-L37).
- **Descrição:** o ADR-012 cifra at-rest **apenas** CPF, telefone, endereço e
  telefone de contato de emergência. Todo o conteúdo clínico — texto do prontuário
  (SOAP), lista de medicamentos prescritos, atestados/documentos, alergias e
  doenças crônicas — é armazenado em `jsonb`/`text` **em claro**.
- **Problema:** há uma **inversão de proteção**. O CPF (identificador, sensível,
  mas de espaço pequeno e recuperável por outras vias) é cifrado; o **registro
  médico** — a categoria de "dado pessoal sensível de saúde" (LGPD Art. 5º-II e
  Art. 11), a de maior valor e maior dano em vazamento — não é.
- **Impacto:** um `pg_dump`, snapshot de backup, réplica de leitura mal protegida,
  ou credencial de banco comprometida **expõe prontuários inteiros, diagnósticos e
  prescrições em texto legível**. A defesa passa a ser 100% RLS + segurança de
  infraestrutura; não há defesa-em-profundidade no dado.
- **Cenário de falha:** atacante obtém um backup antigo (ou acesso `service_role`)
  → CPF aparece cifrado, mas o histórico clínico do paciente é lido diretamente.
- **Risco futuro:** quanto mais prontuários acumulados, maior o dano do vazamento;
  retrofit de cifragem sobre milhões de linhas é caro (re-encrypt em massa).
- **Correção recomendada:** (a) estender `encryptForTenant` (o mesmo wire format
  do ADR-012) ao `content`/`medicamentos` clínico, mantendo só metadados não
  sensíveis fora da cifra; **ou** (b) se a decisão de escopo for mantida por custo,
  tornar explícito e mitigado: cifragem de backup obrigatória, TDE/at-rest no
  provider, restrição forte de acesso a dumps e réplicas, e registro do risco
  aceito num ADR. Buscas nunca dependem desse conteúdo, então a cifra é viável sem
  quebrar índices.
- **Prioridade:** Alta (planejar para a próxima fase; é o único ponto de proteção
  de dado que destoa do resto do rigor do sistema).

> Observação honesta: é uma **decisão de escopo documentada**, não um bug. Mas é a
> exposição de maior severidade potencial do banco e merece decisão consciente.

### A2 — Tabelas raw de mensageria crescem sem teto (sem partição, sem retenção)

- **Severidade:** ALTA (trajetória de escala)
- **Categoria:** Performance / Escala
- **Local:** [messaging/schema.ts:105](../../src/contexts/messaging/schema.ts#L105)
  (`inbound_messages_raw`), [:140](../../src/contexts/messaging/schema.ts#L140)
  (`outbound_messages`), [:166](../../src/contexts/messaging/schema.ts#L166)
  (`provider_status_events_raw`). Cron de retenção atual:
  [data-retention/route.ts:33-34](../../src/app/api/cron/data-retention/route.ts#L33-L34)
  (só cobre `outbox`, `login_attempts`, `idempotency_keys`).
- **Descrição:** as três tabelas raw de WhatsApp têm a **maior taxa de inserção**
  do sistema (uma linha por mensagem recebida/enviada + uma por callback de
  status), **não são particionadas** e **não têm nenhum job de retenção/arquivamento**.
- **Problema:** diferentemente de `audit_events`/`ai_messages` (particionadas) e
  `outbox`/`login_attempts` (com retenção), essas crescem monotonicamente para
  sempre.
- **Impacto:** em escala ("milhões de mensagens" do briefing), elas passam a
  dominar tamanho de tabela, tempo de `VACUUM`/autovacuum, tamanho de backup e
  inflam índices; `count(*)` de healthchecks e queries de janela ficam lentos.
- **Cenário de falha:** 1.000 clínicas ativas no WhatsApp por 2 anos → dezenas de
  milhões de linhas por tabela; latência de inserção e custo de storage sobem, e
  não há mecanismo para arquivar/apagar.
- **Risco futuro:** particionar retroativamente uma tabela grande e viva é uma
  migração dolorosa (lock/rewrite) — muito mais barato decidir agora.
- **Correção recomendada:** particionar por mês (mesmo padrão de
  [0009](../../drizzle/migrations/0009_c4_audit_partitioned.sql) /
  [0024](../../drizzle/migrations/0024_ai_agent_core.sql)) **antes** do volume
  crescer, e adicionar retenção (ex.: manter raw 90–180d; o dado processado já foi
  promovido para as tabelas de domínio). Incluir os pais no cron `audit-partitions`.
- **Prioridade:** Alta (decidir antes do volume; a decisão é barata hoje).

### A3 — Superfície de bypass de RLS via `dbAdmin` / `service_role`

- **Severidade:** ALTA (risco arquitetural residual)
- **Categoria:** Segurança / Arquitetura
- **Local:** grants `GRANT ALL ... TO service_role` (ex.:
  [0022:212-235](../../drizzle/migrations/0022_messaging_core.sql#L212-L235),
  [0024:300-326](../../drizzle/migrations/0024_ai_agent_core.sql#L300-L326)); guarda
  em [connection-origin-guard.ts](../../src/lib/db/connection-origin-guard.ts);
  padrão em [tenant.ts:26-27](../../src/lib/db/tenant.ts#L26-L27).
- **Descrição:** `service_role` tem `BYPASSRLS`. O caminho `db`/`withTenant`
  ([tenant.ts](../../src/lib/db/tenant.ts)) é seguro (RLS ativo), mas todo acesso
  via `dbAdmin` **não passa por RLS** — o isolamento depende de o código escrever
  `WHERE clinic_id = ...` corretamente.
- **Problema:** o RLS deixa de ser a rede de segurança justamente nos caminhos
  administrativos/cron/webhook, que são os que mais lidam com dados cross-tenant.
- **Impacto:** uma única query `dbAdmin` que esqueça o filtro de clínica é um
  vazamento cross-tenant silencioso — sem erro, sem bloqueio do RLS.
- **Cenário de falha:** um handler de webhook/relatório novo usa `dbAdmin` por
  conveniência (para escrever em tabela append-only) e faz um SELECT amplo sem
  escopo → lê/expõe dados de outra clínica.
- **Risco futuro:** a superfície cresce a cada novo cron/webhook; sem um teste ou
  lint que force o escopo, o risco aumenta com o time.
- **Correção recomendada:** manter e reforçar o `connection-origin-guard`;
  centralizar acesso `dbAdmin` cross-tenant atrás de repositórios que exigem
  `clinicId` explícito; adicionar um teste/checklist de PR que audite call sites de
  `dbAdmin`; onde possível, preferir `withTenant` mesmo em jobs (escaneando por
  clínica) em vez de `dbAdmin` amplo.
- **Prioridade:** Alta (processo/guardrail contínuo, não uma correção pontual).

### A4 — Modelo de identidade "1 usuário = 1 clínica" (rigidez de evolução)

- **Severidade:** MÉDIA
- **Categoria:** Arquitetura / Modelagem
- **Local:** [identity/schema.ts:70-72](../../src/contexts/identity/schema.ts#L70-L72)
  (`profiles.clinic_id` escalar); claim escalar no hook
  [0006:186](../../drizzle/migrations/0006_identity_postrest_compat.sql#L186);
  contexto em [ADR-032](../../docs/adr/032-mvp-identity-practitioner-model.md).
- **Descrição:** `profiles.id = auth.users.id` (1:1) e `clinic_id` é uma coluna
  escalar. O claim `clinic_id` do JWT também é escalar. Logo, **um usuário pertence
  a exatamente uma clínica**.
- **Problema:** um mesmo profissional atuando em duas clínicas precisa de dois
  usuários auth distintos. É uma decisão de MVP adequada para clínicas pequenas,
  mas amarra a evolução.
- **Impacto:** hoje, nenhum (produto mira clínica pequena). Futuro: multi-clínica,
  redes, ou marketplace de profissionais exigem repensar identidade.
- **Cenário de falha:** requisito futuro "Dr. X vê a agenda das clínicas A e B com
  um login" não é atendível sem refactor.
- **Risco futuro:** migrar para associação N:N (tabela `clinic_members`) implica:
  claim `clinic_id` vira lista/contexto ativo, o predicado RLS muda em **todas** as
  tabelas, e o hook de claims muda. Refactor grande e sensível (é o núcleo de
  segurança).
- **Correção recomendada:** não agir agora; **registrar como limite conhecido** e,
  se multi-clínica entrar no roadmap, projetar a tabela de associação + "clínica
  ativa" no JWT antes de crescer a base.
- **Prioridade:** Média (planejamento; só vira urgente com requisito multi-clínica).

### A5 — Retenção "30 dias hot" da IA não é aplicada por job

- **Severidade:** MÉDIA
- **Categoria:** Dados / Escala
- **Local:** [ai-agent/schema.ts:98-100](../../src/contexts/ai-agent/schema.ts#L98-L100)
  (`ai_conversations.expires_at`), [:149-151](../../src/contexts/ai-agent/schema.ts#L149-L151)
  (`ai_messages.expires_at`); cron de partição só **cria**, não apaga:
  [audit-partitions/route.ts:7-9](../../src/app/api/cron/audit-partitions/route.ts#L7-L9).
- **Descrição:** ambas as tabelas têm `expires_at` (default `now()+30d`, "memória
  hot"), mas **nenhum cron purga as linhas vencidas nem faz `DETACH`/`DROP` das
  partições antigas** de `ai_messages`. O `data-retention` não as toca.
- **Problema:** a intenção de retenção documentada não tem enforcement — os dados
  ficam indefinidamente até intervenção manual do operador.
- **Impacto:** `ai_messages`/`ai_conversations` acumulam PII conversacional (mesmo
  cifrada) além da janela pretendida; contradição entre política e prática (LGPD:
  minimização/retenção).
- **Cenário de falha:** auditoria de privacidade pergunta "vocês retêm conversas
  por 30 dias?" e a resposta real é "não, ficam para sempre".
- **Risco futuro:** quanto mais tempo sem purga, maior o volume a limpar e o risco
  de exposição.
- **Correção recomendada:** adicionar ao `data-retention` (ou um cron dedicado) a
  purga de `ai_conversations`/`ai_messages` com `expires_at < now()` e o
  `DETACH`+`DROP` das partições mensais totalmente vencidas de `ai_messages`.
- **Prioridade:** Média.

### A6 — Colunas FK sem índice dedicado

- **Severidade:** MÉDIA
- **Categoria:** Performance
- **Local:** [clinical/schema.ts:104-115](../../src/contexts/clinical/schema.ts#L104-L115)
  (`prontuarios` — sem índice em `doctor_id`/`signed_by`),
  [:196-200](../../src/contexts/clinical/schema.ts#L196-L200) (`prescriptions.doctor_id`),
  [:228-231](../../src/contexts/clinical/schema.ts#L228-L231) (`medical_documents.doctor_id`),
  [financial/schema.ts:126](../../src/contexts/financial/schema.ts#L126) (`lancamentos.supplier_id`),
  [scheduling/schema.ts:212-214](../../src/contexts/scheduling/schema.ts#L212-L214) (`appointments.procedure_id`).
- **Descrição:** Postgres **não** cria índice automático para FK. O time é rigoroso
  com `clinic_id` e índices compostos (`clinic_id, patient_id`), mas alguns FKs
  ficaram sem índice próprio.
- **Problema:** dois efeitos — (1) checagem de `ON DELETE RESTRICT`/`SET NULL` faz
  seq scan na tabela filha ao deletar o pai; (2) queries "por médico" / "por
  fornecedor" / "por procedimento" não têm índice de apoio.
- **Impacto:** em escala, o painel do médico ("meus prontuários") e a exclusão de
  um `procedure`/`supplier`/`profile` degradam para full scan das tabelas clínicas
  e de caixa.
- **Cenário de falha:** clínica com 100k prontuários; abrir "prontuários do Dr. X"
  (filtro por `doctor_id`) varre a tabela inteira em vez de usar índice.
- **Risco futuro:** cresce linearmente com o volume clínico/financeiro.
- **Validação ao vivo:** confirmado — **48 constraints FK sem índice cuja coluna
  líder seja a própria coluna da FK** (query de catálogo, independente de volume).
  Nuance importante apurada ao vivo: muitas FKs *são* servidas por índices compostos
  **liderados por `clinic_id`** (ex.: `(clinic_id, patient_id)`), o que cobre as
  queries da aplicação (sempre com `clinic_id`); o que fica **descoberto** é (a) a
  checagem de integridade no DELETE do pai — apagar paciente/clínica/procedimento/
  fornecedor faz seq scan nas filhas (relevante no **hard-delete LGPD** que dispara
  RESTRICT em prontuarios/prescriptions/medical_documents e no **offboarding de
  clínica** que faz CASCADE em tudo) — e (b) queries pela coluna FK sem `clinic_id`.
  FKs sem qualquer índice de apoio (nem composto) incluem `appointments.unit_id`/
  `procedure_id`/`rescheduled_from_appointment_id`, `lancamentos.supplier_id`/
  `unit_id`, e os `*_id` de billing (`subscription_id`, `plan_id`, `price_id`).
- **Correção recomendada:** priorizar índice nas colunas FK usadas em DELETE de pai
  e em queries por médico/fornecedor. Confirmar cada um com `EXPLAIN` no ambiente de
  **volume real** antes de criar (no banco atual, com <100 linhas/tabela, o planner
  sempre faz seq scan — o `EXPLAIN` aqui não é representativo).
- **Prioridade:** Média.

### A7 — Provisionamento de partição depende de um único cron

- **Severidade:** MÉDIA
- **Categoria:** Performance / Arquitetura (operacional)
- **Local:** [audit-partitions/route.ts:27-28](../../src/app/api/cron/audit-partitions/route.ts#L27-L28)
  (`PARENTS`, `MONTHS_AHEAD=3`); partições estáticas até 2027-04
  ([0009:78-89](../../drizzle/migrations/0009_c4_audit_partitioned.sql#L78-L89)) e
  2027-05 (`ai_messages`, [0024:185-196](../../drizzle/migrations/0024_ai_agent_core.sql#L185-L196));
  monitor em [retention.repo.ts](../../src/app/(admin)/admin/_lib/repositories/retention.repo.ts).
- **Descrição:** as partições futuras de `audit_events`/`ai_messages` são criadas
  por um cron mensal do Vercel (3 meses à frente). Não há `pg_cron`/`pg_partman` no
  banco.
- **Problema:** se o cron falhar em silêncio (deploy quebrado, `CRON_SECRET`
  rotacionado, Vercel cron desabilitado), as linhas caem na partição `_default`.
- **Impacto:** não é outage imediato (a `_default` absorve), mas a `_default`
  vira uma tabela não particionada crescente e o benefício da partição se perde.
- **Cenário de falha:** cron para por 4+ meses sem alerta → toda escrita de audit/
  IA vai para `_default`; queries por janela de tempo degradam.
- **Risco futuro:** mitigado hoje por heartbeat (`cron_heartbeats`) + painel admin
  (`retention.repo.ts` expõe `defaultCount` e `monthsAhead`), mas depende de alguém
  olhar o painel.
- **Validação ao vivo:** **confirmado com evidência concreta.** (1) `pg_cron`/
  `pg_partman` **não estão instalados** — o provisionamento é 100% dependente do cron
  Vercel. (2) A partição `audit_events_default` **já contém 9 linhas**, todas de
  `2026-05` — a partição `audit_events_2026_05` **não existe mais** (detach/drop), e
  como o cron só cria mês atual + 3 à frente, essas linhas ficam **presas na default
  para sempre** sem remediação manual. Ou seja: o cenário de falha do achado **já
  ocorreu** (em pequena escala) neste banco. `ai_messages_default` está em 0.
  Cobertura à frente: `audit_events` até `2028-05`, `ai_messages` até `2027-05` (cron
  vem rodando).
- **Correção recomendada:** alerta ativo (Sentry/observability) quando
  `defaultCount > 0` ou `monthsAhead < 1`; remediar as 9 linhas órfãs (recriar a
  partição do mês e mover, ou reclassificar); considerar `pg_cron` como redundância
  no próprio banco.
- **Prioridade:** Média (a partição default já não-vazia eleva a urgência do alerta).

### A8 — PII de negócio (CPF/CNPJ) em texto claro

- **Severidade:** MÉDIA
- **Categoria:** Segurança / Dados
- **Local:** [billing/schema.ts:216](../../src/contexts/billing/schema.ts#L216)
  (`billing_customers.document`), [:156](../../src/contexts/billing/schema.ts#L156)
  (`checkout_sessions.document`), [financial/schema.ts:95](../../src/contexts/financial/schema.ts#L95)
  (`suppliers.cnpj`), [tenancy/schema.ts:44](../../src/contexts/tenancy/schema.ts#L44)
  (`clinics.cnpj`).
- **Descrição:** documentos fiscais do dono da clínica/fornecedor (CPF ou CNPJ)
  são armazenados em claro.
- **Problema:** é PII (CPF em particular). Menos sensível que dado clínico, mas
  ainda sujeito a LGPD e ao mesmo risco de vazamento de backup do A1.
- **Impacto:** vazamento expõe CPF/CNPJ de administradores e fornecedores.
- **Cenário de falha:** mesmo do A1 (dump/backup) — os documentos aparecem em claro.
- **Risco futuro:** baixo/moderado; volume pequeno (uma linha por clínica/fornecedor).
- **Correção recomendada:** avaliar cifrar `*.document`/`cnpj` no mesmo esquema do
  ADR-012 se forem tratados como PII; no mínimo, cobri-los pela mitigação de backup
  do A1. `checkout_sessions` é pré-tenant — cifrar exige chave de plataforma
  (padrão `PLATFORM_ORPHAN_SCOPE` já existe).
- **Prioridade:** Média/Baixa.

### A9 — Colunas de atribuição `*_by` sem integridade referencial

- **Severidade:** BAIXA
- **Categoria:** Dados (integridade)
- **Local:** ex. [scheduling/schema.ts:238](../../src/contexts/scheduling/schema.ts#L238)
  (`appointments.created_by`), [:299](../../src/contexts/scheduling/schema.ts#L299)
  (`transitioned_by`), [financial/schema.ts:138](../../src/contexts/financial/schema.ts#L138)
  (`lancamentos.created_by`), [billing/schema.ts:240](../../src/contexts/billing/schema.ts#L240)
  (`subscriptions.cancelled_by`), [ai-agent/schema.ts:205](../../src/contexts/ai-agent/schema.ts#L205)
  (`ai_handoff_queue.assigned_to`).
- **Descrição:** as colunas de "quem fez" referenciam `auth.users`/`profiles`
  **sem FK** (decisão de design registrada nos comentários — preservar o ator
  histórico mesmo após remoção do usuário).
- **Problema:** não há garantia referencial; a coluna pode apontar para um usuário
  inexistente.
- **Impacto:** consultas de atribuição ("quem cancelou?") podem não resolver o
  nome; joins ficam por conta da aplicação.
- **Cenário de falha:** funcionário é removido → registros históricos exibem um id
  órfão em vez do nome.
- **Risco futuro:** baixo — é tradeoff consciente (log de atribuição ≠ FK viva).
- **Correção recomendada:** manter como está; opcionalmente snapshot do **nome** do
  ator onde a exibição histórica importa (padrão de snapshot já usado no domínio).
- **Prioridade:** Baixa.

### A10 — Rigidez de `pgEnum` para evolução

- **Severidade:** BAIXA
- **Categoria:** Schema / Evolução
- **Local:** ex. [identity/schema.ts:48-55](../../src/contexts/identity/schema.ts#L48-L55)
  (`role_enum`), [scheduling/schema.ts:51-59](../../src/contexts/scheduling/schema.ts#L51-L59)
  (`appointment_status`), [tenancy/schema.ts:27-36](../../src/contexts/tenancy/schema.ts#L27-L36)
  (`clinic_status`).
- **Descrição:** enums Postgres são append-only. Adicionar valor é fácil
  (`ALTER TYPE ADD VALUE`); **remover/reordenar** exige recriar o tipo e reescrever
  colunas.
- **Problema/Impacto:** já houve um caso (`chamadas` removido em
  [0019](../../drizzle/migrations/0019_drop_chamadas.sql)). Enums voláteis (status
  de fluxo que muda com o negócio) podem gerar migração custosa.
- **Correção recomendada:** manter enums só para conjuntos realmente estáveis;
  para conjuntos voláteis, considerar tabela de lookup + FK. Não agir sobre os
  atuais (são estáveis).
- **Prioridade:** Baixa.

### A11 — `clinics.cnpj` sem UNIQUE nem NOT NULL

- **Severidade:** BAIXA
- **Categoria:** Dados / Regra de negócio
- **Local:** [tenancy/schema.ts:44](../../src/contexts/tenancy/schema.ts#L44).
- **Descrição:** `cnpj` é nullable e sem constraint de unicidade (validação só em
  C13, por design).
- **Problema/Impacto:** duas clínicas podem ter o mesmo CNPJ (ou nenhum), abrindo
  espaço para cadastro duplicado/inconsistência de billing.
- **Cenário de falha:** duas assinaturas para o mesmo CNPJ sem detecção no banco.
- **Correção recomendada:** ao amadurecer o onboarding/billing, avaliar
  `UNIQUE (cnpj) WHERE cnpj IS NOT NULL` (índice parcial) após normalizar o CNPJ.
- **Prioridade:** Baixa.

### A12 — `jsonb` estrutural pesado (dívida de validação/queryability)

- **Severidade:** BAIXA
- **Categoria:** Schema
- **Local:** [clinical/schema.ts:82](../../src/contexts/clinical/schema.ts#L82)
  (`prontuarios.content`), [ai-agent/schema.ts:173-177](../../src/contexts/ai-agent/schema.ts#L173-L177)
  (`working_hours`, `message_template_overrides`), [onboarding/schema.ts:32](../../src/contexts/onboarding/schema.ts#L32)
  (`step_state`).
- **Descrição:** vários campos estruturais vivem em `jsonb` (por bom motivo:
  flexibilidade do prontuário SOAP, config livre). A validação é na aplicação (Zod)
  e há `CHECK pg_column_size` defensivo em várias tabelas.
- **Problema/Impacto:** o banco não valida a forma do JSON; consultas por campo
  interno exigem operadores JSON (sem índice por padrão). É dívida aceitável, mas
  cresce se relatórios passarem a filtrar por dentro do JSON.
- **Correção recomendada:** manter; se surgir necessidade de filtrar por chave
  interna em escala, promover a coluna ou criar índice `GIN`/expressão específico.
- **Prioridade:** Baixa.

### A13 — Privilégios amplos de `anon`/`authenticated` no `public` (default do Supabase), incluindo `TRUNCATE` que o RLS não cobre

- **Severidade:** MÉDIA (defense-in-depth / risco latente) — **descoberto na
  validação ao vivo**; a revisão estática das migrations não pegava, porque os
  grants vêm do **`ALTER DEFAULT PRIVILEGES` do Supabase**, não do código do projeto.
- **Categoria:** Segurança
- **Local:** `pg_default_acl` (grantor `postgres`/`supabase_admin`, objtype `r`,
  ACL `anon=arwdDxtm`); `information_schema.role_table_grants`.
- **Descrição:** medido ao vivo, **`anon` tem `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
  REFERENCES/TRIGGER` (`arwdDxtm`) em 89 tabelas** do `public`, e `authenticated` em
  83–97. É o default do Supabase e **se aplica automaticamente a toda tabela nova**
  criada no schema.
- **Problema:** o efeito residual real é **`TRUNCATE` e DDL-privs (`REFERENCES`,
  `TRIGGER`) concedidos a `anon`/`authenticated` — e RLS NÃO cobre `TRUNCATE`**
  (só filtra linhas em SELECT/INSERT/UPDATE/DELETE). São privilégios que a app nunca
  usa (violação de least-privilege).
- **Mitigação já existente (apurada ao vivo — crédito ao time):** o cenário que eu
  temia — "tabela nova sem RLS nasce exposta a `anon`" — está **em grande parte
  guardado** por um **event trigger `rls_auto_enable()`** (`SECURITY DEFINER`,
  `search_path` fixo) que roda em todo `CREATE TABLE` no `public` e executa
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` automaticamente. Ou seja: uma tabela
  nova nasce com RLS ligado (sem policy = deny-all), não exposta. Excelente guardrail.
- **Impacto:** hoje, **exploração direta baixíssima** — `anon`/`authenticated` só
  chegam ao banco via PostgREST (Data API), que emite apenas SELECT/INSERT/UPDATE/
  DELETE (gated por RLS) e **não emite `TRUNCATE`**; e o event trigger fecha o buraco
  de RLS esquecido. Resta o **least-privilege**: privilégios `TRUNCATE`/`REFERENCES`/
  `TRIGGER` desnecessários a `anon`/`authenticated`.
- **Cenário de falha residual:** o event trigger liga RLS mas **não faz `FORCE` nem
  cria policy**; se alguém no futuro der `ENABLE` sem `FORCE` **e** a tabela tiver o
  dono como role não-privilegiada, ou desabilitar o event trigger, o default-grant
  volta a morder. É borda estreita, mas o `REVOKE` explícito a elimina.
- **Risco futuro:** baixo, dado o guardrail; o `REVOKE` explícito o zera.
- **Correção recomendada:** (a) **`REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon,
  authenticated`** no `public` (nunca são necessários pela app); (b) para tabelas que
  `anon` nunca deve tocar, `REVOKE ALL ... FROM anon` como defesa-em-profundidade;
  (c) manter/monitorar o event trigger `rls_auto_enable` e complementar com um
  teste de CI que varra `pg_class.relrowsecurity` (o projeto já tem
  [rls.test.ts](../../src/lib/db/rls.test.ts)).
- **Prioridade:** Média→Baixa (o guardrail `rls_auto_enable` já cobre o pior caso; o
  que resta é hardening de least-privilege barato).

### A14 — RLS re-avalia helpers de auth por linha (`auth_rls_initplan` — 57 policies)

- **Severidade:** MÉDIA (performance em escala) — **achado do `get_advisors` oficial**;
  é o **maior ROI** de performance do banco. Aparece igual em **dev e prod (57×)**.
- **Categoria:** Performance
- **Local:** o predicado congelado do [defaultTenantPolicy](../../src/lib/db/rls.ts#L84-L94)
  — replicado em toda tabela tenant-scoped.
- **Descrição:** o predicado chama `current_setting('app.current_clinic', true)`,
  `current_clinic_id()` e `is_super_admin()` **direto**, sem envolver em subquery
  escalar. O Postgres re-avalia essas funções **por linha** varrida em vez de uma vez
  por query (o advisor `auth_rls_initplan` do Supabase é exatamente sobre isso).
- **Problema:** em toda tabela grande, cada linha avaliada re-executa 2–3 funções de
  auth. Com milhões de linhas (pacientes, mensageria, audit), o overhead é linear e
  incide em **todas** as queries tenant.
- **Impacto:** listagens, relatórios e joins ficam mais lentos do que precisariam,
  proporcional ao volume — exatamente onde o produto quer escalar.
- **Cenário de falha:** `SELECT ... FROM patients WHERE clinic_id = $1` numa clínica
  com 200k pacientes re-avalia `current_clinic_id()`/`is_super_admin()` por linha
  filtrada, em vez de 1×.
- **Correção recomendada:** envolver as chamadas em **subquery escalar** no helper
  `defaultTenantPolicy` — ex.: `clinic_id::text = (select current_setting('app.current_clinic', true))`,
  `... = (select current_clinic_id())`, `(select is_super_admin())`. Como o padrão é
  **um único helper**, o fix propaga para todas as tabelas de uma vez (e vale
  re-emitir as policies existentes). Padrão recomendado pela própria Supabase.
- **Prioridade:** Média (barato — muda só o helper — e beneficia todas as queries).

### A15 — Funções internas/trigger executáveis por `anon`/`authenticated` via RPC

- **Severidade:** MÉDIA (hardening) — achados `anon/authenticated_security_definer_function_executable`
  do `get_advisors`. É a face **de função** do A13 (o default do Supabase concede
  `EXECUTE` de toda função nova a `anon`/`authenticated`).
- **Categoria:** Segurança
- **Local:** funções em `public` expostas como `/rest/v1/rpc/<fn>`:
  `block_lancamento_immutable_cols`, `block_signed_prontuario_update`,
  `enforce_appointment_snapshot_immutable`, `rls_auto_enable` (todas trigger/event —
  não deveriam ser API); e as **intencionais** `record_login_attempt` (pré-auth, por
  design — [0004:36](../../drizzle/migrations/0004_identity_hardening.sql#L36)) e
  `mark_mfa_enrolled` (só `authenticated`, usa `auth.uid()`).
- **Descrição:** o Supabase concede `EXECUTE` default a `anon`/`authenticated` em
  toda função nova; as migrations revogam isso só para o hook de auth — as funções de
  trigger/immutabilidade ficaram expostas como endpoints RPC.
- **Problema:** endpoints RPC que não deveriam existir. Exploração real é **baixa**
  (as funções de trigger referenciam `NEW`/`OLD` ou `pg_event_trigger_ddl_commands()`
  e **falham** se chamadas fora do contexto de trigger), mas é least-privilege violado
  e superfície de API desnecessária.
- **Impacto:** superfície de ataque/ruído; um atacante enumera `/rpc/*` e encontra
  funções internas (mesmo que errem).
- **Correção recomendada:** `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated`
  nas funções de trigger/event/immutabilidade (manter só as intencionais de login/MFA);
  adotar como padrão de migration para toda função nova não-API.
- **Prioridade:** Média (hardening barato, muitos itens de uma vez).

### A16 — Duas funções sem `search_path` fixo (`function_search_path_mutable`)

- **Severidade:** BAIXA (hardening) — achado do `get_advisors` (dev e prod).
- **Categoria:** Segurança
- **Local:** `public.appt_tstzrange` e `public.enforce_appointment_snapshot_immutable`
  (contexto scheduling — helper do EXCLUDE e trigger de imutabilidade de snapshot).
- **Descrição:** ambas sem `SET search_path`. O restante das funções do projeto o
  fixa (a validação confirmou **0** funções `SECURITY DEFINER` sem `search_path` — estas
  duas escaparam porque não são `SECURITY DEFINER`, então minha checagem via `psql` não
  as pegou; o advisor oficial pegou).
- **Problema/Impacto:** `search_path` mutável permite, em tese, resolução de objeto
  não-qualificado para um schema malicioso. Baixo risco aqui (lógica simples), mas é a
  boa prática que o resto do código já segue.
- **Correção recomendada:** adicionar `SET search_path = public, pg_temp` (ou
  `pg_catalog`) às duas funções.
- **Prioridade:** Baixa.

---

## 4. Riscos de Escala

Pensando em milhões de registros, do maior para o menor risco:

1. **Mensageria raw (A2) — o maior.** `inbound_messages_raw`,
   `outbound_messages`, `provider_status_events_raw` sem partição e sem retenção.
   É a maior taxa de escrita e a única categoria "por mensagem". **Decidir antes
   do volume** (particionar tabela viva grande é doloroso).
2. **`audit_events` / `ai_messages` (A7).** Particionadas — ok **enquanto o cron
   rodar**. Risco é operacional (cron silencioso → `_default` crescente). Precisa
   de **alerta ativo**, não só painel.
3. **Retenção de IA (A5).** Sem purga automática, `ai_messages`/`ai_conversations`
   crescem além dos 30d pretendidos.
4. **Tabelas append-only de histórico** — `appointment_state_log`,
   `procedure_history`, `subscription_history`, `billing_events`,
   `ai_agent_failures`, `payment_attempts`. Crescem com o **volume de negócio**
   (não por mensagem), então mais lentas; sem partição. Monitorar tamanho e, se
   necessário, particionar/arquivar as mais quentes (`appointment_state_log`).
5. **Índices FK ausentes (A6).** Queries por médico/fornecedor degradam com o
   crescimento clínico/financeiro.

**Já bem resolvido (citar como referência):** `outbox` (retenção 30d),
`login_attempts` (90d) e `idempotency_keys` (TTL) têm purga em lote com teto de
iteração ([data-retention/route.ts](../../src/app/api/cron/data-retention/route.ts)) —
exatamente o padrão a replicar para a mensageria raw.

---

## 5. Plano de Evolução

### Agora (baixo custo, alto valor — janela pré-go-live)
- **A14 (maior ROI):** envolver os helpers de auth do
  [defaultTenantPolicy](../../src/lib/db/rls.ts#L84-L94) em subquery escalar
  (`(select current_clinic_id())` etc.) e re-emitir as policies. Uma mudança no
  helper acelera **todas** as queries tenant em escala.
- **A15/A16 (hardening):** `REVOKE EXECUTE` de `anon`/`authenticated` nas funções
  de trigger/event (`block_*`, `enforce_*`, `rls_auto_enable`); `SET search_path`
  em `appt_tstzrange` e `enforce_appointment_snapshot_immutable`.
- **A13:** `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated` no
  `public` (o guardrail `rls_auto_enable` já cobre o "RLS esquecido"; isto fecha o
  least-privilege). Opcional: teste de CI varrendo `pg_class.relrowsecurity`.
- **Auth prod:** ativar `leaked password protection` (HaveIBeenPwned) em qoro-prod.
- **A7:** ligar alerta ativo para `default_count > 0` / `monthsAhead < 1`; limpar as
  9 linhas órfãs do `audit_events_default` **do dev** (prod está limpo).
- **A5:** estender o `data-retention` para purgar `ai_messages`/`ai_conversations`
  vencidas e dropar partições totalmente vencidas.
- **A3:** checklist/teste de PR que audite call sites de `dbAdmin` (escopo `clinic_id`).
- **A6:** criar os índices FK (priorizando os usados em DELETE de pai), confirmando
  com `EXPLAIN` quando houver volume real.

### Próxima fase (decisão de produto/segurança)
- **A2:** particionar por mês + retenção nas 3 tabelas raw de mensageria **antes**
  do volume crescer. Incluir os pais no cron `audit-partitions`.
- **A1:** decidir cifragem do conteúdo clínico (estender ADR-012) **ou** formalizar
  o risco aceito + mitigação de backup num ADR. É a decisão de maior impacto de
  privacidade.
- **A8:** decidir cifragem/mitigação de `*.document`/`cnpj` junto com o A1.

### Escala futura (planejamento arquitetural)
- **A4:** se multi-clínica/rede/marketplace entrar no roadmap, projetar associação
  N:N (`clinic_members`) + "clínica ativa" no JWT + predicado RLS revisado **antes**
  de crescer a base — é o núcleo de segurança, migração sensível.
- **Histórico (risco 4):** avaliar particionamento/arquivamento das tabelas
  append-only mais quentes conforme o `pg_stat_user_tables` real evoluir.

---

## 6. Validação no banco vivo

Executada em **2026-07-12** por dois caminhos, ambos **read-only**: (1) `psql`
contra `DATABASE_URL` (dev) e (2) o lint oficial **`get_advisors` (MCP Supabase)**
rodado em **qoro-dev** (`pqhkirrszzpwezdaqrai`) **e qoro-prod** (`shlcbxawrxuaebazuiue`).
Ambos os bancos têm volume baixíssimo (produto pré-produção), então os resultados
validam **estrutura**, não escala real.

### Confirmações positivas (pontos fortes verificados)

| Verificação | Resultado |
|---|---|
| Tabelas em `public` **sem** RLS | **0** (todas `ENABLE`+`FORCE`) |
| Funções `SECURITY DEFINER` sem `search_path` fixo | **0** |
| Views em `public` | 1 (`effective_permissions_v`) — `security_invoker=on` ✅ |
| Tabelas plataforma (`clinic_invites` etc.) | RLS `FORCE` = deny-all para não-service_role ✅ |
| **Event trigger `rls_auto_enable`** | liga RLS automaticamente em toda tabela nova do `public` — guardrail que cobre o pior caso do A13 ✅ |

### Achados confirmados/reforçados com evidência ao vivo

| Achado | Evidência medida (fonte) |
|---|---|
| **A14** (novo) | `get_advisors`: **57× `auth_rls_initplan`** (dev e prod) — helpers de auth re-avaliados por linha |
| **A6** | `get_advisors`: **48× `unindexed_foreign_keys`** (confirma o `psql`) |
| **A15** (novo) | `get_advisors`: funções trigger/event executáveis por `anon`/`authenticated` via `/rest/v1/rpc/*` |
| **A16** (novo) | `get_advisors`: **2× `function_search_path_mutable`** (`appt_tstzrange`, `enforce_appointment_snapshot_immutable`) |
| **A13** | `pg_default_acl`: `anon`=`arwdDxtm` (ALL, incl. `TRUNCATE`) em 89 tabelas — mitigado por `rls_auto_enable` |
| **A7** | `pg_cron`/`pg_partman` ausentes; **dev** com **9 linhas** órfãs em `audit_events_default` (`2026-05`); **prod limpo** (default = 0, partição `2026_05` existe) |
| **A2** | mensageria raw = tabelas simples (`relkind='r'`, não particionadas), fora do cron de retenção |

### Divergências dev × prod (relevantes para o go-live)

- **Partições:** **prod está limpo** (`audit_events_default`=0, `ai_messages_default`=0,
  partição `2026_05` presente). As 9 linhas órfãs são **artefato de teste no dev**
  (a partição `2026_05` foi dropada lá). Prod só precisa do **alerta ativo** de A7.
- **Auth (só prod):** `get_advisors` sinaliza **`auth_leaked_password_protection`
  DESLIGADO** em prod — ativar a checagem HaveIBeenPwned **antes do go-live**
  (config de Auth, não schema). *(Não é um achado de banco, mas apareceu no lint e
  vale corrigir.)*
- **Dado:** prod tem 0 pacientes / 1 clínica (seed) — confirma pré-produção.

### Ruído esperado no lint (não acionável agora)

- **`unused_index`** (41 dev / 72 prod): os índices aparecem "não usados" porque **não
  há tráfego** — não porque são inúteis. **Re-avaliar pós-lançamento** com
  `pg_stat_statements`, nunca dropar agora.
- **`multiple_permissive_policies`** (5×, ex. `profiles` com 3 policies de SELECT):
  micro-custo de performance; consolidável, mas baixíssima prioridade.
- **`extension_in_public`** (`btree_gist`, `pg_trgm`): recomendação Supabase de mover
  extensões para schema próprio — cosmético/hardening leve.

### Ainda pendente (exige volume real)

- `EXPLAIN (ANALYZE)` das queries por médico (A6) e de janela de mensageria (A2), e
  `pg_stat_statements`, **em produção com tráfego real** — no volume atual o planner
  sempre faz seq scan e o plano não é conclusivo.

---

## 7. O que está certo e NÃO deve ser refatorado

Para o relatório não induzir retrabalho desnecessário, registra-se o que está
**bem-feito** e deve ser preservado:

- O padrão de RLS `FORCE` + dual-context congelado em
  [defaultTenantPolicy](../../src/lib/db/rls.ts#L74-L95) e a fronteira
  [withTenant](../../src/lib/db/tenant.ts#L40-L49). **Não** duplicar/variar policies
  fora do helper sem ADR.
- Claims via `custom_access_token_hook` a partir de `profiles` (nunca
  `user_metadata`), `app_role` em vez de `role`, e `security_invoker=on` na view.
- `numeric` para dinheiro, snapshots imutáveis, imutabilidade de prontuário
  assinado, append-only reforçado por `REVOKE` (0021), particionamento de audit/IA.
- Cifragem per-tenant (HKDF por `clinic_id` + HMAC de lookup com salt global) do
  ADR-012 — o A1 é sobre **estender o escopo**, não trocar o mecanismo.
- Disciplina de índices `clinic_id`/compostos, `CHECK` de coerência
  (valor/status/datas) e unicidade parcial (`WHERE ... IS NOT NULL` / `active`).
- **Event trigger `rls_auto_enable`** — liga RLS em toda tabela nova do `public`
  automaticamente. Manter; é o que neutraliza o pior caso do A13.

A validação ao vivo ([§6](#6-validação-no-banco-vivo)) — `psql` + `get_advisors`
oficial em dev e prod — **confirmou** esse rigor: zero tabelas sem RLS, zero
`SECURITY DEFINER` sem `search_path`, view única com `security_invoker`, e o guardrail
`rls_auto_enable`. Os grants amplos a `anon` (A13) e os RPC de função (A15) são o
**default do Supabase**, não erro do time — mas valem o hardening. O achado de maior
retorno é o A14 (envolver os helpers de auth do RLS em subquery), que **não** contradiz
o padrão — só o otimiza no mesmo helper único.

**Veredito final:** do ponto de vista de **correção e isolamento**, o banco está
sólido e seria aprovado para produção. Como o produto **ainda não foi para
produção** (fase de testes), este é o **momento certo** para fechar, com custo
mínimo, os itens estruturais (A2, A6, A7), a decisão de proteção de dado sensível
(A1) e o hardening de defesa-em-profundidade (A13) — **antes** de entrar dado real
de paciente e volume de escala. Não há incêndio a apagar; há terreno a preparar, e a
janela para prepará-lo barato é agora.

---

## 8. Remediação (2026-07-17)

Executada por 5 commits (uma branch, logicamente 4 PRs por perfil de risco + 1
follow-up). Cada mudança foi aplicada e **verificada em dev**; **prod é janela
manual** (checklist em `runbooks/migrations.md`, resumo no fim desta seção).

### Reconciliação — o que a auditoria não sabia (leu até 0037; hoje 0050)

A auditoria é de 2026-07-12 e leu migrations `0000–0037`. Antes de agir, a
verificação ao vivo (MCP `get_advisors` + catálogo em dev **e** prod) mostrou que
parte já estava fechada:

- **A3** (bypass `service_role`): fechado pelo D1 — `qoro_runtime` NOBYPASSRLS
  **ativo em prod desde 2026-07-17**. Um `withTenant` esquecido retorna 0 linhas.
- **A15/A16** (funções): a **0038** já revogou `EXECUTE` das funções de
  trigger/event e fixou `search_path`. Restou só `record_login_attempt` executável
  por `authenticated` (fechado agora na 0045).
- **`leaked_password_protection`**: já **ligado** em prod (sumiu do advisor).

### A14 — RLS InitPlan (PR1 · 0045 + 0050)
Predicado do `defaultTenantPolicy` envolvido em subquery escalar (`(select
current_clinic_id())` etc.) — o `FINGERPRINT` foi para `v2` e a 0045 re-emitiu as
65 policies materializadas (46 canônicas pela saída do helper + 19 manuais). A 0050
fechou o resíduo `profiles_self_select` (`auth.uid()`).
**Evidência:** advisor `auth_rls_initplan` **57 → 0**; `EXPLAIN` de `SELECT FROM
patients` mostra `(InitPlan 1..3).col1` no Filter; assinatura de shape das 75
policies **idêntica** antes/depois (só o predicado mudou).

### A13 — least-privilege do `public` (PR1 · 0045)
A recomendação da auditoria (`REVOKE` das tabelas de hoje) foi ampliada para a
**causa-raiz**: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE` — senão a
próxima tabela nasce exposta de novo. Escopo **medido**: `anon` não usa a Data API
(só 2 leituras PostgREST, pós-signIn como `authenticated`) → `REVOKE ALL`;
`authenticated` mantém o DML (é a role do `withTenant`), perde só
TRUNCATE/REFERENCES/TRIGGER.
**Evidência:** `anon` 618 → **0** privilégios de tabela; default ACL sem `anon`;
DML de `authenticated` intacto (364); login real via GoTrue emite claims; `anon`
lendo `profiles` era `200` vazio (RLS) e agora `401 42501` (privilégio) — 2 camadas.

### A6 + N1 — índices de FK (PR1 · 0044)
Regra: FK cujo pai é apagado em operação real (hard-delete LGPD, offboarding de
membro, exclusão de procedimento/fornecedor/unidade, purga de retenção) ganha
índice **liderado pela coluna da FK** (o composto `(clinic_id, x)` não serve à
checagem de RI). **N1** (novo): `appointment_state_log` e `procedure_history` eram
tenant com policy RLS e **zero índice em `clinic_id`** — seq scan em toda query.
Catálogos que o produto nunca apaga e filhas pequenas ficaram **de fora, por
decisão** (índice sem uso também é dívida).
**Evidência:** advisor `unindexed_foreign_keys` 48 → 16 (as 16 são as deixadas de
fora deliberadamente).

### A2 — retenção da mensageria, NÃO particionamento (PR2 · ADR-043)
Particionar as 3 raw quebraria as UNIQUE de exactly-once — em `outbound_messages`,
incluir `created_at` na `UNIQUE(clinic_id, idempotency_key)` faz um retry virar
**segunda mensagem enviada ao paciente**. A causa-raiz (crescimento sem teto) foi
fechada com retenção em lote (inbound/status 90d, outbound 180d — prova de envio).

### A5 — retenção da IA (PR2)
`ai_conversations`/`ai_messages` vencidas passam a ser purgadas de verdade (era só
comentário de schema). `ai_conversations` primeiro: a FK CASCADE leva as mensagens.
**Evidência (A2+A5):** cron real rodado em dev com dado de teste vencido — purgou
inbound/outbound/status/ai_conversations; ai_messages caiu por CASCADE; a linha
fresca **não** foi tocada.

### A7 + N2 — partições (PR2)
Alerta ativo (`cron.audit_partitions.degraded` via `metrics`+`logger`, pipeline
stdout do ADR-029) quando `defaultCount>0` ou cobertura contígua abaixo de 1 mês.
**N2** (novo): o monitor calculava cobertura por `max(partição)`, **cego a
lacunas** — o dev reportava "22 meses saudáveis" com o próximo buraco a 11.
Corrigido para contiguidade. As **9 linhas órfãs** do dev foram remediadas pelo
procedimento do runbook (mover→criar partição→devolver, atômico).
**Evidência:** cron real → `monthsAhead=11` (não 22); alerta forçado disparou 2
linhas no stdout; default 9 → 0.

### A1 — cifra do conteúdo clínico (PR3 · ADR-044 · 0046+0047)
`content`/`medicamentos`/`observacoes` cifrados per-tenant (mesmo mecanismo do
ADR-012). **Bloqueante descoberto e provado:** o conteúdo vazava em claro para
`audit_events` (32 registros com a chave `content`) e `idempotency_keys` — cifrar a
coluna sozinha deixaria o `pg_dump` legível. Fechado com o seam `project` em
`idempotentMutation`. Enforcement por **branded type** `Encrypted<T>` (call-site sem
decrypt não compila — pegou o `isContentEmpty` que assinaria prontuário "vazio" em
silêncio). Templates **não** cifrados (paciente-agnóstico + listagem);
`patient_clinical_data` **adiado** (ADR-013 — sem escritor).
**Evidência:** 32 audit com content → **0** com texto clínico legível; backfill
12/12+7/7+2/2, 0 NULL; colunas em claro dropadas; smoke-c7 (8/8) e smoke-c8 (9/9)
verdes com cifra; round-trip de decrypt OK.

### A8 — PII de negócio (PR4 · ADR-044 · 0048+0049)
`clinics.cnpj` (5 read-sites religados) + `billing_customers.document` (write-only)
cifrados. `checkout_sessions.document` **não tocado** (coluna morta).
**Evidência:** colunas em claro dropadas; round-trip pela via real
(`getClinicProfile` decifra; ciphertext não contém o valor).

### A11 — UNIQUE do CNPJ (PR4 · 🟡 parcial, adiado)
`cnpj_hash` adicionada e populada (não nasce morta). O **UNIQUE fica adiado**: sem
normalização de CNPJ o hash não dedupe formatações diferentes (proteção falsa), e o
salt HMAC global tornaria a unicidade global de plataforma. Decisão do founder.

> **Correção 2026-07-18:** a 1ª redação dizia "adiado até **C13**". Ponteiro morto —
> o C13 fechou em 2026-06-17 sem entregar a normalização (o comentário
> `validation only in C13` no schema era promessa não cumprida). **Gatilho real:**
> antes do 1º cliente pagante via onboarding self-serve; **pré-requisito:**
> normalizar o CNPJ na escrita. Ver ADR-044 §A11.

### Aceitos por decisão (sem código)
- **A4** (1 user = 1 clínica): a auditoria manda não agir; ADR-032 registra.
- **A9** (`*_by` sem FK), **A10** (pgEnum append-only), **A12** (jsonb estrutural):
  tradeoffs conscientes; a auditoria recomenda manter.

### Gates (todos os PRs)
`lint`, `typecheck`, `test` (669 → **786**), `build`, `check:migrations`
(+ correção de um falso positivo do gate em `ALTER DEFAULT PRIVILEGES`),
`arch:db-check`. Advisor de perf: `auth_rls_initplan` 57→0, `unindexed_foreign_keys`
48→16 (deliberadas).

### Checklist de PROD (janela manual do founder)

> Ordem geral (`runbooks/migrations.md:63-102`): `git pull` → `pnpm install
> --frozen-lockfile` → exportar `SUPABASE_PROJECT_ENV=prod` + `DATABASE_URL_PROD`
> **só neste shell** → **`pnpm db:backup:prod`** → aplicar → conferir
> `_schema_version` → **`unset`**.
>
> 🔑 **Verificar o backup da master key ANTES.** Ela vive nas **env vars da Vercel**
> (`CRYPTO_MASTER_KEY_V1`, com `CRYPTO_SECRET_BACKEND=env`) — **não** no Google
> Secret Manager, apesar do que a doc de ambiente afirmava até 2026-07-18. A cifra
> clínica amplia o raio: perder a chave passa a significar perder o **prontuário**,
> e nenhum backup do Postgres recupera (o dado está cifrado). Garanta uma cópia
> fora da Vercel.

1. **0044+0045+0050** (PR1, DDL puro reversível): `pnpm db:migrate:prod`. Verificar
   por catálogo: `auth_rls_initplan`=0, `anon` sem privilégio de tabela, DML de
   `authenticated` intacto. **Logar no app e navegar** (as 65 policies foram
   re-emitidas — é a mudança com maior chance de quebrar acesso).
2. **PR2** (só código, sem migration): deploy. Rodar `/api/cron/data-retention` e
   `/api/cron/audit-partitions` uma vez e conferir o `health`.
3. **0046 → backfill → 0047** (PR3, cifra clínica): aplicar 0046 **com o deploy do
   código**; rodar `pnpm db:encrypt-clinical`; conferir `content_encrypted IS NULL`
   = 0; **só então** aplicar 0047. Prod tem 0 prontuários → backfill é no-op e as
   duas podem ir juntas (o guard protege). E2E de UI: criar → **tentar assinar vazio
   (deve BLOQUEAR)** → assinar → editar → PDF (receita simples + controle especial)
   → 4 documentos → buscar por nome em `/documentos` → export LGPD. `pg_dump | grep`
   de um termo clínico → vazio.
4. **0048 → backfill → 0049** (PR4, PII): igual, com `pnpm db:encrypt-business-pii`.
   Prod tem 1 clínica seed (CNPJ provavelmente NULL) → no-op. Conferir PDF de
   controle especial + painel admin exibindo o CNPJ.

---

## 9. Aplicação em PRODUÇÃO — 2026-07-18 (concluída)

Migrations `0044`–`0050` aplicadas em **qoro-prod** na janela manual do founder
(`db:backup:prod` → `db:migrate:prod` → verificação → `unset`). Backup
pré-migration: `backups/prod-pre-migration-2026-07-18T15-16-44.sql`.

`_schema_version` (prod) passou a conter: `db-audit-rls-v2-least-privilege`,
`clinical-content-encrypt-add`, `clinical-content-encrypt-drop`,
`business-pii-encrypt-add`, `business-pii-encrypt-drop`,
`profiles-self-select-initplan`.

### Provas de catálogo em PROD (pós-aplicação)

| Prova | Antes | Prod agora |
|---|---|---|
| A14 — policies com helper de auth sem InitPlan | 57 (advisor) | **0** |
| A13 — privilégios de tabela de `anon` | 618 | **0** |
| A13 — default ACL do `public` com `anon` | `anon=arwdDxtm` | **ausente** |
| DML de `authenticated` (o `withTenant` depende) | — | **360, intacto** |
| A1 — colunas clínicas em claro | 5 | **nenhuma** |
| A8 — PII de negócio em claro | 2 | **nenhuma** |
| Policies totais (shape preservado) | 75 | **75** |
| Índices novos A6/N1 | — | **5/5** |

### Provas funcionais (o que catálogo não pega)

- **Login de super_admin em prod: OK.** É a prova que importa para a reescrita das
  65 policies de RLS — nenhum gate detectaria uma policy que bloqueia acesso.
- **Cadastro de paciente real em prod: OK.** Exercita `encryptForTenant` de ponta a
  ponta e prova que o backend de cripto está resolvido (`CRYPTO_SECRET_BACKEND=env`
  + chave nas env vars da Vercel). Login **não** provaria isso — ele usa
  `LOGIN_HASH_PEPPER`, caminho diferente. Antes deste teste o caminho de cripto
  **nunca tinha rodado em produção** (0 pacientes), o que o tornava o maior risco
  latente do PR3.

### Divergência de doc corrigida junto

A doc de ambiente e o runbook C5 afirmavam que produção usava **Google Secret
Manager**. **Não usa** — as chaves vivem nas env vars da Vercel com
`CRYPTO_SECRET_BACKEND=env`. Era ponteiro para infra inexistente (mesma classe do
"validation only in C13" e do cron dual-factor do ADR-011). Corrigido em
`development/environment.md` e `runbooks/c5-validation.md`, com o alerta de que a
env var da Vercel é hoje a **única cópia** de uma chave que agora protege o
prontuário.
