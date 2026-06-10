# REMEDIAÇÃO FORENSE TOTAL — C0 → C10

**Sistema:** ClinicaOS V2 (SaaS multi-tenant healthtech)
**Data:** 2026-06-10
**Base:** [AUDITORIA_C0_C10_COMPLETA.md](../AUDITORIA_C0_C10_COMPLETA.md) (branch `main` @ `7da3bd4`, veredito APROVADO COM RISCO)
**Modo:** MINIMAL PATCH STRATEGY — zero refactor, zero contrato alterado, evidência obrigatória

---

## 1. Resumo Executivo

Os **14 findings** da auditoria forense (2 ALTA, 7 MÉDIA, 5 BAIXA) foram
**integralmente remediados** em 28 arquivos (20 modificados + 8 novos; diff
total ~605 inserções / 140 remoções), com **1 migration aditiva** (0023),
**1 ADR novo** (ADR-021) e **22 verificações de teste novas** (15 unit + 7
smoke de integração contra Postgres real).

Resultado:

| Severidade | Antes | Depois |
|---|---:|---:|
| ALTA | 2 | **0** |
| MÉDIA | 7 | **0** |
| BAIXA | 5 | **0** (4 eliminadas + 1 mitigada e documentada — F-12, ver §6.12) |

Nenhum contrato C0→C10 foi alterado: bounded contexts, eventos, payloads,
schema público (apenas adição nullable), APIs públicas, claims JWT, RLS,
idempotência e outbox permanecem byte-compatíveis. A única evolução de schema
(coluna `patients.anonymized_at`) é aditiva, nullable, sem backfill, e
implementa exatamente o passo 3 já prescrito pelo ADR-017 — formalizada em
**ADR-021** (add-only, conforme processo).

Bônus de remediação: ao ativar o gate `arch:db-check` no CI (F-07), o gate
**capturou imediatamente uma violação real pré-existente** —
`src/lib/messaging/number-store.ts` (seam dbAdmin do C10) nunca tinha entrado
na allowlist do AST porque o guard não rodava no CI. Evidência empírica de que
o F-07 era um gap material, não teórico.

Validação completa (tudo verde): `typecheck` · `lint` · `arch:check` (madge) ·
`arch:db-check` · `check:migrations` · `check:registry:strict` · **267 testes
Vitest** · `build` · migration 0023 aplicada em qoro-dev ·
`smoke:remediation` **7/7** · `smoke:c4` **61/61** · `smoke:c5` **8/8**.

---

## 2. Findings Recebidos

| ID | Sev. | Descrição (resumo) | Status final |
|---|---|---|---|
| F-01 | ALTA | Worker outbox sem agendamento versionado | ✅ CORRIGIDO |
| F-02 | ALTA | Hard-delete LGPD bloqueado por FK RESTRICT + lote tudo-ou-nada | ✅ CORRIGIDO |
| F-03 | MÉDIA | Reconcile 1×/dia vs spec ≈15min | ✅ CORRIGIDO |
| F-04 | MÉDIA | Availability aceita doctorId de outra clínica | ✅ CORRIGIDO |
| F-05 | MÉDIA | Agendamento não valida role/ativo/deleted do médico | ✅ CORRIGIDO |
| F-06 | MÉDIA | Heal de drift não remove cookies fragmentados nem revoga refresh | ✅ CORRIGIDO |
| F-07 | MÉDIA | arch:db-check / check:migrations / check:registry fora do CI | ✅ CORRIGIDO (+1 violação real capturada) |
| F-08 | MÉDIA | Advisory lock do tick libera no COMMIT imediato (controle fictício) | ✅ CORRIGIDO |
| F-09 | MÉDIA | Sem retenção p/ outbox processado/skipped e login_attempts | ✅ CORRIGIDO |
| F-10 | BAIXA | UI promete TTL 7 dias; export gera 24h | ✅ CORRIGIDO |
| F-11 | BAIXA | Script dev anonimiza menos PII que a rota | ✅ CORRIGIDO |
| F-12 | BAIXA | Upload Storage dentro da TX do worker | ✅ MITIGADO + DOCUMENTADO (LOW residual aceito, §6.12) |
| F-13 | BAIXA | Chave `reconcile:<id>` queimada para sempre | ✅ CORRIGIDO |
| F-14 | BAIXA | `check-registry --strict` incompatível com semântica `skipped` | ✅ CORRIGIDO |

## 3. Findings Já Corrigidos (ALREADY_FIXED)

**Nenhum.** A revalidação (Etapa 1) confirmou os 14 findings presentes e
reproduzíveis nos arquivos/linhas citados pela auditoria, no estado exato
descrito. Nenhuma correção proposta havia se tornado inválida.

## 4. Findings Não Reproduzidos

**Nenhum.** 14/14 reproduzidos por inspeção direta (arquivo:linha confirmados
antes de qualquer patch).

> Nota de revalidação relevante: durante o `smoke:remediation`, uma fixture
> `outbox.pending` foi reservada por um worker EXTERNO em segundos — evidência
> empírica de que o "agendador externo" (INSUFFICIENT_EVIDENCE §12.1 da
> auditoria) existe e está ativo contra qoro-dev. Isso reduz o impacto
> *operacional* histórico de F-01, mas não muda a classificação: a configuração
> continuava não-versionada (o gap real), e agora está em `vercel.json`.

---

## 5. Patches Aplicados (por prioridade de execução)

### P0
1. **F-01** — `vercel.json`: `{ "path": "/api/cron/outbox", "schedule": "* * * * *" }`.
2. **F-03** — `vercel.json`: `financial-reconcile` de `0 2 * * *` → `*/15 * * * *`; doc-comment da rota atualizado.
3. **F-07** — `ci.yml`: 3 steps novos (`arch:db-check`, `check:migrations`, `check:registry:strict` com fake envs).

### P1
4. **F-02** — hard-delete por paciente (savepoints) + anonimização ADR-021 + `lgpd_requests` `completed`/`failed` + migration 0023 + scan exclui anonimizados + try/catch por clínica + métrica `blocked_by_clinical`.
5. **F-04/F-05** — validação `role='doctor' AND ativo AND deleted_at IS NULL` sob RLS em `setDoctorAvailability` (novo SELECT no tx) e `buildSnapshot` (filtros adicionados ao SELECT existente).
6. **F-06** — `signOut({scope:'global'})` incondicional no heal (disabled E drift); predicado `isSupabaseAuthCookie` casa base + fragmentos `.N`.

### P2
7. **F-09** — rota nova `/api/cron/data-retention` (purge em lotes: outbox terminal >30d, login_attempts >90d) + cron mensal + allowlist no AST guard.
8. **F-08** — advisory lock `pg_try_advisory_xact_lock` agora numa TX lock-holder aberta pela duração do tick (trabalho roda em conexões próprias); guard para pool <2.
9. **F-12** — `withIoTimeout` (20s) em cada um dos 3 round-trips a Storage dentro da TX do handler.
10. **F-10/F-11** — textos TTL alinhados (UI + console.warn → 24h); `anonymizePatientAuditTrail` única (rota + script).

### P3
11. **F-13** — `idempotencyKey: reconcile:<apptId>:<yyyy-mm-dd>` (re-armável por período; handler idempotente; pendência UPSERT).
12. **F-14** — allowlist `PRODUCER_AHEAD` (19 eventos, cada um com a camada consumidora futura); strict falha para: evento fora da allowlist sem handler, entrada da allowlist que ganhou handler (obsoleta) e entrada que não existe no catalog (typo) — fail-closed nas três direções.

### Análise de impacto consolidada (Etapa 2)

| Finding | Arquivos tocados | Contratos impactados | Estratégia mínima |
|---|---|---|---|
| F-01/F-03 | vercel.json | nenhum (config) | adicionar/ajustar entries |
| F-02 | hard-delete.ts, route, script, schema, 0023 | nenhum congelado; ADR-021 formaliza | per-paciente + anonimização prevista em ADR-017 |
| F-04/F-05 | config-actions.ts, actions.ts | nenhum (validação adicional fail-closed) | SELECT sob RLS, mesmo padrão do buildSnapshot |
| F-06 | middleware.ts | nenhum (middleware ≠ enforcement primário, D22) | predicado + signOut incondicional |
| F-07 | ci.yml, arch-db-check.ts | nenhum | steps + 2 entradas de allowlist |
| F-08 | worker.ts | ADR-011 preservado (3-TX intactas) | TX lock-holder pura |
| F-09 | rota nova, vercel.json, arch-db-check.ts | outbox append-only p/ TENANT preservado (purge é dbAdmin, mesma classe do worker) | DELETE batched de estados terminais |
| F-10/F-11/F-12 | handler, UI action, script | nenhum | textos, função única, timeout local |
| F-13 | reconcile route | payload/evento inalterados; só a key (gerada pelo próprio cron) | sufixo de período |
| F-14 | check-handler-registry.ts | nenhum (script de gate) | allowlist explícita |

---

## 6. Detalhe por Finding (evidência → patch → validação)

### 6.1 F-01 — Outbox sem agendamento versionado
- **Evidência:** `vercel.json` sem `/api/cron/outbox`; doc-comment da rota dizia "every 1 min".
- **Patch:** entry `* * * * *` em `crons[]`. Runbook §4 reescrito: agendamento versionado é o default; fallback externo (Hobby) documentado **com alarme pareado obrigatório** no health `?strict=1`.
- **Residual:** plano Vercel Pro não é verificável no repo → item de checklist assinável no go-live (runbook §4).

### 6.2 F-02 — Hard-delete LGPD (ALTA)
- **Evidência:** FK RESTRICT (0017:139-146) + `inArray(ids)` em TX única + loop sem try/catch (route:104-106).
- **Patch:** ver §5.4 e [ADR-021](../adr/021-lgpd-anonymization-on-clinical-retention.md). A anonimização do audit (que já rodava ANTES do DELETE — agravante apontado) permanece antes, agora explicitamente justificada (idempotente; necessária também no caminho anonimização).
- **Validação:** `smoke:remediation` F-02a..F-02e (5/5 contra Postgres real): lote misto 1 deleted + 1 anonymized + 0 failed no MESMO run; prontuário retido íntegro; filhos cadastrais removidos; `lgpd_requests='completed'` com `fulfilled_at`; scan exclui anonimizados.

### 6.3 F-03 — Reconcile ≈15min
- **Patch:** `*/15 * * * *` versionado. Contrato R4 (ADR-014/C9) volta a ser cumprido pela configuração.

### 6.4 F-04 — Availability cross-tenant
- **Evidência:** INSERT sem validar vínculo; EXCLUDE global `(doctor_id, weekday, range)` permitia interferência na clínica B.
- **Patch:** `SELECT id FROM profiles WHERE id=$1 AND role='doctor' AND ativo AND deleted_at IS NULL` DENTRO do tx do `idempotentMutation` (RLS → cross-tenant = 0 linhas → `SchedulingValidationError`). Mesmo padrão do `buildSnapshot` (consistência, zero abstração nova).

### 6.5 F-05 — Papel/atividade do médico
- **Patch:** mesmos 3 filtros no SELECT do `buildSnapshot` (cobre `createAppointment` e reschedule, que passam pelo mesmo helper).
- **Comportamento:** appointments/availabilities EXISTENTES com não-médicos não são tocados (sem migração de dados — minimal patch); novas criações são bloqueadas.

### 6.6 F-06 — Heal de drift incompleto
- **Patch:** (a) `signOut({scope:'global'})` agora roda para `disabled` E `drift` (claims_version já mudou; revogar é seguro — o usuário re-loga e recebe claims novas); (b) `isSupabaseAuthCookie` (`sb-` + `/-auth-token(\.\d+)?$/`) substitui o `endsWith` — apaga TODOS os fragmentos. Predicado exportado e congelado por 5 testes.

### 6.7 F-07 — Gates fora do CI
- **Patch:** 3 steps em `ci.yml`. `check:registry:strict` recebe os mesmos fake envs do step Build (o boot file de handlers carrega `env.ts`).
- **Prova de valor imediata:** primeira execução do `arch:db-check` reprovou — `src/lib/messaging/number-store.ts` (seam privilegiado único do C10, superfície congelada, ADR-020) importava `dbAdmin` sem estar na allowlist do AST. Allowlistado com justificativa (é o seam deliberado que a própria auditoria revisou e aprovou em §10). O gate agora é fail-closed de verdade.

### 6.8 F-08 — Advisory lock fictício
- **Patch:** a TX que adquire `pg_try_advisory_xact_lock` fica ABERTA como lock-holder puro até o fim do tick (nenhum trabalho roda nela; janitor/circuit/processOne usam conexões próprias — as 3 TXs do CRITICAL-01 intactas). Release garantido no COMMIT/ROLLBACK. Guard: pool <2 → roda sem serialização (comportamento efetivo anterior) + métrica `lock_skipped_pool_too_small`.
- **Validação:** smoke 4.6.24 ("2 ticks paralelos = 1 ativo + 1 skipped") passou — agora medindo serialização REAL, não só a aquisição.

### 6.9 F-09 — Crescimento sem retenção
- **Patch:** `/api/cron/data-retention` mensal. Purge APENAS de `outbox.status IN ('processed','skipped')` >30d (pending/processing/`failed`-DLQ intocados) e `login_attempts` >90d. Lotes de 5k com teto de 10 lotes/tabela/run (cabe no maxDuration; o resto sai no próximo run).
- **Segurança do dedup:** perder linhas terminais >30d do `UNIQUE(event_type, idempotency_key)` é seguro — handlers são idempotentes por contrato (ADR-011) e as keys de produtor derivam de mutações cujas `idempotency_keys` expiram antes.
- **Validação:** `smoke:remediation` F-09a/F-09b — purga velhos, preserva recentes/pending/failed.

### 6.10 F-10 — Textos TTL
- **Patch:** UI: "válido por 24 horas"; console.warn do handler: "TTL 24h". Varredura final: zero referências residuais a "TTL 7" relacionadas ao export.

### 6.11 F-11 — Anonimização divergente script vs rota
- **Patch:** `anonymizePatientAuditTrail(admin, ids)` em `hard-delete.ts` (recebe o executor por parâmetro — nenhum import de `dbAdmin` dentro do context, boundary C1 preservado). Rota e script chamam a mesma função; conjunto de chaves congelado por teste (`PATIENT_PII_AUDIT_KEYS`).

### 6.12 F-12 — I/O de rede na TX do worker (LOW — mitigado e documentado)
- **Patch:** `withIoTimeout` de 20s em cada um dos 3 round-trips a Storage. A TX nunca fica presa além de ~60s — muito abaixo da janela de 5min do janitor (o risco real: reclaim + reentrega). Timeout → throw → retry com backoff (uploads são upsert idempotente por requestId).
- **Residual documentado (LOW aceito):** o split-TX completo (upload FORA da tx, como pdf-pipeline/sender) exigiria evoluir o contrato de handler do ADR-011 (`HandlerCtx` recebe só `tx`) — mudança contratual desproporcional para um LOW. Registrado como candidato C16; o risco-fim (janitor/reentrega/pool) está eliminado pelo bound.

### 6.13 F-13 — Chave de reconcile queimada
- **Patch:** `reconcile:<apptId>:<yyyy-mm-dd>` (UTC). Evento `failed` terminal deixa de ser perdido para sempre: o próximo dia re-arma. Sem mudança de evento/payload/handler; volume extra é bounded (1 evento/appointment/dia enquanto elegível) e cessa quando a flag é setada.

### 6.14 F-14 — Strict vs `skipped`
- **Patch:** allowlist `PRODUCER_AHEAD` com os **19** eventos producer-ahead (validado: catalog 26 ⇔ registry 7 ⇔ allowlist 19, sem sobra). Strict agora é executável e está no CI; allowlist é fail-closed contra entradas obsoletas e typos.

---

## 7. Arquivos Alterados

**Modificados (20):**
`vercel.json` · `.github/workflows/ci.yml` · `package.json` ·
`drizzle/migrations/meta/_journal.json` ·
`scripts/arch-db-check.ts` · `scripts/check-handler-registry.ts` ·
`scripts/run-hard-delete.ts` · `scripts/smoke-c5.ts` ·
`src/middleware.ts` · `src/lib/outbox/worker.ts` ·
`src/contexts/patient/schema.ts` · `src/contexts/patient/internal/hard-delete.ts` ·
`src/contexts/patient/internal/handlers/lgpd-export-requested.ts` ·
`src/contexts/scheduling/actions.ts` · `src/contexts/scheduling/config-actions.ts` ·
`src/app/api/cron/patient-hard-delete/route.ts` ·
`src/app/api/cron/financial-reconcile/route.ts` ·
`src/app/(app)/(shell)/pacientes/actions.ts` ·
`docs/runbooks/production-readiness.md` · `docs/PROGRESS.md`

**Novos (8):**
`drizzle/migrations/0023_wooden_risque.sql` (+ snapshot/journal) ·
`src/app/api/cron/data-retention/route.ts` ·
`docs/adr/021-lgpd-anonymization-on-clinical-retention.md` ·
`src/contexts/patient/internal/hard-delete.test.ts` ·
`src/middleware.test.ts` · `scripts/smoke-remediation.ts` ·
`docs/remediation/REMEDIACAO_FORENSE_C0_C10.md` (este relatório)

## 8. Migrations Criadas

| Migration | Conteúdo | Reversibilidade |
|---|---|---|
| `0023_wooden_risque.sql` | `ALTER TABLE patients ADD COLUMN IF NOT EXISTS anonymized_at timestamptz` (aditiva, nullable, sem backfill, sem grants/policies novas — herda RLS de linha do 0011) | Deploy reversível: rollback de código deixa a coluna dormente. Aplicada em qoro-dev ✓ |

Nota: o `drizzle-kit generate` re-emitiu o DDL do messaging (0022 era
hand-written sem snapshot); o SQL foi enxugado manualmente para apenas o ALTER
e o **snapshot 0023 re-sincroniza o estado** para generates futuros (drift de
snapshot corrigido de carona, documentado no header da migration).

## 9. Testes Criados

| Arquivo | Cobre | Resultado |
|---|---|---|
| `src/contexts/patient/internal/hard-delete.test.ts` (10 testes) | F-02/F-11: conjunto canônico de chaves PII congelado; strip em before E after; scrub de idempotency; bind params (CWE-89); lista vazia = 0 round-trips; `isFkRestrictViolation` (direto, cause-chain, 23505≠23503, fail-closed) | ✅ |
| `src/middleware.test.ts` (5 testes) | F-06: predicado de cookie casa base + fragmentos `.N`; rejeita code-verifier, não-sb, sufixo malformado | ✅ |
| `scripts/smoke-remediation.ts` (7 checks, integração vs qoro-dev) | F-02a (delete físico+cascade), F-02b (anonimização in-place, prontuário retido), F-02c (lgpd_requests completed), F-02d (scan exclui anonimizados), F-02e (lote misto ≠ tudo-ou-nada), F-09a (purge outbox preserva pending/failed/recente), F-09b (purge login_attempts) | ✅ 7/7 |
| Suítes existentes re-executadas | smoke:c4 61/61 (incl. 4.6.24 = serialização real do F-08); smoke:c5 8/8 (hard-delete adaptado); Vitest 267/267; build | ✅ |
| Gates no CI (F-07/F-14) | arch:db-check, check:migrations, check:registry:strict — agora rodam em todo PR | ✅ local |

## 10. Riscos de Regressão (Etapa 5)

| Patch | O que poderia quebrar | Mitigação/verificação |
|---|---|---|
| F-01/F-03 crons | Deploy rejeitado se plano = Hobby | Evidência forte de Pro (4 crons diários já deployando); checklist de verificação no runbook §4; fallback externo documentado |
| F-02 anonimização | Decrypt de linha anonimizada quebrar telas | `cpf_encrypted` recebe ciphertext VÁLIDO (decripta para `''`); linha é soft-deleted (fora das listagens); smoke confirma |
| F-02 savepoints | Erro dentro de savepoint corromper a TX externa | Padrão SAVEPOINT do Postgres via `tx.transaction` aninhado; validado contra PG real (lote misto) |
| F-04/F-05 validação | Clínicas que usavam não-médicos como `doctor_id` passam a receber erro de validação na CRIAÇÃO | Comportamento intencional do finding; dados existentes intocados; mensagem de erro clara ("médico inválido para esta clínica") |
| F-06 signOut no drift | Logout global em falso-positivo de drift | Drift = claims_version divergente confirmado no DB; revogação é o comportamento ANUNCIADO do heal; falha do signOut é não-fatal |
| F-08 lock-holder | Conexão presa idle-in-transaction ≤60s | maxDuration 60s encerra a função; ROLLBACK libera o lock; guard p/ pool<2; smoke 4.6.24 + 61/61 |
| F-09 purge | Apagar linha necessária a replay/dedup | Só estados terminais benignos >30d; `failed` (DLQ) preservado; smoke F-09a |
| F-13 chave por período | Re-publicação diária duplicar efeitos | Handler = UPDATE idempotente de flag; pendência = UPSERT; volume bounded |
| F-14 allowlist | CI quebrar quando um handler novo ativar | Por design (fail-closed): remove-se a entrada no mesmo PR; mensagem do gate instrui |

## 11. Contratos Verificados (Etapa 4)

| Contrato | Verificação pós-patch |
|---|---|
| Bounded contexts / boundaries | `eslint-plugin-boundaries` ✓ · `madge` 0 ciclos ✓ · `arch:db-check` 0 findings ✓ (nenhum import novo cross-context; helpers compartilhados recebem executor por parâmetro) |
| Eventos / payloads | Nenhum evento criado/alterado; `check:registry:strict` 26⇔7⇔19 ✓; F-13 muda apenas a KEY gerada pelo próprio cron |
| Schema público | Só adição nullable (`anonymized_at`); `check:migrations` ✓ (zero DROP novo) |
| RLS | Nenhuma policy alterada; 0023 não toca RLS; validações F-04/F-05 EXECUTAM SOB RLS (fail-closed); smokes A/B existentes verdes |
| Claims JWT / identity | Middleware continua não-enforcement-primário (D22); shape de claims intocado |
| Idempotência | `idempotentMutation` intocado; novos SELECTs rodam DENTRO da mesma TX reservada |
| Outbox (ADR-011) | 3-TX do worker intactas; SKIP LOCKED/backoff/circuit/janitor intocados; F-08 só corrige o escopo do lock (HIGH-15 vira controle real); purge F-09 opera na mesma classe de privilégio do worker (dbAdmin) e só em estados terminais |
| LGPD/CFM (ADR-017) | Registro clínico NUNCA tocado pela anonimização (smoke F-02b prova retenção do prontuário) |

## 12. Auditoria Pós-Correção (Etapas 7–8, antes × depois)

| Item da auditoria | Antes (7da3bd4) | Depois |
|---|---|---|
| §8 "C4 worker a cada 1min" | ❌ violado por config | ✅ versionado (`* * * * *`) |
| §8 "ADR-014 R4 reconcile ≈15min" | ❌ violado por config | ✅ versionado (`*/15`) |
| §8 "LGPD eliminação em prazo (C5 §5.6.5)" | ❌ parcialmente violado | ✅ delete OU anonimização ADR-021, por paciente |
| §8 "boundary enforced by tooling" | ⚠️ parcial (AST fora do CI) | ✅ 3 gates no CI (e 1 violação real corrigida) |
| §9.5 crescimento sem teto | ❌ | ✅ retenção mensal versionada |
| §10 "única aresta multi-tenant" (F-04) | ❌ | ✅ validação sob RLS |
| HIGH-15 (controle de overlap) | ⚠️ fictício | ✅ serialização real (smoke 4.6.24) |
| Heal de drift (ADR-009) | ⚠️ incompleto | ✅ revoga + apaga fragmentos (testado) |
| INSUFFICIENT_EVIDENCE §12 (8 itens de infra externa) | sem processo | checklist assinável no runbook production-readiness §4/§5 (itens 1, 7 endereçados; demais já constavam nos §3–§6) |

Mini-auditoria de cada patch (segurança/tenant/RLS/outbox/idempotência):
nenhum finding novo introduzido — confirmado pelos gates fail-closed + 267
unit + 76 checks de smoke (61 c4 + 8 c5 + 7 remediação) verdes após TODOS os
patches.

## 13. Score Final (projeção pós-remediação)

| Eixo | Antes | Depois | Justificativa |
|---|---:|---:|---|
| Arquitetura | 9.2 | 9.3 | Tooling fail-closed agora roda no CI; zero abstração nova |
| Segurança | 8.4 | 9.0 | F-04/F-05/F-06/F-07 fechados; heal real; gates ativos |
| Multi-Tenant | 8.8 | 9.2 | Única aresta conhecida (F-04) eliminada |
| Banco | 9.0 | 9.1 | Migration aditiva limpa; snapshot drift do 0022 sanado |
| Escalabilidade | 7.5 | 8.2 | Retenção versionada; lock real; tetos restantes são C16 (sharding) |
| LGPD | 7.5 | 9.0 | Eliminação/anonimização funcionando por paciente, testada e2e |
| Produção | 6.5 | 8.5 | Agendamento 100% versionado; gates no CI; resta infra externa assinável (go-live checklist) |
| **Geral** | **8.3** | **≈9.0** | |

## 14. Veredito Final

**REMEDIAÇÃO COMPLETA.**

- ✅ Zero HIGH
- ✅ Zero MEDIUM
- ✅ LOW: 4 eliminados; 1 residual mitigado e documentado (F-12 split-TX completo → C16, risco-fim neutralizado por timeout bound)
- ✅ Todos os testes passam (267 unit + 76 smoke checks + build + 6 gates estáticos)
- ✅ Nenhum contrato C0→C10 alterado (única evolução: coluna aditiva formalizada em ADR-021, fluxo já previsto em ADR-017)
- ✅ Backward compatible, deployável, reversível e auditável (migration aditiva; rollback de código seguro; trilha completa neste relatório + ADR + PROGRESS)

**Pendências exclusivamente de infraestrutura externa** (não-auditáveis no
repo, herdadas do §12 da auditoria): confirmação assinada no go-live de plano
Vercel Pro, monitor externo no health `?strict=1`, buckets privados, TTL 15min
do GoTrue, hook habilitado em prod e backups/PITR — todas mapeadas como
checklist verificável em
[runbooks/production-readiness.md](../runbooks/production-readiness.md).

---

*Gerado pela remediação forense de 2026-06-10. Toda correção referencia
finding + arquivo + linha da auditoria-base; nenhuma correção foi baseada em
hipótese (Etapa 1 revalidou 14/14 antes do primeiro patch).*
