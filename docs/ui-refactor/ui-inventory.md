# UI Inventory — checklist mestre da refatoração DS v2

> Criado na Onda 0 (2026-07-02). Cada onda risca aqui o que migrou e registra o
> UI Audit (Governança de UI, CONVENTIONS §Governança). Referências: ADR-031,
> `docs/ui-refactor/design-system-map.md`, plano aprovado da refatoração.

## Baseline (antes da refatoração)

| Métrica | Valor | Meta |
| --- | --- | --- |
| Rotas de página do tenant | 25 | 22 (−novo, −prontuarios browse, −assinar) |
| Rotas admin | 10 | 10 |
| Padrão `msg = {ok,text}` (feedback DIY) | ~54 ocorrências | 0 (toast + inline `Field`) |
| Tabelas `<table class="ui-table">` à mão | 6 | 0 (Table kit) |
| `loading.tsx` | 0 | 12+ |
| Sistema de toast | inexistente | 1 (`use-toast`) |
| CSS legado (ds.css + app-shell + admin + onboarding) | ~170 KB | 0 na Onda 7 |
| Sistemas de ícones | 2 (icons.tsx custom + lucide) | 1 (lucide) |
| Sistemas de StatCard | 2 (`stat-card.tsx` + `.kpi`) | 1 |

## Inventário de rotas — tenant `(app)/(shell)/`

Classificação: **Manter** · **Mesclar** · **Remover** (a rota, não a função) · **Reestruturar**.

| Rota | Objetivo | Deveria existir? | Classe | Problema / destino | Onda |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | Home operacional (caixa do dia, atividade) | Sim | Reestruturar | Monólito 417 linhas; `.kpi` inline vs StatCard | 3 |
| `/agenda` | Atendimentos de hoje + criar | Sim | Reestruturar | Painéis `useState(open)` sem overlay; sem calendário visual (dívida conhecida, fora de escopo) | 4 |
| `/consultorio` | Kanban de atendimento (maior aposta UX) | Sim | Reestruturar | `atendimento-tools.tsx` 634 linhas com 2 painéis caseiros | 3 |
| `/caixa` | Caixa do dia | Sim | Reestruturar | `caixa-view` 421 linhas; tabela à mão | 4 |
| `/pacientes` | Lista/busca de pacientes | Sim | Reestruturar | Sem Table kit; criação vive em rota própria | 4 |
| `/pacientes/novo` | Form de criação | **Não** | Remover | Página inteira p/ um form já reutilizável → Drawer `?novo=1` + redirect | 4 |
| `/pacientes/[id]` | Detalhe + edição inline | Sim | Reestruturar | Vira hub com tabs (`?tab=dados\|prontuarios`) | 4 |
| `/pacientes/[id]/prontuarios` | Lista de prontuários do paciente | **Não** | Mesclar | Nível de navegação puro → tab do hub + redirect | 4 |
| `/pacientes/[id]/prontuarios/[pid]` | Editor de prontuário (auto-save) | Sim | Manter | Deep-link clínico/auditável; ganha breadcrumb novo | 4 |
| `.../[pid]/assinar` | Confirmar + assinar | **Não** | Remover | Ação crítica ≠ tela; Dialog `?assinar=1` preserva contexto do documento (auditoria na action, inalterada) | 4 |
| `/prontuarios` | Entrada transversal do histórico clínico | Sim | Manter | Visão cross-paciente tem valor próprio | 5 |
| `/documentos` | Feed unificado de documentos | Sim | Manter | Restyle + estados | 5 |
| `/modelos-receita` | Modelos de receita do médico | Sim | Reestruturar | Manager CRUD clonado → `crud-manager` comum | 5 |
| `/financeiro` | Lançamentos + fluxo de caixa | Sim | Reestruturar | Criação vive em rota própria | 5 |
| `/financeiro/lancamentos/novo` | Form de lançamento | **Não** | Remover | → Drawer `?novo=lancamento` + redirect | 5 |
| `/financeiro/fornecedores` | CRUD fornecedores | Sim | Reestruturar | Form inline vira Dialog na listagem | 5 |
| `/relatorios` | Faturamento · no-show · ocupação | Sim | Manter | Adotar specs viz do DS v2 (CSS puro) | 5 |
| `/equipe` | Equipe & permissões | Sim | Reestruturar | Tabela à mão → Table kit; convites em Dialog | 5 |
| `/configuracoes` | Índice de configurações | Sim | Reestruturar | Vira hub com `nav-tabs` (layout.tsx); subrotas mantidas | 5 |
| `/configuracoes/{perfil,horarios,procedimentos,whatsapp}` | Config específicas | Sim | Manter | Sob o hub; managers usam `crud-manager` | 5 |
| `/account/security` | MFA enroll/unenroll | Sim | Manter | Fora do matcher do middleware; ganha link no hub — rota NÃO muda (risco MFA sem ganho) | 5 |

### Fora do shell

| Rota | Objetivo | Deveria existir? | Classe | Onda |
| --- | --- | --- | --- | --- |
| `/login`, `/login/mfa`, `/forgot-password`, `/reset-password` | Auth | Sim | Manter (restyle) | 7 |
| `/join/[token]` | Onboarding por convite mágico | Sim | Reestruturar (wizard 842 linhas → steps) | 7 |
| `/documentos/[id]/pdf`, `/prescricoes/[id]/pdf` | Preview/download PDF | Sim | Manter (não podem regredir; fora do shell) | 0/7 (verificação) |

### Admin `(admin)/admin/`

| Rota | Deveria existir? | Classe | Problema / destino | Onda |
| --- | --- | --- | --- | --- |
| `/admin` | Sim | Manter | StatCard unificado | 6 |
| `/admin/clinicas` | Sim | Reestruturar | 2 tabelas à mão → Table kit; `new-clinic-modal` → Dialog | 6 |
| `/admin/clinicas/[id]` | Sim | Reestruturar | 355 linhas → tabs; impersonate → Dialog com confirmação | 6 |
| `/admin/billing`, `/admin/metricas`, `/admin/audit` | Sim | Reestruturar | Tabelas à mão → Table kit | 6 |
| `/admin/conversas-ia` | Sim | Manter | Restyle (superfícies IA clay) | 6 |
| `/admin/saude` | Sim | Manter | Restyle | 6 |
| `/admin/config` | Sim | Reestruturar | 419 linhas → decompor com tabs | 6 |

## Estados de UI por rota (baseline)

- **Loading**: ✗ em TODAS as rotas (nenhum `loading.tsx`; `.skeleton` do ds.css tem 0 usos) → Onda 2.
- **Empty**: ✓ razoável (`EmptyState` em ~14 telas).
- **Error**: só `src/app/error.tsx` global; sem `not-found.tsx` → Onda 2.
- **Success**: ✗ padrão `msg` local em 7+ arquivos (~54 usos); sem toast → Ondas 3–6.

## Duplicações mapeadas (alvo das ondas)

1. Tabelas à mão (6): `admin/clinicas/page.tsx` ×2, `admin/clinicas/[id]/page.tsx`, `admin/audit`, `admin/billing`, `admin/metricas`, `equipe/page.tsx`.
2. Overlays caseiros: `admin/clinicas/new-clinic-modal.tsx`, `components/shared/announcement-popup.tsx`; painéis `useState(open)`: `agenda-view`, `procedures-manager`, `atendimento-tools` ×2, `impersonate-form`.
3. Managers CRUD clonados: `configuracoes/procedimentos/procedures-manager.tsx`, `modelos-receita/templates-manager.tsx`, `configuracoes/horarios/horarios-manager.tsx`.
4. StatCard ×2: `admin/_components/stat-card.tsx` vs `.kpi` inline (dashboard).
5. Ícones ×2: `painel/icons.tsx` (~22 arquivos) vs lucide (5 arquivos).
6. Card ×2: componente `ui/card.tsx` (4 usos) vs classe `.card` (maioria).

## Audit Onda 0 (2026-07-02)

Onda 0 não toca telas — só o layer de tokens/fontes. Achados e ações:

- **ds.css redefinia TODO o layer de tokens** (`:root` + `[data-theme=dark]`, linhas 9–134) por cima do `globals.css`, incluindo `--font-sans: "Geist"` literal. Bloco removido; `globals.css` é a fonte única (ADR-031).
- **~28 valores `oklch(... 258)` hardcoded** em ds.css/app-shell.css (estados ativos dark) → `var(--primary-300)` e equivalentes. Zero hue-258 restante.
- **Bug pré-existente do anti-flash**: `THEME_INIT` lia `localStorage['theme']`, mas os shells gravam `clinicaos-theme` — o anti-flash nunca funcionou. Corrigido (lê a chave certa e aplica `.dark` + `data-theme`).
- **Dep `geist` removida** — grep zero em `src/` (rotas PDF usam Helvetica embutida do react-pdf; não registram fontes).
- Dark agora responde a **`.dark` E `[data-theme='dark']`** (dual selector em globals.css) — cobre Tailwind e CSS legado.

## Audit Onda 1 (2026-07-02) — biblioteca de primitivos

Onda 1 não toca telas — só `src/components/ui/` (+ `painel/icons.tsx`). Auditoria de reuso
feita ANTES de criar cada componente (Governança regra 5/7):

| Componente novo | Equivalente existente? | Ação |
| --- | --- | --- |
| Dialog/Drawer/ConfirmDialog | Não (overlays caseiros duplicados em telas) | Criado (Radix) — telas migram nas Ondas 3–6 |
| Toast/Toaster/useActionFeedback | Não (padrão `msg` local ×54) | Criado (store singleton, sem Context) |
| Skeleton(+Card/Table) | Classe `.skeleton` no ds.css com 0 usos | Criado em Tailwind; classe morre com o ds.css |
| Table kit | 6 tabelas à mão `ui-table` | Criado (RSC-first, sort/pager por URL) |
| Tabs/NavTabs | `.tab-btn` do ds.css usado ad hoc | Criado (Radix intra-page + Link entre subrotas) |
| DropdownMenu/Tooltip/Popover/Switch/Checkbox/Segmented | Não | Criados (Radix; Segmented caseiro) |
| StatCard | 2 sistemas (`admin/_components/stat-card.tsx` + `.kpi`) | Criado unificado em `ui/`; os 2 antigos morrem nas Ondas 3/6 |
| Breadcrumbs | Breadcrumb manual via prop do PageHeader | Criado; PageHeader compõe na Onda 2 |
| Button/Input/Select/Field/Card/Badge/Alert/EmptyState | Sim — restyle in-place | API 100% preservada (variantes históricas mantidas; testes de telas seguem verdes) |
| Combobox | — | **Adiado** para a Onda 4 (primeira tela que precisa: seletor de paciente da Agenda) |
| Command palette | — | **Fora de escopo** (decisão do founder) |

## Audit Onda 2 (2026-07-02) — shell, navegação e estados

**Fake removido do topbar (UX honesta, regra 3 aplicada a componentes):**
- Busca ⌘K (decisão do founder — palette é dívida) → campo removido.
- Sino de notificações (não existe feature de notificações) → removido.
- Botão de usuário que não abria nada → virou **menu real** (DropdownMenu): Segurança da conta (`/account/security`) + Sair (`POST /logout` — o painel tenant não tinha logout visível!).
- Chevron do clinic-switcher (troca de clínica não existe) → removido.

**Zero duplicação:** os dois shells compartilham `shared/shell-chrome.tsx` (sidebar frame, nav links, footer, wordmark, mobile drawer) e `shared/use-theme.ts` (tema + ⌘\ + persistência). `RouteError` (Sentry + retry) usado pelos 3 error.tsx. `PageSkeleton` com 6 variantes alimenta os 13 loading.tsx.

**app-shell.css — deleção BLOQUEADA (desvio documentado do plano):** os shells não usam mais nenhuma classe dele, mas telas ainda consomem `stat-tile`, `cardblock`, `listrow(s)`, `cols-2/3`, `page-head/ph-*`, `month`, `subtab(s)`, `toolbar`, `screen`, `stack`, `avatar` etc. O critério do próprio plano (grep zero) falha → arquivo permanece até a onda do último consumidor (prevista: 6/7). Regras de chrome (.app/.sidebar/.mnav/.topbar/.tb-*/.menu-btn/body.nav-open) viram órfãs inofensivas até lá.

**Estados criados:** `loading.tsx` em dashboard, agenda, consultorio, caixa, pacientes, pacientes/[id], financeiro, relatorios, equipe, prontuarios, documentos, admin, admin/clinicas (13); `error.tsx` em `(app)/(shell)` e `(admin)/admin` + root restilizado; `not-found.tsx` root.

## Feedback do founder pós-Onda 2 (QA manual completo, 2026-07-02)

**Hotfix imediato (Onda 2.1):** mobile drawer não abria (botão do menu ficava sob o
topbar sticky — z-index; corrigido p/ z-450 + hidden quando aberto); sidebar mais
respirada (item 8px/gap 10px/r-md, cards de identidade mx-16px, grupos mt-20px);
`.input-wrap > input` compat (ícone sobre texto em 6 telas de busca); tema duplicado
(removido do topbar; fica o da sidebar); **Sair na sidebar do tenant**; pattern do
telefone inválido sob flag /v do Chrome (`\(\)` escapados); new-clinic-modal → Dialog
novo (centralizado + blur); dashboard: atividade recente limitada a 5 + data sem quebra.

**Incorporado às ondas:**
- **Onda 3** (dashboard/consultório): melhorar "Em atendimento" e "Finalizadas" (founder pediu sugestões); investigar flash "Você" no header (identidade SSR).
- **Onda 4** (pacientes/agenda/caixa): "novo atendimento" em Drawer (confirmado); quick-view de paciente em pop-up/drawer a partir da lista (founder prefere pop-up — detalhe completo continua tendo rota p/ deep-link clínico); novo prontuário restyle; contraste do botão em /pacientes; UI geral da /agenda.
- **Onda 5** (financeiro/config/relatórios): fornecedor e lançamento em Dialog/Drawer (confirmado); **máscaras/validação de campos** (telefone, dinheiro, documento — tratar em cima do Field/Input); visualizador de PDF de /documentos redesenhado; /configuracoes UX melhor (pedido explícito); /relatorios espaçamento.
- **Onda 6** (admin): paginação "virar página" (TablePager) em convites (**6/página**), /audit e incidentes de /saude; /saude com cards em **lista vertical menor** (sem grade de ícones); /config: espaçamento do header + subtabs sem scroll; espaçamentos gerais das telas admin (na migração p/ Table kit/Card).
- "Problema de espaçamento" recorrente nas telas: as TELAS ainda são legadas (retematizadas, não migradas) — cada uma é reespaçada na sua onda; reavaliar com o founder onda a onda.

**Escopo NOVO que exige backend (fora da refatoração de UI — planejar à parte):**
1. **Pausa de almoço nos horários** — modelo de disponibilidade (C6) hoje é 1 intervalo/dia; suportar múltiplos intervalos = migração de schema + actions + UI. 
2. **Export PDF de relatórios + relatório consolidado de todos os profissionais** — nova geração de PDF + queries agregadas.

**CAUSA RAIZ dos sintomas persistentes (hotfix 2.3, diagnosticado com Chrome headless + computed styles):**
os 4 CSS legados eram *unlayered* e CSS sem layer vence QUALQUER `@layer` — onde o Tailwind v4
coloca as utilities. O `* { margin: 0 }` do ds.css matava toda utility de margin do app
("espaçamento apertado" em todas as telas, cards tocando as bordas) e o `.grid` legado
(display+gap) vencia o `nav:hidden` do hambúrguer. Correção: ds.css/app-shell.css/admin.css/
onboarding-flow.css envelopados em `@layer components` (< utilities). **Regra permanente:
CSS legado SEMPRE em `@layer components`; utilities devem vencer o legado por construção.**

**Não-problemas verificados:** lógica de busca em /clinicas NÃO foi alterada (nenhuma action/query tocada); erros `CONNECT_TIMEOUT`/"Failed to fetch" = acesso ao Supabase saturado (memória conhecida do projeto) + builds meus concorrendo com o dev server do founder no mesmo `.next` (não vou mais buildar com o dev aberto).

## Audit Onda 3 (2026-07-02) — Dashboard + Consultório

**Dashboard** (`page.tsx` 428→~230 linhas + `_components/`): `.kpi`/`stat-tile` → `StatCard` (ui);
painéis → `PanelCard` (Card DS); gráfico → `RevenueChart` (CSS puro, viz-1 + viz-8 p/ hoje);
atividade → `ActivityFeed`; checklist de ativação em Tailwind. **UX honesta**: breadcrumb
"Clínica Vida" hardcoded e segmented "Hoje|Semana" fake REMOVIDOS; próximos usam o
`AppointmentStatusBadge` canônico (matou o mapa de STATUS duplicado). Zero classes legadas.

**Consultório**: cartão de sessão vivo (identidade + `ElapsedChip` "na clínica há X" via
checkInAt + toolbar EMITIR); ferramentas saíram de painéis inline p/ **Drawer**
(`prescription-drawer`, `document-drawer` — tipo de receita usa `Segmented`) e a assinatura
virou **Dialog crítico** (`sign-dialog`); `atendimento-tools.tsx` (634 linhas) DELETADO;
feedback via toast (padrão `msg`/`saveMsg` eliminado do consultório). **Anti-vazamento**:
`getBoard` compõe `listPendenciasAbertas` (Financial, best-effort com catch) e Finalizadas
mostram badge âmbar **"Sem cobrança"**. `.screen`/breadcrumb legado removidos.

**Flash "Você" no header**: comportamento best-effort do `shell-identity` durante stall do
Supabase (o shell nunca quebra a página) — raiz é infra, não UI; fallback por e-mail exigiria
expor e-mail no port de auth (fora do escopo da onda; anotado).

**Verificação**: screenshots headless light+dark (fixtures em rota diag dev-only, removida) —
board com urgência/espera crítica/badge sem-cobrança e gráfico OK; typecheck/lint/496 testes ✓;
build adiado (dev do founder ativo na 3000).

## Dívidas registradas (não entram nesta refatoração)

- Calendário visual da Agenda (React Big Calendar sobre C6).
- `/conversas` tenant (deferido até WhatsApp conectado — UX honesta).
- Command palette ⌘K (decisão do usuário 2026-07-02: campo fake removido na Onda 2; palette fica para projeto futuro).
- Toggle de densidade compact/comfortable (tokens prontos; UI futura).
