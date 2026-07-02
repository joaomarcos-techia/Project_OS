# Design System Map — DS v2 → implementação

> Fonte da verdade visual: `design_system/DSv2.html` (ADR-031). Mockups de
> referência: `design_system/dashboard.html`, `tconsulta.html`,
> `ClinicaOS - Admin (standalone).html`. Atualizado a cada onda.

## Tokens (Onda 0 — implementado)

Todos vivem em `src/app/globals.css` (`:root` / `.dark, [data-theme='dark']`),
com binding Tailwind via `@theme inline`. O CSS legado consome as mesmas vars.

| Grupo | Tokens | Nota de mapeamento |
| --- | --- | --- |
| Primária | `--primary-50…950` | Valores **petrol** (hue 205). Nome `primary` mantido (não `petrol`) — utilities `bg-primary-*` existentes continuam válidas. No dark, 500/600 sobem um degrau de luz (petrol-400/500), espelhando o `--primary` semântico do DS. |
| Accent / IA | `--accent-50…800`, `--ai`, `--ai-soft`, `--ai-border`, `--ai-tint` | Valores **clay** (hue ~45). Nome `accent` mantido (era teal 3 degraus). Todo trabalho de IA é marcado por este tratamento. |
| Neutros | `--neutral-0…950` **+ `--neutral-150`** (degrau novo) | Porcelana/tinta quentes (hue 98–108); substituem os frios hue 258. |
| Semânticas | `--success/warning/danger/info-{50,100,200,500,600,700}` | Degrau `200` é novo. |
| Data-viz | `--viz-1…8`, `--viz-grid`, `--viz-track` | Lightness única ~0.63; usados nos Relatórios (Onda 5). |
| Superfícies | `--bg`, `--bg-subtle`, `--surface`, `--surface-2`, `--surface-inset`, `--surface-hover` | `--bg` agora = neutral-100 (canvas); `--bg-subtle` = neutral-150 (equivale ao `--bg-sunken` do DS). |
| Bordas/Texto | `--border`, `--border-2` (novo), `--border-strong`, `--text/-2/-3`, `--text-inverse` (novo), `--text-on-primary`, `--text-link` (novo) | — |
| Interação | `--primary/-hover/-active/-soft`, `--on-primary`, `--accent/-soft`, `--on-accent`, `--ring`, `--focus-ring` | `--focus-ring` é sombra composta (2px surface + 4px ring 65%/75% dark). |
| Tipografia | `--font-sans` (Hanken Grotesk), `--font-display` (Inter), `--font-mono` (IBM Plex Mono); `--fs-display…--fs-2xs`; `--tracking-tight/-label` | next/font expõe `--font-hanken/--font-inter/--font-plex`. Utilities Tailwind `font-size` NÃO foram re-mapeadas na Onda 0 (decisão: avaliar na Onda 1 com os primitivos). |
| Espaço/Raio | `--sp-1…24`; `--r-xs…2xl,full` | Raio DS v2: 3/5/7/10/14/20/999. `--sp-*` migrou do ds.css para globals. |
| Elevação | `--elev-flat/raised/card/overlay/popover/modal`; aliases `--sh-xs…xl` | `--sh-*` são os nomes históricos consumidos pelo CSS legado. |
| Z-index | `--z-base/sticky/dropdown/drawer/modal/toast/tooltip/command` | Escada nomeada para os primitivos da Onda 1. |
| Motion | `--ease-out/in-out/spring`; `--dur-fast/base/slow/slower` | Valores DS (110/180/280/420ms); nomes históricos mantidos. |
| Densidade | `--control-h(-sm/-lg)`, `--control-px/-fs`, `--field-gap`, `--row-h`, `--cell-py`, `--card-pad`, `--stack` + bloco `[data-density='compact']` | Default comfortable; toggle é dívida registrada. |
| Component hooks | `--btn-radius`, `--field-*`, `--card-*`, `--table-header-bg`, `--table-stripe` | Primitivos da Onda 1 referenciam SÓ estes. |
| Layout | `--sidebar-w: 256px`, `--content-maxw`/`--maxw: 1080px` | Sidebar era 268px. |

### Desvios documentados do DSv2.html

1. **`--text-link` no dark** = `--primary-300` (o DS não sobrepõe; petrol-700 não passa AA sobre `--bg` escuro).
2. **h1–h4 sem `--font-display`**: o base do DS também não aplica (a voz display é opt-in via `.serif`); componentes que pedirem display usam `font-display` utility (ex.: valor do StatCard).
3. **Nomes históricos preservados** (`--primary-*` em vez de `--petrol-*`, `--sh-*`, `--dur-fast/base/slow`, `--bg-subtle`, `--maxw`): zero churn no markup/CSS legado; valores são 1:1 do DS.
4. **Theming por tenant demonstrado no DSv2.html NÃO é implementado** — ADR-028 (white-label = só cabeçalho de PDF) permanece.

### Decisões de compatibilidade da Onda 1 (API preservada, visual DS v2)

- **Button**: variantes reais do DS são `primary/accent/danger/ghost/soft/subtle` (o plano aproximara "solid/flat" — o HTML venceu). `secondary` (= visual default do DS: surface+borda) e `success` seguem como variantes de compat das telas existentes. Alturas via `--control-h*`; a classe legada `.btn` saiu do componente (os 5 seletores contextuais `.btn` do ds.css — `-actions/.ai-sug-act/.pc-actions/.sm-row/.soap-foot` — deixam de pegar em `<Button>`; telas afetadas migram nas Ondas 3–5).
- **Badge**: tones históricos mantidos (`gray/blue/green/amber/red/teal/violet`); `teal`/`violet` viram tints de `--viz-8`/`--viz-3` (paleta viz do DS — clay é reservado a IA); novo tone `ai`.
- **Toast**: store singleton com `useSyncExternalStore` — sem Context (Governança regra 6).
- **Ícones**: lucide 1.17 usa nomes modernos (`ChartColumn`, `Ellipsis`, `Funnel`, `TriangleAlert`); `painel/icons.tsx` virou mapa de compat.
- **page-header.tsx** ficou intocado — será recomposto com o shell na Onda 2 (usa classes do app-shell.css que ainda vivem).

## Componentes DS v2 → React (Ondas 1+)

| DS v2 (classe no bundle) | Componente | Arquivo (`src/components/ui/`) | Radix/caseiro | Onda | Status |
| --- | --- | --- | --- | --- | --- |
| `btn` (solid/soft/ghost/flat/danger, sm/lg, group) | Button, ButtonGroup | `button.tsx`, `button-group.tsx` | caseiro (CVA) | 1 | ✅ 2026-07-02 |
| `field/flabel/fhint/ferror/req`, `input`, `textarea`, `select` | Field, Input, Textarea, Select | existentes (restyle) | caseiro | 1 | ✅ 2026-07-02 |
| `card` (head/body/foot) | Card | `card.tsx` (restyle) | caseiro | 1 | ✅ 2026-07-02 |
| `badge`, `pill`, `tag`, `status` | Badge, StatusBadge | existentes (restyle) | caseiro | 1 | ✅ 2026-07-02 |
| `alert` | Alert | `alert.tsx` (restyle) | caseiro | 1 | ✅ 2026-07-02 |
| `empty` | EmptyState | `empty-state.tsx` (restyle) | caseiro | 1 | ✅ 2026-07-02 |
| `sk`, `loading-row` | Skeleton, SkeletonCard, SkeletonTable | `skeleton.tsx` | caseiro | 1 | ✅ 2026-07-02 |
| `modal`, `scrim` | Dialog | `dialog.tsx` | **Radix Dialog** | 1 | ✅ 2026-07-02 |
| `drawer` | Drawer | `drawer.tsx` | Radix Dialog (posicionado) | 1 | ✅ 2026-07-02 |
| — | ConfirmDialog (ações críticas) | `confirm-dialog.tsx` | composição | 1 | ✅ 2026-07-02 |
| `toast`, `toast-region`, `undo-strip` | Toast, Toaster, useToast | `toast.tsx`, `toaster.tsx`, `use-toast.ts` | caseiro (store singleton) | 1 | ✅ 2026-07-02 |
| — | useActionFeedback (useActionState → toast) | `use-action-feedback.ts` | caseiro | 1 | ✅ 2026-07-02 |
| `menu` | DropdownMenu | `dropdown-menu.tsx` | **Radix** | 1 | ✅ 2026-07-02 |
| `tip` | Tooltip | `tooltip.tsx` | **Radix** | 1 | ✅ 2026-07-02 |
| `popover` | Popover | `popover.tsx` | **Radix** | 1 | ✅ 2026-07-02 |
| `switch`, `check` | Switch, Checkbox | `switch.tsx`, `checkbox.tsx` | **Radix** | 1 | ✅ 2026-07-02 |
| `segmented` | Segmented | `segmented.tsx` | caseiro | 1 | ✅ 2026-07-02 |
| `tbl` + toolbar/sort/pager/selbar, `filterbar` | Table kit | `table.tsx`, `table-toolbar.tsx`, `table-sort-header.tsx`, `table-pager.tsx`, `table-selection-bar.tsx` | caseiro, RSC-first (sort/pager por URL) | 1 | ✅ 2026-07-02 |
| `tabs` | Tabs (intra-page) / NavTabs (subrotas) | `tabs.tsx` / `nav-tabs.tsx` | Radix / caseiro | 1 | ✅ 2026-07-02 |
| `stat` | StatCard (unificação) | `stat-card.tsx` | caseiro | 1 | ✅ 2026-07-02 |
| `crumb` | Breadcrumbs (PageHeader compõe) | `breadcrumbs.tsx` | caseiro | 1 | ✅ 2026-07-02 |
| `combo` | Combobox | `combobox.tsx` | Popover + listbox caseiro | 4 | pendente |
| `topbar`, `side-nav`, `nav-group` | Shell novo (`shared/shell-chrome.tsx` + `use-theme.ts`; shells compõem) | `components/painel/painel-shell.tsx`, `components/admin/admin-shell.tsx` | caseiro | 2 | ✅ 2026-07-02 |
| `sk` (rota) | PageSkeleton (6 variantes p/ loading.tsx) | `ui/page-skeleton.tsx` | caseiro | 2 | ✅ 2026-07-02 |
| — | RouteError (Sentry + retry) | `shared/route-error.tsx` | caseiro | 2 | ✅ 2026-07-02 |
| `barchart`, `linechart`, `donut` | Charts CSS (Relatórios) | por rota | caseiro (sem lib) | 5 | pendente |
| `ai-surface`, `chat`, `agent-mark`, `conf`, `suggest` | Superfícies IA | conforme demanda (admin/conversas-ia) | caseiro | 6 | pendente |
| `cmdk` | Command palette | — | — | **fora de escopo** (decisão usuário 2026-07-02) | dívida |
| `cal` | Calendário | — | — | fora de escopo (dívida Agenda) | dívida |

## Ícones

Decisão: **lucide-react**. `src/components/painel/icons.tsx` vira re-export
lucide mantendo os nomes atuais (~22 consumidores intactos); código novo importa
lucide direto. Mapping é inlinado/deletado na Onda 7.
