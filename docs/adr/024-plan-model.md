# ADR-024 — Modelo de planos: só limites, sem overage, sem feature-gating (base; enforcement em C13)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> Sem overage (`billing/schema.ts`) e sem feature-gating. O plano `Pro+` citado em docs antigos **não existe** no código.
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: contrato congelado agora / enforcement em C13 (billing)
- Refs: ADR-004 (Meta Cloud API), ADR-016 (ciclo de vida de clínica), VisãoGeral §4.2 / §9, PlanoAção C13

## Context

A `VisãoGeral` descrevia os planos (Solo/Clínica/Pro/Pro+) misturando três modelos
ao mesmo tempo: limites de uso, diferenciais de funcionalidade (multi-unidade e
subdomínio só no Pro), provider de WhatsApp por plano (Solo via Z-API) e **overage
billing** (cobrar extra ao estourar a cota). Isso gerava contradições reais:

1. A tabela §4.2 vendia **Z-API como feature do plano Solo**, mas ADR-004 e §3.5
   dizem que Z-API é só fallback operacional, "NÃO é SKU comercial".
2. §6 dizia que a cota de IA **bloqueia** ao estourar; o C13 dizia que **cobra
   overage**. O código (`ai-agent/internal/quota.ts`, C12) já decidiu: bloqueia.
3. Não havia camada de *entitlements* para sustentar feature-gating por plano — o
   risco era desenhá-la ad-hoc sob pressão de billing no C13 (mesmo risco que o
   ADR-016 evitou para `status`).

Congela-se o modelo AGORA (base), sem código de enforcement (isso é C13).

## Decision

**Os planos diferem APENAS por limites de uso. Não há feature-gating.**

1. **Diferenciação sem feature-gating de software.** Todo software-core — incluindo
   o **agente de IA no WhatsApp** (o principal diferencial), consultório, prontuário,
   financeiro, painéis (ocupação/no-show/faturamento) e auditoria — está disponível
   em **todos os planos**. Não existe tabela de entitlements nem flag de feature por
   plano. Os planos se diferenciam por TRÊS alavancas, nenhuma exige engine de
   entitlements:
   - **Capacidade**: nº de usuários (trava dura), agendamentos e IA (tetos — ver #4).
   - **Serviço/SLA**: suporte prioritário, gerente de conta dedicado. Não é código —
     gateável livremente; é o principal sustentáculo do preço dos planos altos.
   - **Escala-natural**: features que só passam a importar com equipe/múltiplos
     profissionais (permissão por função, auditoria de quem-acessou-o-quê, relatório
     CONSOLIDADO de todos os profissionais). O código fica ligado pra todos; o que
     muda é o ESCOPO conforme o tamanho — que o limite de usuários já controla.
     Listar como destaque do plano é honesto; **bloquear no código é proibido**.
   - **Proibido gatear no código** o software-core — em especial os painéis
     anti-vazamento (no-show/faturamento) e compliance (LGPD/CFM/auditoria), que são a
     promessa central e ficam no **plano de entrada** (Solo vê os números DELE; Pro vê
     o consolidado de todos os profissionais — diferença de escopo, não de feature).
   - *Early access a módulos beta* fica **FORA do MVP** (exigiria flag por clínica =
     porta de entrada da engine de entitlements). Reabrir só com decisão explícita.

2. **WhatsApp é Meta Cloud API em todos os planos.** Z-API permanece só como
   fallback operacional se a Meta cair (swap por `clinic.messaging_provider`),
   nunca como diferencial de plano. Consistente com ADR-004.

3. **Multi-unidade NÃO é gated por plano.** É capacidade estrutural disponível a
   qualquer clínica. (Subdomínio por clínica não existe — descartado; todas acessam
   app.qoro.dev. Ver VisãoGeral §3.9.)

4. **Limite é teto anti-abuso, não alavanca de upgrade.** O cliente sobe de plano
   porque CRESCEU (mais gente), não porque foi estrangulado no uso normal —
   estrangular uso normal gera churn, não upgrade. A política varia por dimensão:
   - **Usuários = a ÚNICA trava dura.** Bater o limite só impede convidar mais um
     funcionário até o upgrade — inofensivo e intuitivo (mapeia tamanho da clínica ≈
     capacidade de pagar). É a alavanca de upgrade.
   - **Agendamentos = SEM hard cap.** Bloquear agendamento é anti-produto: causaria
     exatamente o vazamento de receita que o sistema existe pra impedir ("você atingiu
     o limite, não pode marcar esse paciente" é inaceitável). No máximo um teto
     altíssimo anti-abuso que **avisa**, nunca bloqueia a criação.
   - **Conversas de IA = métrica, sem hard cap comercial.** É o moat e é baratíssimo.
     Bloquear mata a feature de destaque; abuso/loop é contido pelos limites técnicos
     do agente, rate limit e circuit breaker, não por uma cobrança/limite de plano.
   - **Sem overage** em nenhuma dimensão — sem cobrança extra, sem add-on de volume.

**Invariantes:**

- Check de cota é síncrono na escrita, mas apenas **usuários** bloqueia (no convite).
  **IA** e **agendamentos** são métricas e nunca bloqueiam a criação/conversa;
  `checkAndIncrementQuota` (C13) registra o uso sem criar uma trava comercial.
- **Números são ponto de partida, não verdade.** Comece generoso e aperte com dado do
  `usage_metrics` dos 5-10 primeiros clientes — nunca o contrário (baixar limite de
  cliente existente é problema contratual: você grandfather o que prometeu). Os 200/200
  atuais do Solo são apertados pra um médico solo ativo; revisar pra cima.
- O limite de nº de usuários (convite de funcionário, C3 `manage:employees`) é lido
  via **API interna de Tenancy** (`tenancy.getPlanLimits(clinicId)`), nunca por JOIN
  cross-context (respeita ADR-001 / bounded contexts).
- **Downgrade** só vigora no próximo ciclo E é **bloqueado** se o uso atual exceder
  o limite do plano-alvo ("remova usuários/unidades antes"). Nada é apagado
  automaticamente.
- **Trial** herda os limites do plano escolhido (sem cota especial de trial).

**Timeline de enforcement:** contrato congelado agora; tabelas (`plans`,
`subscriptions`, `usage_metrics`), quota de agendamento, dunning e transições de
plano são implementados em **C13** com todos os testes. Nada de código agora além do
que já existe (teto de custo de IA em C12).

## Consequences
- (+) Mata a contradição Z-API-como-plano e a ambiguidade overage-vs-bloqueio.
- (+) Elimina a necessidade de uma engine de entitlements — menos código, menos
  superfície de teste combinatória (alinha com "opinionado sobre flexível" e
  "debugável às 2h da manhã").
- (+) C13 implementa contra um contrato claro, não decide sob pressão de billing.
- (−) Sem overage, o teto de usuários é a única fricção comercial; exige UX clara
  de upgrade. Agendamento e IA não bloqueiam o cuidado ao paciente.
- (−) Menções em prosa de estratégia no §9 da VisãoGeral (overage, multi-unidade/
  subdomínio por plano) ficam superseded por este ADR; a tabela §4.2 e o C13 já
  foram corrigidos, a narrativa do §9 é não-normativa.

## Amendment (C13 — enforcement)

A decisão acima permanece LEI. O enforcement em C13 refina a **modelagem** (sem mudar a
política), via contexto `billing` (ver ADR-025):

1. **Plano ≠ preço.** `plans(code, name)` é catálogo estável. **Preço vive em `prices`**
   (`plan_id, amount, currency, billing_cycle, active_from, active_until`) — histórico explícito.
   Isso habilita reajuste e **grandfather pricing** (cliente existente mantém o preço que
   contratou) sem mutar a linha do plano. O checkout SEMPRE resolve o preço atual no backend;
   o frontend nunca envia preço.

2. **Limites são NUMÉRICOS de capacidade — `plan_limits(plan_id, metric, limit_value int)`.**
   `metric` ∈ {`users`, `agendamentos`, `ai_messages`} (conjunto fechado). **Proibido** flag
   booleana de feature: `ai_enabled=true` ✗; `ai_messages_limit=800` ✓. `plan_limits` NUNCA
   pode virar porta de entrada de feature-gating/entitlements (a invariante #1 continua valendo).

3. **Downgrade = regra em runtime, sem tabela de estado.** O excedente é DERIVADO da contagem
   viva vs `plan_limits` no momento da decisão. Efeito: bloqueia **novos** convites de usuário
   acima do limite-alvo; **nunca apaga** usuários/dados; downgrade só vigora no próximo ciclo.
   (Mantém a invariante de downgrade da decisão original.)

4. **Política vigente (2026-08-05).** `users` é a única trava dura. `agendamentos` e
   `ai_messages` continuam no ledger e nos relatórios, porém são somente métricas: não
   bloqueiam criação nem conversa. `monthly_budget_usd` e
   `AI_MONTHLY_COST_LIMIT_USD` permanecem como compatibilidade/telemetria, sem gate.
