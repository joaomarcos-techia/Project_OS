# Qoro v2 — Plano de Execução em Camadas (staff/principal, produção paga)

**Data:** 2026-08-19 · **Base:** `ClinicaOS_V2` @ `d414191` · **Decisão de pagamentos:** [ADR-049](adr/049-pagamentos-paciente-sinal.md)

Plano canônico para evoluir o Qoro para **plataforma de saúde mental que cobra clientes reais**. Execução **em camadas**; cada uma só libera a próxima **verde, endurecida e estabilizada**.

> **Precedência: Código > Banco > Testes > Documentação.** Divergiu? Atualize o plano/ADR **antes** de prosseguir.

---

## 0. Método, restrições e gates

### 0.1 Ordem inviolável
Entender → projetar (ADR) → **congelar (ADR/Scope Freeze)** → implementar → testar → endurecer (.H) → estabilizar (.S) → observar → liberar. Nunca inverter.

### 0.2 Portão de aceite padrão — gates de PRIMEIRA CLASSE
Sub-fase só é "verde" com **todos**:
```
FUNCIONAL        lint · typecheck · test · build · test:e2e
ARQUITETURA      arch:check · arch:db-check · check:migrations · check:registry:strict
COMPLEXIDADE     arch:graphs --check verde: 0 ciclos + zero acoplamento novo não commitado (§11)
REGRESSÃO        1966 testes de baseline verdes + Regression Matrix (§0.4)
ANTI-ESCOPO      nenhuma mudança fora do gap mapeado (§0.5)
SCOPE FREEZE     nenhum requisito novo incorporado na camada (§0.8)
BUDGET           ≤25 arquivos · ≤1500 linhas · ≤2 contexts, senão split (§0.6)
ARQ. PROTEGIDA   integra a outbox/RLS/audit/idempotência/flags/eventos/multitenancy (§0.7)
ADR FREEZE       arquitetura da camada = ADR aprovado; mudança exige ADR complementar (§0.9)
OBSERVABILIDADE  metrics.emit + check:observability + Sentry/Better Stack (§8)
SEGURANÇA        Security Gates (§9)
PERFORMANCE      SLOs (§10)
CHAOS            serviços externos (§12)
FINANCEIRO       Financial Integrity — fecha contábil (§13)
OPERAÇÃO REAL    Clinic Simulation 30 dias consistente (§14)
PRODUTO          Product Acceptance por persona (§15)
MIGRAÇÃO         vazio/populado/volume + up/down/up (§16)
DOCS VIVAS       ADR + docs + fluxograma + runbook (§17)
```

### 0.3 Definition of Done (global)
```
[ ] ADR criado/atualizado (+ ADR freeze)   [ ] Observabilidade (log+métrica+alerta+painel)
[ ] Impact + Regression Matrix             [ ] Security review
[ ] Anti-escopo + Scope freeze respeitados [ ] Performance (SLO)
[ ] Budget respeitado (senão split)        [ ] Chaos validado
[ ] Complexidade: 0 ciclos novos           [ ] Financial Integrity (fecha contábil)
[ ] Arquiteturas protegidas                [ ] Clinic Simulation 30d
[ ] Código atrás de feature flag           [ ] Product Acceptance por persona
[ ] Unit·Integration·Contract·Smoke·E2E    [ ] Migração (vazio/populado/volume, up/down/up)
[ ] Rollback + rollout progressivo         [ ] Docs vivas (ADR/docs/fluxo/runbook)
```

### 0.4 REGRA ABSOLUTA — Impact & Regression Matrix
Toda feature declara **quais domínios podem regredir** + teste específico por domínio. Modelo (sinal): Agenda/Financeiro/Billing/WhatsApp/IA/Relatórios.

### 0.5 ANTI-ESCOPO — proibido construir
Se não resolve um **gap mapeado**, **não se faz**. Proibido: refatorar sem necessidade direta · trocar arquitetura por preferência · reescrever módulo estável · nova dependência sem justificativa/ADR · abstração para problema inexistente · mexer em fluxo não impactado · mudar naming convention global · mudar design system sem ADR · mover arquivo por estética.
> **Toda linha alterada aponta para um gap. Sem gap → sem mudança.**

### 0.6 BUDGET DE MUDANÇA (menor PR possível)
Estimar antes: **arquivos · linhas · contexts**. Excedeu **qualquer** limite → **split**:
```
> 25 arquivos   ou   > 1500 linhas   ou   > 2 bounded contexts
```

### 0.7 ARQUITETURAS PROTEGIDAS (não remover, não contornar)
| Mecanismo | Onde vive | Regra |
|---|---|---|
| Outbox / Domain Events | `lib/outbox`, `schema/infra/outbox.ts` | cross-context via evento |
| RLS / Multi-tenancy | `lib/db/rls.ts`, `withTenant`, `tenantIdRef` | tudo tenant-scoped; `dbAdmin` só allowlist |
| Audit Trail | `lib/audit` | ações sensíveis auditadas |
| Idempotency | `lib/idempotency`, `external_reference` | handlers idempotentes |
| Feature Flags | por clínica | feature nova nasce off |
> Burlar qualquer um exige **ADR próprio aprovado** — nunca como efeito colateral.

### 0.8 SCOPE FREEZE + Discovery Log
Iniciada a camada, **nenhum requisito novo entra nela**. Todo achado vai para o **Discovery Log** (`docs/discovery-log.md`) e é movido para **próxima camada** ou **backlog**. Exceção única: **bug crítico · vulnerabilidade crítica · risco financeiro crítico** (entra com registro + mini-ADR).

### 0.9 ADR FREEZE
Após o ADR **aprovado**, a arquitetura da camada **não muda durante a implementação**. Mudança de arquitetura exige **ADR complementar** aprovado — não redesenho no meio do caminho.

### 0.10 Proibido concluir se
Código sem teste · migration sem validação em volume · endpoint sem teste · fluxo sem E2E · feature sem observabilidade · domínio afetado sem regressão · **mudança fora do anti-escopo/scope-freeze** · **budget estourado sem split** · **ciclo novo de dependência** · **arquitetura protegida burlada** · **integridade financeira não fecha** · warning · TODO sem justificativa · `.H` ou `.S` não executados.

---

## 1. Decisões travadas
Asaas · Modelo B (conta da clínica, BYO, cifrada, write-only) · **link sem token** · sinal 50% configurável (PIX/cartão, 1ª+retorno) · hold 24h · cancelamento ≥24h estorna · restante por link/presencial · trial admin 14d / self-serve 7d · preço fundador só admin · **psiquiatria disponível, psicologia "em breve"**. Detalhe: [ADR-049](adr/049-pagamentos-paciente-sinal.md).

---

## 2. Sequência
```
CAMADA -1  Architecture Review (C4 + grafos + riscos + ADRs) ..... ✅ CONCLUÍDA
CAMADA 0   Baseline ...................................... ✅ CONCLUÍDA
CAMADA 1   1.0 adapter·1.1 credencial·[O-1]·1.2 política·1.3 charges+hold·
           1.4 webhook·1.5 falta/restante·1.6 UI·1.H hardening·1.S stabilization
CAMADA 2   P1 (recibo · [2.2.0 spike Memed] Memed · template · recuperação) · 2.H · 2.S
CAMADA 3   P2 (conselho genérico + O-2 + pacote/mensalidade) · 3.H · 3.S
CAMADA 4   P3 (backlog)
ADIADO     CRM/UTM/reativação · repasse
```
**Nenhuma camada libera a próxima sem `.H` E `.S` verdes.**

---

## 3. CAMADA -1 — Architecture Review
**Objetivo:** entender o sistema inteiro antes de tocar código (reforça anti-escopo §0.5).
**Mapear:** contexts (**12** — `feedback` é o 12º) · dependências · eventos · crons (15) · webhooks · integrações · RLS · flags · tabelas.
**Entregue em `docs/architecture/`** (padrão do repo; o rascunho dizia `/docs/arquitetura`):
- **[C4](architecture/c4.md)** (Mermaid, níveis 1–3) + inventário medido.
- **`dependency-graph.mmd`**, **`event-flow.mmd`**, **`context-map.mmd`**, **`arch-metrics.json`** — **gerados** por `pnpm arch:graphs`, versionados, com `--check` (modelo lockfile) para **diffar antes×depois**.
- **[Riscos](architecture/risks.md)** — 11 itens, incl. flag por clínica inexistente (R1) e `arch:check` sem tsconfig (R2).
- **ADRs necessários** listados em `risks.md`; achados adiados em [`discovery-log.md`](discovery-log.md).
**Resultado:** 52 elementos · 264 arestas · **0 ciclos** · 57 eventos (43 sem consumidor, allowlist `PRODUCER_AHEAD`). Nenhum refactor; zero mudança em `src/`.

---

## 4. CAMADA 0 — Baseline ✅
lint ✅ · typecheck ✅ · **1966 testes** ✅ · build ✅ @ `d414191`.

---

## 5. CAMADA 1 (P0) — Cobrança de paciente + sinal
Arquitetura no [ADR-049](adr/049-pagamentos-paciente-sinal.md). Testes **funcionais** por sub-fase; **gates transversais (§8–§17) valem para cada uma**.

- **1.0 Adapter:** extrair p/ `src/lib/payments/asaas`, `createAsaasClient(cred)`. Sem migração. Baseline inteiro verde (23 testes de webhook). Zero comportamento novo.
- **1.1 Credencial:** `clinic_payment_accounts` (cifrada, `hasApiKey`, token da clínica); painel `configuracoes/pagamentos`; validação no save; auto-config do webhook. unit/integration/contract/e2e/audit.
- **1.2 Política:** `clinic_deposit_policy` (off, 50%, janela 24h) + consent `politica_cancelamento`. unit/contract. Flag off = idêntico.
- **1.3 Charges+hold:** context `payments` + `patient_charges`; colunas `deposit_*`/`hold_expires_at`; cron de expiração. unit/integration/contract/smoke. Máquina de estados congelada intocada.
- **1.4 Webhook:** `/api/webhooks/asaas/patient/[ref]`; resolve clínica→chave→`getPayment`→concilia→`agendado→confirmado`. Integration+contract **espelhando os 23**.
- **1.5 Falta/restante/refund:** handlers `no_show`/`completed`/cancelamento. unit/integration + **E2E completo**.
- **1.6 UI:** link no WhatsApp (sistema; IA read-only); status na agenda. unit/e2e/smoke:conversas.

**1.H HARDENING:** destrutivo · concorrência (duplo pagamento, webhook duplicado/out-of-order, hold expira no instante do pagamento) · idempotência (replay, retry pós-timeout) · multi-tenant (A concilia cobrança de B, `ref` forjada) · inválidos. Aceite: cada cenário com teste + Security/Chaos/Financial/Load/Simulation verdes.

**1.S STABILIZATION:** corrige bugs do hardening/rollout · remove débito técnico da camada · atualiza docs vivas · **reexecuta a suíte completa**. Aceite: zero bug alto aberto; suíte 100% verde.

**E2E de aceite:** `agenda(on)→aceita política→link 50%→paga→webhook→CONFIRMADO`; A(falta)=retido/restante não criado · B(comparece)=restante conciliado · C(cancela a tempo)=estornado.

---

## 6. Track O — Onboarding self-serve
Mesmos gates + `O.H`/`O.S`. **O-1** wizard (módulo→atribuição do Qoro→média/mês→email+senha→plano→verificação→entrou; trial **7d**; preço **padrão**; psicologia "em breve"). **O-2** módulo→dashboard (depende de P2). **O-3** tour. **O-4** Central de Documentação (Asaas/WhatsApp).

---

## 7. Camadas 2–4 (mesmos gates + `.H`/`.S`)
- **P1:** 2.1 recibo PDF · **2.2.0 SPIKE Memed** (validar **contrato · custos · requisitos regulatórios · dependência comercial** ANTES de qualquer código — integração externa não começa sem o spike passar) → 2.2 Memed · 2.3 template psiquiátrico · 2.4 recuperação falta/retorno · **2.H·2.S**.
- **P2:** conselho genérico (fundação; psicologia clínica desacoplada) · pacote/mensalidade · O-2 · **3.H·3.S**.
- **P3:** NPS · modalidade online · convênio/TISS · NFS-e (parceiro) · psicologia clínica completa.
- **Adiado:** CRM/UTM/reativação · repasse.

---

## 8. Gate — Observabilidade
`metrics.emit` + `check:observability` (drift) + Sentry/Better Stack. Eventos P0: `payments.patient_charge.{created,paid,refunded,failed}` · `payments.deposit.expired` · `scheduling.appointment.confirmed_after_payment` · `payments.webhook.{received,invalid_token,verify,duplicate}`. Alertas + painel "saúde do pagamento".

## 9. Gate — Segurança
RLS · cross-tenant · permission escalation · **webhook forgery (espelhar os 23)** · rate limiting · sensitive data exposure · LGPD (consent do sinal, hard-delete cobre `patient_charges`). Reusa `arch:db-check`, `lib/auth/*`, cripto.

## 10. Gate — Performance & Carga
> **Exigível a partir de 1.4** (antes disso não há endpoint novo para medir). Ferramenta: **`autocannon`** (npm) — `k6` descartado por ser binário fora do npm. Ambiente-alvo a decidir (`restore:test`); **nunca produção**.

**SLOs:** API P95<500ms · P99<1s · webhook<2s · job<30s · query<100ms.
**Load (NET-NEW `test:load` via k6/autocannon):** appointment 500 · webhook 1000 · WhatsApp 5000 · reconcile em lote · outbox saturado → sem erro/deadlock/race. Números = **SLO-alvo a calibrar** ao volume projetado × fator de segurança.

## 11. Gate — Complexidade
Nenhuma alteração pode aumentar acoplamento, ciclos ou fan-in/out excessivo. Ferramenta: **`pnpm arch:graphs --check`** (Camada -1) — usa o `madge` já instalado e calcula fan-in/out por elemento. **`dependency-cruiser` foi CORTADO**: regra declarativa de dependência já é feita pelo `eslint-plugin-boundaries`, e uma segunda config das mesmas regras só cria divergência. **Exigível desde 1.0. Aceite:** `--check` verde (0 ciclos; nenhuma aresta nova sem o diff do snapshot commitado no mesmo PR).

## 12. Gate — Chaos Testing
Simular e validar os mecanismos **existentes**: Asaas indisponível (circuit breaker do adapter) · Gemini indisponível (`lib/ai/circuit-breaker.ts`) · WhatsApp indisponível (outbox retry) · banco lento · timeout de webhook (backstop `billing-reconcile`) · falha parcial de worker. Validar: retry · circuit breaker · fallback · **consistência ao voltar**.

## 13. Gate — Financial Integrity (crítico)
Nenhum cenário gera: **cobrança duplicada · estorno duplicado · recebimento negativo · divergência Asaas↔Qoro · divergência agenda↔financeiro.** Toda transação **fecha contábil**. Valida: ledger append-only (`payment_transactions`), estorno=lançamento novo, `UNIQUE(appointment_id)`, `external_reference` idempotente, `billing-reconcile` (somatório Asaas = somatório Qoro por clínica/período).

## 14. Gate — Clinic Simulation (Operação Real) — NET-NEW
> **Exigível no `1.H`** — antes de 1.3–1.5 não existe `patient_charges`, webhook de paciente nem handler de `no_show`: não há o que simular. Sem dependência nova (tsx + seeds + `worker:once`, no molde dos `smoke:*`).

Harness `test:simulation` (reusa seeds + geradores de evento) simulando **30 dias de operação**: agendamentos, faltas, pagamentos, cancelamentos, reembolsos, webhooks (inclusive duplicados/out-of-order). **Validar consistência final** (Financial Integrity §13 + agenda↔financeiro + sem órfão/hold preso). Pega bugs que só aparecem com eventos acumulados.

## 15. Gate — Product Acceptance
Percorrer a jornada como **secretária·médico·dono·paciente**: nº de cliques · clareza · tempo · chance de erro humano. *(Usabilidade real exige usuário real → confirmada na piloto da Fase 2 do rollout §18.)*

## 16. Gate — Migração
Validar em **vazio · populado (`seed:dev`) · volume (restore anonimizado)**, com **Up→Down→Up** + consistência. Reusa `check:migrations`, `db:backup:prod`, `restore:test`.

## 17. Gate — Documentação Viva
Concluído só com: **ADR · docs · fluxograma · runbook (`docs/runbooks/`)** atualizados.

## 18. Rollout progressivo
`interna → 1 clínica piloto (psiquiatra) → 5 → 25% → 100%`. Avanço só com observabilidade sem anomalia + zero incidente por N dias. Rollback = desligar flag na onda.

---

## 19. Rastreabilidade, riscos e rollback
**Gap→camada→validação:** no-show → 1.3–1.5 (E2E A/B/C + §13 + §14) · gateway → 1.0–1.4 (webhook espelhado + §10 + §12) · recibo → 2.1 · controlado → 2.2 (após spike §7) · psiquiátrico → 2.3 · psicólogo bloqueado → 3.1 · onboarding → O-1.
**Riscos:** refactor do adapter (1.0 isolada) · fricção do sinal (flag/%) · credencial de terceiro (cifra+write-only+papel+audit) · webhook forjado (A2) · concorrência/carga (§10+§12+1.H) · integridade financeira (§13) · **Memed estourar cronograma (spike §7 antes de integrar)** · scope creep (§0.8 freeze).
**Rollback:** flag desliga; migrações aditivas; reverter = desligar flag + reverter migração + recuar onda.
