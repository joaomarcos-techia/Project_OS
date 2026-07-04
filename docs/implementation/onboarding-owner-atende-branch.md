# Spec de Implementação — Onboarding: "o dono também atende?" (owner ± CRM)

**Status:** proposta (não implementada) · **Camada:** refinamento do wizard de onboarding (ADR-027) ·
**Refs:** ADR-027 (convite mágico / wizard), ADR-016 (lifecycle: owner é quem loga suspenso p/ regularizar),
ADR-008 (identity — role vs campos), ADR-024 (plano). **Relacionada:** `convite-e-gestao-de-equipe.md`
(fluxo IRMÃO, porém distinto — lá o owner convida funcionário; aqui o owner nasce).

> **Contexto.** O wizard de criação de clínica (ADR-027: clínica → dono/senha → plano → checkout) hoje
> cria o dono **sempre como `owner`** e **não pergunta se ele atende**, nem coleta CRM — a
> `provisionTenantFromInviteTx` insere o profile do owner sem `crm`
> ([saga.ts §2](../../src/contexts/onboarding/internal/saga.ts)). Resultado: o médico-dono (o caso mais
> comum de clínica pequena) nasce sem credencial e não é reconhecido como clínico.

> **Premissa que corrige um mal-entendido (2026-07-04).** "Médico **vs** owner" é falsa escolha: **CRM é
> um campo de `profiles`** (`crm`/`crmUf`, nullable — [schema.ts](../../src/contexts/identity/schema.ts)),
> **ortogonal ao `role`**. Um `owner` PODE ter CRM — isso É o médico-dono. Quem cria a clínica é **sempre
> `owner`** (assinou e paga; é o único que loga com a clínica `suspended` p/ regularizar — ADR-016). Se
> pudesse escolher `role=doctor`, a clínica nasceria **sem dono** e quebraria a invariante de billing/acesso.

## Decisão

**O papel não muda (sempre `owner`). O wizard ramifica por UMA pergunta: "Você também atende pacientes?"**

- **Sim** → coleta **CRM + UF** → owner médico-dono → pós-provisionamento, o checklist de ativação oferece
  adicionar **médicos parceiros** e **atendentes** (via o fluxo de `convite-e-gestao-de-equipe.md`).
- **Não** → pula CRM → owner administrativo → o checklist **enfatiza adicionar o(s) médico(s)**, senão a
  clínica não tem quem atenda.

CRM aqui é **opcional** (consistente com o convite): coletado no wizard se ele atende, mas só vira
obrigatório **para emitir o 1º documento** (`assertDoctorHasCrm`, já existente). No comercial orienta-se
preencher na hora.

## Onde pluga (mínimo de superfície)

1. **Wizard** — [join-wizard.tsx](../../src/app/(app)/join/[token]/join-wizard.tsx), na etapa do dono:
   um toggle **"Também atendo pacientes"** e, quando ligado, os campos **CRM + UF** (componentes DS:
   `Switch`/`Segmented` + `Field`/`Input`). Vai no `step_state` (contrato Zod — **nunca** senha/cartão).
2. **Contrato de checkout** — estender `CheckoutArgs.owner` e `ProvisionArgs.owner`
   ([saga.ts](../../src/contexts/onboarding/internal/saga.ts)) com `crm?`/`crmUf?` (opcionais).
3. **Escrita** — adicionar `crm`/`crmUf` ao `insert profiles` do owner na `provisionTenantFromInviteTx`
   (hoje grava `nome/telefone/role:'owner'/ativo`). É a única linha de schema tocada — **aditivo**, sem
   migração (as colunas já existem, C7).
4. **Pós-provisionamento** — o checklist de ativação (ADR-027 Fase 2) ramifica o CTA por `atende`
   (adicionar parceiros vs adicionar médico).

## Design

Mesma autoridade do irmão: **DS implementado** (`src/components/ui/*` + tokens `_painel/ds.css`), **não** o
`design_system/DSv2.html`. A pergunta "atende?" reusa `Switch`/`Segmented`; CRM+UF reusa `Field`/`Input`.

## Segurança / invariantes

- Owner continua **único** por clínica; este branch não muda papel, só preenche (ou não) CRM.
- `atende` + CRM entram por `step_state` validado por Zod; preço/plano seguem resolvidos server-side (ADR-027).
- Nenhum novo caminho de escalonamento (o dono é o topo; não há papel acima).

## Adjacente e pré-requisitos ([ADR-032](../adr/032-mvp-identity-practitioner-model.md))

- **⚠️ Pré-requisito de ordem:** o predicado **`isPractitioner`** (ADR-032 §2) deve nascer e os checks
  `role === 'doctor'` serem migrados **antes** deste branch gravar CRM no owner — senão o médico-dono grava
  CRM mas continua não sendo reconhecido como clínico nos 17 lugares que ainda checam `role === 'doctor'`.
- **Centralização (gaps 3/15 do review):** este branch e o convite de funcionário devem **chamar o mesmo
  comando de domínio** de criação em `identity` (profile + role + CRM + practitioner) — a UI (wizard/drawer)
  só coleta. Não duplicar a lógica de CRM/UF/practitioner entre os dois fluxos.
- **Canal = e-mail** (ADR-032 §3): o owner nasce por e-mail (Supabase Auth); coerente com o convite.
- **Duplicidade/autoridade de CRM** (ADR-032 §5): as mesmas políticas do convite valem aqui (o owner é o
  primeiro CRM da clínica).

## A implementar quando sair do papel

- **Amendment no ADR-027** registrando o branch "atende?" no wizard (ADRs são a autoridade —
  [documentation-authority.md](../documentation-authority.md)).
