# Changelog

Todas as mudanças notáveis do ClinicaOS. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

Este changelog registra **o que muda de comportamento visível** por entrega. O log
detalhado, camada a camada (contratos congelados, defesas validadas, débitos), vive em
[docs/PROGRESS.md](./docs/PROGRESS.md) — a autoridade sobre o estado de cada camada.

> Convenção: toda mudança de comportamento visível atualiza este arquivo na seção
> `[Unreleased]` (parte da [Definition of Done](./docs/engineering/definition-of-done.md)).
> O projeto ainda não versiona releases (`package.json` = 0.0.0); entradas históricas
> usam a data de fechamento da camada.

## [Unreleased]

### Corrigido (lote de teste em produção — 2026-07-22)
- **Convite e redefinição de senha voltam a funcionar (itens 11/21).** Os links de
  e-mail (convite de equipe, recuperação de senha) davam "sessão inválida" /
  redirecionavam pro login: o cliente fazia `exchangeCodeForSession(?code)`, que
  exige um code-verifier PKCE que **não existe** para link gerado no servidor. Novo
  route **`/auth/confirm`** faz `verifyOtp(token_hash)` no servidor (padrão SSR),
  sanitiza `next` (anti open-redirect) e limpa sessão prévia antes de trocar. As
  páginas `/convite` e `/reset-password` ganharam fallback resiliente. **Requer** os
  templates de e-mail do Supabase apontando para `/auth/confirm?token_hash=…`.
- **Plano Pro = 10 usuários** (era 15 por engano no seed). Migration de dados
  versionada `0052`. O teto agora é **atômico** no convite (advisory lock por
  clínica) — dois convites simultâneos não furam o limite.
- **`/conversas` não quebra mais para super_admin** (render amigável antes do
  `requireClinicId`, na lista e na thread).
- **Máscaras CPF/CNPJ/telefone** ao digitar em Paciente, Fornecedor (campo "Contato"
  virou "Telefone"), Perfil e no wizard de convite (`src/lib/masks.ts`). O agente de
  IA já normalizava igual (mesmo `createPatientCore`).
- **Caixa** agora mostra **"A pagar"** (visibilidade read-only) além de "A receber".
- **Consultório** sempre exige um médico selecionado (sem "visão geral" — o card não
  mostra o médico); default = 1º médico do dia.
- **Financeiro:** abrir "Novo lançamento" não rebusca mais a lista inteira (drawer via
  `history.replaceState`).
- **Wizard de convite:** botões "Começar"/"Ativar" corrigidos (ícones dimensionados),
  marca "Qoro" removida do topo, telas "já ativada"/"inválido" no design do wizard.
- **Logo do receituário** aparece instantâneo no upload (preview local); falha de
  upload não apaga a logo existente.

### Adicionado
- **Agenda: visões Mês / Semana / Dia** com navegação (item 12). Calendário do mês
  com os atendimentos, semana (seg→dom) e dia; cancelados aparecem esmaecidos.
  Navegação por URL (`?view=&date=`), fuso da clínica.
- **Tela "Conversas IA" (`/conversas`) — intervenção humana no agente (ADR-047).**
  Fecha um beco sem saída: desde a C11 o agente escalava para humano (`status='handoff'`)
  e **parava de responder**, mas não havia nenhuma tela onde alguém assumisse — a conversa
  morria em silêncio. Agora a clínica lista a fila (conversas em `handoff` **primeiro**),
  busca por paciente ou telefone, abre a thread decifrada, **assume**, **responde pelo
  painel** e **devolve ao agente**. Duas permissions novas (`view:conversations`,
  `manage:conversations`; migration 0051) — `owner`/`gestor`/`attendant` recebem as duas,
  `doctor` só leitura.
  Três invariantes, todas revalidadas no servidor sob `SELECT ... FOR UPDATE` (a UI só
  desabilita o campo — não é autoridade): **(1)** responder exige `status='handoff'`,
  senão o agente responderia ao próximo inbound em paralelo com o humano e o paciente
  receberia duas respostas; **(2)** primeira implementação da **janela de 24h da Meta**
  — a regra existia só em prosa e nada nunca olhou o relógio; fora dela o texto livre é
  bloqueado com explicação (sem inbound algum e exatamente 24h contam como fechada);
  **(3)** o envio vai pelo **outbox** (evento `ai_agent.manual_reply.requested` +
  handler), nunca direto da Server Action.
  A mensagem manual é cifrada per-tenant, persistida em `ai_messages` com
  `direction='out'` e a coluna nova `sent_by_user_id` (autoria — `model IS NULL` não
  servia, o agente também grava `null` em fallbacks). **Persistir não é entregar**: a
  thread mostra *Enviando… / Entregue / Falha* a partir de `outbound_messages`, em vez de
  afirmar "enviada" logo após o clique. CPF, telefone em claro e prompt snapshot não
  cruzam para o browser nem para a auditoria.
- **Observabilidade Enterprise (remediação das auditorias de monitoramento, ADR-045).**
  Exceções de background (13 crons, 2 webhooks, worker) agora chegam ao **Sentry com
  stack** — antes o `catch → metrics → 500` sem rethrow deixava só `{name, message}` no
  stdout. `withCron` centraliza auth/correlação/erro/heartbeat das 13 rotas. Correlação
  **ambiente** (`request_id`/`clinicId`/`userId`) em todas as métricas e logs.
  `/api/health` passa a checar **alcançabilidade real** das dependências externas
  (`?deep=1`), incluindo Redis — antes só verificava se a env existia, e ficava verde
  durante um apagão de provedor. Telemetria de segurança nova (`auth.login.failed`,
  `auth.mfa.failed`, `auth.ratelimit.tripped`, `auth.session.revoked`), saturação de
  conexões (`db.pool.saturation`), SLIs reais no rollup diário, MTTD/MTTR no `slo.md`,
  runbooks `redis-down` e `alerting-setup`, alerting como código em `infra/observability/`
  e o gate de CI `check:observability` (docs ⇔ `vercel.json` ⇔ eventos emitidos).

### Corrigido
- **Vazamento latente de conteúdo clínico** (`createProntuario`): o caminho de criação não
  passava pelo seam `project`, e `toProntuarioDetail` devolve o SOAP **decifrado**, que o
  `logAudit` gravava em `audit_events.after`. Mesma classe do A1 (ADR-044), numa rota que
  seguia aberta. Encontrado pelo novo guard de compilação, não por revisão.
- **Documentação operacional dessincronizada** (lida durante incidente): `production-readiness`
  dizia 6 crons e `c16-inventory` dizia 12, contra **13** no manifesto; refs a "Pino" (o
  ADR-029 o rejeitou); rota de drill removida ainda citada; `c16-inventory §6` listava como
  "a construir" 15 itens já em produção; e a saved search de LLM alertava sobre
  `ai.provider.error`, que **nenhum código emitia** — busca vazia é indistinguível de
  "está tudo bem".
- **Documentação como sistema de conhecimento** (modernização, Passo 1+2): índice mestre
  (`docs/README.md`), governança (`documentation-authority`/`lifecycle`/`audit`), onboarding
  de dev (`development/*` + `.env.example`), `architecture/context-map`, processo de
  engenharia (`engineering/git-workflow`/`ai-development`/`decision-guide`/`definition-of-done`),
  templates de PR/issue, este `CHANGELOG.md` e a auditoria de conformidade dos ADRs.
  Ver [relatório](./docs/achados/documentation-modernization-report.md).

### Corrigido
- `.gitignore` deixava de versionar `.env.example` (template sem segredos) — destravado.
- CI alinhado ao runtime (Node 20 → 22, `package.json engines`).
- Restaurados 2 docs históricos deletados por engano em `88829ce`
  (`docs/testesC15.md`, `docs/AUDITORIA_C0_C10_COMPLETA.md`).

---

## Histórico por camada (fechamentos)

Resumo; detalhe completo em [docs/PROGRESS.md](./docs/PROGRESS.md).

- **2026-06-20 — C15 Platform Admin**: painel `/admin` (404-absoluto, impersonate auditado, step-up MFA, export PDF).
- **2026-06-18 — C14 Proactive Jobs**: lembrete D-1 + dunning + follow-up (cron determinístico + IA interpreta resposta).
- **2026-06-17 — C13 Tenancy & Billing**: planos + Asaas (webhook verificado em prod).
- **2026-06-15 — C12 AI Agent Intents**: ator de sistema `ai_agent` + tools.
- **2026-06-11 — C11 AI Agent Base**: Gemini, saga LLM-fora-de-TX, guards anti-SAMD (gate adversarial 50/50).
- **2026-06-07 — C10 Messaging + Webhook Meta** e **C9 Financial Core** (faturamento automático + Caixa).
- **2026-06-03 — C7 Clinical** (prontuário/prescrição/PDFs) e **C8 Consultório UI**.
- **2026-05-31 — C6 Scheduling Core**: agenda, slots, state machine, anti-overlap.
- **2026-05-30 — C5 Patient**: encryption per-tenant + LGPD export/delete.
- **2026-05-29 — C4 Outbox + Audit + Idempotency** (production-grade).
- **2026-05-28 — C3 Identity/Auth/Claims/RBAC** e **C2 Multi-Tenant + RLS**.
- **2026-05-26 — C1 Banco + Drizzle + Migrations** e **C0 Fundação do Repositório**.
- **Pós-camadas**: receituário de controle especial (Fase 1), UI (agenda/config/documentos/relatórios), onboarding via convite mágico, observabilidade C16 (Ondas 0–4).

[Unreleased]: https://github.com/
