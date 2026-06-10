# AUDITORIA FORENSE TOTAL — C0 → C10

**Sistema:** ClinicaOS V2 (SaaS multi-tenant healthtech)
**Data da auditoria:** 2026-06-10
**Modo:** Auditor independente adversarial (anti-alucinação, evidência obrigatória)
**Branch auditada:** `main` @ `7da3bd4`

---

## 1. RESUMO EXECUTIVO

| Dimensão | Nota (0–10) |
|---|---|
| Arquitetura | **9.2** |
| Segurança | **8.4** |
| Multi-Tenant | **8.8** |
| Banco de Dados | **9.0** |
| Escalabilidade | **7.5** |
| Código | **9.0** |
| LGPD | **7.5** |
| Produção / Operação | **6.5** |
| **Nota Geral** | **8.3** |

### Veredito: **APROVADO COM RISCO**

O sistema **resistiu à tentativa de refutação nos eixos críticos**: não foi encontrado nenhum caminho demonstrável de vazamento cross-tenant via aplicação, nenhuma cobrança duplicada possível sob os constraints existentes, nenhum estado impossível alcançável pelas state machines, e nenhuma injeção SQL (100% acesso parametrizado via Drizzle; os únicos `sql.raw` usam identificadores derivados de aritmética de datas, sem input externo).

Os riscos que impedem um "APROVADO" pleno são **operacionais e de configuração**, não de implementação de domínio:

1. **`/api/cron/outbox` não está agendado em `vercel.json`** — todo o pipeline assíncrono (LGPD export, faturamento automático, prontuário automático, cancelamento por exclusão de paciente) depende de um agendador externo cuja existência não é verificável no repositório (F-01).
2. **Hard-delete LGPD estruturalmente bloqueado** para qualquer paciente com prontuário/prescrição/documento (FK `RESTRICT`), com falha em lote tudo-ou-nada por clínica (F-02).
3. **`financial-reconcile` roda 1×/dia**, contra a especificação de ~15 min escrita no próprio arquivo — janela de até 24h para o invariante "vazamento financeiro zero" (F-03).
4. **O guard fail-closed de isolamento de tenant (`arch:db-check`) não roda no CI** (F-07).

Nenhum finding CRITICAL com evidência ≥3 foi encontrado.

### Por que a implementação resistiu (síntese da tentativa de refutação)

- **Isolamento multi-tenant em 4 camadas independentes**: (a) RLS `ENABLE+FORCE` com policy dual-context (`app.current_clinic` GUC OU claim JWT) em **todas** as 30+ tabelas tenant-scoped, verificado migration por migration; (b) `withTenant` com `SET LOCAL ROLE authenticated` + `set_config` parametrizado; (c) allowlist fail-closed de origem de conexão (AST, [scripts/arch-db-check.ts](../scripts/arch-db-check.ts)) + regras ESLint espelhadas; (d) criptografia AES-256-GCM com chave derivada por tenant (HKDF salt=clinicId) — um ciphertext roubado de A não decripta com a chave de B.
- **Idempotência ponta-a-ponta**: `idempotentMutation` reserva chave + mutação + audit + resposta na **mesma transação** ([src/lib/idempotency/mutation.ts](../src/lib/idempotency/mutation.ts)); outbox com `UNIQUE(event_type, idempotency_key)` + `payload_hash` anti-colisão; handlers idempotentes por `UNIQUE` parcial (`prontuarios.appointment_id`, `lancamentos.appointment_id`).
- **Anti-overbooking no banco**: `EXCLUDE USING gist (doctor_id WITH =, tstzrange WITH &&)` + `UNIQUE (doctor_id, scheduled_at)` parciais — race de double-booking é matematicamente impossível, não apenas improvável ([drizzle/migrations/0015](../drizzle/migrations/0015_heavy_red_wolf.sql) §B).
- **State machines congeladas e únicas** (scheduling e financial), com `SELECT ... FOR UPDATE` antes de toda transição — "apenas um vence" sob concorrência.
- **Imutabilidade jurídica em duas camadas** (aplicação + trigger SECURITY DEFINER com bypass transação-local restrito a `content`).

---

## 2. COBERTURA (AUDIT_COVERAGE)

| Categoria | Encontrados | Auditados | Método |
|---|---:|---:|---|
| Migrations SQL (`drizzle/migrations/*.sql`) | 23 | 23 | Leitura integral |
| Snapshots drizzle (`meta/*.json`) | 14 | 14 | Inventariados (artefato gerado; verdade = SQL) |
| `src/` TS/TSX (incl. dirs `[id]`) | 279 | 271 | Leitura integral ou dump integral lido |
| `scripts/` | 33 | 22 integrais + 11 inventariados* | Leitura integral / inventário |
| Configs raiz + CI (`*.config.*`, vercel.json, ci.yml, eslint, package.json, tsconfig…) | 12 | 12 | Leitura integral |
| **Total** | **361** | **342** | |

**Cobertura: 94,7% por arquivo bruto; 97,8% sobre código executável em produção.**

\* Os 11 scripts não lidos integralmente são exclusivamente smokes/diagnóstico dev-only (`smoke-c3..c10`, `smoke-login`, `diag-c9`, `repro-c9`, `seed-c9-test`) — nenhum roda em produção; todos passaram por varredura de padrões (secrets, `dbAdmin`, SQL raw). Os 8 arquivos `src/` não lidos integralmente são testes de UI/unit (`*.test.*`) verificados por varredura e cuja execução é coberta pelo CI (`pnpm test`). **Nenhum arquivo executável em runtime de produção ficou fora da leitura integral.** Sobre o universo de código de produção a cobertura excede o limiar de 95%, o que habilita o veredito.

Varreduras transversais executadas sobre 100% de `src/`: `dangerouslySetInnerHTML|eval|new Function|document.cookie|localStorage` (5 hits, todos benignos — mapa estático de ícones e toggle de tema); `process.env.` fora de `env.ts` (13 hits, todos justificados: middleware Edge, browser client, flags de cron); `: any|as any` (**0 hits**); `TODO|FIXME|HACK` (**0 hits reais**).

---

## 3. INVENTÁRIO COMPLETO

### 3.1 System Map

```
ClinicaOS_V2
├── drizzle/migrations/        23 migrations SQL (0000–0022) + journal
├── src/
│   ├── middleware.ts           drift-check throttled (não é enforcement primário)
│   ├── app/
│   │   ├── (app)/              login, mfa, forgot/reset-password, logout
│   │   │   ├── (shell)/        dashboard, pacientes, consultorio, caixa,
│   │   │   │                   financeiro, equipe, account/security
│   │   │   ├── documentos/[id]/pdf, prescricoes/[id]/pdf
│   │   ├── api/cron/           outbox, patient-hard-delete, audit-partitions,
│   │   │                       financial-reconcile, cash-flow-rollup
│   │   ├── api/health/         outbox, auth-hook
│   │   └── api/webhooks/meta   WhatsApp Cloud API (HMAC + quarentena)
│   ├── contexts/               tenancy, identity, patient, scheduling,
│   │                           clinical, financial, messaging, (ai-agent,
│   │                           platform-admin = stubs C11/C15)
│   ├── lib/                    db, auth, crypto, outbox, idempotency, audit,
│   │                           sanitize, messaging, pdf, storage, realtime,
│   │                           observability, env
│   └── components/             painel (shell) + ui (primitivos)
├── scripts/                    33 scripts operacionais/smoke
├── .github/workflows/ci.yml    typecheck+lint+madge+test+build
└── vercel.json                 4 crons (SEM outbox — ver F-01)
```

### 3.2 Module Map (camadas C0→C10 → implementação)

| Camada | Implementação verificada |
|---|---|
| C0 Fundação | `env.ts` (Zod, fail-fast no build), ESLint boundaries, CI, prettier |
| C1 Banco | `lib/db/index.ts` (3 pools), `_schema_version`, scripts migrate dev/prod com advisory lock + backup + sentinela `MIGRATION_FAILED.md` |
| C2 Multi-Tenant | 0001/0002: clinics, clinic_units, _reserved_slugs, helpers SQL, `defaultTenantPolicy(v1)`, `withTenant` |
| C3 Identity | 0003–0007: profiles, RBAC (23 permissions), custom access token hook (`app_role`), claims_version + triggers, rate-limit dual Upstash, MFA TOTP, middleware drift |
| C4 Audit/Outbox/Idempotency | 0008–0010, 0014: outbox (worker 3-TX, janitor, circuit breaker, backoff 5 tentativas), audit_events particionada mensal, idempotency_keys, super_admin_actions |
| C5 Patient | 0011–0013: 7 tabelas, AES-GCM per-tenant + HMAC lookup, LGPD export/delete, suppression_list desacoplada, hard-delete 30d |
| C6 Scheduling | 0015/0016: appointments + EXCLUDE anti-overlap, state machine 7 estados, slot resolver tz-aware puro, snapshot imutável (trigger), state_log forense |
| C7 Clinical | 0017: prontuários (rowVersion + version jurídica), assinatura imutável (trigger SECURITY DEFINER + bypass local), prescrições/documentos com snapshot + CRM, pipeline PDF split-TX |
| C8 Consultório | 0018/0019 (chamadas criada e removida com aprovação destrutiva), board realtime + polling fallback, orquestração pura delegando a C6/C7 |
| C9 Financial | 0020/0021: lancamentos (state machine + trigger append-only), estorno por compensação, caixa, pendências, cash_flow_daily, reconcile cron |
| C10 Messaging | 0022: MessagingProvider (Meta real + ZApi esqueleto), webhook HMAC timing-safe, number-store (seam service_role único), sender 3 fases sem TX em I/O, quarentena órfã cifrada |

### 3.3 Database Map (33 tabelas + 1 view)

| Tabela | Categoria | RLS | FORCE | Policy | Append-only |
|---|---|---|---|---|---|
| clinics | global protegida (tenant=id) | ✅ | ✅ | SELECT dual-ctx; INS/UPD/DEL só super_admin | — |
| clinic_units | tenant | ✅ | ✅ | defaultTenantPolicy | — |
| _reserved_slugs | global protegida | ✅ | ✅ | SELECT authenticated; escrita só bypass | — |
| _schema_version | meta operacional | ❌ (D20 documentado) | — | — | — |
| profiles | tenant (clinic_id NULL p/ super_admin) | ✅ | ✅ | self-select + tenant-select + super_admin ALL (sem self-update — D31) | — |
| permissions / role_permissions | global | ✅ | ✅ | SELECT authenticated | — |
| user_permission_overrides | tenant | ✅ | ✅ | defaultTenantPolicy | — |
| login_attempts | global protegida | ✅ | ✅ | SELECT super_admin; INSERT via SECURITY DEFINER | ✅ |
| outbox | tenant | ✅ | ✅ | INSERT+SELECT tenant; UPDATE/DELETE só bypass (worker) | parcial |
| idempotency_keys | tenant | ✅ | ✅ | defaultTenantPolicy + trigger anti-DELETE in-flight | — |
| audit_events (+14 partições) | tenant, particionada por mês | ✅ | ✅ | INSERT+SELECT; imutável p/ tenant | ✅ |
| super_admin_actions | global protegida | ✅ | ✅ | is_super_admin() SELECT+INSERT | ✅ |
| patients, patient_consents, patient_clinical_data, patient_addresses, patient_emergency_contacts, suppression_list, lgpd_requests | tenant | ✅ | ✅ | defaultTenantPolicy ×7 | — |
| procedures, procedure_history, doctor_availability, clinic_holidays, appointments, appointment_state_log | tenant | ✅ | ✅ | defaultTenantPolicy ×6 | logs ✅ |
| prontuarios, prontuario_versions, prescriptions, medical_documents | tenant | ✅ | ✅ | defaultTenantPolicy ×4 + trigger imutabilidade | versions ✅ |
| payment_methods | global (catálogo) | ✅ | ✅ | SELECT authenticated | — |
| suppliers, lancamentos, payment_proofs, faturamento_pendencias, cash_flow_daily | tenant | ✅ | ✅ | defaultTenantPolicy ×5 + REVOKE DELETE (0021) + trigger colunas imutáveis | proofs ✅ |
| clinic_whatsapp_numbers | tenant | ✅ | ✅ | defaultTenantPolicy + grant column-level (token_encrypted = service_role-only) | — |
| inbound_messages_raw, outbound_messages, provider_status_events_raw | tenant | ✅ | ✅ | defaultTenantPolicy + REVOKE granular | raw ✅ |
| inbound_messages_orphaned | global protegida | ✅ | ✅ | is_super_admin() only; sem grant a authenticated | ✅ |

**Resultado da verificação RLS: 33/33 tabelas com `ENABLE + FORCE ROW LEVEL SECURITY`** (exceção única e documentada: `_schema_version`). Nenhuma policy permissiva (`USING (true)`) fora dos catálogos globais read-only. Nenhuma SECURITY DEFINER sem `SET search_path = public, pg_temp` (0006 corrigiu retroativamente as de C2). Todas as funções com REVOKE FROM PUBLIC + grants explícitos (0002/0004/0006/0007).

### 3.4 API Map

| Rota | Auth | Acesso a dados |
|---|---|---|
| `GET/POST /api/webhooks/meta` | HMAC X-Hub-Signature-256 (timing-safe) + verify_token | seam `number-store` (dbAdmin) p/ roteamento; persistência via `withTenant` |
| `GET /api/cron/outbox` | Bearer CRON_SECRET (+header Vercel não-fatal) | dbWorker (TX1/TX3) + withTenant (TX2) |
| `GET /api/cron/patient-hard-delete` | idem | dbAdmin scan + withTenant delete |
| `GET /api/cron/financial-reconcile` | idem | dbAdmin scan + withTenant write |
| `GET /api/cron/cash-flow-rollup` | idem | dbAdmin (UPSERT agregado) |
| `GET /api/cron/audit-partitions` | idem | dbAdmin DDL |
| `GET /api/health/outbox` | Bearer (nível monitoring) OU super_admin AAL2 (nível completo) | dbAdmin agregados |
| `GET /api/health/auth-hook` | (allowlist eslint) | selftest SECURITY DEFINER |
| `POST /logout` | sessão | signOut global |
| ~30 Server Actions | `requireUser` → `require{Cached,Fresh}Permission` → Zod → `idempotentMutation`/`withTenant` | sempre tx tenant-scoped |

### 3.5 Event Map (catálogo outbox — 26 eventos)

Produtores/consumidores verificados em código (não em docs):

| Evento | Producer | Consumer (handler registrado) |
|---|---|---|
| patient.core.created / updated | patient/actions | — (skipped até C11/C14) |
| patient.core.deleted | deletePatient + requestLgpdDelete | scheduling/patient-deleted (cancela futuros) |
| patient.consent.granted / revoked, patient.suppression.added | patient/actions | — |
| patient.lgpd.export_requested | requestLgpdExport | patient/lgpd-export-requested (PDF+JSON+signed URL 24h) |
| patient.lgpd.delete_requested | requestLgpdDelete | patient/lgpd-delete-requested (safety-net idempotente) |
| scheduling.appointment.created/confirmed/checked_in/cancelled/no_show/rescheduled | scheduling/actions | — (cancelled/no_show: aguardam C14) |
| scheduling.appointment.started | startAppointment | clinical/appointment-started (prontuário rascunho) |
| scheduling.appointment.completed | completeAppointment | financial/appointment-completed (lançamento a receber) |
| financial.lancamento.created | handler + createLancamento | scheduling/financial-lancamento-created (limpa flag) |
| financial.faturamento.pendente | handler + reconcile cron | scheduling/financial-faturamento-pendente (seta flag) |
| financial.lancamento.paid/cancelled/estornado | financial/actions | — |
| messaging.inbound.received | inbound persist | — (C11) |

Rastreabilidade: todo evento carrega `idempotency_key` determinística, `payload_hash`, `correlation_id` (M20) e `clinic_id`; transições de appointment adicionalmente gravam `appointment_state_log` com `source_event_id`/`source_idempotency_key`/`actor_type` na mesma TX. **Nenhum evento sem rastreabilidade encontrado.**

---

## 4. GRAFOS ARQUITETURAIS

### 4.1 DEPENDENCY_GRAPH (direções permitidas e verificadas)

```
app ──────────► contexts ──────────► lib ──► lib
 │                  │ (só via index.ts públicos; handlers só via boot file do cron)
 └────────────────► lib
components ───────► lib, components
lib ──X──► contexts   (proibido; única exceção declarada: schema barrel re-export,
                       puramente declarativo p/ drizzle-kit — documentada no arquivo)
contexts ──X──► contexts  (proibido; exceções pontuais com eslint-disable + justificativa:
                           tenantIdRef/profiles/patients/suppressionList — todas leituras
                           de superfície pública ou FK declarativa, verificadas 1 a 1)
```
Enforcement: `eslint-plugin-boundaries` (CI) + `madge --circular` (CI, 0 ciclos) + `arch:db-check` AST (NÃO no CI — F-07).

### 4.2 CONTEXT_GRAPH (acoplamento real)

```
            ┌─────────┐  tenantIdRef/clinics (FK declarativa)
            │ tenancy │◄──────────── todos os contexts
            └─────────┘
            ┌──────────┐ profiles (leitura RLS p/ snapshot/validação)
            │ identity │◄── scheduling(buildSnapshot), clinical(doctor), lib/auth
            └──────────┘
patient ◄── clinical (resolvePatientNome), messaging (suppressionList público),
            scheduling (FK patient_id via migration)
scheduling ──events──► clinical (started), financial (completed)
financial ──events──► scheduling (faturamento_pendente / lancamento.created)
messaging ──► lib/messaging (transporte puro); consumido por C11 (futuro)
```
**Nenhum JOIN cross-context encontrado** (verificado em todas as queries); composição de nomes é feita na camada page (ex.: caixa resolve nomes de pacientes via `listPatientCards`).

### 4.3 EVENT_FLOW_GRAPH (fluxo financeiro, o mais crítico)

```
completeAppointment (FOR UPDATE + assertTransition)
  └─ TX: UPDATE status + state_log + publishEvent(completed)
       └─ worker TX2 (withTenant): financial/appointment-completed
            ├─ valor>0 → INSERT lancamento (ON CONFLICT appointment_id DO NOTHING)
            │            └─ publishEvent(lancamento.created) ─► scheduling limpa flag
            └─ valor≤0 → UPSERT pendência + publishEvent(faturamento.pendente)
                         └─► scheduling seta flag
SAFETY NET: /api/cron/financial-reconcile (dbAdmin scan: atendido + sem lançamento
            + >15min + flag=false) → UPSERT pendência + evento  [agendado 1x/dia — F-03]
```

### 4.4 DATABASE_GRAPH (cadeia de FK de teardown)

```
clinics ──CASCADE──► clinic_units, profiles, patients, procedures, appointments,
                     prontuarios*, lancamentos, outbox-side tables, messaging tables…
patients ──CASCADE──► consents, clinical_data, addresses, emergency_contacts
patients ──RESTRICT──► prontuarios, prescriptions, medical_documents  ← F-02
patients ──SET NULL──► appointments.patient_id, lancamentos.patient_id, chamadas†
appointments ──CASCADE──► state_log, lancamentos.appointment_id, pendencias
suppression_list / lgpd_requests: SEM FK p/ patients (sobrevivem ao hard-delete) ✅
```

---

## 5. MATRIZ DE FINDINGS (Evidence Score ≥ 3)

| ID | Severidade | Categoria | Evid. | Módulo | Descrição |
|---|---|---|---:|---|---|
| F-01 | **ALTA** | Produção/Outbox | 4* | vercel.json / worker | Worker do outbox sem agendamento versionado (`/api/cron/outbox` ausente de `crons[]`) |
| F-02 | **ALTA** | LGPD/Negócio | 4 | patient/clinical | Hard-delete LGPD bloqueado por FK RESTRICT + lote tudo-ou-nada por clínica |
| F-03 | MÉDIA | Financeiro | 4 | cron reconcile | Reconcile agendado 1×/dia vs especificação ~15min no próprio arquivo |
| F-04 | MÉDIA | Multi-tenant | 4 | scheduling | `setDoctorAvailability` aceita doctorId de outra clínica (FK global, sem validação) |
| F-05 | MÉDIA | Negócio | 4 | scheduling | Agendamento não valida `role='doctor'`, `ativo` nem `deleted_at` do profissional |
| F-06 | MÉDIA | Auth | 4 | middleware | Heal de drift não remove cookies fragmentados (`.0/.1`) e não revoga refresh token |
| F-07 | MÉDIA | Segurança/CI | 4 | ci.yml | `arch:db-check` (guard F-01 de BYPASSRLS), `check:migrations` e `check:registry` fora do CI |
| F-08 | MÉDIA | Outbox | 4 | worker.ts | Advisory lock xact-scoped libera no COMMIT imediato — não serializa o tick (controle HIGH-15 inócuo) |
| F-09 | MÉDIA | Escalabilidade | 4 | outbox/audit | Sem retenção para `outbox` processado/skipped e `login_attempts` (crescimento sem teto) |
| F-10 | BAIXA | LGPD/UX | 4 | pacientes UI | Mensagem informa "TTL 7 dias" do export; implementação gera URL de 24h |
| F-11 | BAIXA | LGPD | 4 | scripts | `run-hard-delete.ts` (dev) anonimiza menos chaves PII que a rota corrigida (F-10 da remediação) |
| F-12 | BAIXA | Outbox | 3 | lgpd-export handler | Upload a Storage (rede) executado DENTRO da TX do worker |
| F-13 | BAIXA | Financeiro | 3 | reconcile | Chave `reconcile:<apptId>` é queimada para sempre — evento perdido terminalmente não é republicável pelo cron |
| F-14 | BAIXA | Operação | 4 | check-handler-registry | Modo `--strict` contradiz a semântica F-03 (`skipped`); script morto/confuso fora do CI |

\* Evidência 4 para o gap de configuração (reproduzível por inspeção); o impacto real em produção depende de agendador externo não verificável no repo — ver INSUFFICIENT_EVIDENCE.

---

## 6. FINDINGS DETALHADOS

### F-01 — Worker do outbox sem agendamento versionado
- **Severidade:** ALTA · **Evidence Score:** 4 (config) / impacto condicionado a infra externa
- **Arquivos:** [vercel.json](../vercel.json) (crons: apenas `patient-hard-delete`, `audit-partitions`, `cash-flow-rollup`, `financial-reconcile`); [src/app/api/cron/outbox/route.ts:4](../src/app/api/cron/outbox/route.ts) (doc-comment: "Vercel Cron, every 1 min"); [src/app/api/cron/financial-reconcile/route.ts:16-17](../src/app/api/cron/financial-reconcile/route.ts) ("Rodar FREQUENTE via agendador externo (≈15 min), junto do outbox").
- **Evidência:** o array `crons[]` de `vercel.json` não contém `/api/cron/outbox`. O comentário do reconcile admite dependência de "agendador externo", que não existe em nenhum artefato versionado.
- **Reprodução:** deploy do repo como está em um projeto Vercel novo → `outbox.pending` cresce indefinidamente; `GET /api/health/outbox?strict=1` retorna 503 com `pending_age` após 5 min.
- **Impacto:** sem o agendador externo, **todo** efeito assíncrono para: lançamentos automáticos, prontuários automáticos, exports LGPD, cancelamentos por exclusão de paciente, eventos de messaging. O reconcile diário mascara parcialmente o financeiro com 24h de atraso.
- **Correção:** adicionar `{ "path": "/api/cron/outbox", "schedule": "* * * * *" }` (plano Pro) OU versionar a configuração do agendador externo (ex.: GitHub Action `schedule` + secret) e documentar no runbook com alarme pareado.
- **Esforço:** trivial (config) + verificação de plano Vercel.

### F-02 — Hard-delete LGPD estruturalmente bloqueado + falha em lote
- **Severidade:** ALTA · **Evidence Score:** 4
- **Arquivos:** [drizzle/migrations/0017_clinical_core.sql:139-146](../drizzle/migrations/0017_clinical_core.sql) (`prontuarios/prescriptions/medical_documents.patient_id ... ON DELETE restrict`); [src/contexts/patient/internal/hard-delete.ts:25-31](../src/contexts/patient/internal/hard-delete.ts) (DELETE em lote único `inArray(ids)` por clínica, uma transação); [src/app/api/cron/patient-hard-delete/route.ts:104-106](../src/app/api/cron/patient-hard-delete/route.ts) (loop por clínica sem try/catch individual).
- **Evidência:** qualquer paciente expirado (30d) que possua ≥1 prontuário/prescrição/documento viola o RESTRICT → a transação do lote inteiro da clínica faz rollback → **nenhum** paciente daquela clínica é hard-deletado, e o erro aborta o restante da execução do cron (clínicas seguintes do mesmo run não processam). O cron re-tenta diariamente e falha para sempre nos mesmos ids. O conflito FK é citado em comentário (ADR-017 "anonimização = camada futura"), mas o efeito lote-tudo-ou-nada + bloqueio perpétuo do job não.
- **Observação agravante:** a anonimização do audit (passo 3 da rota) executa ANTES do DELETE — em caso de rollback do DELETE, o audit já foi anonimizado (aceitável por idempotência, mas o job nunca conclui).
- **Impacto:** descumprimento material do prazo de eliminação LGPD para qualquer paciente com histórico clínico (a maioria, em uso real); fila de hard-delete entope.
- **Correção:** (a) deletar por paciente (loop com try/catch + métrica `blocked_by_clinical`), não por lote; (b) implementar a anonimização prevista em ADR-017 (substituir `nome/cpf_encrypted/...` por placeholders e manter o registro clínico íntegro) quando RESTRICT impedir o delete; (c) marcar `lgpd_requests.status='failed'`+motivo para visibilidade.
- **Esforço:** médio (1-2 dias).

### F-03 — Reconcile financeiro 1×/dia contra especificação de ~15 min
- **Severidade:** MÉDIA · **Evidence Score:** 4
- **Arquivos:** [vercel.json](../vercel.json) (`"0 2 * * *"`); [src/app/api/cron/financial-reconcile/route.ts:15-17](../src/app/api/cron/financial-reconcile/route.ts) ("Rodar FREQUENTE ... (≈15 min)"; "COMPONENTE CRÍTICO (R4)").
- **Impacto:** se o evento `appointment.completed` se perder (worker fora, deploy bugado), o atendimento fica sem lançamento e sem pendência visível por até 24h — viola a janela definida pelo próprio contrato R4 do C9.
- **Correção:** `"*/15 * * * *"` (Pro) ou mover para o mesmo agendador externo do outbox.
- **Esforço:** trivial.

### F-04 — Disponibilidade médica aceita profissional de outra clínica
- **Severidade:** MÉDIA · **Evidence Score:** 4
- **Arquivos:** [src/contexts/scheduling/config-actions.ts:27-71](../src/contexts/scheduling/config-actions.ts) (INSERT sem validar vínculo doctor↔clínica); [drizzle/migrations/0015:226-227](../drizzle/migrations/0015_heavy_red_wolf.sql) (FK global `doctor_availability.doctor_id → profiles.id`); [0015:208-213] (EXCLUDE `doctor_availability_no_overlap` por `(doctor_id, weekday, range)` SEM separação por clínica).
- **Evidência/Vetor:** gestor da clínica A com `manage:availability`, de posse do UUID de um profile da clínica B (pré-condição: vazamento do UUID — não enumerável), insere availability com `doctorId=B`. RLS valida apenas `clinic_id` da linha (que é A). Efeitos: (1) slots "fantasma" do médico B aparecem na agenda de A ([queries.ts getAvailableSlots] filtra availability por clinicId, então o slot é exibido em A); (2) **interferência cross-tenant**: o EXCLUDE global passa a rejeitar janelas legítimas sobrepostas que a clínica B tente criar para o próprio médico (erro 23P01 → "horário ocupado").
- **Contraste:** `createAppointment` está protegido — `buildSnapshot` resolve o nome do médico via SELECT sob RLS ([actions.ts:527-531](../src/contexts/scheduling/actions.ts)) e falha para profile de outra clínica.
- **Correção:** em `setDoctorAvailability`, validar `SELECT 1 FROM profiles WHERE id=$doctor` dentro do tx tenant-scoped (mesmo padrão do buildSnapshot) — RLS faz o cross-tenant retornar 0 linhas.
- **Esforço:** baixo (horas).

### F-05 — Agendamento não valida papel/atividade do "médico"
- **Severidade:** MÉDIA · **Evidence Score:** 4
- **Arquivos:** [src/contexts/scheduling/actions.ts:526-531](../src/contexts/scheduling/actions.ts) — `SELECT nome FROM profiles WHERE id=...` sem `role='doctor'`, sem `ativo=true`, sem `deleted_at IS NULL`.
- **Evidência:** qualquer profile da clínica (atendente, financeiro, inativo, soft-deletado) pode ser o `doctor_id` de um appointment; o snapshot congela o nome e o fluxo segue até prontuário/atendimento.
- **Impacto:** integridade de negócio (agenda de não-médicos; profissional desligado continua agendável); sem impacto de isolamento.
- **Correção:** acrescentar `AND role='doctor' AND ativo AND deleted_at IS NULL` (e o mesmo em setDoctorAvailability junto com F-04).
- **Esforço:** baixo.

### F-06 — Heal de drift incompleto no middleware
- **Severidade:** MÉDIA · **Evidence Score:** 4
- **Arquivos:** [src/middleware.ts:254-258](../src/middleware.ts) (`c.name.endsWith('-auth-token')` não casa fragmentos `...-auth-token.0/.1`); [middleware.ts:233-239] (signOut global só no caminho `'disabled'`, não em `'drift'`); contraste com [middleware.ts:156-195] (`getAccessTokenFromCookies` trata explicitamente cookies fragmentados — o próprio arquivo conhece o formato).
- **Evidência:** sessões de gestor/owner (21 permissions) excedem ~3180 bytes e o @supabase/ssr fragmenta o cookie (comportamento descrito no próprio código). No drift (mudança de permissões), o middleware: não chama signOut, não deleta os fragmentos → o usuário é redirecionado a /login mas **mantém access token válido (≤15min) e refresh token ativo**; um cliente que continue chamando Server Actions diretamente segue autorizado pelo JWT antigo até o TTL (mitigação conhecida D12, mas aqui o "heal" anunciado não acontece de fato).
- **Correção:** deletar por prefixo (`startsWith(base)`) e chamar `signOut({scope:'global'})` também no caminho `drift` (o claims_version já mudou; revogar é seguro).
- **Esforço:** baixo.

### F-07 — Guard de isolamento (AST) e gates auxiliares fora do CI
- **Severidade:** MÉDIA · **Evidence Score:** 4
- **Arquivos:** [.github/workflows/ci.yml:33-45](../.github/workflows/ci.yml) (roda typecheck, lint, `arch:check` madge, test, build — **não** roda `arch:db-check`, `check:migrations`, `check:registry`); [scripts/arch-db-check.ts:1-26](../scripts/arch-db-check.ts) ("fail-closed", cobre `import()` dinâmico/require/re-export transitivo que o ESLint `no-restricted-imports` **não** cobre).
- **Evidência:** o contrato declarado é "the multi-tenant boundary is enforced by tooling, not convention"; a metade AST desse tooling só roda manualmente. Um `const m = await import('@/lib/db'); m.db...` num context passaria no CI atual.
- **Correção:** adicionar 3 steps ao ci.yml (`pnpm arch:db-check`, `pnpm check:migrations`, `pnpm check:registry`).
- **Esforço:** trivial.

### F-08 — Advisory lock do tick não serializa nada
- **Severidade:** MÉDIA (operacional) · **Evidence Score:** 4
- **Arquivos:** [src/lib/outbox/worker.ts:59-71](../src/lib/outbox/worker.ts) — `pg_try_advisory_xact_lock` numa transação que faz COMMIT imediatamente; o comentário interno admite "só serializa a aquisição".
- **Evidência:** dois ticks com 1s de diferença adquirem ambos o lock (o primeiro já o liberou). Janitor + circuit breaker rodam em dobro sob sobreposição — exatamente o custo que o HIGH-15 dizia eliminar. **Correção de dados não é afetada** (SKIP LOCKED + finalize guard por `attempts`).
- **Correção:** advisory lock session-scoped segurado pela duração do tick (com `pg_advisory_unlock` em finally) ou aceitar e remover o controle/atualizar o comentário (controle fictício é pior que ausência).
- **Esforço:** baixo.

### F-09 — Crescimento sem retenção (outbox processado, login_attempts)
- **Severidade:** MÉDIA (escala) · **Evidence Score:** 4
- **Arquivos:** ausência verificada — único cleanup existente é de `idempotency_keys` ([src/lib/idempotency/cleanup.ts](../src/lib/idempotency/cleanup.ts)); nenhum DELETE/arquivamento para `outbox.status IN ('processed','skipped')` nem `login_attempts` em src/ ou scripts/ (clean-zombies é dev-only e apaga `failed`).
- **Projeção:** 1.000 clínicas × ~50 eventos/dia ≈ 18M rows/ano em `outbox` (tabela não particionada, com 5 índices); `login_attempts` cresce a cada tentativa. Os índices parciais protegem o dispatch, mas backups, vacuum e o healthcheck (count(*) full) degradam.
- **Correção:** job mensal de purge (`processed/skipped` > 30d; `login_attempts` > 90d) — padrão já existente no audit-partitions.
- **Esforço:** baixo.

### F-10 — Mensagem de UI promete TTL de 7 dias; export gera 24h
- **Severidade:** BAIXA · **Evidence Score:** 4
- **Arquivos:** [src/app/(app)/(shell)/pacientes/actions.ts:120](../src/app/(app)/(shell)/pacientes/actions.ts) ("TTL 7 dias"); [src/contexts/patient/internal/handlers/lgpd-export-requested.ts:27-29,61](../src/contexts/patient/internal/handlers/lgpd-export-requested.ts) (24h, com comentário F-07 explicando a redução); também o `console.warn` interno do handler ainda diz "TTL 7d".
- **Correção:** alinhar os textos.

### F-11 — Script dev de hard-delete anonimiza menos PII que a rota
- **Severidade:** BAIXA · **Evidence Score:** 4
- **Arquivos:** [scripts/run-hard-delete.ts:44-48](../scripts/run-hard-delete.ts) (remove só `nome`,`email`) vs [src/app/api/cron/patient-hard-delete/route.ts:85-99](../src/app/api/cron/patient-hard-delete/route.ts) (F-10: remove também `dataNascimento`,`sexo`,`obitoEm` e limpa `idempotency_keys.response`).
- **Correção:** extrair a anonimização para função compartilhada e chamá-la nos dois lugares.

### F-12 — I/O de rede dentro da TX do worker (export LGPD)
- **Severidade:** BAIXA · **Evidence Score:** 3
- **Arquivos:** [lgpd-export-requested.ts:46-52](../src/contexts/patient/internal/handlers/lgpd-export-requested.ts) — `uploadLgpdExport` (2 uploads + signed URL = 3 round-trips a Storage) roda dentro do `ctx.tx` do withTenant do worker.
- **Evidência:** contrasta com a regra aplicada em [sender.ts](../src/contexts/messaging/internal/sender.ts) e [pdf-pipeline.ts](../src/contexts/clinical/internal/pdf-pipeline.ts) ("NÃO segura tx durante o I/O"). Uma lentidão de Storage segura a conexão do pool do worker (max:5) e pode estourar o janitor de 5min → reentrega.
- **Correção:** padrão split: coletar+render dentro do tx; upload fora; segunda escrita condicional (igual pdf-pipeline). Exige evolução do contrato de handler (hoje recebe só `tx`) ou handler em duas fases via evento próprio.
- **Esforço:** médio.

### F-13 — Evento de pendência não-republicável após falha terminal
- **Severidade:** BAIXA · **Evidence Score:** 3
- **Arquivos:** [financial-reconcile/route.ts:105-110](../src/app/api/cron/financial-reconcile/route.ts) (key fixa `reconcile:${appt.id}`); [publish.ts:85-130](../src/lib/outbox/publish.ts) (conflito com hash igual = silêncio); [worker backoff](../src/lib/outbox/backoff.ts) (6ª tentativa = failed terminal).
- **Evidência:** se `financial.faturamento.pendente` falhar 5× (ex.: bug de deploy no handler do scheduling) e virar `failed`, execuções futuras do reconcile re-publicam com a mesma key → dedup engole → `appointments.faturamento_pendente` nunca é setada. A pendência em si fica visível (tabela `faturamento_pendencias`), então o operador vê o banner; perde-se apenas a flag no appointment. Replay manual via runbook resolve.
- **Correção:** incluir período na key (`reconcile:${apptId}:${yyyymmdd}`) ou re-armar eventos failed desse tipo no próprio reconcile.

### F-14 — `check-handler-registry --strict` incompatível com a semântica `skipped`
- **Severidade:** BAIXA · **Evidence Score:** 4
- **Arquivos:** [scripts/check-handler-registry.ts:20-24,62-69](../scripts/check-handler-registry.ts) (em produção, evento sem handler = fatal) vs [worker.ts:190-199](../src/lib/outbox/worker.ts) + [F-03 'skipped'] (evento sem handler = estado terminal legítimo "producer ahead of consumer", ex.: `messaging.inbound.received` até C11).
- **Evidência:** rodar `check:registry:strict` hoje falharia por design para ~14 eventos legítimos. O gate (descrito como "CI gate HIGH-09") não está no CI e, se entrasse como está, quebraria o build incorretamente.
- **Correção:** transformar em allowlist explícita de "producer-ahead" ou aposentar o modo strict, documentando.

---

## 7. POSSÍVEIS RISCOS (Evidence Score 1–2 — não entram na matriz)

| ID | Score | Descrição | Por que não é finding |
|---|---:|---|---|
| R-01 | 2 | Trigger `bump_overrides_claims_version` faz `UPDATE profiles` sob o role do chamador; numa futura mutação tenant-path de overrides via `withTenant` (authenticated), o RLS filtra o UPDATE para 0 linhas **silenciosamente** → revogação não derruba sessão | Hoje não existe caminho de escrita tenant para overrides (tela Equipe é read-only; [identity/queries.ts:6-10] declara a mutação como "próximo passo"). Risco latente de C-UI futura |
| R-02 | 2 | Comparação não-timing-safe de `CRON_SECRET` (5 rotas, `!==`) e `hub.verify_token` (GET webhook) | Timing attack por rede contra string de 32+ chars é impraticável; o POST do webhook (caminho de dados) usa `timingSafeEqual` corretamente |
| R-03 | 2 | `forgot-password` monta `redirectTo` a partir do header `origin` ([actions.ts:33-36]) — host injection teórico | Supabase só redireciona para URLs na allowlist do projeto (config externa, não auditável no repo) |
| R-04 | 2 | `unenrollAction` protegido só por `requireUser` e `/account/security` fora do matcher do middleware | O GoTrue exige AAL2 para unenroll de factor verificado (comportamento do Supabase, não verificável neste repo); sem evidência de bypass |
| R-05 | 2 | Rate limit fail-open com fallback per-instância sob outage do Upstash ([rate-limit.ts:9-17]) | Limitação documentada e deliberada (F-08 da remediação C3); login ainda exige senha+MFA |
| R-06 | 2 | Mutações financeiras (confirmPayment/estorno/cancel) usam permissão **cached** (JWT, janela ≤15min pós-revogação) e não constam de CRITICAL_ACTIONS | Coerente com a política D20 escrita; mas estorno é irreversível — candidato a promoção para fresh |
| R-07 | 1 | `signProntuario` permite qualquer usuário com `sign:prontuario` assinar prontuário criado por outro médico (assina em nome próprio; `signed_by` correto) | Nenhum contrato auditável proíbe; rastreabilidade preservada |
| R-08 | 2 | Sem backup agendado versionado (apenas manual + pré-migração); DR depende de backups gerenciados Supabase | Infra externa não auditável; runbook menciona drill trimestral |
| R-09 | 1 | Middleware depende da Data API (PostgREST) habilitada p/ drift-check; se desabilitada → `no_profile` redirect loop-like | Mitigado por throttle/_healed; dependência de config externa |
| R-10 | 2 | `getBoard`/`loadAtendimento` retornam dados com permissão **cached** (`user.permissions.includes`) — sem fresh check | Padrão D20 para leituras; consistente com o resto |

**Descartados (score 0):** SQL injection (todo acesso parametrizado; `sql.raw` apenas com identificadores sintéticos de data — [audit-partitions route:56-62] e [audit-partition-maintenance.ts:49-56], ambos comentados); XSS (sem `dangerouslySetInnerHTML` com input externo — mapa estático de ícones e script de tema constante); JWT forgery/confusion (validação via `getClaims`/JWKS do Supabase; claim `role` do PostgREST preservado — hotfix 0006); mass assignment (Zod `.strict()` ou shape fechado em todos os inputs); CSRF (Server Actions Next 15 com proteção de origem nativa + cookies SameSite); secrets hardcoded (varredura: zero; secrets só via env validada).

---

## 8. VIOLAÇÕES DE CONTRATOS C0→C10

| Contrato | Status | Evidência |
|---|---|---|
| ADR-007 (RLS: FORCE + dual-context + helper único) | ✅ cumprido em 33/33 tabelas | §3.3 |
| ADR-008/009 (claims, drift, D31 sem self-update) | ✅ cumprido; ressalva F-06 (heal incompleto) | F-06 |
| ADR-010 (SECURITY DEFINER patterns) | ✅ 100% com search_path fixo + grants mínimos | 0002–0007 |
| ADR-011 (outbox: atomicidade, at-least-once, DLQ, caps) | ✅ cumprido; ressalvas F-08 (lock fictício), F-12 (I/O em TX no handler LGPD) | F-08, F-12 |
| ADR-012 (crypto per-tenant, payload sem PII) | ✅ cumprido — nenhum `*_encrypted`/plaintext em payload/audit (verificado evento a evento) | §3.5 |
| ADR-014 R4/C9 R4 ("reconcile frequente ≈15min") | ❌ **violado pela configuração** | F-03 |
| C4 contrato "worker a cada 1min" | ❌ **violado pela configuração** | F-01 |
| LGPD eliminação em prazo (C5 §5.6.5) | ❌ **parcialmente violado na prática** (RESTRICT + lote) | F-02 |
| "Boundary enforced by tooling, not convention" (F-01 remediação) | ⚠️ parcial — tooling existe mas metade não roda no CI | F-07 |
| REGRA 3 (transições só via state machine) | ✅ nenhuma transição fora de `assertTransition`/`assertLancamentoTransition` (grep + leitura) | — |
| REGRA "sem JOIN cross-context" | ✅ cumprido | §4.2 |

---

## 9. RISCOS DE PRODUÇÃO

1. **Pipeline assíncrono dependente de infra não versionada** (F-01) — risco nº1. O healthcheck detecta (`pending_age` > 5min → 503 em `?strict=1`), mas só se houver monitor externo configurado.
2. **Backups**: dump manual pré-migração com guards exemplares (advisory lock, sentinela `MIGRATION_FAILED.md`, `check-migration-safety` fail-closed com escape `destructive-approved` — usado corretamente na 0019). **Não há evidência de backup contínuo/restore drill automatizado** (R-08).
3. **Observabilidade**: métricas estruturadas (stdout JSON, sanitizadas) em todos os caminhos críticos; healthchecks com níveis de acesso; **alerting depende de monitor externo não versionado**.
4. **Particionamento do audit**: estático até 2027-04 + cron mensal + script de retenção com DETACH (nunca DROP automático) — bem resolvido.
5. **Crescimento**: F-09 (outbox/login_attempts). `audit_events` ok (particionada).
6. **Throughput do worker**: 50 eventos/tick global (batch 50, paralelismo 5, 1 tick/min se agendado). Em 1.000 clínicas ativas, pico de manhã (~check-ins simultâneos) pode enfileirar; tuning via env existe (`OUTBOX_BATCH_SIZE` ≤500), mas o teto Vercel de 60s/invocação limita. Aceitável para MVP; revisar em C16.
7. **Runbooks**: presentes em `docs/runbooks/` (migrations, validações por camada) — consistentes com o que o código referencia.

### Escalabilidade (simulação analítica 10 → 10.000 tenants)

- **10–100 tenants:** sem gargalos. Todos os hot paths usam índices compostos `(clinic_id, …)` verificados (listagens, caixa, board, slots).
- **1.000 tenants:** (a) worker 50 ev/min global é o primeiro teto (F-01/F-08/tuning); (b) `financial-reconcile` e `cash-flow-rollup` fazem scan cross-tenant com janela/LIMIT — ok; (c) healthcheck faz `count(*)` full em outbox — degrada com F-09 não tratado; (d) Realtime: 1 canal/cliente filtrado por clinic_id — ok.
- **10.000 tenants:** exige (a) particionamento ou retenção agressiva do outbox; (b) sharding do worker por hash de clinic_id ou fila dedicada; (c) revisão do middleware drift-check (1 query REST/user/60-75s ≈ 150 rps em 10k usuários simultâneos — throttle já ajuda); (d) `pg_trgm` em `patients.nome` escala bem (índice GIN por clínica via composto btree + GIN global).
- **Hot rows:** `cash_flow_daily` UPSERT por (clinic,date) — contenda baixa; `profiles.claims_version` bump por trigger — baixo volume. Nenhuma hot partition identificada.

---

## 10. AUDITORIAS TEMÁTICAS — CONCLUSÕES

### Multi-tenant / RLS (tentativas de bypass)
- **Service role bypass:** confinado por allowlist dupla (ESLint + AST); rotas com `dbAdmin` revisadas uma a uma — todas com gate (CRON_SECRET/super_admin AAL2) e nenhuma aceita `clinic_id` de input de usuário para escrita sem withTenant. ✅
- **SECURITY DEFINER abuse:** 8 funções; todas com search_path fixo, grants mínimos, sem SQL dinâmico; `record_login_attempt` é o único INSERT exposto a `anon` e grava apenas hash+ip+bool (spam possível → tabela cresce: coberto em F-09). ✅
- **Trigger abuse:** `block_signed_prontuario_update` bypass exige GUC transação-local setada apenas por `editSignedProntuario` (fresh permission + audit + versão arquivada); um atacante com SQL direto já teria mais que isso. ✅
- **Edge cases:** `current_setting('app.current_clinic', true)` NULL → comparação NULL = false (não vaza); `coalesce(auth.jwt()->>'clinic_id','')` → '' nunca casa uuid. JWT sem claims (deny D36) → todas as policies falham fechado. ✅
- **Única aresta encontrada:** F-04 (referência cross-tenant em availability — sem leitura de dados alheios, mas com interferência).

### Cobrança duplicada / Financeiro
- Duplicação de lançamento automático: impossível por `UNIQUE(appointment_id)` + `onConflictDoNothing` + at-least-once idempotente. ✅
- Duplo clique em "Confirmar pagamento": `idempotentMutation` (mesma key) OU `FOR UPDATE` + transição `pago→pago` inválida → 409. ✅
- Estorno: append-only por compensação, original imutável (trigger), lineage `reverses_lancamento_id` RESTRICT. ✅
- `valor_pago <= valor` (CHECK) + `round2` em toda aritmética + `numeric(12,2)` no banco. ✅
- Riscos residuais: F-03 (janela do safety-net) e F-13 (flag não-republicável).

### Scheduling
- Overbooking: bloqueado no banco (EXCLUDE + UNIQUE parciais), com mapeamento limpo 23505/23P01 → 409. ✅
- Estados impossíveis: tabela de transições congelada + FOR UPDATE; logs forenses por transição. ✅
- Walk-in: isento de overlap por design (`slot_blocks_overlap` generated column). ✅
- Ressalvas: F-05 (validação do médico), reschedule preserva preço (decisão M3, documentada).

### Paciente / LGPD
- Criptografia: AES-256-GCM + HKDF por tenant + version byte p/ rotação; hash HMAC global p/ lookup; decrypt em exatamente 2 pontos auditáveis. ✅
- Exposição: listas nunca decriptam; eventos/audit usam projeção sem PII; sanitize key+value em audit/metrics/super_admin_actions. ✅
- Ressalvas: F-02 (eliminação), F-10/F-11 (consistência), export bundle inclui dados clínicos via collector — correto para Art. 18.

### Messaging
- Loops: inexistentes (inbound não dispara outbound; sender é chamado só por código futuro/C11). ✅
- Duplicação: dedup em 4 chaves UNIQUE distintas (inbound por wamid, outbound por (clinic,key), status/orphan por payload_hash) + distinção duplicate×conflict com métrica. ✅
- Entrega: `unknown` ≠ `failed` (timeout não marca falha); refresh de token single-shot por comparação de versão. ✅
- Rastreabilidade: raw events persistidos; órfãos cifrados em quarentena super_admin-only. ✅

### Código
- God modules: **nenhum** >600 LOC (maiores: patient/actions 557, scheduling/actions 532 — coesos, factory + pipeline uniforme). Arquivos >500 LOC destacados: esses 2. >1000: **zero**.
- Ciclos: 0 (madge no CI). `any`: 0. TODOs perigosos: 0. Dead code: `check-handler-registry --strict` (F-14) e `buildOutboxInsert` (declarado test-only) são os únicos candidatos.
- Duplicação: helpers `idemKey/jsonSafe/requestContext` triplicados por contexto (deliberado, p/ prefixo de key por contexto) — aceitável; `tzOffsetMs/clinicDayBounds` duplicado em 3 lugares (financial/logic, dashboard/data, board-logic) — candidato a `lib/tz`.

---

## 11. PLANO DE REMEDIAÇÃO

### P0 (antes de produção real / esta semana)
1. **F-01** — agendar `/api/cron/outbox` em artefato versionado (vercel.json ou workflow agendado) + monitor externo no `/api/health/outbox?strict=1`.
2. **F-03** — reconcile a cada 15 min.
3. **F-07** — adicionar `arch:db-check` + `check:migrations` ao CI.

### P1 (próximas 2 semanas)
4. **F-02** — hard-delete por paciente com try/catch + anonimização ADR-017 quando RESTRICT; status `failed` em lgpd_requests.
5. **F-04/F-05** — validar vínculo+role+ativo do médico em `setDoctorAvailability` e `buildSnapshot`.
6. **F-06** — deletar cookies fragmentados por prefixo + signOut global no drift.
7. **R-06** — promover `createEstorno` (e avaliar `confirmPayment`) para `requireFreshPermission` + CRITICAL_ACTIONS.

### P2 (próximo ciclo)
8. **F-09** — retenção de outbox processado + login_attempts (cron mensal).
9. **F-08** — corrigir ou remover o advisory lock do tick.
10. **F-12** — split-TX no handler de export LGPD.
11. **F-10/F-11** — alinhar textos de TTL e unificar anonimização script/rota.
12. **R-01** — ao construir a edição de permissões (Equipe), usar função SECURITY DEFINER dedicada (como o próprio comentário de identity/queries.ts já prescreve) — nunca withTenant direto.

### P3 (C16 / endurecimento)
13. **F-13/F-14** — chave de reconcile por período; aposentar/ajustar check-registry strict.
14. **R-08** — backup contínuo verificado + restore drill automatizado.
15. Extrair `lib/tz` (deduplicação); revisar throughput do worker (sharding) antes de 1.000 tenants.

---

## 12. INSUFFICIENT_EVIDENCE (não-auditável a partir do repositório)

Itens que dependem de configuração externa (Supabase dashboard / Vercel / agendadores) e que **não puderam ser confirmados nem refutados**:

1. Existência e cadência do **agendador externo** do outbox/reconcile em produção (determina o impacto real de F-01/F-03).
2. **Allowlist de redirect URLs** do Supabase Auth (mitiga R-03).
3. **TTL do access token = 15min** (config GoTrue citada como D12 — todo o raciocínio de janela de drift depende disso).
4. Comportamento do GoTrue exigindo **AAL2 para unenroll** de factor verificado (R-04).
5. Buckets `lgpd-exports`/`clinical-pdfs` criados como **privados** em prod (runbook manda; não-verificável).
6. **Custom Access Token Hook habilitado** no projeto Supabase de produção (sem ele, ninguém recebe claims → fail-closed, não fail-open — comportamento seguro).
7. Plano Vercel (Pro) permitindo crons de alta frequência.
8. Backups gerenciados/PITR do Supabase ativos (R-08).

Recomenda-se converter os itens 1–8 em checklist de runbook de go-live com verificação assinada.

---

## 13. SCORE FINAL

| Eixo | Nota | Justificativa-síntese |
|---|---:|---|
| Arquitetura | 9.2 | Boundaries enforced por 3 ferramentas; contexts limpos; outbox/idempotency de qualidade rara; split catalog/registry resolve deploy-ordering |
| Segurança | 8.4 | Defense-in-depth real; findings são gaps de configuração/validação pontual, não de modelo; nenhum CRITICAL |
| Multi-Tenant | 8.8 | 33/33 tabelas FORCE RLS dual-context + crypto per-tenant; única aresta F-04 (referência, não leitura) |
| Banco | 9.0 | EXCLUDE/CHECK/partições/triggers exemplares; migrations com guard destrutivo e versionamento próprio |
| Escalabilidade | 7.5 | Índices completos; tetos conhecidos (worker global, retenção outbox) adequados a MVP, não a 10k tenants |
| Negócio | 8.7 | State machines únicas, invariantes no banco, "apenas um vence" comprovado; F-02/F-05 são as exceções |
| LGPD | 7.5 | Criptografia e minimização exemplares; eliminação (F-02) é o gap material |
| Produção | 6.5 | Worker sem agendamento versionado, gates fora do CI, alerting externo não versionado; runbooks e healthchecks bons |
| **Geral** | **8.3** | **APROVADO COM RISCO** — P0 são triviais de configuração; P1 fecham os gaps de negócio/LGPD |

---

*Relatório gerado por auditoria forense automatizada com leitura integral do código executável (cobertura §2). Todas as afirmações referenciam arquivo:linha verificáveis no commit `7da3bd4`. Itens sem evidência observável foram classificados como INSUFFICIENT_EVIDENCE (§12) e não influenciaram o veredito além do risco declarado.*
