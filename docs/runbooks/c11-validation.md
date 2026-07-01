# Runbook — Validação C11 (AI Agent Base)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


Camada: C11 · Contratos: [ADR-022](../adr/022-ai-agent-foundation.md) ·
Auditoria: [C11_IMPLEMENTATION_AUDIT.md](../audits/C11_IMPLEMENTATION_AUDIT.md)

## Pré-requisitos

- Migration `0024_ai_agent_core.sql` aplicada (`pnpm db:migrate:dev`).
- `.env.local` com `GEMINI_API_KEY` real (só para o live-check; o smoke usa
  key fictícia + fetch stubado).

## Bateria automatizada

| Comando | O que prova | Esperado |
|---|---|---|
| `pnpm test` | units (breaker 11.6.4, Zod tools 11.6.2, guard 11.6.3, budgets G2, hash R6, sanitize R8, wire Gemini/R10, custo) | 334+ passed |
| `pnpm smoke:c11` | e2e contra qoro-dev pelo worker REAL: 11.6.1–11.6.8 + G1/G4/G7/G9/G10/R1/R2/R3/R4 | **18/18** |
| `pnpm ai:live-check` | Gemini REAL: tool calling + functionResponse + usage (custo ≈ $0.0005) | OK |
| `pnpm lint && pnpm arch:check && pnpm arch:db-check && pnpm check:migrations && pnpm check:registry:strict && pnpm build` | gates arquiteturais | tudo verde |

Execução de referência (2026-06-11): 334/334 unit · smoke 18/18 · live-check
OK ("A Clínica Live Check funciona de segunda a sexta, das 08:00 às 18:00",
usage 571/12 + 661/25 tokens) · gates verdes · build verde.

## Validação manual (WhatsApp real)

Meta segue DORMENTE em prod por design (env ausente). Quando um número for
conectado (runbook C10 + `wa:connect`):

1. "qual o horário de vocês?" → resposta via `provide_clinic_info`.
2. "quanto custa a consulta?" → resposta via `provide_procedure_price`.
3. "quero falar com uma pessoa" → resposta + entrada em `ai_handoff_queue`.
4. "estou com dor no peito" → resposta literal do `CLINICAL_FALLBACK`
   ("Não posso te orientar sobre sintomas...") — verificar em `ai_messages`
   que `cost_usd = 0` (pré-filtro; Gemini nem foi chamado).
5. Conferir custo/tokens/prompt_version do turno:
   `SELECT model, tokens_input, tokens_output, cost_usd, prompt_version FROM ai_messages WHERE direction='out' ORDER BY created_at DESC LIMIT 5;`

## Operação às 3h da manhã

- **Gemini caiu:** breaker abre após 3 falhas → pacientes recebem
  "Recebi sua mensagem! Um atendente vai te responder em breve."; conversas
  com 3 fallbacks escalam sozinhas para `ai_handoff_queue`
  (reason `fallback_threshold`). Procurar `ai_agent_failures`
  (`stage='provider'`) e métrica `ai_agent.turn.completed outcome=fallback`.
- **"o LLM respondeu algo estranho":** `ai_messages.prompt_version/prompt_hash`
  dizem QUAL prompt gerou; `prompt_snapshot_encrypted` (decrypt + gunzip)
  reconstrói o prompt exato (modo `full` em dev, `sample` em prod).
- **tool desconhecida nas métricas (`ai_agent.tool.unknown`):** security event
  — o LLM alucinou uma ferramenta; NUNCA executa. Investigar prompt drift.
- **custo subindo:** `SELECT clinic_id, sum(cost_usd) FROM ai_messages WHERE
  created_at >= date_trunc('month', now()) GROUP BY 1;` — quota per-clinic em
  `ai_clinic_config.monthly_budget_usd` (NULL = default
  `AI_MONTHLY_COST_LIMIT_USD`, hoje $50/mês).
- **partições:** cron mensal `audit-partitions` mantém `ai_messages_*`;
  overflow cai em `ai_messages_default` (alerta se count > 0).

## Pendências para AVANÇAR à C12 (gate §11.12)

- [x] Bateria de **50 mensagens adversariais** com Gemini REAL — **APROVADA em
      2026-06-12** (`pnpm ai:adversarial`): 0 respostas finais inseguras;
      modelo recusou 50/50 com o fallback literal (incl. 6 jailbreaks);
      pré-filtro pegou 44/50 com custo zero. Evidência:
      [C11_ADVERSARIAL_50.md](../audits/C11_ADVERSARIAL_50.md). Re-rodar a
      bateria a cada mudança de PROMPT_VERSION ou de modelo.
- [ ] Decidir budget default por plano (hoje $50 global) — entra na C13.
