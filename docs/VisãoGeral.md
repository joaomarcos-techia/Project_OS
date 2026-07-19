# ClinicaOS v2 — Documentação Definitiva

**Versão**: 1.0
**Data de consolidação**: 2026-05-24
**Autor original das decisões**: João Marcos Rodrigues Duarte (Qoro)
**Domínio principal**: qoro.dev
**Status**: Em design, pre-implementação

---

> **Como ler este documento**
>
> Este documento é a **fonte da verdade arquitetural, técnica, de produto e estratégica** do ClinicaOS v2. Foi escrito assumindo que o contexto original da conversa de design será perdido, que ninguém lembrará das motivações, que o código pode mudar completamente, que o time pode ser outro e que o sistema pode crescer 100x.
>
> Cada decisão aqui registrada inclui: **o que foi decidido, por que, quais alternativas foram descartadas, quais trade-offs foram aceitos, quais riscos persistem**. Não há decisões sem racional. Quando você (futuro) for tentado a quebrar uma regra, leia primeiro o "por que" — se o contexto mudou, OK quebrar. Se não mudou, não quebre.
>
> **Convenções:**
> - 🔒 = decisão permanente, não negocie sem repensar tudo
> - 🔓 = decisão temporária, esperada mudar conforme o produto evolui
> - ⚠️ = armadilha conhecida, leia antes de tocar
> - 💡 = insight que veio de experiência, não de teoria
> - 📌 = ponto onde "o eu do futuro" provavelmente tentará simplificar e vai se ferrar

---

## Sumário

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Filosofia Arquitetural](#2-filosofia-arquitetural)
3. [Decisões Técnicas Fundamentais](#3-decisões-técnicas-fundamentais)
4. [Estrutura Completa dos Módulos](#4-estrutura-completa-dos-módulos)
5. [Fluxos Críticos do Sistema](#5-fluxos-críticos-do-sistema)
6. [Arquitetura de IA](#6-arquitetura-de-ia)
7. [Segurança e Compliance](#7-segurança-e-compliance)
8. [Estratégia de Escalabilidade](#8-estratégia-de-escalabilidade)
9. [Estratégia Comercial e Produto](#9-estratégia-comercial-e-produto)
10. [Roadmap Realista](#10-roadmap-realista)
11. [Decisões Críticas e Não Negociáveis](#11-decisões-críticas-e-não-negociáveis)
12. [Conhecimento Tácito](#12-conhecimento-tácito)
13. [Apêndices](#13-apêndices)

---

# 1. Visão Geral do Projeto

## 1.1 O que é o QORO

Qoro oferece um **sistema operacional para clínicas pequenas e médias brasileiras** — não é um sistema de gestão clínica genérico. É um produto SaaS multi-tenant que combina **gestão clínica + agente de IA conversacional via WhatsApp + cobrança automatizada + auditoria forense** em um único produto integrado.

O sistema é vendido **white-label leve** (logo, cor primária, nome em PDFs) sob o domínio principal `qoro.dev`. Todas as clínicas acessam por `app.qoro.dev` (o tenant é resolvido pelo `clinic_id` do JWT). **Não há subdomínio por clínica** (decisão — ver §3.9).

## 1.2 Qual problema resolve

**Problema central**: clínicas pequenas e médias brasileiras vazam receita constantemente por **falha operacional sistêmica**, não por falta de demanda. Os vazamentos identificados no sistema antecessor (v1) e validados empiricamente:

1. **Pacientes que faltam sem aviso e o slot é perdido** — sem confirmação automatizada, ~15-25% de no-show.
2. **Atendimentos finalizados sem cobrança correspondente** — sistema permite "marcar como atendido" sem gerar lançamento, R$ 2-6k/mês perdidos.
3. **Cobranças esquecidas e não recuperadas** — sem dunning automatizado, ~30% das contas a receber viram inadimplência permanente.
4. **Recepção sobrecarregada** — atendente passa 60% do tempo no WhatsApp respondendo "qual o horário?", "tem vaga sexta?", "quanto custa consulta?" — trabalho que IA resolve por R$ 0,002 por conversa.
5. **Retornos não agendados** — médico pediu "volta em 3 meses", paciente esqueceu, clínica perdeu a consulta de retorno.

Atacamos cada vazamento com **automação operacional + IA + integração financeira**.

## 1.3 Posicionamento do produto

- **Não é**: ERP médico generalista (Tasy, MV, Philips), nem prontuário eletrônico isolado (iClinic Lite, Doctoralia).
- **É**: plataforma operacional opinionada, com fluxos pré-definidos otimizados para clínica solo (médico-dono) até clínicas pequenas (até 10 funcionários).
- **Slogan estratégico**: "O sistema operacional anti-vazamento da sua clínica."

📌 **Diferencial defensável** (moat): a combinação **agente IA + cobrança + auditoria** num único produto. Concorrentes têm pedaços — iClinic tem prontuário e agenda, Memed tem prescrição, Asaas tem cobrança, ChatGPT pode até atender pacientes. **Nenhum tem tudo integrado e otimizado para o fluxo operacional da clínica brasileira pequena.**

## 1.4 Visão de longo prazo

Em 5 anos, ClinicaOS deve ser a **opção default para qualquer médico brasileiro que decide abrir clínica própria ou consultório solo**. O produto deve ser tão integrado ao dia operacional que **trocar de sistema custe mais que o desconto que um concorrente ofereça**.

Marcos de visão:
- **Ano 1**: 50 clínicas pagantes, validação de produto-mercado
- **Ano 2**: 300-500 clínicas, expansão para verticais (estética, odontologia, fisio)
- **Ano 3**: 1.500-3.000 clínicas, API pública e integrações com Conta Azul/Omie
- **Ano 5**: 10k+ clínicas, marketplace de templates clínicos, módulo de telemedicina

## 1.5 Filosofia do sistema

🔒 **Princípios que orientam toda decisão de produto e engenharia:**

1. **Anti-vazamento antes de qualquer feature nova** — toda funcionalidade deve responder: "isso impede dinheiro de escapar, ou só cria conforto?". Se for só conforto, vai pra fila.
2. **Opinionado sobre flexível** — o produto tem opinião sobre o fluxo certo. Configuração só onde negócio realmente varia. Configurabilidade desmedida é o que matou o v1.
3. **IA como funcionário operacional, não como brinquedo** — IA executa tarefas (agenda, confirma, cobra), não conversa por conversar.
4. **Solo founder mantém sozinho** — toda decisão arquitetural passa pelo teste "consigo debugar isso sozinho às 2h da manhã?". Se não, não entra.
5. **Postgres é a fonte da verdade** — single source of truth. Cache, índice secundário, materialized view são otimizações. Se sumirem, sistema reconstrói.
6. **Eventos são append-only** — escrita-única, leitura-projetada. Nunca mute eventos.
7. **Isolamento de tenant é sagrado** — uma clínica nunca vê dado de outra, nem por bug, nem por erro humano. RLS no banco é a defesa que não falha.
8. **Compliance é vantagem competitiva, não custo** — LGPD/CFM bem feitos vendem pra clínica que já levou multa.

## 1.6 Tipos de clínicas atendidas

**Atende bem desde o dia 1:**
- Médico-dono solo (clínico geral, cardio, pedia, psiquiatra, gineco, dermato, oftalmo) — 1 médico, 1 atendente ou nenhum
- Clínicas pequenas até 10 funcionários (até 3-4 médicos, recepção, financeiro)
- Clínicas de psicologia, nutrição, fisioterapia (consulta + retorno recorrente)
- Clínicas de estética (consulta + pacote de sessões + estoque simples)

**Atende mal (ou não atende) no v2 inicial:**
- Hospitais (internação, prescrição controlada SNGPC)
- Clínicas que dependem fortemente de convênio/TISS (chega na v2.1)
- Laboratórios (fluxo é coleta+resultado, não consulta)
- Clínicas com >10 funcionários e múltiplas unidades complexas (chega no plano Pro, v2.2)

## 1.7 O que o sistema NÃO deve virar

🔒 **Anti-escopo explícito** — listas do que o ClinicaOS recusa ser:

1. **Não vira ERP médico genérico** — recusamos features que só clínica grande usa (custos por centro, BSC, planejamento estratégico).
2. **Não vira plataforma de marketplace** — não conectamos paciente com clínica nem agendamos sem a clínica saber.
3. **Não vira sistema de telemedicina pura** — telemedicina pode ser feature, não core.
4. **Não vira plataforma de IA conversacional generalizada** — agente IA tem escopo restrito: agendar, confirmar, cobrar, follow-up. **Não dá diagnóstico, não interpreta exame, não orienta clinicamente.** Isso é regulação (SAMD/ANVISA) e responsabilidade clínica.
5. **Não vira ferramenta de marketing** — não substitui RD Station/Hubspot. Pode ter integração via webhook futuramente.
6. **Não vira sistema de gestão de convênios** — TISS vem como módulo opcional na v2.1, nunca como core.

---

# 2. Filosofia Arquitetural

## 2.1 Princípio fundamental: bounded contexts isolados

O v1 falhou porque **agregou complexidade por técnica, não por domínio**. Toda regra de financeiro foi pra `financeiro.ts` (1352 LOC), toda regra de agendamento pra `agendamentos.ts` (1290 LOC), e essas god-modules conversavam diretamente entre si. Resultado: mudança em "convênio sem coparticipação não fatura" tocava 3-5 arquivos, e o `clinicId` aparecia **537 vezes manualmente** em queries.

🔒 **Regra invariante**: ClinicaOS v2 é organizado por **bounded contexts** (Domain-Driven Design). Cada contexto:

- Tem **um único módulo no código** que escreve nas suas tabelas
- **Não acessa diretamente tabelas de outro contexto** (proibido SQL JOIN cross-context)
- Comunica com outros contextos via **eventos no outbox** (assíncrono) ou **API interna explícita** (síncrono)
- Tem **dono claro de regra de negócio** — se a regra é financeira, vive em Financial. Se é clínica, em Clinical. Não há área cinza.

**Contextos definidos** (8 no v2 inicial):

| # | Contexto | Responsabilidade |
|---|---|---|
| 1 | **Identity** | Autenticação, usuários, roles, permissions, sessions |
| 2 | **Tenancy & Billing** | Clínicas (cadastro), planos, mensalidade que VOCÊ cobra, churn, MRR |
| 3 | **Patient** | Pacientes, contato, LGPD consents, suppression list, alergias, medicamentos em uso |
| 4 | **Scheduling** | Agendamentos, slots, agenda do médico, procedimentos, salas, multi-unidade |
| 5 | **Clinical** | Prontuários, prescrições, atestados, exames, encaminhamentos, anamnese |
| 6 | **Financial** | Lançamentos, pagamentos, PIX, fluxo de caixa, fornecedores, estoque |
| 7 | **AI Agent** | Conversas WhatsApp, intents, agent config (params), conversation memory, retenção |
| 8 | **Platform Admin** | Audit events, exportação PDF, super_admin actions, métricas operacionais |

## 2.2 Por que isso evita o "efeito hidra"

No v1, uma mudança em regra financeira tocava `financeiro.ts` + `agendamentos.ts` + `contas-receber-convenio.ts` + types financial. 3-5 arquivos = 3-5 chances de inconsistência. Cada fix tinha alta probabilidade de quebrar outra coisa.

No v2, a regra invariante: **Scheduling emite `AppointmentCompleted` no outbox; Financial reage**. Scheduling não sabe nem se importa com convênio, valor, ou regras de faturamento. Mudança em regra de faturamento → toca apenas Financial.

💡 **Insight crítico do v1**: a hidra não veio de Firebase nem de Next.js. Veio de **organizar código por técnica em vez de por domínio**. Postgres com RLS resolve o boilerplate de `clinicId`, mas se não resolver o problema de bounded contexts, a hidra renasce no Postgres.

## 2.3 Multi-tenant single deploy

🔒 **Decisão permanente**: ClinicaOS v2 é **single deploy multi-tenant**. UM código rodando, atendendo todas as clínicas.

**Por que isso vs deploy-per-clinic (modelo v1):**

| Critério | Deploy-per-clinic (v1) | Single deploy multi-tenant (v2) |
|---|---|---|
| Manutenção operacional | 1 deploy por clínica = N deploys | 1 deploy só |
| Atualização de feature | Pipeline complexo, rollback fragmentado | Deploy único, rollback unificado |
| Custo de hosting | Linear com clínicas | Cresce, mas escala melhor |
| Onboarding nova clínica | Criar projeto, configurar env, deploy | Inserir row na tabela `clinics` |
| Bug fix urgente | Push pra N clientes | Push, todos pegam |
| Isolamento de dados | "Total" (mas falso — mesma codebase) | Via RLS no Postgres (defesa real do banco) |
| Migração entre versões | Caos | Trivial |

A "vantagem" de isolamento do deploy-per-clinic é **falsa segurança** — todos os clientes rodam o mesmo código, então um bug afeta todos igualmente. RLS no Postgres dá isolamento **real** porque o banco fisicamente recusa retornar dado cross-tenant.

⚠️ **Quando deploy-per-clinic faria sentido**: clínica enterprise contratual exigir "meus dados não podem estar no mesmo banco do concorrente". Pra clínicas pequenas/médias brasileiras, **nunca**.

## 2.4 Control Plane vs Data Plane

ClinicaOS tem **dois planos arquiteturais lógicos** no mesmo deploy:

**Data Plane** (operação das clínicas):
- Dashboards das clínicas, app dos funcionários
- Conversas IA, agendamentos, financeiro
- Tudo que afeta o dia-a-dia operacional da clínica
- Acesso: usuários autenticados de cada clínica, escopo via RLS

**Control Plane** (operação da Qoro):
- Dashboard master (você)
- Billing das clínicas (cobrança da mensalidade)
- Métricas globais (MRR, churn, custo Gemini total)
- Configuração de planos, prompts do agente
- Acesso: apenas `super_admin` (você), todas ações auditadas

🔒 Os dois planos vivem em **rotas separadas no Next.js** (`/app/*` vs `/admin/*`), no mesmo deploy e mesmo banco. **Separação é lógica, não física.**

> ⚠️ **Corrigido em 2026-07-16:** este parágrafo dizia que os planos vivem em *subdomínios diferentes* (`admin.qoro.dev`). **Esse subdomínio nunca foi provisionado** — os dois vivem em `app.qoro.dev`. A separação de host foi **adiada com motivo** ([PROGRESS §D7](./PROGRESS.md)): ela não protege o painel (a defesa é `guardAdminAccess()` → super_admin + AAL2 → 404 absoluto, que independe de host) e só passa a valer junto com CSP bloqueante + cookie escopado por host.

📌 **Armadilha futura**: vai dar vontade de criar deploy separado pro Control Plane "por segurança". Não faça. A separação por RLS + rotas dedicadas + role super_admin é suficiente. Deploy separado dobra trabalho de manutenção pra zero ganho real.

## 2.5 Segurança em 4 camadas (defesa em profundidade)

🔒 **Defesa obrigatória, cada camada redundante**:

| Camada | Responsabilidade | Tecnologia |
|---|---|---|
| **L1: Authentication** | Provar quem é o usuário | Supabase Auth (email+senha, magic link, MFA opcional) |
| **L2: Authorization (JWT)** | Carregar `clinic_id` + `role` + `permissions` no token | Supabase JWT com claims customizados via Auth Hook |
| **L3: Row Level Security** | Última linha de defesa no banco | Postgres RLS em **toda** tabela: `USING (clinic_id = auth.jwt()->>'clinic_id')` |
| **L4: Encryption at-rest per-tenant** | Dados sensíveis criptografados com chave por clínica | `pgcrypto` + chave derivada do `clinic_id` via KDF, master key no Supabase Vault ou Google Secret Manager |

⚠️ **A camada que mais importa é L3 (RLS)**. Sem RLS, defesa depende de disciplina humana ("não esqueça do `where clinic_id`"). Com RLS, o banco **fisicamente recusa** retornar dado de outra clínica mesmo se o código backend tentar. Funciona contra:
- Bug de backend que esquece o filtro
- SQL injection
- Atacante com credencial legítima de outra clínica
- Endpoint mal-feito de novo dev

A camada **L4** (encryption per-tenant) protege contra **roubo de backup**: se atacante levar o dump inteiro, dados sensíveis exigem chave de cada clínica (armazenadas em vault separado).

## 2.6 Princípio "folha de caderno"

💡 Princípio formulado pelo founder: **"cada clínica deve ser tratada como uma única folha de um caderno; se uma folha for cortada, as outras devem permanecer intactas."**

Consequências práticas obrigatórias:

1. 🔒 **Hard delete cumpre LGPD** — quando clínica pede LGPD-delete, dados são **deletados de verdade** (não marcados `deleted_at`). Cascading deletes via FK garantem que tudo dela some. Soft-delete deixa rastro que outro tenant poderia ver via bug. **Compromisso aceito**: soft-delete + hard-delete agendado 30 dias depois (janela de "undo" administrativo).

2. 🔒 **Audit log é per-tenant**. Cada clínica tem seu audit. Você (super_admin) consegue ler todos, mas **toda leitura cross-tenant fica logada automaticamente** numa tabela `super_admin_actions`. Você nunca olha sem deixar rastro — protege você juridicamente também.

3. 🔒 **Backups são per-tenant exportáveis**. Quando uma clínica sai, dump SQL só dos dados dela (LGPD Art. 18 — portabilidade). E `DELETE FROM clinics WHERE id=X` cascateia limpando tudo.

## 2.7 Event-driven via Outbox Pattern

🔒 **Decisão fechada**: comunicação assíncrona entre bounded contexts via **Outbox Pattern**.

**Como funciona:**

1. Quando contexto A precisa notificar B, A escreve em duas tabelas **na mesma transação**:
   - Tabela de dados de negócio (ex: `appointments`)
   - Tabela `outbox` (ex: `outbox` com payload do evento)
2. A transação commita atomicamente — ou ambas escritas vão, ou nenhuma
3. Worker em background polleia `outbox` e entrega o evento aos consumidores (que rodam no mesmo deploy via handler registrado)
4. Após entrega bem-sucedida, marca o evento como processado (idempotente)

**Por que outbox vs alternativas:**

| Alternativa | Por que rejeitada |
|---|---|
| Chamada direta entre contextos | Acoplamento — viola bounded contexts |
| Postgres LISTEN/NOTIFY | Sem retry, sem persistência, perde evento se worker tá down |
| Fila externa (RabbitMQ, SQS) | Mais infra, ponto de falha extra, custo. Outbox usa Postgres que já temos. |
| Webhooks diretos | Sem garantia de entrega, sem ordem, sem dedup |

**Garantias do outbox:**
- ✅ **Exactly-once delivery** (na prática): idempotency key impede duplicação
- ✅ **Atomicidade** com a transação de negócio
- ✅ **Retry automático** com backoff exponencial
- ✅ **Auditável**: todo evento fica registrado

📌 **Decisão sobre escopo dos eventos**: por design, **eventos são públicos** (consumíveis por webhook externo no futuro). Eventos exclusivamente internos têm prefixo `internal.*`. Isso evita refactor quando v2.x adicionar webhooks pra clientes.

## 2.8 Tolerância a falhas

ClinicaOS depende de **três serviços externos críticos**:

1. **Supabase** (Auth + DB + Storage)
2. **Meta Cloud API** (WhatsApp)
3. **Google Gemini** (IA conversacional)

🔒 **Cada uma tem estratégia de degradação explícita:**

**Supabase down:**
- Sistema para. Sem alternativa real no curto prazo.
- Mitigação: monitorar uptime publicado (Supabase: 99.9% SLA Pro). Se cair, comunicar transparentemente via WhatsApp pro gestor de cada clínica. **Plano B no longo prazo**: Drizzle ORM permite migrar pra Neon/Railway em ~2 semanas se Supabase virar problema crônico.

**Meta Cloud API down ou número bloqueado:**
- Abstração `MessagingProvider` permite swap pra Z-API em ~30 minutos.
- Z-API existe **só como plano B operacional**, não como SKU comercial.
- Clínica nem percebe — recebe/envia normal.

**Gemini down:**
- Circuit breaker já implementado (lib v1, portar).
- Agente degrada pra mensagem fallback: *"Recebi sua mensagem. Vou anotar e a recepção te responde em breve."*
- Atendente recebe alerta de "fila de mensagens IA caída — atendimento humano necessário".
- Cliente perde funcionalidade temporariamente, sistema não trava.

📌 **Não construa retry-de-tudo-pra-sempre.** Se Supabase tá down há 1h, não adianta sua aplicação reescrever em loop infinito. Define max attempts (3-5) com backoff, depois dead letter queue + alerta humano. Você (solo) precisa saber que algo precisa de atenção, não que tá tudo tentando sozinho.

## 2.9 IA-first, mas não IA-cega

🔒 **Princípio**: IA é **funcionário operacional**, não decisor clínico.

**O que a IA faz:**
- Agendar consultas
- Confirmar agendamentos (24h antes)
- Cobrar pagamentos pendentes
- Responder dúvidas operacionais (horário, preço, endereço)
- Coletar dados de cadastro (nome, CPF, telefone, motivo da consulta)
- Enviar lembretes de retorno
- Notificar atendente quando precisa de humano

**O que a IA NÃO faz** (🔒 hardcoded no prompt sistema):
- Diagnóstico
- Interpretação de exames
- Orientação clínica ("isso parece grave, vá pro hospital")
- Receitar medicamentos
- Triagem de sintomas

**Por que esse limite é absoluto**: ANVISA classifica como SAMD (Software as a Medical Device) qualquer software que dá decisão clínica. SAMD exige registro ANVISA (Classe I-IV), testes clínicos, responsável técnico. Cair nessa classificação inviabiliza o produto.

Resposta padrão da IA pra qualquer pergunta clínica: *"Não posso te orientar sobre sintomas. Vou marcar pra você conversar com o médico, ok?"*

## 2.10 Modularidade e extensibilidade

ClinicaOS é desenhado pra **extensão sem modificação**:

- **Novo módulo opcional** (ex: telemedicina) entra como bounded context novo, consumindo eventos existentes
- **Nova integração externa** (ex: Conta Azul) entra como consumidor do outbox + webhook
- **Nova feature de IA** (ex: lembrete por SMS) entra como novo handler de intent + novo `MessagingProvider`
- **Novo formato de documento clínico** (ex: laudo) reutiliza o sistema de templates + PDF que já existe

📌 **Resista à tentação de "framework de plugins"**. Modularidade boa é boas fronteiras + boas interfaces. Plugin system é overengineering típico de SaaS imaturo. Adicione plugin system apenas quando 3+ integrações externas distintas pedirem (provavelmente nunca).

---

# 3. Decisões Técnicas Fundamentais

## 3.1 Stack consolidado

| Camada | Tecnologia | Versão alvo |
|---|---|---|
| **Frontend Framework** | Next.js (App Router, Server Components, Server Actions) | 15+ |
| **UI Components** | shadcn/ui + Tailwind CSS | 4+ |
| **Forms** | React Hook Form + Zod | latest |
| **State Management** | Zustand (mínimo) + React Query (server state) | latest |
| **Database** | Postgres via Supabase | 15+ |
| **ORM** | Drizzle | latest |
| **Auth** | Supabase Auth | latest |
| **File Storage** | Supabase Storage | latest |
| **Realtime** | Supabase Realtime (Postgres logical replication) | latest |
| **AI Provider** | Google Gemini 2.5 Flash | latest |
| **WhatsApp** | Meta Cloud API (oficial) com Z-API como fallback | API v18+ |
| **Cobrança (você)** | Asaas (mensalidade das clínicas) | latest |
| **Cobrança paciente** | Manual via atendente (sem gateway no v2 inicial) | — |
| **Rate Limiting** | Upstash Redis | latest |
| **Secrets** | Supabase Vault + Google Secret Manager (chaves críticas) | latest |
| **Email transacional** | Resend (cadastro, recuperação senha, faturas) | latest |
| **Logging** | in-house estruturado (ADR-029 — **sem Pino**) | — |
| **Error Tracking** | Sentry | latest |
| **Logs centralizados** | Better Stack ou Axiom | latest |
| **PDF Generation** | @react-pdf/renderer | latest |
| **Hosting App** | Vercel | Pro |
| **Hosting Landing** | Firebase Hosting (atual, não migrar) | — |
| **Domain** | qoro.dev (já adquirido) | — |
| **DNS** | wildcard `*.qoro.dev` → Vercel | — |
| **Calendário UI** | React Big Calendar | latest |
| **Charts** | Recharts | latest |

## 3.2 Por que Supabase (e não Firebase, e não Postgres puro)

🔒 **Decisão fechada**: Supabase é o backend-as-a-service do v2.

**Por que Supabase vs Firebase (stack do v1):**

| Critério | Firebase (v1) | Supabase (v2) |
|---|---|---|
| Banco | Firestore (NoSQL) | Postgres (SQL) |
| Joins | Não suporta | Nativo |
| Row Level Security | Manual nas rules + código | Nativo no banco (defesa real) |
| Multi-tenant boilerplate | `where('clinicId', '==', X)` em 537 lugares | Zero, RLS faz |
| Custo | Imprevisível (reads/writes) | Linear ($25/mês base) |
| Backups | Manual | PITR automático Pro |
| TTL | Sim, com policy | Via pg_cron |
| Relatórios cross-tabela | N+1 manual | SQL JOIN |
| Tipos | Sem schema enforcement | Schema + tipos via Drizzle |
| Realtime | Maduro | Maduro (Postgres logical replication) |
| Storage | Maduro | Suficiente |
| Auth | Muito maduro | Maduro |

**A única coisa que Firebase faz melhor**: Phone Auth (SMS). Não usamos no v2.

**Por que Supabase vs Postgres puro (Neon, Railway, RDS):**

- Auth + DB + Storage + Realtime + Edge Functions num único provider = simplicidade operacional pra solo founder
- Studio visual (UI tipo phpMyAdmin moderna) reduz dependência de saber SQL profundamente
- Curva de aprendizado boa pra quem vem de Firebase
- Migração de saída é trivial (Postgres é Postgres) — não há vendor lock-in real **se** seguirmos as regras abaixo

🔒 **Regras anti-vendor-lock pra Supabase:**

1. **Use Drizzle ORM** — schema portável, queries portáveis. Se sair de Supabase, leva o Drizzle pra Neon/Railway sem reescrever.
2. **Auth via JWT padrão** — JWT do Supabase Auth é JWT padrão. Pode ser substituído por Clerk/Auth0/Firebase Auth se preciso, sem reescrever app.
3. **Evite Edge Functions do Supabase** — use Next.js API routes ou Vercel Functions. Edge Functions do Supabase são Deno, lock-in pesado.
4. **Não use features proprietárias do Supabase Auth** (ex: hooks no banco) — use auth padrão e adicione lógica no app.

Se essas 4 regras forem seguidas, **migração pra fora de Supabase é ~2 semanas de trabalho**, não meses.

## 3.3 Por que Drizzle e não Prisma

| Critério | Drizzle | Prisma |
|---|---|---|
| Footprint | Pequeno, sem runtime extra | Schema runtime engine pesado |
| Performance serverless | Boa (sem cold start extra) | Cold start ruim (Prisma engine boot) |
| Tipo de queries | Próximo do SQL puro | Abstração mais alta |
| Curva pra quem não sabe SQL | Aprende SQL olhando o output | Esconde o SQL |
| Migrations | Boa (drizzle-kit) | Boa, mais maduras |
| RLS support | Bom | Limitado |
| Comunidade | Crescendo rápido | Maior |

💡 **Razão decisiva**: Drizzle gera SQL que você lê e entende. **Pra solo founder com pouco SQL, isso é didático** — você aprende olhando o que o ORM faz. Prisma esconde tudo numa caixa preta.

📌 **Quando reconsiderar**: se time crescer pra 3+ pessoas e gente sentir falta de migrations declarativas mais robustas, Prisma é defensável. Mas pra solo, Drizzle ganha.

## 3.4 Por que Next.js (mantido do v1)

- Você já conhece, não há motivo pra trocar
- App Router maduro em 2026
- Server Actions reduzem boilerplate de API routes
- Server Components reduzem JS no cliente
- Vercel suporta nativo, deploy é git push

⚠️ **Limitações conhecidas a aceitar**:
- Build time cresce com app (~5-10 min em produção)
- Memory leak ocasional em dev mode com Hot Reload pesado
- Tipagem de Server Actions ainda evoluindo

📌 **Quando reconsiderar**: nunca, provavelmente. Next.js é a aposta segura pra Web pelos próximos 3-5 anos. Migração pra outro framework seria evento de vida.

## 3.5 Por que Meta Cloud API e não Z-API exclusivo

🔒 **Decisão fechada**: Meta Cloud API (oficial) é o **provider primário** de WhatsApp.

**Por que oficial:**

- **Sem risco de ban arbitrário** — Z-API é proxy do WhatsApp Web, Meta pode banir o número a qualquer momento sem aviso
- **Templates aprovados** — Meta exige aprovação prévia de mensagens proativas (lembretes, cobranças). Sem template aprovado, só responde dentro de 24h
- **Compliance** — Meta tem DPA (Data Processing Agreement) defensável pra LGPD/ANS. Z-API não tem equivalente
- **Custo previsível** — Meta cobra por conversa de 24h (~R$ 0,05-0,12 categoria utility). Z-API cobra por mensagem mas tem risco oculto (ban = perda de histórico)

**Por que ainda manter Z-API:**

- 🔓 **Plano B operacional**: se Meta bloquear número de uma clínica (acontece com falso positivo), swap pra Z-API em 30 min mantém operação. NÃO é SKU comercial.

🔒 **Abstração obrigatória**: módulo `MessagingProvider` em `/lib/messaging/` com interface única:

```typescript
interface MessagingProvider {
  sendMessage(to: string, content: MessageContent): Promise<SentMessage>;
  sendTemplate(to: string, templateId: string, vars: Record<string, string>): Promise<SentMessage>;
  setWebhookHandler(handler: WebhookHandler): void;
}
```

Implementações: `MetaCloudProvider`, `ZApiProvider`. Sistema escolhe por `clinic.messaging_provider` (default: Meta). Troca é 1 update no banco.

## 3.6 Por que Gemini e não OpenAI/Claude

| Critério | Gemini 2.5 Flash | GPT-4 mini | Claude Haiku |
|---|---|---|---|
| Custo input/output (1M tokens) | $0.075 / $0.30 | $0.15 / $0.60 | $0.25 / $1.25 |
| Qualidade pt-BR | Excelente | Excelente | Excelente |
| Latência | Baixa (~1-2s) | Baixa | Baixa |
| Function calling | Maduro | Maduro | Maduro |
| Suporte multi-turn | Sim | Sim | Sim |
| Confiabilidade SLA | Boa | Boa | Boa |

💡 **Razão decisiva**: custo. Gemini Flash é **2x mais barato** que GPT-4 mini e **3-4x mais barato** que Claude Haiku, com qualidade equivalente pra tarefa de "agendar consulta via chat". Pra 50 clínicas escalando, isso vira diferença real.

🔓 **Pode trocar futuramente** — abstração `AIProvider` permite swap. Se OpenAI/Anthropic baixarem preço ou Gemini piorar, troca é refactor leve.

## 3.7 Por que Asaas (mensalidade) e não Stripe/AbacatePay

| Critério | Asaas | Stripe | AbacatePay |
|---|---|---|---|
| PIX recorrente | Sim | Limitado | Não nativo |
| Boleto recorrente | Sim | Não | Não |
| Cartão recorrente | Sim | Sim | Não |
| NF-e automática | Sim | Não (precisa NotaCarioca, Bling) | Não |
| Brazilian focus | Total | Internacional | Total (mas só PIX) |
| Taxa | R$ 0,49/boleto, 0,99% PIX | 3.99% + R$ 0,39 cartão | R$ 0,49/PIX |
| Webhooks | Maduros | Maduros | Maduros |
| Integração | Boa | Excelente | Boa |

💡 **Razão decisiva**: Asaas é o **único que emite NF-e automaticamente E suporta os 3 métodos brasileiros (PIX, boleto, cartão) recorrentes**. Pra cobrar 50 clínicas/mês com NF em dia, é ele.

🔓 **Quando reconsiderar**: nunca pra mensalidade. Pra cobrança de paciente futura (v2.2+), AbacatePay pode entrar como opção de PIX dinâmico com melhor DX.

## 3.8 Por que Vercel e não Firebase Hosting/Cloudflare Pages

| Critério | Vercel | Firebase Hosting | Cloudflare Pages |
|---|---|---|---|
| Next.js nativo | Sim (criadores) | Suporta | Suporta com edge runtime |
| SSR | Otimizado | Via Cloud Functions Gen 2 (cold start ruim) | Edge (rápido mas com limitações) |
| ISR | Nativo | Fraco | Limitado |
| Preview por branch | Automático | Manual | Sim |
| Custom domains | Trivial | OK | Trivial |
| Wildcard SSL | Automático | OK | Automático |
| Custo (50 clínicas) | $20/mês Pro | Imprevisível | Mais barato em bandwidth |

💡 **Razão decisiva**: Vercel é feita pra Next.js. DX é incomparável. Pra solo founder, o tempo economizado em deploy/debug paga o custo várias vezes.

🔓 **Quando reconsiderar**: se custo do Vercel ultrapassar $500/mês (provavelmente em 200+ clínicas), Cloudflare Pages é alternativa séria. Migração é refactor médio.

## 3.9 Arquitetura de domínios

🔒 **Estrutura DNS definitiva:**

```
qoro.dev                        → landing page (Firebase Hosting, intacta)
*.qoro.dev                      → Vercel (todo o app)
  ├─ app.qoro.dev               → app de TODAS as clínicas (login roteia por clinic_id no JWT)
  └─ app.qoro.dev/admin        → dashboard master (você) — host próprio adiado (§D7)
```
<!-- DECISÃO (atual): NÃO há subdomínio por clínica para NINGUÉM. Todas as clínicas
     acessam por app.qoro.dev; o tenant é resolvido pelo clinic_id do JWT, não pelo
     host. Custom domain por clínica já tinha sido removido (2026-05); o subdomínio
     {slug}.qoro.dev por clínica foi DESCARTADO depois (baixo valor, custo de
     SSL/verificação/suporte). `clinics.slug` permanece só como identificador interno
     (NÃO é usado para roteamento). A tabela `clinic_domains` nunca foi criada. -->


**Configuração DNS** (uma vez):
```
A/CNAME  @   <IP/CNAME Firebase Hosting atual>   → landing fica
CNAME    *   cname.vercel-dns.com                → tudo mais → Vercel
```

**Por que dois providers (Firebase + Vercel) é aceitável:**
- DNS por host (`qoro.dev` landing vs `*.qoro.dev` app), cada um aponta pra provider diferente
- Zero conflito, zero custo extra de SSL (ambos auto-provê)
- Landing tem ciclo de vida diferente (muda 2x/mês) — separar evita redeploy do app a cada copy change
- Custo: free tier dos dois cobre você

🔒 **Slug da clínica** (identificador interno — NÃO é subdomínio, sem roteamento por host):
- Escolhido pelo gestor na contratação
- Validação: `[a-z0-9-]{3,30}` (CHECK em `clinics.slug`)
- Único no sistema
- **Reservados** (não permitir): `app`, `admin`, `api`, `www`, `mail`, `status`, `qoro`, `support`, `help`, `docs`, `blog` (herança do tempo de subdomínio; mantido por segurança)
- Permitir troca **1x grátis** depois (gestor errou, deixa corrigir)

## 3.10 Arquitetura de repositório

🔒 **Estrutura definitiva**:

```
qoro-landing/         ← repo existente, manter intacto (Firebase Hosting)
qoro/                 ← repo novo do v2
  src/app/
    (app)/            → app.qoro.dev (todas as clínicas; tenant via JWT)
    (admin)/          → app.qoro.dev/admin  (host próprio adiado — PROGRESS §D7)
    api/              → API routes
  src/lib/
    db/               → Drizzle schema + migrations + queries
    auth/             → Supabase Auth helpers
    messaging/        → MessagingProvider abstraction
    ai/               → Gemini + agent logic
    outbox/           → outbox pattern implementation
    audit/            → audit logging helpers
    pdf/              → PDF generation
  src/components/
    ui/               → shadcn/ui
    forms/            → React Hook Form components
    shared/           → cross-feature components
  src/contexts/       → bounded contexts (8 módulos)
    identity/
    tenancy/
    patient/
    scheduling/
    clinical/
    financial/
    ai-agent/
    platform-admin/
  drizzle/
    schema/           → table definitions per context
    migrations/       → versioned migrations
  docs/
    adr/              → Architecture Decision Records (este documento + futuros)
    runbooks/         → operational runbooks
```

📌 **Por que monorepo single-app vs Turborepo**:
- Solo founder não precisa de pacotes separados ainda
- Compartilhamento de código é trivial dentro do mesmo Next.js
- Pode migrar pra Turborepo no futuro sem refactor doloroso
- Setup inicial é minutos, não horas

🔓 **Quando migrar pra Turborepo**: quando tiver 2+ frontends (app web + app mobile, ou app paciente separado). Não antes.

## 3.11 CI/CD

🔒 **Pipeline**:

1. **Push em qualquer branch** → Vercel cria preview deploy automático
2. **Pull request em `main`** → CI roda:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test` (Vitest)
   - `pnpm build` (sanity check)
   - Drizzle migrations dry-run contra ambiente staging
3. **Merge em `main`** → Vercel deploy produção
4. **Production migrations** rodam em job separado controlado manualmente (não auto):
   - Comando: `pnpm db:migrate:prod`
   - Backup automático antes (Supabase PITR + dump manual extra)
   - Logs gravados em `super_admin_actions`

⚠️ **Nunca deixar migration rodar automaticamente em produção sem revisão humana.** Schema change é evento crítico, merece atenção dedicada.

## 3.12 Observabilidade

🔒 **Stack mínimo obrigatório:**

| Camada | Ferramenta | O que captura |
|---|---|---|
| Erros aplicação | Sentry | Stack traces, contexto de usuário, source maps |
| Logs estruturados | Better Stack (drain ativo) | Logs JSON in-house centralizados |
| Métricas custom | Postgres + dashboard interno | MRR, conversas IA, custo Gemini |
| Uptime check | Better Stack uptime monitor | Health do app + WhatsApp |
| Performance | Vercel Analytics | TTFB, LCP, Core Web Vitals |
| Database | Supabase Studio + queries de monitoring | Slow queries, conexões |

📌 **Não invente "monitoring custom"** no início. Use as ferramentas mainstream. Você solo, precisa de pager funcional, não de dashboard bonito.

🔓 **Quando adicionar**: se algo te morder 2x, vira métrica.

## 3.13 Cache e performance

🔓 **Estratégia inicial: cache mínimo, mede primeiro**

- **React Query** no cliente: cache de queries, deduplica requests, revalida automaticamente
- **Next.js cache** (ISR, Server Components cache): usar default, otimizar quando medir lentidão
- **Upstash Redis** (já temos): rate limiting + cache de dados quentes (lista de procedimentos, lista de médicos)
- **Postgres materialized views**: pra relatórios pesados (dashboard financeiro mensal)

📌 **Anti-padrão**: cache Redis para tudo. Cache invalidation é a "segunda coisa mais difícil em CS" (Phil Karlton). Cache só onde provou ser gargalo. Antes disso, é débito futuro.

## 3.14 Idempotency

🔒 **Toda escrita no sistema requer idempotency key.** Sem exceção.

Padrão:
- Cliente gera UUID v7 antes do request
- Servidor verifica `idempotency_keys` table (RLS por clinic_id, TTL 24h)
- Se já existe com mesmo hash payload → retorna resposta cached
- Se já existe com payload diferente → erro 409
- Se não existe → processa, grava key+resposta, responde

**Operações que requerem isso:**
- Criar agendamento
- Confirmar pagamento
- Enviar mensagem WhatsApp
- Criar prescrição
- Criar prontuário
- Qualquer evento no outbox

💡 **Por que isso é não-negociável**: cliente clica 2x, rede dropa e retenta, worker pega job duplicado — sem idempotency, dá pra criar 2 agendamentos pro mesmo paciente no mesmo horário. **Bug com cara de fraude.**

---

# 4. Estrutura Completa dos Módulos

Cada bounded context vive em `src/contexts/<nome>/` com estrutura interna padrão:

```
contexts/<nome>/
  schema.ts           → Drizzle table definitions
  types.ts            → TypeScript types/interfaces
  events.ts           → Eventos que emite no outbox
  api.ts              → API interna (chamada por outros contextos)
  actions.ts          → Server Actions (chamadas pelo frontend)
  queries.ts          → Read queries
  policies.ts         → RLS policies declarativas
  handlers.ts         → Handlers de eventos de outros contextos
  __tests__/
```

## 4.1 Identity

**Objetivo**: autenticar usuários, gerenciar identidade, controlar acesso.

**Responsabilidades:**
- Cadastro e login de usuários
- Reset de senha, magic link, MFA
- Gerenciamento de sessions
- Custom claims no JWT (`clinic_id`, `role`, `permissions`)
- Auto-heal de claims dessincronizados

**Entidades:**
- `users` (Supabase Auth + nossa tabela `profiles`)
- `sessions` (auditoria, IP, user agent)
- `roles` (gestor, doctor, attendant, financial, owner)
- `permissions` (granular: `view:agenda`, `create:prontuario`, etc.)
- `role_permissions` (default bundle por role)
- `user_permission_overrides` (gestor edita por usuário)

**Roles definidos:**

| Role | Bundle padrão |
|---|---|
| `super_admin` | Você. Acesso a tudo + cross-tenant (auditado). |
| `gestor` | Tudo dentro da clínica + criar funcionários + editar permissões |
| `doctor` | Agenda própria, prontuários, prescrições, consultório |
| `attendant` | Agenda, pacientes, chamadas, caixa |
| `financial` | Receber, pagar, fornecedores, relatórios |
| `owner` | Bundle "tudo" — usado em planos Solo (médico-dono é tudo) |

**Permissões granulares** (lista inicial, expandirá):

```
view:agenda, edit:agenda
view:patient, create:patient, edit:patient, delete:patient
view:prontuario, create:prontuario, sign:prontuario
view:prescription, create:prescription
view:financial, manage:financial
view:audit, export:audit
manage:employees, manage:permissions
manage:settings, manage:agent
view:consultorio
```

**Eventos emitidos:**
- `internal.user.created`
- `internal.user.role_changed`
- `internal.user.permissions_changed`
- `internal.user.session_started`
- `internal.user.session_revoked`

**Eventos consumidos:**
- `tenancy.clinic.suspended` → revoga sessions de todos usuários daquela clínica
- `tenancy.clinic.deleted` → hard delete de users daquela clínica

**Regras de negócio:**
- 🔒 2FA **obrigatório só pro `super_admin`** (**ADR-038** — decisão de MVP). `gestor` e `financial` recebem opt-in forte (banner de enrollment não-bloqueante), mas **não** são forçados enquanto não existirem recovery codes + reset por admin: sem rede de resgate, forçar 2FA tranca o cliente fora da própria clínica. Fonte: [mfa-policy.ts](../src/lib/auth/policies/mfa-policy.ts) (`mustHaveMFA`/`mustEnforceAAL2`). *(Corrigido em 2026-07-15 — esta seção afirmava obrigatoriedade pra gestor/financial, contradizendo o código e o ADR.)*
- 🔒 Session expira em 7 dias de inatividade. Refresh automático em uso ativo.
- 🔒 Auto-heal de claims: se claims do JWT diferem do banco, força re-login.
- 🔒 Tentativas de login: rate limit **dual** via Upstash (sliding window) — 10/15min por IP **e** 5/15min por `email_hash`; bloqueia se qualquer um estourar. Não há bloqueio de 1h: a janela desliza. Durante outage do Upstash o limite é fail-open com fallback em memória por instância (ADR-008 F-08). Fonte: [rate-limit.ts](../src/lib/auth/rate-limit.ts). *(Corrigido em 2026-07-15 — dizia "5/15min, bloqueia 1h".)*

**Edge cases:**
- Usuário deletado mas com session ativa → invalidar via lookup em `users.deleted_at`
- Usuário muda de clínica (raro, mas possível) → revoga session, força re-login com novo `clinic_id`
- Gestor revoga permissão de funcionário online → próximo request com claim velho falha, força re-login

**Como escalar:**
- Supabase Auth aguenta milhões de MAU
- Custom claims via Auth Hook é eficiente
- `profiles` table cresce linear com usuários, indexada por `clinic_id` + email

## 4.2 Tenancy & Billing

**Objetivo**: gerenciar clínicas como clientes, cobrar mensalidade, controlar planos.

**Responsabilidades:**
- Cadastro de clínicas
- Atribuição de planos (Solo, Clínica, Pro)
- Cobrança recorrente via Asaas
- Geração de NF-e mensal
- Suspensão por inadimplência (dunning)
- Métricas comerciais: MRR, churn, LTV
- Annual prepay com desconto

**Entidades:**
- `clinics` (id, slug, nome, cnpj, cnes, endereço, telefone, email, plano, status)
- `clinic_units` (multi-unidade — filiais/salas; não gated por plano — ADR-024)
<!-- `clinic_domains` (slug → clinic_id, roteamento por subdomínio) REMOVIDO: não há
     subdomínio por clínica; tabela nunca foi criada. Slug vive em clinics.slug como
     identificador interno. -->

- `plans` (Solo, Clínica, Pro, com limites)
- `subscriptions` (clinic_id, plan_id, status, started_at, current_period_end)
- `invoices` (clinic_id, subscription_id, valor, status, due_date, paid_at, nfe_url)
- `usage_metrics` (clinic_id, period, agendamentos_count, conversas_ia_count)
- `setup_fees` (cobrança única de onboarding)
- `annual_prepayments` (clinic_id, valor, desconto, refund_pro_rata)

**Planos definidos:**

| Plano | Preço/mês | Limites |
|---|---|---|
| **Solo** | R$ 149 | 1 médico, 1 usuário, 200 agendamentos/mês, 200 conversas IA/mês |
| **Clínica** | R$ 349 | até 5 usuários, 800 agendamentos/mês, 800 conversas IA/mês |
| **Pro** | R$ 699 | até 10 usuários, 2500 agendamentos/mês, 2500 conversas IA/mês |
| **Pro+** | sob consulta | ilimitado, SLA dedicado |

<!-- ADR-024 (2026-06-15) — modelo de planos revisado, AUTORIDADE sobre menções
     dispersas no §9:
     1. Software-core (inclusive o agente de IA, painéis e auditoria) está em TODOS
        os planos — sem feature-gating no código. Planos diferenciam por 3 alavancas:
        capacidade (usuários/cotas), serviço/SLA (suporte, gerente de conta) e
        features escala-natural (úteis só com equipe). Ver "O que cada plano destaca".
     2. WhatsApp é Meta Cloud API em TODOS os planos. Z-API é só fallback
        operacional se a Meta cair (não é diferencial de plano). Ver §3.5.
     3. Multi-unidade NÃO é gated por plano. (Subdomínio por clínica não existe — §3.9.)
     4. Limite = teto anti-abuso, não alavanca. USUÁRIOS é a única trava dura;
        AGENDAMENTOS nunca bloqueia (anti-produto, só avisa); IA tem teto generoso
        (só bloqueia abuso). Sem overage/add-on de volume. Números a validar com os
        primeiros clientes (200/200 do Solo é apertado — subir). -->


**Add-ons:**
- Annual prepay: 15% off sobre valor anual

<!-- ADR-024: add-ons de uso extra (agendamentos/IA) REMOVIDOS. Cota é hard cap;
     quem precisa de mais volume sobe de plano. -->

**O que cada plano destaca** (uso em landing/comercial — ADR-024 §Decision #1):

📌 Nada aqui é gate de código. O software-core é igual em todos; o que muda é
capacidade (usuários), serviço/SLA e features que só passam a importar com equipe
(escala-natural). Painéis anti-vazamento e compliance ficam no plano de ENTRADA.

- **Solo** (até 2 usuários):
  - Agente de IA no WhatsApp 24/7 (agenda, confirma, cobra, responde)
  - Confirmação, lembrete e reativação de retornos
  - Cobrança automática de pendências do paciente
  - Consultório, prontuário e documentos em PDF
  - Caixa, contas a receber/pagar e fluxo de caixa
  - **Seus painéis: ocupação, no-show e faturamento** (core anti-vazamento — fica no base)
  - LGPD & CFM nativo
- **Clínica** (até 5 usuários) — tudo do Solo, mais:
  - Permissões por função (médico, recepção, financeiro) *(escala-natural)*
  - Auditoria de acessos — quem viu/alterou o quê *(escala-natural)*
  - **Suporte prioritário** *(serviço/SLA)*
- **Pro** (até 10 usuários) — tudo do Clínica, mais:
  - Relatórios consolidados de todos os profissionais *(escopo, não feature nova)*
  - **Gerente de conta dedicado** *(serviço/SLA)*
  - Prioridade no suporte e em novas funcionalidades
  - *(fora do MVP — só com flag)* acesso antecipado a novos módulos


**Eventos emitidos:**
- `tenancy.clinic.created`
- `tenancy.clinic.plan_changed`
- `tenancy.clinic.suspended` (inadimplência)
- `tenancy.clinic.deleted` (LGPD)
- `tenancy.invoice.generated`
- `tenancy.invoice.paid`
- `tenancy.invoice.overdue`

**Eventos consumidos:**
- `scheduling.appointment.created` → incrementa usage_metrics
- `ai_agent.conversation.completed` → incrementa usage_metrics

**Regras de negócio:**
- 🔒 Cobrança automática via Asaas no dia X do mês (configurável por clínica)
- 🔒 Inadimplência: D+3 lembrete WhatsApp, D+7 email, D+15 suspensão (read-only), D+30 lockdown
- 🔒 Trial 14 dias COM cartão cadastrado (não trial sem cartão — atrai turista)
- 🔒 Setup fee R$ 200-500 cobrado upfront (filtra cliente sério, paga seu white-glove)
- 🔒 Annual prepay: cliente paga 12 meses adiantado com 15% off. Reembolso pro-rata se cancelar (CDC).
- 🔒 Limite é teto anti-abuso, não alavanca de upgrade (ADR-024). Por dimensão: **usuários** é a única trava dura (só impede convidar mais um funcionário até o upgrade); **agendamentos** NÃO bloqueia (travar a agenda seria anti-vazamento ao contrário — no máximo avisa); **IA** tem teto generoso anti-abuso (é o moat e é barato; só bloqueia abuso, degradando pra "atendente responde"). Sem overage em nenhuma. Números são ponto de partida — validar com `usage_metrics` dos primeiros clientes.

**Edge cases:**
- Cliente upgrade no meio do mês → pro-rate diff
- Cliente downgrade → vigora próximo ciclo (não imediato, evita reclamação)
- Cartão recusado: 3 tentativas (D+1, D+3, D+7) antes de marcar overdue
- Cliente quer cancelar no meio do ano com prepay → reembolso pro-rata dos meses restantes

**Risco:**
- Asaas como SPOF de cobrança. Mitigação: fallback manual via boleto bancário se Asaas falhar 24h+.
- NF-e Asaas: se Asaas mudar regra de NF, pode quebrar. Monitorar webhook `invoice.created`.

## 4.3 Patient

**Objetivo**: gerenciar pacientes como sujeitos de dados (LGPD), com consentimentos e dados sensíveis.

**Responsabilidades:**
- CRUD de pacientes
- Gerenciamento de contato (WhatsApp, email)
- Consentimentos LGPD
- Suppression list (opt-out de comunicações)
- Dados clínicos persistentes (alergias, medicamentos em uso, condições crônicas)
- Export de dados (LGPD Art. 18)
- Hard delete + 30 dias soft-delete window

**Entidades:**
- `patients` (id, clinic_id, nome, cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash, email, dataNascimento, sexo)
- `patient_consents` (patient_id, dados_saude, compartilhamento, cobranca_whatsapp, marketing, versao, data_aceite)
- `patient_clinical_data` (alergias, medicamentos_em_uso, doencas_cronicas, tipo_sanguineo)
- `patient_addresses` (rua_encrypted, cidade, estado, cep)
- `patient_emergency_contacts` (nome, telefone, relacao)
- `suppression_list` (patient_id, channel, reason, created_at)
- `lgpd_requests` (patient_id, type: export|delete, status, fulfilled_at)

**Eventos emitidos:**
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `patient.consent_revoked`
- `patient.consent_granted`
- `patient.suppression_added`

**Eventos consumidos:**
- `scheduling.appointment.created` → atualiza `last_appointment_at`
- `clinical.prontuario.signed` → atualiza `last_visit_at`

**Regras de negócio:**
- 🔒 Mesmo CPF pode existir em N clínicas (cada uma sua "ficha"). UNIQUE constraint: `(clinic_id, cpf_hash)`.
- 🔒 CPF, telefone, endereço **criptografados at-rest** (AES-256-GCM com chave per-tenant)
- 🔒 Hash de CPF/telefone (HMAC SHA-256 com salt global) pra lookup sem decrypt
- 🔒 Hard delete (LGPD): cascade delete de tudo. Janela de 30 dias soft-delete antes do hard (undo administrativo).
- 🔒 LGPD export: gera JSON+PDF com TUDO sobre o paciente, signed URL TTL 7 dias
- 🔒 Suppression: paciente em suppression_list nunca recebe mensagem proativa (só responde se ele iniciar)

**Edge cases:**
- Paciente quer mudar CPF (erro de cadastro) → audit pesado, exige confirmação do gestor
- Paciente menor de idade → consentimento via responsável (campo `responsavel_id`)
- Paciente falecido → fica registrado, marcado `obito_em`, deixa de receber comunicações
- Paciente reclama de mensagem indesejada → adiciona em suppression IMEDIATAMENTE

**Como escalar:**
- Cresce linear com clínicas × pacientes — 50 clínicas × 5000 pacientes = 250k rows, trivial pra Postgres
- Indexes em `(clinic_id, cpf_hash)`, `(clinic_id, telefone_hash)`, `(clinic_id, nome)` cobrem 95% das queries

## 4.4 Scheduling

**Objetivo**: gerenciar agenda, slots, agendamentos, multi-unidade, procedimentos.

**Responsabilidades:**
- CRUD de agendamentos
- Gerenciamento de slots disponíveis por médico
- Catálogo de procedimentos (com snapshot no agendamento)
- Estado de agendamento (state machine simplificada)
- Suporte a multi-unidade (filiais/salas)
- Walk-in (paciente chega sem agendar)
- Bloqueio de horários
- Notificações automáticas (lembretes via AI Agent)

**Entidades:**
- `appointments` (id, clinic_id, unit_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor, valor_ajustado, snapshot_*, created_via)
- `slots` (doctor_id, unit_id, start_at, end_at, status: available|locked|blocked)
- `procedures` (id, clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
- `procedure_history` (mudanças de preço/duração — auditável)
- `doctor_availability` (doctor_id, weekday, start_time, end_time, unit_id)
- `clinic_holidays` (clinic_id, date, reason)

**State machine de agendamento** (simplificada vs v1, 5 estados):

```
agendado → confirmado → chegou → em_atendimento → atendido
                  ↓
              cancelado
                  ↓
               faltou
```

🔒 **Transições válidas hardcoded em `scheduling/state-machine.ts`**, com testes obrigatórios.

**Eventos emitidos:**
- `scheduling.appointment.created`
- `scheduling.appointment.confirmed`
- `scheduling.appointment.cancelled`
- `scheduling.appointment.checked_in` (chegou)
- `scheduling.appointment.started` (em_atendimento)
- `scheduling.appointment.completed` (atendido) — **FINANCIAL OUVE**
- `scheduling.appointment.no_show` (faltou)
- `scheduling.appointment.rescheduled`

**Eventos consumidos:**
- `patient.deleted` → cancela agendamentos futuros
- `clinical.prontuario.signed` + tag `needs_return` → cria task de follow-up

**Regras de negócio:**
- 🔒 Agendamento obrigatoriamente referencia procedure_id (snapshot grava nome/valor/duração)
- 🔒 Valor herda do procedure, editável com flag `valor_ajustado=true` (auditado)
- 🔒 Walk-in: tipo='walkin', slot virtual (não conflita com agenda regular)
- 🔒 Cancelamento libera slot atomicamente (transação Postgres)
- 🔒 Faltou: libera slot + dispara evento que pode disparar dunning
- 🔒 Multi-unidade: `unit_id` opcional (1 unidade = NULL, multi-unidade obrigatório)
- 🔒 No-show fee opcional (se paciente faltou 2x sem aviso, próximo agendamento exige PIX adiantado) — feature v2.1

**Edge cases:**
- Dois agendamentos no mesmo slot (race condition) → constraint UNIQUE (doctor_id, scheduled_at, unit_id) bloqueia
- Médico bloqueia horário com agendamento existente → erro, exige cancelar primeiro
- Paciente confirma via WhatsApp mas atendente já cancelou → idempotency + último-vence ou conflict resolution
- Procedimento deletado mas com agendamentos → snapshot mantém info, novos agendamentos bloqueiam

**Como escalar:**
- Particiona `appointments` por `created_at` mensal quando passar de 1M rows
- Cache de slots disponíveis no Redis (TTL 5 min, invalida em mudança)
- View materializada `today_appointments_by_doctor` pro Consultório (refresh a cada 1 min)

## 4.5 Clinical

**Objetivo**: prontuário eletrônico, prescrições, documentos clínicos, módulo Consultório.

**Responsabilidades:**
- Prontuário eletrônico (criar, editar, assinar)
- Prescrições (PDF imprimível, médico assina e carimba fisicamente)
- Atestados, declarações, solicitações de exame, encaminhamentos
- Módulo Consultório (kanban 3 colunas: espera, em atendimento, finalizadas)
- Receitas favoritas do médico
- Timeline cronológica do paciente
- Calculadoras clínicas (IMC, Framingham, CKD-EPI, percentil pediátrico)
- Alerta de interação medicamentosa (banco curado, ~200 interações comuns)
- Templates SOAP por especialidade

**Entidades:**
- `prontuarios` (id, clinic_id, patient_id, doctor_id, appointment_id, status: rascunho|assinado, content_jsonb, signed_at)
- `prescriptions` (id, prontuario_id, medicamentos jsonb, observacoes, pdf_url)
- `medical_documents` (id, type: atestado|exame|encaminhamento|declaracao, content_jsonb, pdf_url)
- `doctor_favorite_prescriptions` (doctor_id, nome, medicamentos jsonb)
- `clinical_templates` (especialidade, type, structure_jsonb)
- `drug_interactions` (drug_a, drug_b, severity, message) — seeded global, read-only
- `patient_timeline_cache` (materialized view: appointments + prontuarios + prescriptions ordenados)

**Eventos emitidos:**
- `clinical.prontuario.created`
- `clinical.prontuario.signed` — após assinatura, vira imutável
- `clinical.prescription.created`
- `clinical.document.generated` (atestado, exame, etc.)
- `clinical.contraindication_alert` (interação detectada — auditado)

**Eventos consumidos:**
- `scheduling.appointment.started` → cria prontuário rascunho (se não existe) e abre no Consultório
- `scheduling.appointment.completed` → fecha prontuário (se ainda rascunho, alerta médico)

**Regras de negócio:**
- 🔒 Prontuário assinado é **imutável**. Edição cria nova versão (audit + versionamento).
- 🔒 Prescrição: PDF gerado pelo sistema, médico imprime, assina e carimba fisicamente. **Sem certificado digital ICP-Brasil no v2 inicial.** (CFM 2.299 — atendido pelo "papel + assinatura física"). Memed integration na v2.1+.
- 🔒 Interação medicamentosa: alerta visual + log em audit. Médico pode override com motivo (audit pesado).
- 🔒 Templates SOAP curados pra: clínico geral, cardio, pedia, dermato, gineco, psiquiatria, psicologia, fisio, estética. Outros: campo livre.
- 🔒 Calculadoras: ferramentas numéricas, NÃO sugerem decisão clínica (fora de SAMD)
- 🔒 Documentos clínicos seguem template padrão CFM/CRM, com cabeçalho da clínica (white-label)
- 🔒 Receita controlada (azul/amarela/branca C1): sistema permite escrever mas alerta médico de obrigação legal (talão receituário, etc.). **Não substitui talão físico** no v2.

**Módulo Consultório — detalhamento crítico:**

Layout: kanban 3 colunas em `/app/consultorio`:

```
┌──────────────────┬──────────────────┬──────────────────┐
│  SALA DE ESPERA  │ EM ATENDIMENTO   │   FINALIZADAS    │
│                  │                  │                  │
│ Card por paciente│ Painel ativo do  │ Lista do dia,    │
│ com motivo (se   │ médico (1 por    │ scrollable,      │
│ informado),      │ vez normalmente) │ click reabre     │
│ alergias visíveis│                  │ prontuário       │
│ (read-only),     │                  │                  │
│ botão "chamar"   │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘
```

**Fluxo:**
1. Atendente faz check-in → paciente vai pra Sala de Espera (status `chegou`)
2. Médico clica "Chamar próximo" no card → automaticamente:
   - Move card pra "Em Atendimento"
   - Atualiza status pra `em_atendimento`
   - Abre painel do médico com prontuário aberto + dados do paciente
3. Médico escreve prontuário, prescreve, emite documentos
4. Médico clica "Encerrar consulta" → status `atendido`, card vai pra Finalizadas
5. Próximo paciente da espera fica visível pra chamar

**Botões adicionais:**
- "Chamar de novo" (paciente não respondeu)
- "Marcar ausente" (libera slot apenas se passou do horário do próximo)
- "Encerrar consulta"

⚠️ **Restrições aceitas** (decisões explícitas do founder):
- ❌ Sem pré-anamnese via IA (risco SAMD)
- ❌ Sem alerta de hipertensão/condições pelo sistema (responsabilidade do médico perguntar)
- ❌ Sem "pausar consulta" (não faz sentido clínico)
- ❌ Sem "encerrar sem cobrança" do médico (atendente faz isso)

**Edge cases:**
- Médico esquece de encerrar consulta → ao final do dia, prontuário fica `rascunho`. Reminder no dia seguinte.
- 2 médicos atendem mesmo paciente (consulta de equipe) → cada um cria seu prontuário, mesmo `appointment_id`
- Paciente em consulta urgente (atendimento por outro médico) → walk-in com flag `urgencia`

**Como escalar:**
- Prontuários crescem MUITO (5-50 KB cada). Particionamento por `created_at` mensal aos 500k rows.
- Cold storage: prontuários >2 anos vão pra Cloud Storage comprimidos, leitura sob demanda

## 4.6 Financial

**Objetivo**: gestão financeira da clínica — receber, pagar, controle de caixa, fornecedores, estoque opcional.

**Responsabilidades:**
- Contas a receber (lançamentos de pagamento)
- Contas a pagar (despesas)
- Confirmação manual de pagamento (atendente registra)
- Fornecedores (CRUD)
- Estoque simples (opcional, toggle por clínica)
- Relatórios (DRE simplificado, fluxo de caixa)
- Pacotes de sessões (5/10 sessões com desconto, controle de saldo)
- Comprovantes (upload opcional, anexado ao lançamento)
- Fluxo de caixa diário/semanal/mensal

**Entidades:**
- `lancamentos` (id, clinic_id, unit_id, type: receber|pagar, descricao, valor, status: pendente|pago|cancelado|estornado, due_date, paid_at, patient_id?, supplier_id?, appointment_id?)
- `payment_methods` (PIX, dinheiro, cartão_credito, cartão_debito, transferencia)
- `payment_proofs` (lancamento_id, type: foto|comprovante_pix, file_url)
- `suppliers` (id, clinic_id, razao_social, cnpj, contato, condicao_pagamento)
- `inventory_items` (id, clinic_id, nome, unidade, quantidade, qtd_minima, ativo) — opcional
- `inventory_movements` (item_id, type: entrada|saida|ajuste|perda, quantity, motivo)
- `session_packages` (id, patient_id, procedure_id, total_sessions, used_sessions, valor_total, ativo)
- `cash_flow_summary` (materialized view por dia/clinic_id)

**Eventos emitidos:**
- `financial.lancamento.created`
- `financial.lancamento.paid`
- `financial.lancamento.cancelled`
- `financial.package.created`
- `financial.package.session_used`
- `financial.package.exhausted`
- `financial.inventory.low_stock`

**Eventos consumidos:**
- `scheduling.appointment.completed` → cria lançamento a receber automaticamente
- `scheduling.appointment.cancelled` → cancela lançamento se ainda pendente
- `scheduling.appointment.no_show` → cria lançamento "no-show fee" se clínica habilitou

**Regras de negócio:**
- 🔒 Lançamento gerado automaticamente quando agendamento vai pra `atendido`. **Blocking, com timeout 5s.** Se falhar, agendamento marca `faturamento_pendente=true` e dispara alerta no Caixa.
- 🔒 Confirmação de pagamento é **manual** pelo atendente. Sistema não tenta detectar pagamento via OFX/PIX no v2 (corta complexidade).
- 🔒 Pagamento exige escolha de método. Comprovante opcional (mas recomendado).
- 🔒 Pacote de sessões: cada uso decrementa `used_sessions`. Quando esgotou, lança evento.
- 🔒 Estoque (se ativo): vincula procedimento a item ("aplicar botox usa 1 unidade"). Saída automática ao atender. Alerta de mínimo.
- 🔒 Sem suporte a medicamentos controlados (SNGPC) no v2. Avisar gestor.
- 🔒 Dunning automatizado: D+3 lembrete WhatsApp, D+7 segundo lembrete, D+15 alerta atendente.

**Edge cases:**
- Paciente paga adiantado → atendente cria lançamento "pago" antes do atendimento. Quando atendimento conclui, sistema NÃO duplica (verifica existência via `appointment_id`).
- Estorno (paciente devolvido) → cria evento `lancamento.cancelled` + lançamento compensatório. Não muta o original (append-only mindset).
- Pagamento parcial → lançamento `status=parcial`, valor_pago < valor_total. Saldo gera novo lançamento.
- Múltiplos comprovantes (PIX + dinheiro) → array de payment_proofs

**Como escalar:**
- `lancamentos` cresce com agendamentos — partição mensal aos 500k rows
- Relatórios pesados (DRE mensal) via materialized view, refresh noturno

## 4.7 AI Agent

**Objetivo**: agente conversacional via WhatsApp que executa tarefas operacionais.

**Responsabilidades:**
- Recebe mensagens via webhook Meta Cloud API
- Identifica clínica destino (por número WhatsApp)
- Carrega contexto da clínica (horários, médicos, especialidades, procedimentos, regras)
- Roda LLM (Gemini Flash) com tools/function calls
- Executa intents: agendar, confirmar, cobrar, listar slots, follow-up, LGPD
- Gerencia conversation memory (sessão multi-turn)
- Retenção: 30 dias hot + 1 ano cold archive (Cloud Storage)
- Handoff humano quando não consegue resolver
- Lembretes proativos (24h antes, retorno, cobrança)

**Entidades:**
- `ai_conversations` (id, clinic_id, patient_phone_encrypted, patient_phone_hash, patient_id?, channel, started_at, last_message_at, status)
- `ai_messages` (conversation_id, direction: in|out, content_encrypted, intent, tokens_used, cost_usd, model, created_at, expires_at) — TTL 30 dias
- `ai_intents` (intent_id, name, description, schema_input, action_handler)
- `ai_conversation_memory` (conversation_id, memory_jsonb, last_intent, fallback_count) — TTL 30 dias
- `ai_clinic_config` (clinic_id, working_hours, especialidades_atendidas, can_schedule_anonymous, max_days_ahead, message_template_overrides)
- `ai_proactive_jobs` (id, clinic_id, type: reminder|dunning|followup, scheduled_for, payload, status)
- `ai_handoff_queue` (conversation_id, reason, assigned_to, resolved_at)

**Intents suportados (v2 inicial):**

| Intent | O que faz |
|---|---|
| `list_slots` | Lista slots disponíveis filtrados por especialidade/médico |
| `schedule_appointment` | Cria agendamento |
| `confirm_appointment` | Confirma agendamento existente (responde "sim" ao lembrete D-1) |
| `cancel_appointment` | Cancela agendamento futuro |
| `reschedule_appointment` | Reagenda (cancela + cria novo) |
| `check_payment_status` | Lista lançamentos pendentes do paciente |
| `provide_address` | Responde endereço da clínica |
| `provide_hours` | Responde horário de funcionamento |
| `provide_price` | Responde preço de procedimento |
| `request_human` | Escalona pra atendente |
| `lgpd_export` | Solicita export de dados pessoais |
| `lgpd_delete` | Solicita exclusão de dados |

**Intents FORA do escopo** (🔒 sistema recusa):
- Diagnóstico
- Interpretação de exames
- Orientação clínica/medicamentosa
- Triagem de sintomas

**Eventos emitidos:**
- `ai_agent.conversation.started`
- `ai_agent.conversation.completed`
- `ai_agent.intent.executed`
- `ai_agent.handoff.requested`
- `ai_agent.cost.incurred` (pra cota de plano)

**Proativo vs reativo (C14 — implementado, ver ADR-026):**
- **REGRA DE OURO:** o *envio* proativo é **cron determinístico**, o **LLM nunca envia**
  (só interpreta a resposta do paciente). Defesa de escala.
- **Reminder** (D-1) e **Dunning** (D+3/D+7) = **cron-scan** dos read-models das origens
  (`schedulingApiV1.listReminderCandidates` / `financialApiV1.listDunningCandidates`) —
  NÃO são event-driven (registry = 1 handler/evento; `appointment.created`/`lancamento.created`
  já tomados). O contexto-fonte é dono da regra de "quem recebe".
- **Followup** = **event-driven**: handler em `clinical.prontuario.signed` (com `needs_return`).
- **Reativo:** o "sim/não/remarcar" entra pelo webhook → AI Agent (intents). ⚠️ Falta a tool
  `list_my_appointments` p/ o agente saber QUAL consulta confirmar (pendência C12, ver ADR-026).
- Templates proativos **só** saem aprovados pela Meta (fora da janela 24h); nome via ENV hoje,
  catálogo `whatsapp_templates` no nosso DB quando multi-WABA (provável feature do C15).

**Regras de negócio:**
- 🔒 **Prompt sistema é código, não DB.** Mudança = git commit + deploy. Evita prompt injection e drift.
- 🔒 **Parâmetros operacionais ficam em DB** (`ai_clinic_config`) — horários, especialidades, max_days_ahead, mensagens custom
- 🔒 **Sem triagem clínica.** Resposta padrão pra perguntas clínicas: "Não posso te orientar sobre sintomas. Vou marcar pra você falar com o médico."
- 🔒 **Stateless por mensagem**: cada call ao LLM inclui contexto completo. Sem cache global de agente entre tenants.
- 🔒 **Circuit breaker pro Gemini**: se Gemini cai, agente degrada pra "Recebi sua mensagem, atendente responde em breve" + alerta interno.
- 🔒 **Cota de IA por plano**: teto **generoso anti-abuso** (ADR-024 — IA é o moat e é barato; clínica normal nunca encosta). Só ao estourar, agente degrada pra "limite atingido, atendente responde em breve". **Sem cobrança extra** (sem overage).
- 🔒 **Handoff humano explícito**: certas intents (request_human, falha 3x consecutiva) escalonam pra fila de atendimento humano.

**Mecânica de identificação de clínica:**

1. Webhook recebe mensagem com `to_number` (número da clínica)
2. Query: `SELECT clinic_id FROM clinic_whatsapp_numbers WHERE phone = to_number`
3. Se múltiplas clínicas compartilham número (não comum) → conflito, alerta
4. Carrega `ai_clinic_config` da clínica
5. Identifica paciente (se existir) por `from_number_hash` em `patients`
6. Cria/atualiza `ai_conversation`

**Mecânica de contexto no prompt:**

Pra cada mensagem, o sistema monta:

```
[SYSTEM PROMPT (código, fixo)]
Você é o assistente operacional da clínica. Seu papel é agendar consultas, confirmar agendamentos, cobrar pagamentos. NUNCA dê conselho clínico. Se perguntarem sobre sintomas: "Não posso te orientar sobre sintomas. Vou marcar pra você falar com o médico."

[CONTEXTO DA CLÍNICA]
Clínica: {nome}
Horário: {working_hours}
Especialidades: {especialidades}
Procedimentos disponíveis: {top 20 procedures}
Slots disponíveis próximos 7 dias: {slots}

[CONTEXTO DO PACIENTE]
Nome: {patient.nome}
Última consulta: {last_appointment_at}
Pendências financeiras: {pending_lancamentos}

[HISTÓRICO DA CONVERSA]
(últimas 10 mensagens)

[MENSAGEM ATUAL]
{user_message}

[TOOLS DISPONÍVEIS]
list_slots, schedule_appointment, confirm_appointment, ...
```

**Edge cases:**
- Paciente não cadastrado escreve → agente coleta nome + CPF + telefone, cria patient
- Paciente com 2 fichas em clínicas diferentes escreve pra clínica A → contexto SÓ da clínica A
- Mensagem com áudio/imagem → resposta "Recebi seu áudio/imagem, atendente vai responder" (não processa mídia no v2)
- Mensagem com gírias/regionalismos → Gemini lida bem
- Mensagem fora do horário → agente responde, marca task pra atendente revisar de manhã
- Webhook Meta perde mensagem → idempotency key + retry; se falhar, alerta operacional

**Como escalar:**
- Conversation history TTL 30 dias mantém DB enxuto
- Cold archive (Parquet em GCS) preserva 1 ano pra auditoria
- Gemini Flash custa ~$8-30/mês pra 50 clínicas → desprezível

**Riscos:**
- ⚠️ Meta muda política de templates → mitigação: `MessagingProvider` abstrato
- ⚠️ Gemini cai → circuit breaker
- ⚠️ Custo Gemini explode com cliente fora da cota → teto anti-abuso degrada pra fallback (sem overage — ADR-024)
- ⚠️ LLM alucina e marca consulta inexistente → idempotency + validação rigorosa do output

## 4.8 Platform Admin

**Objetivo**: operação interna da Qoro, dashboard master, auditoria.

**Responsabilidades:**
- Dashboard `/admin` (você)
- Listar/gerenciar clínicas
- Visualizar conversas IA pra debug
- Métricas globais (MRR, churn, custo Gemini, DAU, agendamentos totais)
- Audit logs cross-tenant (com auto-log de cada acesso)
- Exportação de auditoria em PDF por clínica
- Configuração de planos
- Saúde do sistema (Sentry highlights, Better Stack status)
- Suspensão/exclusão de clínicas

**Entidades:**
- `audit_events` (id, clinic_id, user_id, action, resource_type, resource_id, before_jsonb, after_jsonb, ip_address, user_agent, created_at) — particionada por mês
- `super_admin_actions` (id, super_admin_id, action, target_clinic_id, payload_jsonb, ip_address, created_at) — toda ação sua fica aqui
- `system_metrics_daily` (date, clinic_id?, metric_name, value) — agregações para dashboards
- `error_events` (já tracked via Sentry, espelho no banco pra dashboard interno)
- `clinic_health` (clinic_id, last_login_at, agendamentos_last_30d, conversas_ia_last_30d, alerts_count)

**Telas no dashboard master:**

| Tela | O que mostra |
|---|---|
| **Visão Geral** | MRR atual, MRR mês passado, churn rate, clientes ativos, clientes em risco |
| **Clínicas** | Lista, busca, filtro por plano/status. Click entra na clínica (impersonate auditado) |
| **Clínica detalhe** | Dados, plano, faturas, métricas de uso, audit, **botão Exportar Auditoria PDF** |
| **Billing & Faturas** | Faturas em aberto, vencidas, dunning ativo, refunds |
| **Conversas IA** | Stream de conversas (com filtro por clínica), pra debug de agente |
| **Métricas Globais** | DAU, conversas/mês, custo Gemini, agendamentos totais |
| **Audit Logs** | Toda ação do sistema, filtros por clínica/user/action |
| **Saúde do Sistema** | Status Sentry, Better Stack, alertas ativos |
| **Configurações** | Prompt sistema agente, tiers de plano, templates de email, secrets management |

**Eventos consumidos:**
- TUDO (audit log é consumidor universal do outbox)
- `tenancy.invoice.overdue` → mostra alerta no dashboard
- `ai_agent.handoff.requested` → mostra na lista de atenção
- `internal.error.critical` → alerta visual

**Regras de negócio:**
- 🔒 Toda ação do super_admin que toca dado de clínica é **auto-logged** em `super_admin_actions` com timestamp, IP, payload
- 🔒 Impersonate ("entrar como" clínica) abre nova session com role `super_admin_impersonating`, banner permanente "Você está vendo a clínica X como super_admin", todas ações logadas extra
- 🔒 Exportação de auditoria PDF: gera com filtro (data, tipo de evento), inclui hash do conteúdo pra integridade, signed URL TTL 7 dias
- 🔒 Audit log retenção: 12 meses hot, 5 anos cold (Cloud Storage compactado)
- 🔒 Super_admin não pode editar dado clínico diretamente — só via ferramentas administrativas explícitas (suspensão, refund, etc.)

**Edge cases:**
- Super_admin vê dado sensível por engano → ação logada, proteção legal preserva você
- Super_admin precisa fazer "tarefa operacional" pra clínica (raro) → faz via impersonate auditado
- Audit log explode (1M events/dia futuro) → particionamento mensal + cold archive

**Como escalar:**
- `audit_events` particionada por mês desde o início
- `super_admin_actions` cresce devagar (só você)
- Dashboards usam materialized views refrescadas a cada 5-15 min

---

# 5. Fluxos Críticos do Sistema

## 5.1 Onboarding de nova clínica

**Atual**: white-glove via ligação (até ~30 clientes). Self-service incremental depois.

**Fluxo manual atual:**

1. Lead vem pela landing (`qoro.dev`) — preenche formulário "quero conhecer"
2. Email/WhatsApp pra você (notificação)
3. Você liga, qualifica, demonstra
4. Cliente topa → cobra setup fee R$ 200-500 via Asaas (link único)
5. Após pagamento confirmado → cria conta:
   - Insert em `clinics` (slug escolhido pelo gestor, nome, CNPJ)
   - Insert em `subscriptions` (plano escolhido, status=trial, current_period_end=+14 dias)
   - Cria primeiro usuário gestor (email + senha temporária)
   - Email/WhatsApp pro gestor com link de primeiro acesso
6. Ligação de onboarding (você + gestor):
   - Configura ai_clinic_config (horários, especialidades)
   - Cadastra médicos
   - Cadastra procedimentos básicos
   - Configura WhatsApp Meta (migra número da clínica)
   - Cadastra primeiros pacientes (opcional)
7. Cliente entra em produção
8. D+1, D+7, D+14: checkin via WhatsApp/email
9. Final do trial (D+14): cobrança normal inicia

**Self-service futuro (jornada guiada):**
- Wizard de onboarding visual no app (convite → dados → plano → pagamento Asaas in-app → ativa → "Monte sua equipe" → checklist)
- Setup de Meta Cloud API automatizado com OAuth (quando Meta disponibilizar)
- Cadastro guiado de médicos e procedimentos

📌 **Spec canônica do onboarding (os dois modos): [docs/onboarding-spec.md](onboarding-spec.md).**
O fluxo manual acima é o **modo interino (script)** — tem falha conhecida (pagamento
desacoplado da conta; reconciliação manual no Asaas). A **jornada guiada** resolve isso
(pagamento amarrado à clínica, ativação automática). Depende de C13 e é
**demand-triggered** (build quando white-glove vira gargalo, ~20-30 clientes), NÃO um
slot fixo pós-C16. Ver ADR-024 (modelo de planos) e ADR-016 (status da clínica).

⚠️ **Limite do white-glove**: ~30-40 clientes. Depois disso, você vira refém. A partir do 30º, cada nova feature de onboarding pensa em self-service.

## 5.2 Lead chega via WhatsApp (paciente novo)

```
1. Paciente envia "oi" pro WhatsApp da clínica
2. Webhook Meta dispara → endpoint /api/v1/webhooks/meta
3. Identifica clinic_id pelo to_number
4. Verifica se from_number existe em patients (por hash)
   - Existe: carrega patient, monta contexto
   - Não existe: marca como "new_lead", coleta dados em multi-turn
5. Inicia ai_conversation
6. LLM responde (com tools disponíveis)
7. Se intent=list_slots:
   - LLM chama tool list_slots com filtros
   - Sistema retorna 3 slots
   - LLM oferece pro paciente
8. Paciente escolhe horário
9. LLM chama tool schedule_appointment
10. Sistema cria appointment (idempotency key gerada)
11. Dispara evento scheduling.appointment.created
12. AI Agent agenda job de lembrete D-1
13. LLM confirma pro paciente: "Marcado! Você receberá lembrete um dia antes."
14. Conversa fica em ai_messages (TTL 30 dias)
```

**Falhas e retry:**
- LLM erra (alucina) → validação no servidor, pede correção, max 3 tentativas
- Tool falha (DB down) → retry exponencial, se persiste, agente avisa "tive um problema, atendente vai te ajudar"
- Paciente abandona conversa → conversa fica `status=abandoned` após 24h sem resposta

## 5.3 Confirmação de agendamento (lembrete D-1)

```
1. Cron job diariamente às 18h: SELECT appointments WHERE scheduled_at BETWEEN tomorrow AND tomorrow+1d AND status=agendado
2. Pra cada appointment:
   - Verifica patient.suppression_list (channel=whatsapp)
   - Se em suppression: pula
   - Senão: enfileira mensagem em outbox (intent=confirmation_reminder)
3. Worker processa outbox:
   - Envia template Meta aprovado: "Olá {nome}, lembramos sua consulta amanhã {horário} com Dr {nome}. Confirma? Responda SIM/NÃO."
4. Paciente responde:
   - "SIM" → LLM classifica intent=confirm_appointment → muda status pra confirmado
   - "NÃO" → LLM classifica intent=cancel_appointment → muda status pra cancelado + libera slot
   - Outra resposta → LLM tenta entender (pode chamar reschedule)
5. Atendente vê na agenda quem confirmou (status visual)
```

## 5.4 Atendimento (fluxo Consultório)

```
1. Atendente vê paciente chegar, clica "Check-in" → status=chegou
2. Card aparece em Sala de Espera no Consultório do médico
3. Médico (desocupado) vê o card, vê motivo e alertas (alergias)
4. Médico clica "Chamar próximo" no card → ações atômicas:
   a. status=em_atendimento
   b. Card move pra "Em Atendimento"
   c. Cria prontuario rascunho (se não existe) com appointment_id
   d. Abre painel: prontuário + dados paciente + timeline
5. Paciente vem pra sala
6. Médico escreve prontuário (auto-save a cada 10s)
7. Médico prescreve (verifica interação medicamentosa, se houver alerta → confirma)
8. Médico gera PDF de prescrição (imprime), atestado se necessário, exame, etc.
9. Médico marca "Precisa de retorno em X dias" (opcional)
10. Médico clica "Encerrar consulta":
    a. status=atendido
    b. Prontuário fica como rascunho ou assinado (botão "Assinar")
    c. Dispara evento scheduling.appointment.completed
    d. Financial reage: cria lancamento (a receber) automático
    e. Se "retorno": AI Agent agenda followup job
11. Card move pra Finalizadas
12. Médico vê próximo paciente em Sala de Espera
```

**Falhas:**
- Médico esquece de assinar prontuário → fica rascunho. Reminder no dia seguinte.
- Faturamento blocking falha (financial down ou regra falha) → status=atendido mas `faturamento_pendente=true` + alerta no Caixa pra retry manual.
- Médico fecha o navegador no meio da consulta → prontuário salvo no auto-save, reabre ao voltar.

## 5.5 Cobrança (pagamento na hora)

```
1. Após atendimento, paciente vai pro Caixa
2. Atendente abre Caixa, vê lancamento pendente daquele paciente (criado automático)
3. Atendente seleciona método de pagamento (PIX/dinheiro/cartão)
4. Se PIX: mostra QR code dinâmico (pix-qr generator local — gera EMV BR Code)
5. Paciente paga (via maquininha, app PIX dele, dinheiro físico)
6. Atendente confirma "Pago"
7. Sistema:
   - status do lancamento = pago
   - paid_at = now()
   - payment_method = X
   - Dispara evento financial.lancamento.paid
8. (Opcional) Atendente anexa comprovante (foto da maquininha, screenshot PIX)
```

## 5.6 Cobrança recorrente (você cobrando clínicas)

```
1. Asaas cron: gera fatura mensal pra cada subscription ativa, dia X do mês
2. Asaas envia cobrança pro gestor da clínica (email + WhatsApp via Asaas)
3. Gestor paga (PIX, boleto, cartão)
4. Asaas webhook → seu endpoint /api/v1/webhooks/asaas
5. Sistema:
   - invoices.status = paid
   - Subscription continua ativa
   - Dispara evento tenancy.invoice.paid
6. Se não paga até due_date:
   - D+1: lembrete amigável (Asaas faz nativamente)
   - D+3: WhatsApp tua: "olá, vi que ficou esquecida..."
   - D+7: email + WhatsApp segundo aviso
   - D+15: suspende read-only (clinic.status=suspended_readonly), banner no app
   - D+30: lockdown total (clinic.status=suspended), só dashboard de pagamento
```

## 5.7 Follow-up de retorno

```
1. Médico marca prontuário "Precisa de retorno em 90 dias"
2. AI Agent cria job em ai_proactive_jobs:
   - type=followup_return
   - scheduled_for = today + 88 dias (2 dias antes do prazo)
   - payload = {patient_id, doctor_id, motivo}
3. Cron diário processa jobs prontos
4. Pra cada job:
   - Verifica suppression list
   - Verifica se paciente já agendou (não duplicar)
   - Envia mensagem via Meta: "Oi {nome}, Dr {nome} pediu retorno. Quer marcar pra essa semana?"
5. Paciente responde:
   - "Sim" → conversa IA normal, list_slots, schedule
   - "Depois" → reagenda job pra +7 dias
   - "Não" → encerra, atendente revisa
```

## 5.8 Dunning (cobrança de paciente inadimplente)

```
1. Lancamento criado com status=pendente, due_date=hoje (pagar agora ou depois)
2. Se não pago em 3 dias: AI Agent dispara lembrete WhatsApp suave
3. Não pago em 7 dias: segundo lembrete, mais firme
4. Não pago em 15 dias: alerta atendente, retira do dunning automático
5. Atendente decide: tentar contato humano, mandar pra cobrança, ou abater
```

## 5.9 LGPD — Direito de exclusão

```
1. Paciente solicita exclusão (via WhatsApp: "quero deletar meus dados" ou via UI)
2. Cria lgpd_request (type=delete, status=pending)
3. Notifica gestor da clínica (email + dashboard alert)
4. Gestor revisa e confirma (clica "aprovar exclusão")
5. Sistema:
   - Soft-delete: marca patient.deleted_at = now()
   - Anonimiza nome em audit logs (mantém estrutura)
   - Cancela agendamentos futuros
   - Adiciona em suppression_list permanente
6. Após 30 dias (janela undo):
   - Hard delete via cascade: tudo do paciente some
   - audit_events daquele paciente também são purgados (LGPD permite)
   - LGPD request fica como "fulfilled" sem detalhes
```

⚠️ **Compromisso aceito**: 30 dias soft → hard. Não-imediato pra prevenção de erro (paciente pode arrepender, gestor pode ter confundido).

## 5.10 Walk-in (paciente chega sem agendar)

```
1. Paciente chega na recepção
2. Atendente clica "Walk-in" → seleciona médico desocupado
3. Sistema:
   - Cria appointment com tipo=walkin, slot_type=virtual (não bloqueia agenda regular)
   - status=chegou direto
   - Card vai pra Sala de Espera do médico
4. Médico atende normalmente (fluxo Consultório)
5. Faturamento idem
```

---

# 6. Arquitetura de IA

## 6.1 Visão arquitetural

A IA do ClinicaOS é **um sistema multi-agente operacional** (não conversacional generalista). Cada conversa é uma instância stateless do agente, com contexto injetado por mensagem.

**Decisões fundamentais:**

🔒 **Agente único, prompt no código** — não há "agente customizado por clínica". Todos clientes usam o mesmo prompt sistema. Parâmetros operacionais (horários, especialidades) vivem em `ai_clinic_config` no DB.

🔒 **Stateless por mensagem** — cada call ao LLM tem todo o contexto necessário. Sem cache global de agente. Isolamento entre tenants = perfeito.

🔒 **Tools, não geração livre** — agente só executa ações via tools registradas. Output livre do LLM vai pra resposta ao paciente; ações só via tool call.

🔒 **Output validado server-side** — toda chamada de tool é validada com schema Zod. LLM alucina → sistema rejeita, pede correção.

## 6.2 Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                  Meta Cloud API Webhook                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Webhook Handler                            │
│ - Valida assinatura Meta                                    │
│ - Resolve clinic_id pelo to_number                          │
│ - Idempotency check                                         │
│ - Carrega/cria patient                                      │
│ - Inicia/continua ai_conversation                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Context Builder                            │
│ - System prompt (código)                                    │
│ - Clínica context (horários, especialidades, procedimentos) │
│ - Patient context (último atendimento, pendências)          │
│ - Conversation memory (últimas 10 mensagens)                │
│ - Tools list disponíveis                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  LLM Caller (Gemini Flash)                  │
│ - Circuit breaker                                           │
│ - Cost tracking                                             │
│ - Quota check (per-clinic)                                  │
│ - Retry com backoff                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Response Processor                         │
│ - Se tool call: valida schema, executa tool, re-call LLM    │
│ - Se text: valida (não dá conselho clínico), envia          │
│ - Save conversation memory                                  │
│ - Save ai_message (TTL 30 dias)                             │
│ - Emit ai_agent.* events                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Message Sender                             │
│ - MessagingProvider abstraction                             │
│ - Meta Cloud API (default) ou Z-API (fallback)              │
│ - Outbox pra entrega garantida                              │
└─────────────────────────────────────────────────────────────┘
```

## 6.3 Tools registradas

```typescript
// Schemas Zod, validados antes de executar
list_slots({ procedure_id?, doctor_id?, date_from, date_to })
schedule_appointment({ patient_id, doctor_id, procedure_id, scheduled_at })
confirm_appointment({ appointment_id })
cancel_appointment({ appointment_id, reason? })
reschedule_appointment({ appointment_id, new_scheduled_at })
list_pending_payments({ patient_id })
provide_clinic_info({ field: 'address' | 'hours' | 'phone' })
provide_procedure_price({ procedure_id })
request_human_handoff({ reason })
lgpd_export_request({ patient_id })
lgpd_delete_request({ patient_id })
```

Cada tool:
- Schema input Zod
- Handler (chama contexto correspondente via API interna)
- Schema output (resposta pra LLM)
- Audit log automático

## 6.4 Conversation Memory

Estrutura simplificada (vs v1 que era complexa):

```typescript
type ConversationMemory = {
  conversationId: string;
  lastIntent: string | null;
  fallbackCount: number; // se > 3, força handoff
  collectedData: {
    nome?: string;
    cpf?: string;
    telefone?: string;
    motivo?: string;
  };
  contextDrift: number; // métrica de "tá indo bem ou tá perdido"
  lastUpdated: Date;
}
```

TTL 30 dias. Quando expira, conversa "reseta" — paciente novo recomeça do zero.

## 6.5 Controle de hallucination

Estratégias combinadas:

1. **Tools com schema rigoroso** — LLM só pode "agendar" via tool, que valida tudo
2. **Validação semântica server-side**: ex. agendamento pra data passada → rejeita
3. **Existência de entidades**: tool `schedule_appointment` valida que `doctor_id` existe na clínica
4. **Fallback explícito**: se LLM responde algo absurdo, sistema reenvia com "Você não pode fazer isso. Responda dentro das opções."
5. **Auditoria**: toda interação logada, debugável no painel `/admin`

## 6.6 Custo e cota

**Cota por plano (mensal):**

| Plano | Conversas IA/mês (teto generoso anti-abuso) |
|---|---|
| Solo | 200* |
| Clínica | 800* |
| Pro | 2500* |

\* ADR-024: **teto, não overage** — ao estourar, IA degrada pra "atendente responde", sem cobrança extra. Números a validar com uso real dos primeiros clientes (200 do Solo é apertado — começar generoso).

**Métrica "conversa"**: 1 sessão de 24h por número de paciente. Múltiplas mensagens contam 1 conversa.

**Custo real Gemini Flash:**
- ~3-5k tokens por conversa
- $0.075 input + $0.30 output por 1M tokens
- ~$0.001-0.002 por conversa
- 50 clínicas × 200 conversas = 10k/mês = ~$20/mês total → desprezível

**IA é baratíssima** (custo real ~$0.002 = R$ 0,01/conversa) — por isso o teto é generoso e não precisa de overage: o custo absorvido cabe na mensalidade com folga (margem ~40x). ADR-024.

## 6.7 Handoff humano

Triggers de handoff:
- Paciente diz "quero falar com pessoa" / "atendente"
- LLM falha 3x consecutivas (não entende)
- Intent `request_human` explícito
- Erro técnico repetido (Gemini down, tool fail)
- Conversa em horário fora do atendimento (opcional, configurável)

Fluxo:
1. Cria entrada em `ai_handoff_queue`
2. Notifica atendente (notificação in-app + email se urgente)
3. Atendente assume conversa via UI (envia mensagens via WhatsApp da clínica)
4. Marca como resolvido manualmente

## 6.8 Observabilidade da IA

Métricas tracked:
- Conversas/dia por clínica
- Tokens/dia por clínica
- Custo USD/dia por clínica (controle de margem + base pro teto anti-abuso; não há overage — ADR-024)
- Taxa de sucesso de intent (chegou ao objetivo?)
- Taxa de handoff humano
- Latência média
- Erros/timeouts Gemini

Dashboard em `/admin` mostra tudo.

## 6.9 Riscos da IA e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| LLM alucina e marca consulta inexistente | Baixa | Médio | Tool validation rigorosa, idempotency |
| LLM dá conselho clínico apesar do prompt | Média | Alto (SAMD) | System prompt forte + validação semântica + monitoring |
| Custo Gemini explode | Baixa | Médio | Teto de cota por plano (hard cap anti-abuso, sem overage) + circuit breaker |
| Gemini cai por horas | Baixa | Médio | Circuit breaker → degrade gracefully |
| Prompt injection via paciente | Média | Médio | System prompt é código, não DB. Input sanitizado. |
| Vazamento entre tenants via cache | Baixa | Crítico | Stateless per-message, sem cache global |
| Meta bloqueia número | Média | Alto | MessagingProvider abstrato (Z-API fallback) |
| Paciente reclama de mensagem indesejada (LGPD) | Média | Médio | Suppression list automática, opt-out fácil |

---

# 7. Segurança e Compliance

## 7.1 LGPD

ClinicaOS é controlador parcial e operador parcial. As clínicas são controladoras dos dados de pacientes; ClinicaOS opera essa dados em nome delas + tem dados próprios (login dos funcionários, dados das clínicas).

**Direitos garantidos:**

- ✅ **Acesso** (Art. 18, II): paciente solicita export → JSON+PDF com tudo
- ✅ **Correção** (Art. 18, III): paciente solicita correção → atendente atualiza
- ✅ **Anonimização/bloqueio/eliminação** (Art. 18, IV): hard delete com 30d window
- ✅ **Portabilidade** (Art. 18, V): export estruturado
- ✅ **Eliminação após uso** (Art. 16): retenção declarada por tipo de dado
- ✅ **Revogação de consentimento** (Art. 8, §5): toggle no app
- ✅ **Oposição** (Art. 18, §2): suppression list

**Consentimentos coletados:**
- `dados_saude` — uso de dados de saúde pra atendimento
- `compartilhamento` — compartilhar com outros profissionais da clínica
- `cobranca_whatsapp` — receber cobranças via WhatsApp
- `marketing` — receber comunicações de marketing (opt-in explícito)
- `pesquisa` — uso de dados (anonimizados) pra pesquisa interna

Versionado: `consents.versao` permite mudança de termos.

**Retenção declarada:**

| Tipo de dado | Retenção | Justificativa |
|---|---|---|
| Dados de paciente | 20 anos após último atendimento | CFM 1.821 — prontuário |
| Prontuários e prescrições | 20 anos após criação | CFM 1.821 |
| Conversas IA (hot) | 30 dias | LGPD Art. 16 — finalidade cumprida |
| Conversas IA (cold archive) | 1 ano | Auditoria operacional |
| Audit logs (super admin) | 5 anos | Marco Civil Art. 15 |
| Audit logs (clínica) | 12 meses hot + 5 anos cold | Necessidade |
| Lançamentos financeiros | 5 anos | Receita Federal |
| Dados de cartão (Asaas) | Não armazenamos | Asaas é PCI-compliant |

## 7.2 Criptografia

**At-rest:**
- 🔒 CPF, telefone, endereço dos pacientes → AES-256-GCM com chave per-tenant
- 🔒 Conversas IA → AES-256-GCM com chave per-tenant
- 🔒 Passwords → bcrypt via Supabase Auth (não toca)
- 🔒 API keys de terceiros (Meta token, Asaas token, etc.) → Supabase Vault ou Google Secret Manager

**In-transit:**
- 🔒 HTTPS obrigatório (Vercel auto-provê)
- 🔒 SSL/TLS no Postgres (Supabase default)
- 🔒 Webhooks recebidos com validação de assinatura (Meta HMAC, Asaas signature)

**Gerenciamento de chaves:**
- Master key: Google Secret Manager (não em env var de produção)
- Per-tenant key: derivada via HKDF do master + clinic_id
- Rotação: anual, com versionamento (`encryption_key_version` em cada doc encriptado)

## 7.3 Controle de acesso

**Modelo RBAC + ABAC:**

- **RBAC** (Role-Based): roles definidos (gestor, doctor, attendant, financial, owner)
- **ABAC** (Attribute-Based): permissões granulares editáveis por usuário

**Hierarquia de override:**
1. Permissão padrão do role (template)
2. Override do gestor para usuário específico (`user_permission_overrides`)
3. Super_admin sempre pode (bypassa, mas audita)

**Enforcement:**
- L1: RLS no banco
- L2: Server Action verifica `requireRole(['gestor'])` ou `requirePermission('manage:financial')`
- L3: UI esconde elementos sem permissão (UX, não segurança)

## 7.4 Auditoria

**Toda mutação de dado fica registrada em `audit_events`:**

```typescript
{
  id: uuid,
  clinic_id: uuid,
  user_id: uuid,
  action: string, // 'patient.created', 'prontuario.signed', etc.
  resource_type: string, // 'patient', 'prontuario', etc.
  resource_id: uuid,
  before_jsonb: object | null,
  after_jsonb: object | null,
  ip_address: string,
  user_agent: string,
  created_at: timestamp,
}
```

**Particionado por mês.** TTL 12 meses hot. Após 12 meses → Cloud Storage compactado, 5 anos retenção.

**Super_admin actions tracked separadamente** em `super_admin_actions`:
- Toda leitura cross-tenant
- Impersonate
- Suspensão/exclusão de clínica
- Refund
- Edição de configuração de plano

## 7.5 Backups

**Supabase PITR (Point-in-Time Recovery):**
- Plano Pro: 7 dias de PITR
- Plano Team: 14 dias
- Recovery via Supabase dashboard, granularidade de segundos

**Backup extra customizado (defesa em profundidade):**
- Cron diário: `pg_dump` → Cloud Storage (GCS)
- Retenção: 30 dias diários, 12 meses mensais
- Encrypted at rest (GCS default)
- Recovery testada trimestralmente

**Por tenant exportável:**
- Sob demanda: gestor pode pedir "baixar tudo da minha clínica" → JSON estruturado de todas tabelas dela + arquivos do storage
- Signed URL TTL 7 dias

## 7.6 Disaster Recovery

**Cenários planejados:**

| Cenário | Plano |
|---|---|
| Supabase indisponível 1-2h | Esperar restauração, comunicar clientes |
| Supabase indisponível 6h+ | Comunicar status page, ativar plano B (manual) |
| Supabase quebrar permanente (improvável) | Migrar pra Neon/Railway com backups (~2 semanas) |
| Erro humano (drop table) | PITR + restore |
| Ataque ransomware | Backups offline GCS imutáveis + restore |
| Vazamento de dados (breach) | Comunicar ANPD 72h + clientes afetados + análise forense |
| Bug crítico em produção | Rollback Vercel (deploy anterior) instant |

## 7.7 Segurança do WhatsApp

**Meta Cloud API:**
- Webhook valida assinatura HMAC SHA-256 com `WHATSAPP_APP_SECRET`
- Webhook URL com token secreto (querystring) pra defesa extra
- Token de acesso rotacionado a cada 90 dias
- Limit IP da Meta (allowlist se possível)

**Mensagens:**
- Conteúdo criptografado at-rest
- Sem armazenar mídia (áudio/imagem) — apenas referência se necessário

## 7.8 Segurança da IA

**Prompt injection mitigado:**
- System prompt em código (não editável por usuário)
- Input do paciente sanitizado (escape de marcadores estruturais)
- Validação semântica do output (não dar conselho clínico)
- Monitoring: alertas se LLM tenta executar tool não autorizada

**Vazamento entre tenants:**
- Sem cache global de agente (stateless)
- Cada call de Gemini é isolado (sem session shared)
- RLS no banco impede leitura cross-tenant via tool

## 7.9 Acesso interno da Qoro

**Princípio: zero trust com você mesmo.**

- Toda ação de super_admin é logada com IP, user agent, payload
- Impersonate exige confirmação ("Você está prestes a entrar como Clínica X — confirma?")
- Audit retorno: você pode auditar quem (de você) acessou o quê
- 2FA obrigatório no seu super_admin
- Sessions super_admin expiram em 4h (vs 7 dias normal)

---

# 8. Estratégia de Escalabilidade

## 8.1 Limites técnicos previstos

**Postgres (Supabase):**

| Métrica | Limite confortável | Quando vira gargalo |
|---|---|---|
| Connections | 500 | ~1000+ clínicas simultâneas |
| DB size | 50 GB Pro / 200 GB Team | ~5000 clínicas |
| Rows por tabela | 10M+ sem particionamento | `appointments` aos 1M, particiona |
| RLS overhead | ~10-20% | Aceitável |
| Realtime channels | 500 simultâneos | Provavelmente nunca |

**Vercel:**

| Métrica | Limite Pro ($20/mês) | Quando upgrade |
|---|---|---|
| Bandwidth | 1 TB/mês | ~500 clínicas |
| Function invocations | Unlimited (mas billed) | Cuidado |
| Build time | 45 min | OK |
| Edge requests | 1M/mês | OK |

**Gemini:**

| Métrica | Limite | Realidade |
|---|---|---|
| RPM | 1000+ | Nunca atingido |
| Cost | ~$0.002/conversa | 50 clínicas × 200 conv = $20/mês |

## 8.2 Particionamento e indexes

🔒 **Tabelas que devem ser particionadas desde o início:**

- `audit_events` — particionada por mês desde dia 1
- `ai_messages` — particionada por mês desde dia 1
- `super_admin_actions` — sem necessidade (cresce devagar)

🔒 **Tabelas que devem ser particionadas quando passarem de 500k rows:**

- `appointments`
- `lancamentos`
- `prontuarios`
- `ai_conversations`

**Indexes obrigatórios desde dia 1:**

```sql
-- Patient lookups
CREATE INDEX patients_clinic_cpf ON patients (clinic_id, cpf_hash);
CREATE INDEX patients_clinic_phone ON patients (clinic_id, telefone_hash);
CREATE INDEX patients_clinic_name ON patients (clinic_id, nome);

-- Appointments
CREATE INDEX appointments_doctor_date ON appointments (doctor_id, scheduled_at);
CREATE INDEX appointments_clinic_status ON appointments (clinic_id, status, scheduled_at);
CREATE INDEX appointments_patient ON appointments (patient_id, scheduled_at DESC);

-- Financial
CREATE INDEX lancamentos_clinic_status ON lancamentos (clinic_id, status, due_date);
CREATE INDEX lancamentos_patient ON lancamentos (patient_id, status);

-- Audit
CREATE INDEX audit_events_clinic_time ON audit_events (clinic_id, created_at DESC);
CREATE INDEX audit_events_user ON audit_events (user_id, created_at DESC);

-- AI
CREATE INDEX ai_conversations_clinic_phone ON ai_conversations (clinic_id, patient_phone_hash);
```

## 8.3 Cache strategy

**Sem cache no v2 inicial (medir primeiro).**

🔓 **Quando adicionar Redis cache:**

- Lista de procedimentos da clínica (mudança rara, leitura constante) — TTL 5 min, invalidar em update
- Lista de médicos e horários — TTL 1 min
- Slots disponíveis (próximos 7 dias) — TTL 30s, invalidar em criação de agendamento
- Configuração da clínica (`ai_clinic_config`) — TTL 5 min

**Cache de queries no React Query** já cobre 80% do que importa pro UX.

## 8.4 Workers e filas

**Workers (Vercel Functions / Cron):**

| Worker | Frequência | O que faz |
|---|---|---|
| `outbox-processor` | 30s | Processa eventos do outbox |
| `appointment-reminders` | Diário 18h | Envia lembretes D-1 |
| `dunning-processor` | Diário 9h | Processa cobranças atrasadas |
| `followup-processor` | Diário 10h | Processa jobs de followup |
| `archive-old-messages` | Diário 3h | Move mensagens IA > 30d pro cold archive |
| `metrics-aggregator` | Diário 4h | Refresca materialized views |
| `health-check` | A cada 5 min | Verifica integrações (Meta, Gemini, Asaas) |
| `auto-suspend-overdue` | Diário 12h | Suspende clínicas inadimplentes D+15/D+30 |

⚠️ **Workers idempotentes obrigatório.** Cada job tem idempotency key. Re-run não duplica.

## 8.5 Quando o sistema vai precisar ser reescrito

🔓 **Pontos de re-arquitetura previstos:**

1. **~500 clínicas**: dashboard master começa a ficar lento sem read replica → adicionar
2. **~1000 clínicas**: outbox single-table fica gargalo → particionar ou migrar pra fila externa (Inngest, Trigger.dev, AWS SQS)
3. **~2000 clínicas**: pode justificar app mobile nativo (PWA não basta)
4. **~5000 clínicas**: re-avaliar Supabase vs DB próprio (custo)
5. **Internacionalização**: precisa reescritura de i18n + multi-currency + multi-timezone (complexo)

## 8.6 O que NÃO escalará bem (e está OK)

- Onboarding white-glove: não escala além de 30-40 clientes/mês, vira self-service
- Suporte solo founder: não escala além de ~100 clientes, vira time
- Prompt único universal: não escala se tiver verticais muito diferentes — vai segmentar
- Dashboard master sem read replica: ~500 clínicas

## 8.7 Decisões MVP vs Definitivas

**MVP (v2 inicial, pode mudar):**
- 🔓 Cota IA fixa por plano (pode virar dinâmica)
- 🔓 Setup white-glove via ligação
- 🔓 Sem app mobile (PWA basta)
- 🔓 Sem TISS
- 🔓 Sem telemedicina
- 🔓 Asaas como único gateway de cobrança (pode adicionar Stripe pra internacional)
- 🔓 Gemini como único LLM (pode adicionar GPT/Claude)
- 🔓 Z-API como fallback (pode remover se Meta nunca falhar)

**Definitivas (não negocie sem repensar tudo):**
- 🔒 Bounded contexts isolados
- 🔒 RLS no Postgres como L3 obrigatória
- 🔒 Outbox pattern pra eventos
- 🔒 Idempotency keys em toda escrita
- 🔒 Multi-tenant single deploy
- 🔒 Hard delete de paciente após 30d soft
- 🔒 Prompt sistema em código
- 🔒 IA não dá conselho clínico

---

# 9. Estratégia Comercial e Produto

## 9.1 ICP (Ideal Customer Profile)

**Primário:**
- Médico-dono solo (clínico geral, cardio, dermato, pedia, psiquiatra, gineco, oftalmo)
- 1-3 anos de clínica aberta
- Fatura R$ 15-50k/mês
- Usa hoje: papel, Google Agenda, Excel, ou sistema antigo (iClinic Lite, MV)
- Frustração: tempo demais administrando, recepção sobrecarregada, dinheiro escapando

**Secundário:**
- Clínica pequena 2-5 médicos
- 1 gestor + 1-2 atendentes + 1 financeiro
- Fatura R$ 50-200k/mês
- Já tentou outros sistemas, achou complicado/caro/inadequado

**Terciário (v2.1+):**
- Clínica de estética/odonto/fisio com pacotes
- Clínica média 5-10 médicos com multi-unidade

## 9.2 Posicionamento

**Frase de marketing:**
> "O sistema operacional anti-vazamento da sua clínica. IA que agenda, confirma e cobra. Você foca em medicar."

**Diferenciação clara:**
- vs iClinic: "iClinic é prontuário com agenda. ClinicaOS é sistema operacional com IA."
- vs Doctoralia: "Doctoralia traz paciente. ClinicaOS opera a clínica."
- vs ChatGPT integrações artesanais: "Não é IA experimento. É operação."

## 9.3 Moat (vantagem defensável)

🔒 **3 fontes de moat construídas no produto:**

1. **Integração profunda**: agente IA + cobrança + auditoria + prontuário num único produto. Concorrente que tenta replicar precisa de 18+ meses.
2. **Dados acumulados**: cada clínica vira um asset (histórico paciente, prontuários, financeiro). Trocar de sistema = perder 2+ anos de dados estruturados.
3. **Compliance + auditoria**: LGPD/CFM bem feitos viram argumento de venda contra concorrente sloppy.

**Moats que NÃO contam (ilusões):**
- ❌ "Nossa tecnologia é melhor" (sempre será replicável)
- ❌ "Nosso preço é mais baixo" (concorrente baixa em 1 mês)
- ❌ "Temos mais features" (feature parity é commodity)

## 9.4 Estratégia de retenção

**Lock-in positivo construído via:**

1. **Dependência operacional saudável**: clínica usa todos os dias. Trocar = treinar equipe de novo, migrar dados, reaprender fluxos.
2. **Dados acumulados**: histórico paciente, prontuários, métricas — não migram fácil.
3. **Integração WhatsApp**: paciente já conhece o número, conversa fluida. Trocar = perder conversas, reonboarding paciente.
4. **Setup fee não-reembolsável**: cliente que pagou R$ 200-500 pensa 2x antes de cancelar.
5. **Annual prepay**: 15% off prende por 12 meses.
6. **Features auto-extensíveis**: novo módulo (ex: estoque) entra sem migração, aumenta valor sem aumentar preço.

## 9.5 Pricing strategy

**Princípios:**

- **Tier-based puro** (sem usage-based/overage — ADR-024). Cotas são teto anti-abuso, não cobrança por uso. Cliente cresce → sobe de tier.
- **Anual sempre 15% mais barato**.
- **Setup fee obrigatório** (filtra cliente sério).
- **Nunca dar desconto direto** — sempre como add-on ("vou te dar 2 meses grátis se você pagar anual").
- **Listar preços públicos** (transparência aumenta confiança, filtra leads ruins).

## 9.6 Funil de aquisição

**Fontes esperadas (v2 inicial):**

1. **SEO inbound**: blog `qoro.dev/blog` com conteúdo "Como reduzir no-show em clínica", "Como cobrar paciente sem ser invasivo"
2. **Indicação**: clientes felizes indicam (R$ 100 de desconto pra ambos)
3. **WhatsApp ads**: pra raio CEP específico
4. **Parcerias**: cooperativas médicas, sindicatos, contadores especializados
5. **Cold outbound**: você manualmente, fase early

**Funil:**
- Landing → formulário "quero conhecer" → ligação demo → trial 14d com cartão → cliente pagante
- Conversão esperada (early): ~30% lead-to-trial, ~50% trial-to-paid

## 9.7 Expansão de receita

**Caminhos pra expandir receita por cliente sem novos clientes:**

1. **Upgrade de plano**: Solo → Clínica → Pro conforme crescem (alavanca principal — ADR-024)
2. **Annual prepay**: 15% off prende por 12 meses
3. **Sessões de pacote** (estética/fisio): módulo de produto, não overage
4. **Multi-unidade**: nova filial pode virar nova subscription (modelo de cobrança por unidade — NÃO é feature-gate por plano)
5. **Módulos opcionais futuros**: TISS (v2.1), telemedicina (v2.2), marketing (v2.3)

<!-- ADR-024: removido "Overage IA" e "agendamentos extras" — cota é hard cap, sem
     cobrança por uso. Expansão de receita vem de upgrade + módulos + multi-unidade. -->

## 9.8 Estratégia de crescimento (5 anos)

- **Ano 1**: 50 clínicas, valida produto, refina onboarding
- **Ano 2**: 300-500 clínicas, contrata 1-2 pessoas (suporte + dev), introduz self-service
- **Ano 3**: 1.500-3.000 clínicas, expansão pra verticais (estética, odonto), API pública
- **Ano 4**: 5.000+ clínicas, marketplace de templates, módulo telemedicina maduro
- **Ano 5**: 10k+ clínicas, expansão pra América Latina ou venda estratégica

---

# 10. Roadmap Realista

## 10.1 MVP (v2.0) — meta 3 meses

**Escopo mínimo viável** (pra primeiros 5-10 clientes):

- Auth + multi-tenant + RBAC básico
- Cadastro de clínica e usuários
- Cadastro de paciente
- Agenda (CRUD agendamento)
- Consultório (kanban 3 colunas)
- Prontuário (criar, editar, assinar)
- Prescrição (gerar PDF)
- Atestado/declaração/exame/encaminhamento (PDFs)
- Caixa (registro manual de pagamento)
- Financeiro básico (receber/pagar)
- Agente IA via WhatsApp (intents core: list_slots, schedule, confirm, cancel, provide_info, handoff)
- Dashboard master (você): clínicas, billing, conversas IA, métricas básicas
- Asaas integração (cobrança recorrente da clínica)
- Audit log básico
- LGPD: consents + export + delete
- Setup white-glove via ligação

**NÃO inclui no MVP:**
- TISS / convênios
- Estoque
- Pacotes de sessões
- Fornecedores avançados
- Multi-unidade
- Receitas favoritas
- Calculadoras clínicas
- Templates SOAP
- Backup baixável
- Webhooks
- Status page
- Interação medicamentosa

## 10.2 v2.1 — meta +3 meses (6 meses total)

**Features pós-MVP** (escolhidas por feedback de cliente):

- Pacotes de sessões
- Estoque simples
- Multi-unidade
- Receitas favoritas
- Calculadoras clínicas
- Templates SOAP por especialidade
- Backup baixável pelo gestor
- White-label leve (logo + cor + nome em PDFs)
- TISS — pequeno (CR/convênio sem retorno automatizado)
- Interação medicamentosa (banco curado)
- Memed integration pra prescrição digital

## 10.3 v2.2 — meta +6 meses (12 meses)

- Self-service onboarding (wizard)
- Status page pública
- Webhooks pro cliente
- TISS completo (lotes, retorno automatizado, glosas)
- App PWA otimizado (modo offline parcial)
- Telemedicina básica (vídeo via Daily.co ou similar)
- AbacatePay pra checkout PIX paciente (opcional)

## 10.4 v2.3+ (futuro)

- API pública read-only
- Marketplace de templates clínicos
- Módulo de marketing (newsletter, campanhas)
- Integração Conta Azul / Omie
- App mobile nativo
- Internacionalização
- BI/Analytics avançado

## 10.5 Débito técnico aceitável

**No v2 inicial, aceito:**

- 🔓 Sem testes E2E (Vitest unitário só)
- 🔓 Sem dashboard de métricas custom (Vercel Analytics + dashboard interno básico)
- 🔓 Sem CI/CD elaborado (Vercel git push)
- 🔓 Sem migration testing automatizada (só dry-run em staging)
- 🔓 Documentação só este doc + ADRs (sem wiki interno)

**Mas NÃO aceito:**

- 🔒 Sem testes unitários do outbox e state machines
- 🔒 Sem RLS policies (bug catastrófico)
- 🔒 Sem audit log
- 🔒 Sem idempotency keys
- 🔒 Sem error tracking (Sentry)

## 10.6 Riscos de construir cedo demais

- ❌ TISS no MVP: 3000+ LOC de complexidade, atende vertical específica
- ❌ App mobile no v2: PWA cobre, mobile native é distração
- ❌ Telemedicina core: regulação CFM 2.314 complexa, espera demanda
- ❌ Multi-currency: não precisa, todo cliente é R$
- ❌ Multi-language: PT-BR basta no Brasil
- ❌ Plugins/extensions framework: overengineering pré-PMF
- ❌ Microsserviços: vc não precisa
- ❌ Kubernetes: vc não precisa
- ❌ Event sourcing puro: outbox basta

---

# 11. Decisões Críticas e Não Negociáveis

## 11.1 Princípios absolutos

🔒 **Estas regras NÃO devem ser quebradas sem repensar a arquitetura inteira:**

1. **Bounded contexts isolados** — nunca SQL JOIN cross-context. Comunicação via outbox ou API interna.
2. **RLS no Postgres como L3** — toda tabela tem RLS. Sem exceção.
3. **Idempotency em toda escrita** — sem exceção.
4. **Outbox pra eventos cross-context** — sem chamadas síncronas que viram race conditions.
5. **Hard delete LGPD com 30d window** — soft delete temporário, hard depois.
6. **Audit log per-tenant + super_admin actions separados** — toda ação cross-tenant logada.
7. **Prompt sistema em código** — agente IA único, sem custom prompt por clínica.
8. **IA NÃO dá conselho clínico** — hardcoded no prompt, validado server-side.
9. **Encryption at-rest per-tenant** pra dados sensíveis.
10. **Stateless IA por mensagem** — sem cache global.
11. **2FA obrigatório pro `super_admin`** (**ADR-038**); gestor/financial = opt-in forte, não forçado. Ver §4.1.
12. **Backups + PITR + cold archive** — defesa em profundidade contra perda.
13. **Multi-tenant single deploy** — nunca deploy-per-clinic.

## 11.2 Erros arquiteturais proibidos

🚫 **Não faça**:

- God modules (>500 LOC sem boa razão) → divida em contextos
- Cross-context SQL JOIN → emit evento
- Hardcoded `if (clinic_id === X)` → use feature flag ou config
- Cache que sobrevive entre tenants → stateless ou per-tenant
- Mutar evento histórico (financialEvents, audit_events) → append-only
- Comentários longos justificando hack → fix o hack
- Feature flag esquecida ligada/desligada em produção → revisa trimestral
- Migration sem rollback plan
- Deploy em produção sexta-feira à noite (a menos que urgente)

## 11.3 Anti-patterns conhecidos do v1

⚠️ **Erros do v1 que NÃO devem ser repetidos:**

1. **`clinicId` manual em 537 lugares** → RLS no Postgres elimina
2. **God modules `financeiro.ts` 1352 LOC, `agendamentos.ts` 1290 LOC** → bounded contexts
3. **12 state machines, só 2 centralizadas** → toda state machine em arquivo dedicado, com testes
4. **Mistura de prompt da IA com config da clínica** → prompt sistema em código
5. **Sem testes em fluxos críticos (TISS, dispatcher)** → testes obrigatórios em outbox, state machines, RLS policies
6. **Auditoria sem TTL → growth infinito** → particionamento + cold archive desde dia 1
7. **Dual-write financialEvents + lancamento status** → projeção a partir de events
8. **`autoProcessConsultaFinalizada` non-blocking → vazamento silencioso** → faturamento blocking com timeout + fallback alerta
9. **Pre-anamnese via IA** → cortada (risco SAMD)
10. **Per-clinic prompt configurável** → cortado (prompt injection + prompt engineering por cliente)
11. **Comissão sobre crescimento (modelo Qoro)** → cortado (não funciona pra clínica pequena, conflitos)

## 11.4 Coisas que parecerão boas no futuro mas são armadilhas

📌 **Você vai ter vontade de fazer estas coisas. Resiste:**

1. **"Vamos abrir API pública pra qualquer cliente do nosso plano"** — vira suporte infinito. Só pra Pro+ via contrato.
2. **"Vamos fazer agente IA com personalidade customizável por clínica"** — caos de suporte. Mantém único.
3. **"Vamos deixar o gestor editar o prompt sistema"** — prompt injection + chaos. Não.
4. **"Vamos colocar tudo num único arquivo de actions pra ficar fácil de achar"** — é assim que god modules nascem. Bounded contexts.
5. **"Vamos guardar conversas IA pra sempre"** — explode storage, vira passivo LGPD.
6. **"Vamos fazer deploy-per-clinic pra grandes clientes"** — falsa segurança, real complexidade.
7. **"Vamos adicionar Kubernetes pra escalar"** — você não precisa. Vercel + Supabase cobrem.
8. **"Vamos suportar Firestore E Postgres"** — over-engineering, escolha um.
9. **"Vamos fazer triagem de sintomas via IA, é só prompt"** — SAMD/ANVISA, inviabiliza produto.
10. **"Vamos automatizar emissão de NF na hora do pagamento"** — Asaas faz, não duplica.
11. **"Vamos integrar com TODOS os bancos via OFX automático"** — feature de planilha, valor marginal pro paciente.

## 11.5 Riscos organizacionais

⚠️ **Você solo founder, sem time. Riscos específicos:**

1. **Bus factor = 1**: você desaparece, sistema morre. **Mitigação**: ADRs versionados no repo. Toda decisão importante documentada.
2. **Burnout**: 50 clínicas + suporte solo é teto. **Mitigação**: a partir do 30º cliente, self-service. A partir do 50º, contratar.
3. **Decisão emocional vs técnica**: você vai querer dar desconto pro amigo, vai querer ignorar bug "porque é raro". **Mitigação**: regras escritas (este doc) sobrepujam impulso.
4. **Cliente que paga muito mas estraga produto**: pedidos custom que não servem pra mais ninguém. **Mitigação**: educado mas firme, "isso não cabe no roadmap, mas posso fazer custom contratual".
5. **Dependência de uma feature de provider**: se Meta mudar regra de templates, posso quebrar. **Mitigação**: abstração + monitoring.

---

# 12. Conhecimento Tácito

## 12.1 Intuições do founder (você no passado)

💡 **Coisas que você sentiu nas decisões mas talvez não articulou:**

1. **"Não confio em config via UI pra coisa crítica"** — por isso prompt sistema em código, credencial em Secret Manager. Quanto menos UI editável, menos suporte.

2. **"Cada clínica é uma folha de caderno"** — frase que você usou. Define toda a estratégia de isolamento. RLS + per-tenant encryption + audit per-tenant materializam esse princípio.

3. **"Quero saber tudo o que entra de dinheiro na clínica"** — vc quer transparência total pra calcular comissão / pra entender o cliente. Mesmo cortando modelo Qoro de comissão sobre crescimento, o instinto persiste — vai virar dashboard interno de "saúde financeira do cliente" pra você ver risco de churn.

4. **"Não quero ser refém de provider"** — Drizzle ORM (pode trocar Supabase), MessagingProvider (pode trocar Meta por Z-API), AIProvider (pode trocar Gemini por GPT). Abstração paranoica mas defensável.

5. **"Não quero parecer amador"** — por isso white-label leve (logo, cor, PDFs com marca da clínica). Vc projeta o produto pra ser "profissional aos olhos da clínica e do paciente dela". (Sem domínio/subdomínio próprio por clínica — §3.9.)

## 12.2 Preocupações conhecidas

⚠️ **Coisas que você tem medo de errar:**

1. **Vazamento entre tenants** — paranoia justificada. RLS + per-tenant encryption + audit dão 3 camadas de proteção.
2. **Bug financeiro** — clínica perde dinheiro, vc paga. Idempotency + faturamento blocking + audit mitiga.
3. **Custo Gemini explodir** — cota por plano + circuit breaker mitiga.
4. **Meta banir cliente** — abstração MessagingProvider mitiga.
5. **Suporte fora de controle** — white-glove tem limite, self-service desde cedo mitiga.
6. **LGPD ANPD bater** — compliance bem feito + audit + retention declarada mitiga.

## 12.3 Aprendizados do v1

🎓 **Coisas que custaram caro pra aprender:**

1. **Per-deploy não escala** — onboarding manual de cada cliente é trabalho que cresce linear, e cada deploy fica defasado em relação aos outros. Multi-tenant é o caminho.

2. **Firestore mata produtividade em domínio relacional** — 537 `clinicId manual`, sem JOIN, indexes explosivos. Postgres com RLS é jogo diferente.

3. **Comissão sobre crescimento conciliado é teorima bonita** — na prática, exige clínica fazer OFX semanal, virar conflito comercial, e clínica pequena não opera assim. Tier fixo + add-on (% IA-gerada) é defensável.

4. **TISS é projeto à parte** — 25-30% da complexidade do v1, atende vertical específica. Não core no MVP.

5. **Pre-anamnese via IA é tentação que destrói você juridicamente** — SAMD/ANVISA não tem como passar. Não fazer.

6. **God modules surgem de "vai ficar fácil de achar tudo num lugar só"** — não fica. Vira pesadelo de 1300 LOC.

7. **State machines hardcoded em ifs distribuídos é o motor da hidra** — toda state machine vai pra arquivo dedicado, com testes obrigatórios.

8. **Cobrança automática + dunning + LGPD bem feito é o que diferencia produto profissional de planilha glorificada** — investimento que paga.

## 12.4 Hipóteses estratégicas (apostas)

🎯 **Coisas que vc aposta sem ter certeza:**

1. **Clínica pequena/média paga R$ 150-700/mês com prazer se sistema reduz vazamento mensurável** — hipótese. Validar com primeiros 5-10 clientes.

2. **IA + WhatsApp é diferencial vendável** — provavelmente sim, mas concorrente vai copiar em 12-18 meses. Moat real será integração + dados acumulados.

3. **Setup fee R$ 200-500 não afasta cliente sério** — hipótese. Se afastar, ajusta.

4. **White-glove via ligação aumenta conversão e retention** — confiança do médico tradicional. Testar.

5. **Annual prepay 15% off encontra adesão** — depende da maturidade financeira da clínica.

6. **Memed integration é suficiente pra prescrição digital** — provavelmente sim, mas há risco de Memed mudar termos ou cobrar.

## 12.5 Riscos políticos e produto

⚠️ **Coisas que podem dar errado fora do código:**

1. **CFM regulamenta IA em saúde mais duramente** — sistema que faz "agendamento via IA" pode entrar em escopo regulado. Mitigação: prompt restritivo + documentação clara de "não faz triagem".

2. **ANPD intensifica fiscalização** — multas LGPD começam a cair em SaaS pequenos. Mitigação: compliance desde dia 1.

3. **Meta sobe preço da Cloud API** — possível. Mitigação: Z-API como fallback + repassar custo no plano.

4. **Concorrente grande (iClinic, Doctoralia) lança feature similar** — provável em 18-24 meses. Mitigação: integração + dados acumulados + atendimento próximo.

5. **Receita cresce e você não dá conta sozinho** — bom problema, mas exige contratar antes de quebrar. Threshold: ~40 clientes.

## 12.6 Visões futuras (especulativo, low confidence)

🔮 **Coisas que podem acontecer mas não definem o presente:**

1. **Marketplace de templates clínicos** — clínica compartilha template SOAP, outras compram (revenue share). Possível em 2-3 anos.

2. **ClinicaOS pra outras verticais** — pet shop (sistema clínico veterinário), odonto (já cabe), barbearia (não cabe). Não distrair do core.

3. **Telemedicina como diferencial** — pós-COVID, demanda real. CFM 2.314 permite. Implementar com Daily.co ou similar quando demanda explícita.

4. **Venda estratégica** — em 3-5 anos, possível adquirente: iClinic, Doctoralia, Memed, Conta Azul. Manter qualidade arquitetural facilita due-diligence.

5. **Expansão pra Latam** — Argentina, México, Colômbia têm mercados similares. Distante, mas multi-currency + multi-language no roadmap quando time crescer.

---

# 13. Apêndices

## 13.1 Glossário

| Termo | Definição |
|---|---|
| **Bounded context** | Subsistema com fronteira clara, dono único de dados e regras |
| **Outbox pattern** | Tabela onde eventos são gravados na mesma TX do dado, processados depois |
| **RLS** | Row Level Security do Postgres, filtra rows por policy automática |
| **MRR** | Monthly Recurring Revenue, receita recorrente mensal |
| **Churn** | Taxa de cancelamento de clientes |
| **LTV** | Lifetime Value, valor total que cliente paga durante relacionamento |
| **SAMD** | Software as a Medical Device, classificação ANVISA |
| **TISS** | Troca de Informação em Saúde Suplementar, padrão ANS pra convênios |
| **CFM** | Conselho Federal de Medicina |
| **ANPD** | Autoridade Nacional de Proteção de Dados |
| **PITR** | Point-In-Time Recovery, restauração do banco em momento exato |
| **HMAC** | Hash-based Message Authentication Code, validação de integridade |
| **HKDF** | HMAC Key Derivation Function, deriva chaves de chave master |
| **Idempotency** | Propriedade de operação que produz mesmo resultado se executada N vezes |
| **CRC16-CCITT** | Algoritmo de checksum usado em PIX BR Code |
| **EMV BR Code** | Padrão de QR code do PIX (BACEN) |
| **HSM** | Highly Structured Message (template aprovado da Meta) |
| **BSP** | Business Solution Provider (revende API WhatsApp) |
| **DPA** | Data Processing Agreement (acordo de processamento LGPD) |
| **DRE** | Demonstração do Resultado do Exercício (relatório contábil) |

## 13.2 Convenções de código

- **Naming**: `snake_case` no banco, `camelCase` no TypeScript
- **Files**: kebab-case (`agent-config.ts`)
- **Folders**: kebab-case
- **Imports**: absolute from `@/` (Next.js path alias)
- **Server actions**: prefixadas com verbo (`createAppointment`, `confirmPayment`)
- **Events**: format `<context>.<entity>.<action>` (ex: `scheduling.appointment.created`)
- **Idempotency keys**: format `<entity>:<action>:<deterministic-hash>`

## 13.3 ADRs futuras

Cada decisão arquitetural significativa (que muda este doc) vira ADR em `docs/adr/`:

```
docs/adr/
  001-bounded-contexts.md
  002-rls-postgres.md
  003-outbox-pattern.md
  004-meta-cloud-api.md
  005-supabase-vs-firebase.md
  ...
```

Template ADR:

```markdown
# ADR-XXX: <título>

**Status**: proposed | accepted | deprecated | superseded by ADR-YYY
**Data**: YYYY-MM-DD
**Contexto**: <situação que motivou a decisão>
**Decisão**: <o que foi decidido>
**Consequências**: <positivas e negativas>
**Alternativas consideradas**: <outras opções e por que rejeitadas>
```

## 13.4 Decisões fechadas no design (resumo executivo)

✅ **Arquitetura:**
- Multi-tenant single deploy
- 8 bounded contexts isolados
- Outbox pattern pra eventos
- RLS no Postgres como L3
- Idempotency keys obrigatórias
- Encryption at-rest per-tenant
- Multi-unidade desde o schema
- 2FA obrigatório pro `super_admin` (gestor/financial: opt-in forte — **ADR-038**)

✅ **Stack:**
- Next.js 15+ (App Router) + Supabase + Drizzle + Tailwind/shadcn
- Postgres como source of truth
- Meta Cloud API + Z-API fallback (MessagingProvider abstrato)
- Gemini Flash como LLM
- Asaas pra cobrança recorrente
- Sentry + Better Stack/Axiom pra observabilidade
- Vercel pra hosting do app
- Firebase Hosting (atual) pra landing — não migrar
- Wildcard DNS `*.qoro.dev` → Vercel

✅ **Produto:**
- Dashboard único com permissões granulares (RBAC + ABAC)
- Roles: gestor, doctor, attendant, financial, owner + super_admin
- Módulo Consultório (kanban 3 colunas)
- Documentos clínicos imprimíveis (sem ICP-Brasil no MVP)
- Estoque simples opcional (sem SNGPC)
- Fornecedores em Financial
- Pacotes de sessões
- Pagamento manual pelo atendente (sem gateway paciente no MVP)
- TISS adiado pra v2.1+

✅ **IA:**
- Agente único, prompt em código
- Parâmetros operacionais por clínica em DB
- Sem triagem clínica (hardcoded)
- Cota por plano = teto anti-abuso, sem overage (ADR-024)
- Stateless por mensagem (isolation perfeito)
- Conversa retenção 30d hot + 1 ano cold archive

✅ **Compliance:**
- LGPD: consents + export + delete (30d window) + suppression
- CFM: prontuário 20 anos + assinatura física no MVP (Memed na v2.1)
- Marco Civil: audit 12m hot + 5 anos cold
- ANS/TISS: somente na v2.1+

✅ **Commercial:**
- Tier fixo: Solo R$ 149 / Clínica R$ 349 / Pro R$ 699
- Setup fee R$ 200-500
- Trial 14 dias COM cartão
- Annual prepay 15% off
- Onboarding white-glove via ligação até ~30 clientes

---

> **Fim do documento.**
>
> Este documento é vivo. Atualize-o (ou crie ADRs novas) sempre que decisão importante for tomada ou revertida. Não deixe o documento decair — ele é o único ativo arquitetural que sobrevive a você esquecer o motivo de tudo.
>
> Última atualização: 2026-05-24

---

## Veja também

- [README.md](./README.md) — índice mestre da documentação (porta de entrada).
- [architecture/context-map.md](./architecture/context-map.md) — os 8 bounded contexts em 1 tela.
- [adr/README.md](./adr/README.md) — as decisões arquiteturais com seus racionais.
- [documentation-authority.md](./documentation-authority.md) — quando este doc conflita com um ADR, o ADR vence.
