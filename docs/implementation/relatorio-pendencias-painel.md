# Relatório — Pendências do Painel + Revisão do Fluxo de Agendamento

**Data:** 2026-06-28 · **Escopo:** estado atual do receituário/modelos/agenda + revisão de
segurança da criação de atendimento + análise de gaps de **Documentos, Prontuários, Relatórios e
Conversas IA**. ·
**Refs:** [plano-receituario-e-painel-medico.md](plano-receituario-e-painel-medico.md),
[prescricao-psiquiatria.md](prescricao-psiquiatria.md), VisãoGeral §2.5 (defesa 4 camadas),
ADR-007 (RLS), ADR-012 (encryption), ADR-018 (UI honesta — sem mock).

---

## 0. Estado atual (entregue)

| Entrega | Status |
|---|---|
| **Fase 1 — Receituário de Controle Especial** | ✅ implementado + validado (smoke) + commitado (`feat/receituario-controle-especial`). Endereço do paciente capturado no cadastro/edição. |
| **Fase 2 — Modelos de Receita** | ✅ implementado (migration 0035, CRUD `/modelos-receita`, aplicar/salvar no editor e consultório, RLS+doctor_id, idempotência). Pendente: smoke do usuário + commit. |
| **Agenda (walk-in + agendar)** | ✅ `/agenda` com "Novo atendimento": **encaixe (agora)** e **agendar (dia/hora)**. Backend C6 já existia; era só front. |
| **R1 — patient↔clinic no core C6** | ✅ `assertPatientInClinic` no core (`createAppointmentCore` + walk-in) — cobre TODOS os chamadores (UI, walk-in, AI Agent). Ver §1.3. |
| **Documentos** | ✅ `/documentos` (feed unificado prescrições + documentos via adapter `listClinicalDocumentFeed`). Nav ligada. |
| **Prontuário (browse)** | ✅ `/prontuarios` (busca paciente → histórico existente). Nav ligada. |
| **Procedimentos (catálogo)** | ✅ `/configuracoes/procedimentos` (CRUD, gate `manage:procedures`) — destrava a Agenda para clínicas reais. |
| **Configurações (índice)** | ✅ `/configuracoes` (índice honesto: Procedimentos + WhatsApp reais; Perfil/Horários como "em breve" sem link morto). |
| **Relatórios** | ✅ `/relatorios` (faturamento gated por `view:financial` · no-show · **ocupação via slot-resolver canônico**). Nav ligada. |
| **Configurações › Horários** | ✅ `/configuracoes/horarios` (disponibilidade semanal por médico + feriados, gate `manage:availability`). |
| **Configurações › Perfil da clínica** | ✅ `/configuracoes/perfil` (dados do documento + **upload de logo** até 5 MB, gate `manage:settings`). Escrita segura via `dbAdmin`+audit no core (S5 resolvido). Cor da marca **removida da UI** por decisão (coluna mantida p/ seed/PDF). |

> **Rodada 2026-06-28** — R1/Documentos/Prontuários/Procedimentos/Configurações(índice)/Relatórios
> +  **Horários** e **Perfil** implementados. Gates verdes: `typecheck` · `lint` · `arch:db-check` ·
> `check:migrations` · `check:registry` · `test` (472). **Sem migration nova** (todo o backend já
> existia; Perfil reusa o escape hatch `dbAdmin`+audit já existente). **Restam só** Conversas IA e
> Agenda-calendário — ambos deferidos POR DECISÃO (§2.4 e §3), não por falta de backend. Pendente:
> smoke multi-tenant do usuário (A/B) + commit.

---

## 1. Revisão de segurança/lógica — criação de atendimento

Revisão do fluxo `createAppointment` / `createWalkInAppointment` (C6) e da camada nova `/agenda`.

### 1.1 Achados e correções
| # | Severidade | Achado | Resolução |
|---|---|---|---|
| S1 | **Alta** | O core do C6 (`createAppointmentCore`/walk-in) valida **procedure** e **doctor** contra a clínica (`buildSnapshot`), mas **NÃO valida `patient_id`↔clínica**. `patient_id` é só FK para `patients(id)` e a checagem de FK **ignora RLS** → um `patientId` forjado de outra clínica poderia ser vinculado a um atendimento. | **Corrigido na camada `/agenda`**: `criarAtendimento` chama `getPatientSummaryById(clinicId, patientId)` (tenant-scoped/RLS) e rejeita se não pertencer à clínica. **Recomendação (R1, abaixo):** replicar a checagem no core do C6 para cobrir todos os chamadores. |
| S2 | Média | Timezone: hora "de parede" digitada poderia ser interpretada no fuso do browser (errado para clínica em outro fuso). | **Resolvido**: o modo "agendar" envia `date`+`time` crus; o **servidor** converte com `zonedWallToUtc(clinicId tz)` (DST-correct) antes de `createAppointment`. Nunca confia no browser. |
| S3 | Baixa | Exposição de existência de paciente na busca. | `buscarPacientes` exige `view:patient` + é tenant-scoped (RLS); `criarAtendimento` exige `edit:agenda` antes de qualquer leitura. |
| S4 | Info | Permissão de criação. | `createAppointment`/`createWalkInAppointment` reaplicam `requireFreshPermission(edit:agenda)` internamente (defesa em profundidade além do gate cacheado da action). |

### 1.2 Comportamentos corretos confirmados (sem ação)
- **Anti-conflito**: EXCLUDE (btree_gist) impede duplo-agendamento do mesmo médico em horários sobrepostos → `SchedulingConflictError` (mensagem amigável na UI).
- **Passado**: `createAppointmentCore` rejeita `scheduledAt < now()` (exceto import histórico).
- **Idempotência + audit + snapshot imutável**: herdados do pipeline C6.
- **Médico/procedimento**: `buildSnapshot` exige `role='doctor'` ativo e procedimento ativo da clínica.

### 1.3 Recomendações (follow-up)
- **R1 — ✅ RESOLVIDO (2026-06-28):** `assertPatientInClinic(tx, clinicId, patientId)` no core
  ([appointment-core.ts](../../src/contexts/scheduling/internal/appointment-core.ts)), chamado em
  `createAppointmentCore` e no walk-in quando `patientId != null`. Roda sob `withTenant` (RLS de
  `patients` isola por tenant) + filtro `clinic_id` explícito (defesa em profundidade, espelha
  `buildSnapshot`). Fecha o gap S1 para TODOS os chamadores (UI, walk-in, **AI Agent**). A checagem
  na action `/agenda` virou só early-fail/UX. **Smoke a validar:** sessão da Clínica A com um
  `patientId` da Clínica B → `SchedulingValidationError('paciente inválido para esta clínica')`.
- **R2 (produto):** a criação atual **não valida disponibilidade** (`doctor_availability`/
  feriados) — permite agendar fora do expediente (override manual). Aceitável para encaixe; quando
  houver o **calendário** (slots visuais), oferecer apenas horários livres e marcar overrides.
- **R3 (UX):** no modo "agendar", o `min` do input de data usa o fuso do browser; o servidor é a
  fonte da verdade (rejeita passado no fuso real). Suficiente; o calendário futuro refina.

---

## 2. Gaps do painel ("Em breve") — análise por módulo

**Insight central:** quase tudo tem **backend pronto**; falta **UI**. Nada exige regra de negócio
nova. Mantém ADR-018 (vira link real só quando a rota existir).

### 2.1 Documentos — `/documentos` · ✅ **FEITO (2026-06-28)** · esforço **Baixo**
- **Backend:** ✅ pronto. PDFs já geram (C7); páginas de visualização **já existem**:
  [prescricoes/[id]/pdf](../../src/app/(app)/prescricoes/[id]/pdf/page.tsx) e
  [documentos/[id]/pdf](../../src/app/(app)/documentos/[id]/pdf/page.tsx) (signed URL fresca, R4).
  Queries `getPrescriptionById`/`getMedicalDocumentById` existem.
- **Falta:** rota **índice** `/documentos` que **lista** prescrições + `medical_documents` do
  tenant, com filtros (paciente/tipo/data), linkando às páginas de PDF.
- **Como:** adapter único `listClinicalDocumentFeed(clinicId, filtros)` em
  [clinical/queries.ts](../../src/contexts/clinical/queries.ts) → `ClinicalDocumentFeedItem[]`
  (`{ kind, id, patientId, patientNome, createdAt, pdfHref }`) — a tela **nunca conhece tabelas**.
  Server component + filtros client (padrão de `pacientes/.../prontuarios/page.tsx`).
- **Segurança:** RLS tenant; `kind` no item → href correto; sem PII além de nome (snapshot).

### 2.2 Prontuários (browse) — nav · ✅ **FEITO (2026-06-28)** · esforço **Baixo**
- **Backend:** ✅ pronto. Rota **já existe**:
  [pacientes/[id]/prontuarios](../../src/app/(app)/(shell)/pacientes/[id]/prontuarios/page.tsx)
  (lista por paciente) + editor read-only quando assinado.
- **Falta:** só **navegação** — o item "Prontuário" do menu hoje é "Em breve". Precisa de um
  ponto de entrada por paciente (o histórico já existe).
- **Como:** apontar o item de nav para `/pacientes` (selecionar paciente → "Prontuários"); ou uma
  landing `/prontuarios` com busca de paciente reusando `buscarPacientes`/`listPatients`. Sem
  editor novo, sem regra nova.
- **Segurança:** read-only; imutabilidade pós-assinatura já garantida por trigger (C7).

### 2.3 Relatórios — `/relatorios` · ✅ **FEITO (2026-06-28)** · esforço **Médio**
> **Entregue:** faturamento (gated `view:financial`, via `getFaturamentoPeriodo`), no-show
> (`getAppointmentStats`) e **ocupação reusando `getAvailableSlots` (slot-resolver canônico)** —
> ocupação = minutos ocupados ÷ (ocupados + livres do resolver), respeitando almoço/feriado.
> Seletor de período (7/30/90d) no fuso da clínica. Cards + barra CSS (sem lib de gráfico).
> **A validar com fixtures:** feriado, ausência (0 ofertável → "sem horários"), agenda vazia.
- **Backend:** ✅ dados existem. Tabelas: `cashFlowDaily`, `lancamentos`
  ([financial/schema.ts](../../src/contexts/financial/schema.ts)), `appointments`
  (no-show = `status='faltou'`), `doctorAvailability`+`appointments` (ocupação).
- **Falta:** UI de painéis (sem lib de gráfico — **cards/barras CSS**, decisão tomada):
  - **Faturamento**: somatório por período de `cash_flow_daily`/`lancamentos`.
  - **No-show**: contagem `appointments.status='faltou'` por período/médico.
  - **Ocupação**: **reusar o slot-resolver canônico** (`computeSlots` com os mesmos inputs de
    `getAvailableSlots`) → `ocupação = ocupados ÷ (ocupados+livres)`. **Não** usar contagem ingênua
    de `doctor_availability` (ignora almoço/feriado/bloqueio).
- **Cuidados (testar com fixtures):** feriado (menos ofertável), ausência (0 ofertável), agenda
  vazia (0%); janela de período no **fuso da clínica** (reusar `clinicDayBounds`/`getClinicTimezone`).
- **Segurança:** leitura tenant-scoped; financeiro exige `view:financial` (atendente já tem;
  garantir gate na página/loader).

### 2.4 Conversas IA — `/conversas` · ⏸️ **DEFERIDO POR DECISÃO** (não construir agora)
- **Backend:** ✅ C11/C12. Tabelas `aiConversations`, `aiMessages` (cifradas), `aiHandoffQueue`
  ([ai-agent/schema.ts](../../src/contexts/ai-agent/schema.ts)). Padrão de decrypt server-side
  validado no C15.
- **Por que NÃO foi construído agora:** sem o **WhatsApp conectado** não há conversas reais — a
  tela seria um inbox vazio, o que **viola ADR-018** (não simular o que não existe). O item
  permanece "em breve" na nav até o WhatsApp no ar (mesma regra do 4º item da checklist de
  ativação). É decisão, não falta de backend.
- **Quando fizer:** inbox do tenant (lista + thread) + fila de handoff. **Segurança (crítica):** L4
  encryption — decifrar **só server-side** no ponto de uso (loader/action), **nunca** enviar
  `*_encrypted` ao browser; gate por permissão (`manage:agent`/`view:consultorio`); RLS por clínica;
  **não logar** conteúdo (sanitização C4).

### 2.5 Configurações + Procedimentos
- **Procedimentos — ✅ FEITO (2026-06-28):** `/configuracoes/procedimentos` (CRUD via
  `catalog-actions.ts`, gate `manage:procedures`, soft-disable nunca DELETE). Era o **bloqueio das
  clínicas reais** na Agenda. RLS `procedures` (tenant FOR ALL) suporta a escrita pelo tenant.
- **Configurações (índice) — ✅ FEITO:** `/configuracoes` lista as 4 seções com rota real:
  Procedimentos, Perfil da clínica, Horários e Conexão do WhatsApp.

#### Decisão — white-label só nos PDFs (ADR-028, 2026-06-28)
White-label fica **restrito ao cabeçalho dos PDFs** (logo + cor) — sem tema de app. O caminho de
**render já está pronto** (`loadClinicBranding` → `PdfBranding` → templates). Importante: **"Perfil
da clínica" ≠ white-label** — os campos `nome/endereço/telefone/CNPJ/CNES` são **dados obrigatórios
do documento** (o receituário precisa por lei) e é por isso que o Perfil continua valendo. Ver ADR-028.

**Self-service de logo — ✅ IMPLEMENTADO (2026-06-28)** (o "futuro" da ADR-028 §4):
- **Logo via upload** (não mais URL colada): bucket **público** `clinic-logos`
  ([lib/storage/clinic-assets.ts](../../src/lib/storage/clinic-assets.ts), criado/atualizado por
  `pnpm seed:logo-bucket`) → action `uploadClinicLogo(formData)` em
  [tenancy/actions.ts](../../src/contexts/tenancy/actions.ts): gate `manage:settings`, `clinicId`
  do request (namespaceia `clinic-logos/<clinicId>/logo.<ext>`), valida **MIME png/jpeg/webp** +
  **≤5 MB** server-side (e no bucket), devolve URL pública (cache-bust `?v`). O @react-pdf já
  consome `logo_url` no render — **PDF não mudou**. SVG fora (script-injection).
- **Cor da marca: REMOVIDA da UI** (decisão de produto, 2026-06-28). A coluna
  `clinics.primary_color` permanece (seed/admin/PDF com default neutro), mas o tenant não escolhe
  cor — `primaryColor` saiu de `ClinicProfileSchema`/core, então a edição de perfil nunca toca essa
  coluna.
- Persistência: o upload só **hospeda**; o `logo_url` entra em `clinics` no **Salvar** (escrita
  segura S5). **Setup 1x:** `pnpm seed:logo-bucket` (dev, idempotente — cria OU atualiza limite/MIME)
  / criar bucket público no Dashboard (prod).

#### ✅ Achado de segurança (S5) — RESOLVIDO (2026-06-28)
A tabela `clinics` tem RLS **SELECT tenant-aware, mas INSERT/UPDATE/DELETE são `is_super_admin()`
only** ([0001_tenancy_foundation.sql](../../drizzle/migrations/0001_tenancy_foundation.sql#L96)) —
um usuário do tenant **não** dá `UPDATE clinics` via `withTenant`. **Implementação segura** (irmão
do `connection-store` de mensageria):
1. `updateClinicProfile` ([tenancy/actions.ts](../../src/contexts/tenancy/actions.ts)) →
   `requireFreshPermission(manage:settings)` + `clinicId = requireClinicId()` (do **request**);
2. core ([tenancy/internal/profile-core.ts](../../src/contexts/tenancy/internal/profile-core.ts))
   abre `dbAdmin.transaction`, faz `UPDATE clinics SET <só 7 colunas de perfil> WHERE id=clinicId`
   (**nunca** status/plan/slug/timezone → sem escalonamento de billing/lifecycle) e **audita**
   before/after na mesma tx;
3. arquivo na allowlist de `dbAdmin` (eslint + `arch:db-check`), com justificativa.
**Smoke a validar:** gestor da Clínica A salva perfil → só a clínica A muda; usuário sem
`manage:settings` é barrado; `status`/`plan` permanecem intocados.

### 2.6 Horários de atendimento — ✅ **FEITO (2026-06-28)**
`/configuracoes/horarios` ([page](../../src/app/(app)/(shell)/configuracoes/horarios/page.tsx)):
disponibilidade semanal por médico + feriados. Backend C6 já pronto
(`config-actions.ts`, gate `manage:availability`, validação doctor↔clínica + EXCLUDE de overlap);
adicionadas as queries de leitura `listDoctorAvailability`/`listHolidays`
([scheduling/queries.ts](../../src/contexts/scheduling/queries.ts)) + UI. O link "Defina os
horários" da checklist de ativação do dashboard agora aponta para esta rota.

---

## 3. Sequência — feito × pendente

**✅ Concluído (2026-06-28):** R1 (core C6) · Documentos · Prontuários (browse) · Procedimentos ·
Configurações (índice) · Relatórios (faturamento/no-show/ocupação) · **Horários** · **Perfil da
clínica** (escrita segura S5).

**Pendente — só os 2 deferidos POR DECISÃO (backend já existe; não é dívida oculta):**
1. **Conversas IA** (§2.4) — **bloqueado por produto**: só faz sentido com o WhatsApp no ar (senão
   é inbox vazio → ADR-018). Construir junto/depois da conexão do WhatsApp.
2. **Agenda — calendário visual** (slots/criar por clique sobre o backend C6) — **evolução de UI**,
   não pendência de fundação. A Agenda já cria atendimentos (encaixe/agendar) e os Horários já
   alimentam os slots; o calendário é o próximo grande trabalho de front quando virar prioridade.

**Smoke pendente do usuário (multi-tenant A/B, `reset:dev`+`seed:dev`):**
- **R1** — paciente da Clínica B em sessão A → rejeitado no core.
- **Documentos** — Clínica B não vê documento da A.
- **Procedimentos / Horários** — CRUD + reativar; janela com overlap → conflito amigável.
- **Perfil (S5)** — gestor A salva → só A muda; sem `manage:settings` → barrado; `status`/`plan` intocados.
- **Relatórios** — faturamento só com `view:financial`; ocupação com feriado / sem-horário.

## 4. Gates de qualidade (todas as entregas)
`pnpm typecheck` · `pnpm lint` · `pnpm arch:db-check` · `pnpm check:migrations` ·
`pnpm check:registry` · `pnpm test`. Smoke multi-tenant (RLS A/B) com `pnpm reset:dev`+`seed:dev`
(Clínicas A/B). Decrypt sempre server-side; storage privado + signed URL.
