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

## Dívidas registradas (não entram nesta refatoração)

- Calendário visual da Agenda (React Big Calendar sobre C6).
- `/conversas` tenant (deferido até WhatsApp conectado — UX honesta).
- Command palette ⌘K (decisão do usuário 2026-07-02: campo fake removido na Onda 2; palette fica para projeto futuro).
- Toggle de densidade compact/comfortable (tokens prontos; UI futura).
