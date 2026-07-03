# Auditoria UI/UX — Refatoração Design System v2

> Relatório final da refatoração (Ondas 0–7, 2026-07-02 → 2026-07-03), branch
> `feat/ui-ds-v2-fundacao`. Fonte de verdade visual: `design_system/DSv2.html`
> (ADR-031). Checklist mestre e UI Audits por onda: `docs/ui-refactor/ui-inventory.md`.
> Mapa token/componente: `docs/ui-refactor/design-system-map.md`.

## Resumo Executivo

O app inteiro (tenant + admin) migrou para o DS v2 — rebrand petrol/clay +
Hanken Grotesk/Inter/IBM Plex Mono — com **menos telas, mais contexto**: criação
e assinatura viraram Drawer/Dialog deep-linkáveis, o fluxo clínico caiu de 5
para 3 níveis de página, e todas as rotas principais ganharam estados de
loading/erro. A biblioteca `src/components/ui/` saiu de 14 para **40 arquivos**
(Dialog, Drawer, Toast, Table kit, Tabs, Combobox, Skeleton…), o padrão de
feedback foi unificado em toast (54 → **0** banners locais) e as 6 tabelas à
mão viraram Table kit (resta 1, na página deferida do admin). Duas descobertas
estruturais valeram a refatoração sozinhas: o ds.css redefinia todos os tokens
por cima do globals.css, e o CSS legado *unlayered* esmagava as utilities do
Tailwind (`* { margin:0 }` matava toda margem do app) — ambos corrigidos na
raiz (tokens únicos + `@layer components`).

## Números (antes → depois)

| Métrica | Antes | Depois |
| --- | --- | --- |
| Rotas de página do tenant | 25 | 22 (−novo, −prontuarios browse, −assinar) |
| Fluxo mais profundo | 5 níveis | 3 níveis |
| Feedback `msg={ok,text}` local | ~54 | **0** |
| Tabelas `<table class="ui-table">` à mão | 6 | 1 (admin/clinicas/[id], deferida) |
| `loading.tsx` | 0 | 13 |
| `error.tsx` | 1 global | 3 (root + shell + admin) + not-found |
| Sistema de toast | inexistente | store singleton + `useActionFeedback` |
| Componentes em `ui/` | 14 | 40 |
| Sistemas de ícones | 2 | 1 (lucide; `icons.tsx` = mapa compat) |
| Sistemas de StatCard | 2 | 1 (admin usa adapter do canônico) |
| Elementos fake na UI | busca ⌘K, sino, user-menu morto, chevron switcher, "Clínica Vida", segmented Hoje\|Semana | **0** |

## Problemas encontrados (e corrigidos)

1. **ds.css redefinia TODO o layer de tokens** (incl. `--font-sans:"Geist"` literal) por cima do `globals.css` — trocar tokens não tinha efeito. Removido; tokens só em `globals.css`.
2. **CSS legado unlayered vencia as utilities** (regra de cascade layers): `*{margin:0}` matava toda utility de margem; `.grid` legado quebrava o `nav:hidden` do mobile. Os 4 CSS legados agora vivem em `@layer components` (< utilities) — **regra permanente em CONVENTIONS**.
3. Anti-flash de tema lia `localStorage['theme']` mas os shells gravam `clinicaos-theme` — nunca funcionou. Corrigido.
4. Mobile drawer não abria: o botão do menu ficava sob o topbar sticky (z-index) — corrigido; breakpoint do shell restaurado a 900px (paridade com o antigo).
5. `pattern` do telefone inválido sob a flag /v do Chrome; posicionamento do Dialog somava `translate`+`transform` (nascia deslocado). Corrigidos.
6. Painel tenant **não tinha logout visível**; agora: user-menu real + Sair na sidebar.

## Telas removidas (rota → destino, redirects em `next.config.ts`)

- `/pacientes/novo` → Drawer `?novo=1` em /pacientes
- `/pacientes/[id]/prontuarios` → aba `?tab=prontuarios` do hub do paciente
- `/pacientes/[id]/prontuarios/[pid]/assinar` → Dialog `?assinar=1` no editor (gate + auditoria intactos)
- `/financeiro/lancamentos/novo` → Drawer `?novo=1` em /financeiro

## Telas unificadas

- `/pacientes/[id]` virou **hub** (Dados | Prontuários) — a sublista deixou de ser tela.
- `/configuracoes` virou **hub com nav-tabs** entre as subrotas (mantidas, RSC próprio) + visão geral em cards; Segurança da conta linkada.
- Consultório: emissão de prescrição/documento e assinatura vivem NO atendimento (drawers/dialog no cartão de sessão) — sem trocar de tela.

## Componentes duplicados eliminados

- `prescription-form.tsx` (299) + `medical-document-form.tsx`: a página do prontuário reusa os Drawers do Consultório.
- `atendimento-tools.tsx` (634): decomposto em `prescription-drawer`/`document-drawer`/`sign-dialog`.
- 2 sistemas de StatCard → 1; 2 sistemas de ícones → 1; mapa STATUS duplicado do dashboard → `AppointmentStatusBadge` canônico; `PanelCard` promovido a `ui/` no 2º consumidor.

## Melhorias aplicadas (destaques por área)

- **Consultório**: cartão de sessão vivo (tempo na clínica + toolbar EMITIR + Encerrar); Finalizadas com badge âmbar **"Sem cobrança"** (composição best-effort com pendências do Financial — anti-vazamento na cara do time).
- **Dashboard**: StatCards, gráfico viz (hoje em teal), atividade limitada a 5 sem quebra, checklist de ativação restilizado.
- **Admin**: Table kit em clinicas/audit/billing/metricas; convites paginados em **6/página**; /saude em **lista vertical** com dots de status; /config sem scroll nos subtabs.
- **Estados**: skeleton por rota (PageSkeleton, 6 anatomias), error boundaries com Sentry+retry, empty states preservados.

## Dívidas UX restantes (registradas, com dono de decisão)

1. **`join-wizard.tsx` (842 linhas)**: decomposição adiada — fluxo público de uso único, sem reclamação no QA; menor prioridade pela própria regra do plano (fluxos mais usados primeiro).
2. **CSS legado não deletável ainda** (~2,0k linhas, já em `@layer components`): consumidores restantes = join-wizard (`input-wrap`), whatsapp-connect (`page-head/ph-*`), admin `clinicas/[id]` (última `ui-table`, `phead/kv-list`), `admin/config` (subtabs), `conversas-ia` (`iad-*`), managers de horários/procedimentos (parciais). Deleção quando esses migrarem.
3. **Command palette ⌘K** (decisão do founder: fora desta refatoração) e **toggle de densidade** (tokens prontos).
4. **Calendário visual da Agenda** (React Big Calendar sobre C6) e **/conversas tenant** (aguarda WhatsApp conectado).
5. **Backend novo aprovado pelo founder (planejar como mini-fases com ADR próprio):** pausa de almoço nos horários (múltiplos intervalos/dia — mexe no modelo C6) e export PDF de relatórios + consolidado por profissional.
6. Quick-view de paciente em pop-up na lista (founder mencionou; o hub com abas cobre parcialmente — validar preferência no review final).
7. Visualizador de PDF (`/documentos/[id]/pdf`, fora do shell) — restyle pendente.

## Plano de migração (executado)

Onda 0 fundação (tokens/fontes/ADR-031) → 1 primitivos (Radix+Toast+Table kit)
→ 2 shell+estados (+hotfixes 2.1–2.3 do QA do founder, incl. causa raiz @layer)
→ 3 dashboard+consultório → 4 pacientes/agenda/caixa (redução de telas)
→ 5 financeiro/config/equipe/documentos/relatórios → 6 admin → 7 limpeza+este
relatório. Cada onda = 1 commit com gates (typecheck, lint, 496 testes, build)
e verificação visual headless (screenshots light+dark) quando havia superfície
sem auth. Governança permanente: CONVENTIONS §Governança de UI.
