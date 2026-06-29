# Runbook — Production Rehearsal (ensaio de produção)

> C16 FASE 13 / GAP 6. **Antes do primeiro cliente pagante.** Percorra o ciclo de
> vida completo de uma clínica num ambiente production-like, com uma **clínica fake**,
> simulando ~1 dia de operação. Prova que os contextos funcionam ponta-a-ponta e que
> os SLOs se sustentam sob fluxo real.

## Pré-requisitos
- Ambiente production-like (preview/staging com Supabase próprio, ou prod com clínica
  descartável claramente marcada).
- Sentry + Better Stack (logs/uptime) ativos para observar o ensaio.
- WhatsApp/Meta e Asaas em **sandbox** (não cobrar cartão real).

## Fluxo (siga na ordem — cada seta é um contexto)

### 1. Cadastro / Onboarding
- Crie a clínica via convite mágico (`/join/<token>` → wizard → checkout Asaas sandbox →
  saga de trial + owner auto-login). Ver ADR-027.
- **Confere:** clínica criada, owner logado, trial ativo, `audit_events` registrou.

### 2. WhatsApp
- Conecte um número (Embedded Signup sandbox) e envie um inbound de teste.
- **Confere:** webhook Meta valida HMAC, inbound persistido cifrado, sem 401.

### 3. Agenda
- Cadastre um procedimento + um paciente; crie um agendamento.
- **Confere:** anti-duplo-agendamento (R1) funciona; `appointments` populado; sem vazar p/ outra clínica.

### 4. IA
- Mande uma mensagem que o agente responda (ex.: pedir horário). Tente 2-3 adversariais.
- **Confere:** resposta coerente, **sem conselho clínico**, sem vazar cross-tenant; `ai_messages` gravado; custo em `ai_cost_usd`.

### 5. Financeiro
- Marque um atendimento como realizado → gere lançamento/cobrança; dispare um webhook Asaas sandbox (pagamento).
- **Confere:** invoice/lançamento atualizado; `cash_flow_daily` fecha; dedup de webhook ok.

### 6. Export LGPD
- Rode o export do paciente de teste.
- **Confere:** ZIP gerado com signed URL; conteúdo correto; `lgpd_requests` registrou; export é sanitizado.

### 7. Delete (hard-delete)
- Soft-delete do paciente; force o hard-delete (`/api/cron/patient-hard-delete` ou aguarde a janela).
- **Confere:** cascade nos filhos; se houver prontuário (RESTRICT clínico), o registro é **anonimizado** (ADR-021), não deletado; PII some do audit (anonimização do trail).

### 8. Restore
- Faça um restore PITR/dump (ver [disaster-recovery.md](./disaster-recovery.md) / [restore-test.md](./restore-test.md)) e confirme que os dados da clínica fake voltam íntegros.
- **Confere:** RTO ≤ 4h, RPO ≤ 24h na prática.

## Durante todo o ensaio (observabilidade)
- `GET /api/health` deve ficar `ok` o tempo todo (db/gemini/meta/asaas/fila).
- Better Stack: nenhuma `*.error` inesperada; fila outbox drenando (`oldest_pending_age_s` baixo).
- Sentry: nenhum erro não-tratado novo.
- `system_metrics_daily`: após o rollup, métricas da clínica fake aparecem (patients_created, appointments_scheduled, ai_messages, revenue_received).

## Critério de aprovação
- [ ] Os 8 passos completam sem erro bloqueante.
- [ ] Isolamento multi-tenant intacto (nada da clínica fake aparece em outra).
- [ ] `/api/health` ok durante todo o ensaio; SLOs respeitados.
- [ ] Restore recupera a clínica fake.
- [ ] Limpeza: remova a clínica fake e os dados de teste ao final.
