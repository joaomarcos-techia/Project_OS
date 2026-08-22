# Novo Design System / UI UX — Qoro (ClinicaOS)

> Documento canônico de **auditoria + plano + mapa de componentes + score de rotas**.
> O estado executável de cada gap é registrado em `ui-redesign-implementation.md`;
> este documento continua sendo a fonte de verdade para decisões de UI/UX e
> arquitetura de componentes. Regras de negócio permanecem intactas.
> Auditoria inicial: 2026-08-19 (`d414191`) · ampliação e revisão: 2026-08-20 ·
> branch `main` · commit observado `3612b08`.
> Por decisão do solicitante, `ui-audit.md`, `ui-redesign-plan.md`,
> `ui-components-map.md` e `ui-ux-score.md` foram consolidados neste único
> arquivo, em vez de criados separadamente.

> **Decisão mais recente prevalece:** o preset solicitado agora é
> `b5J5Qtmtc`, por meio do comando
> `pnpm dlx shadcn@latest init --preset b5J5Qtmtc --template next`. Os valores
> descritos mais abaixo para `b1s9bZdKy` são apenas referência histórica e
> **não estão aprovados para implementação**. Os metadados de `b5J5Qtmtc` foram
> decodificados no Gate A; tokens e arquivos gerados ainda exigem scaffold/diff
> isolado antes de qualquer `init` no projeto.

---

## Objetivo

Levar a interface do Qoro de "montada" para "projetada": hierarquia visual clara,
densidade adequada, componentes com comportamento único e aparência de produto
SaaS B2B maduro — **sem perder funcionalidade** e **sem dissolver a identidade da
marca numa instalação genérica de shadcn**.

O plano converge o design system atual (DS v2, já maduro) com o **ecossistema
shadcn/ui**, aproveitando que a stack subjacente já é exatamente a do shadcn.

---

## Sumário executivo (o que a auditoria descobriu)

Três conclusões mudam a natureza do trabalho em relação ao briefing inicial:

**1. A stack já é shadcn.** O projeto usa Radix UI (7 pacotes), Tailwind v4, CVA,
`clsx` + `tailwind-merge`, `lucide-react`, helper `cn()` em `src/lib/ui/cn.ts` e
alias `@/*`. Falta apenas o `components.json` e o registry. Adotar shadcn é
**convergência**, não migração. `src/components/ui/dialog.tsx` inclusive já
documenta "API shadcn-like".

**2. O problema não é falta de design system — é sistema demais.** Existem
**dois sistemas de estilo em paralelo**: os tokens + utilities do `globals.css`
(571 linhas, excelente) e **3.951 linhas de CSS legado** (`ds.css` 2.106 +
`app-shell.css` 1.173 + `admin.css` 672) com **451 classes** importadas
globalmente. O mesmo conceito visual existe 2–4 vezes com paddings divergentes.

**3. A direção visual solicitada é o preset `b5J5Qtmtc`, mas a composição ainda
é um gate, não uma suposição.** O `globals.css` gerado pelo CLI **não pode
substituir automaticamente** o atual: o código consome ~60 nomes de token em
209 arquivos e três folhas de estilo legadas ainda dependem deles. A adoção será
feita por compatibilidade de tokens e revisão visual, preservando o significado
do marcador de IA. Cores, fontes, raio e estilo do registry só serão definidos
depois da decodificação do preset solicitado. Ver [Design tokens](#design-tokens).

### Números da auditoria

| Métrica | Valor |
| --- | --- |
| Rotas com `page.tsx` | 51 |
| Arquivos `.tsx` em `src/app` + `src/components` | 209 |
| Arquivos em `src/components/ui/` | 43 (inclui 3 testes e 2 hooks) |
| Linhas de CSS legado (`@layer components`) | 3.951 |
| Classes CSS legadas distintas | 451 |
| Abstrações de "card" concorrentes | 4 |
| Uso explícito de tokens CSS de spacing | 14% (106 de 740); **não mede sozinho inconsistência**, pois utilities Tailwind também são tokenizadas |
| Tamanhos de fonte fora da escala | 11 valores arbitrários |
| `<Field>` sem `htmlFor` (exige classificação manual) | **44 de 109 (40%)** |
| Ações destrutivas com `confirm()` nativo | 5 |
| Arquivos `loading.tsx` / rotas efetivamente cobertas | 8 / **12 de 51** |
| `Suspense` com `fallback={null}` | 2 (`/login` e `/convite`) |
| `router.refresh()` explícitos | 34 ocorrências em 21 arquivos |
| `style={{...}}` inline | 107 ocorrências; 31 só no WhatsApp |
| Primitivos definidos e nunca usados | 5 |

---

## Estado atual

### O que já é bom (preservar)

Esta é a parte que **não** deve ser refeita. A auditoria encontrou fundações
melhores do que o briefing supunha.

| Ativo | Onde | Por que preservar |
| --- | --- | --- |
| **Arquitetura de tokens** | [globals.css](src/app/globals.css) | `@theme inline` liga utilities Tailwind às CSS vars — trocar tema re-tematiza em runtime, sem rebuild. **É exatamente essa arquitetura que permite adotar o preset por remap de valores**, sem tocar em nenhum `.tsx`. A estrutura fica; os valores passam a ser os do preset. |
| **Dark mode** | [layout.tsx:35](src/app/layout.tsx:35), [use-theme.ts](src/components/shared/use-theme.ts) | Script anti-FOUC inline, mecanismo duplo (`.dark` + `data-theme`), atalho `⌘/Ctrl+\`, persistência. Funciona. |
| **Padrão CRUD** | `pacientes`, `documentos`, `financeiro`, `equipe`, `conversas` | `PageHeader → TableWrap → TableToolbar → Table → EmptyState`. Consistente em 5 módulos. É a espinha dorsal do redesign, não um problema. |
| **Responsividade de tabela** | [table.tsx:23](src/components/ui/table.tsx:23) | `TableScroll` presente em **11 de 11** arquivos com `TableWrap`. Zero risco de overflow horizontal. |
| **Higiene de cor** | global | Apenas 4 cores hex hardcoded em toda a UI real. A disciplina de token de cor já existe. |
| **Base Radix** | `dialog`, `drawer`, `dropdown-menu`, `tabs`, `checkbox`, `tooltip`, `switch` | Acessibilidade de overlay/foco já resolvida por biblioteca madura. |
| **Nav filtrada por permissão** | [configuracoes/layout.tsx:48](<src/app/(app)/(shell)/configuracoes/layout.tsx:48>) | Tabs e cards do hub filtram por `PERMISSIONS`. UX honesta: não oferece o que o usuário não pode fazer. |
| **Honestidade de produto** | [modules.ts](src/components/painel/modules.ts), [painel-shell.tsx:27](src/components/painel/painel-shell.tsx:27) | Módulos inexistentes marcados "em breve"; busca ⌘K falsa e sino sem feature foram removidos deliberadamente. Manter esse princípio. |

### A stack visual real

```
Tailwind v4 (@tailwindcss/postcss)   →  utilities
globals.css (571 linhas)             →  tokens DS v2 + @theme inline  ✅ fonte da verdade
ds.css (2.106) ─┐
app-shell.css (1.173) ├─ 3.951 linhas, 451 classes, @layer components  ⚠️ sistema paralelo
admin.css (672) ─┘
src/components/ui/*.tsx (38)         →  primitivos Radix + CVA + cn()  ✅ ~shadcn
```

Os três CSS legados são importados nos layouts
([shell](<src/app/(app)/(shell)/layout.tsx:7>), [admin](<src/app/(admin)/admin/layout.tsx:8>),
[join](<src/app/(app)/join/layout.tsx:3>)), portanto valem globalmente em todas as
telas autenticadas.

### Distribuição da dívida — o débito é geográfico

| Área | `<Card>` | `.cardblock` | `<StatCard>` | `.listrow` | Migrado |
| --- | --- | --- | --- | --- | --- |
| Painel tenant `(shell)` | 52 | 12 | 31 | ~0 | **~80%** |
| Admin `(admin)` | 9 | 35 | 19 | 18 | **~30%** |

**Consequência de planejamento:** o painel tenant precisa de *consolidação*; o
`/admin` precisa de *migração*. São esforços diferentes e devem ser fases
diferentes. O `/admin` é interno (super-admin) — prioridade menor.

---

## Problemas encontrados

Cada problema traz **evidência verificável no código**. A numeração `P-NN` é
referenciada pela [matriz de prioridades](#matriz-de-prioridades).

### Categoria A — Fragmentação de componentes

#### P-01 · Quatro abstrações concorrentes de "card" · **P1 · global**

| Implementação | Usos | Padding | Fonte |
| --- | --- | --- | --- |
| `<Card>` | 52 | `--card-pad` (24px) | [card.tsx](<src/components/ui/card.tsx>) |
| `<PanelCard>` | 14 | `--sp-4` (16px) | [panel-card.tsx](<src/components/ui/panel-card.tsx>) |
| `<StatCard>` | 31 | — | [stat-card.tsx](<src/components/ui/stat-card.tsx>) |
| `.cardblock` (CSS) | 47 | `16px 20px` | [app-shell.css:614](<src/app/(app)/(shell)/_painel/app-shell.css:614>) |

As quatro produzem o mesmo resultado visual (`surface` + `border` + `r-lg` +
sombra), **com três paddings diferentes**. `.cardblock` e `.stat-tile` são
reimplementações literais de `<Card>` e `<StatCard>` em CSS.

> **Impacto operacional:** dois cards em telas diferentes não alinham. É a origem
> direta da sensação de "montado, não projetado".

#### P-02 · Primitivos definidos e nunca usados · **P3 · local**

`TableSortHeader`, `TableSelectionBar`, `ButtonGroup`, `Popover`, `Switch` —
**0 usos** em `src/app`. `TableSortHeader` é citado no comentário de
[table.tsx:7](<src/components/ui/table.tsx:7>) como se dirigisse a ordenação, mas
**nenhuma tabela do sistema é ordenável**.

#### P-03 · Duplicação estrutural CSS ↔ React · **P2 · global**

| Conceito | React | CSS legado |
| --- | --- | --- |
| Cabeçalho de página | `<PageHeader>` | `.page-head` / `.ph-title` / `.ph-crumb` |
| Toolbar | `<TableToolbar>` | `.toolbar` / `.tb-*` |
| Lista | — | `.listrow` / `.listrows` / `.lr-*` (12 arquivos) |
| KPI | `<StatCard>` | `.stat-tile` / `.st-*` |

### Categoria B — Tokens que não pegam

#### P-04 · Semântica de spacing fragmentada · **P2 · global**

106 usos de `*-(--sp-N)` contra **634 utilities Tailwind cruas**. Os valores de
`gap` se espalham por 12+ variantes, incluindo passos de quarto:

```
gap-2 (94) · gap-3 (74) · gap-4 (40) · gap-2.5 (27) · gap-1 (26)
gap-1.5 (23) · gap-3.5 (11) · gap-0.5 (9) · gap-1.25 (6) · gap-1.75 (2)
```

Essa contagem **não prova** que 86% do spacing está “fora de token”: utilities
Tailwind também derivam de uma escala, e passos como `1.25`/`1.75` seguem a
unidade base. O problema confirmado é semântico: componentes equivalentes usam
medidas diferentes e medidas globais de página/row/control não estão
centralizadas. A correção é por componente e papel, não uma substituição massiva
de `gap-4` por CSS variables.

#### P-05 · Tipografia fora da escala · **P1 · global**

O DS define `--fs-2xs` até `--fs-display`. O código usa **11 tamanhos
arbitrários** em paralelo:

```
text-[9.5px] text-[10px] text-[10.5px] text-[11px] text-[11.5px] text-[12.5px]
text-[13px] text-[14.5px] text-[15px] text-[27px] text-[34px]
```

Distribuição: 202 token · **189 Tailwind stock** (`text-sm`, `text-xs`…) · 37
arbitrário. São **três escalas tipográficas simultâneas**.

O próprio `<PageHeader>` — o componente que define a hierarquia de toda página —
usa `text-[27px]` e `text-[14.5px]`
([page-header.tsx:34](<src/components/ui/page-header.tsx:34>)) em vez de `--fs-h2`
(30px) e `--fs-base` (15px).

#### P-06 · Tokens mortos · **P3 · global**

| Token | Definido em | Usos |
| --- | --- | --- |
| `--content-maxw` / `--maxw` | globals.css | **0** |
| `--stack` | globals.css | **0** |
| `[data-density='compact']` | globals.css | **nunca ativado** |

O eixo de densidade — 10 tokens desenhados para recompor o produto inteiro sem
tocar markup — nunca foi ligado: `data-density` não é definido em lugar nenhum.
`--field-gap` tem 1 uso, `--row-h` 2, `--cell-py` 3.

#### P-07 · Largura de conteúdo contradiz o token · **P2 · global**

`--content-maxw: 1080px` (morto) contra `max-w-330` = **1320px** hardcoded nos
dois shells: [painel-shell.tsx:166](<src/components/painel/painel-shell.tsx:166>)
e [admin-shell.tsx:74](<src/components/admin/admin-shell.tsx:74>).

Em 1920px: 256 (sidebar) + 1320 (conteúdo) = 1576px → **344px de canvas vazio**
no total. Em 2560px, sobram aproximadamente **984px**. A correção não é trocar
por outro máximo universal: workspaces/data ficam fluidos e form/read mantêm
largura legível.

### Categoria C — Espaço em branco e densidade

#### P-08 · Dashboard gasta 2 de 5 painéis com "em breve" · **P1 · local**

Em [dashboard/page.tsx](<src/app/(app)/(shell)/dashboard/page.tsx>), "Ocupação por
profissional" e "Alertas da IA" são `PanelCard` contendo `EmptyState` com
`py-(--sp-8)`. Dois painéis inteiros do grid principal dedicados a features que
não existem.

#### P-09 · Grid de KPI com fileira órfã · **P1 · módulo**

`grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5` com **5 StatCards**, idêntico em
[dashboard](<src/app/(app)/(shell)/dashboard/page.tsx>) e
[financeiro:134](<src/app/(app)/(shell)/financeiro/page.tsx:134>).

Entre 1024px e 1535px — a **faixa dominante de desktop** — são 3 colunas para 5
itens: a segunda fileira fica com 2 cards e um buraco de um terço da largura.

#### P-10 · EmptyState de ~200px de altura · **P2 · global**

[empty-state.tsx](<src/components/ui/empty-state.tsx>): `py-(--sp-12)` (48px em
cima e embaixo) + ícone `size-14` (56px) + `mb-2.5` + título + descrição ≈
**200px**. Usado em 19 arquivos. No dashboard aparece **aninhado dentro de um
card**, somando os dois paddings.

#### P-11 · Padding de rodapé fixo · **P3 · global**

`pb-(--sp-16)` (64px) em toda página nos dois shells — espaço morto permanente
abaixo do conteúdo.

### Categoria D — UX operacional

#### P-12 · Acesso incompleto às listagens · **P0 · módulo**

As listagens principais cortam resultados sem paginação. Pacientes, documentos
e financeiro hoje avisam que mostram apenas os primeiros/mais recentes, portanto
o problema não é mais totalmente silencioso; continua sendo grave porque não há
como alcançar o restante:

| Rota | Corte | Evidência |
| --- | --- | --- |
| `/pacientes` | `limit: 50` | [page.tsx:68](<src/app/(app)/(shell)/pacientes/page.tsx:68>) |
| `/documentos` | `limit: 100` | [page.tsx:65](<src/app/(app)/(shell)/documentos/page.tsx:65>) |
| `/financeiro` | `limit: 50` | [page.tsx:102](<src/app/(app)/(shell)/financeiro/page.tsx:102>) |
| `/agenda/ausencias` | `limit: 100` | [page.tsx:51](<src/app/(app)/(shell)/agenda/ausencias/page.tsx:51>) |

`<TablePager>` existe e é usado em **4 arquivos — 3 deles no `/admin`**. A única
tela tenant paginada é `/conversas`.

> **Impacto operacional:** uma clínica com 300 pacientes vê 50 e não consegue
> navegar até os demais. É perda de acesso operacional a dado real — o achado
> mais grave desta auditoria.
>
> Nota de escopo: a correção envolve a camada de query (`listPatients`,
> `listDocuments`…), não só UI. Este plano especifica o contrato de UI
> (paginação, contagem, "N de M") e sinaliza a dependência — **não** altera regra
> de negócio nem o shape das queries por conta própria.

#### P-13 · Ações destrutivas com `confirm()` nativo · **P1 · módulo**

`<ConfirmDialog>` existe ([confirm-dialog.tsx](<src/components/ui/confirm-dialog.tsx>))
e é usado em 2 arquivos (ambos em `/equipe`). **5 ações destrutivas usam
`confirm()`**:

| Ação | Arquivo |
| --- | --- |
| Excluir paciente | [delete-form.tsx:31](<src/app/(app)/(shell)/pacientes/[id]/delete-form.tsx:31>) |
| Registrar falecimento | [patient-death-form.tsx:45](<src/app/(app)/(shell)/pacientes/[id]/patient-death-form.tsx:45>) |
| Ações LGPD | [lgpd-actions.tsx:47](<src/app/(app)/(shell)/pacientes/[id]/lgpd-actions.tsx:47>) |
| Desativar procedimento | [procedures-manager.tsx:111](<src/app/(app)/(shell)/configuracoes/procedimentos/procedures-manager.tsx:111>) |
| Excluir modelo de receita | [templates-manager.tsx:111](<src/app/(app)/(shell)/modelos-receita/templates-manager.tsx:111>) |

O diálogo nativo não tem tema, ignora o dark mode, é bloqueante, não permite
digitar-para-confirmar e é hostil no mobile. **As duas ações mais graves do
domínio clínico** — exclusão de paciente e registro de óbito — estão nele.

#### P-14 · Estados vazios em três tratamentos · **P2 · global**

`<EmptyState>` em 19 arquivos contra **23 mensagens ad-hoc**. O
[dashboard](<src/app/(app)/(shell)/dashboard/page.tsx>) usa **três tratamentos
diferentes no mesmo arquivo**: `<EmptyState>`, `<p className="py-(--sp-6)
text-center…">` e `<p className="py-2 …">`.

#### P-15 · Cobertura de loading/error baixa · **P1 · global**

Existem 8 arquivos `loading.tsx`; considerando a herança de segmentos do Next,
eles cobrem efetivamente **12 de 51 rotas**. Há 4 boundaries de erro contando
`global-error.tsx`. `/pacientes`, `/conversas`, `/modelos-receita`, `/admin` e
**todas** as subrotas de `/configuracoes` navegam sem skeleton próprio. Os dois
`Suspense` de autenticação (`/login` e `/convite`) usam `fallback={null}`.

#### P-16 · Sem busca global · **P3 · feature separada**

O topbar foi aposentado ([painel-shell.tsx:27](<src/components/painel/painel-shell.tsx:27>))
e com ele a busca ⌘K — corretamente, porque era falsa. Mas hoje **não existe
nenhuma busca global**: achar um paciente exige navegar até `/pacientes` e
filtrar. Uma busca global só deve entrar depois de existir endpoint autorizado,
escopo claro de entidades e navegação por teclado; não é pré-requisito para a
refatoração visual e não autoriza adicionar `cmdk` agora.

### Categoria E — Acessibilidade

#### P-17 · Contrato de associação de campos incompleto · **P1 · global**

**109 usos de `<Field>`, 65 com `htmlFor`.** Os outros 44 exigem classificação:
alguns são grupos corretamente nomeados internamente (por exemplo, Segmented e
checkboxes), mas muitos renderizam `<label>` sem `for` e controle sem `id`.

```tsx
// src/app/(app)/(shell)/pacientes/patient-form.tsx:215
<Field label="Telefone">
  <Input name="telefone" type="tel" />   {/* sem id → label órfã */}
</Field>
```

Nos controles simples afetados, clicar no rótulo não foca o input e o nome
acessível pode se perder. A correção **não** deve gerar um `useId()` cego dentro
de `Field`: o componente recebe filhos heterogêneos e não pode injetar o mesmo
id com segurança. O contrato novo deve exigir `controlId/htmlFor` para um
controle e `fieldset/legend` ou `aria-labelledby` para grupos; cada um dos 44
casos será classificado e testado.

#### P-18 · `NavTabs` sem overflow · **P1 · local**

[nav-tabs.tsx:36](<src/components/ui/nav-tabs.tsx:36>) usa `flex gap-0.5 border-b`
sem `overflow-x-auto`. Em `/configuracoes` são **10 tabs** — abaixo de ~1100px
elas se espremem e abaixo de ~800px vazam da viewport **sem scroll**, tornando as
últimas inalcançáveis.

#### P-19 · Política de foco divergente · **P3 · global**

[input.tsx:16](<src/components/ui/input.tsx:16>) aplica o anel em `focus:`, e
`Button` usa `focus-visible:`. Isso não é, por si só, falha WCAG: manter indicação
de foco em campos após clique é útil. A tarefa é documentar e testar a política,
garantindo foco forte no teclado em todos os controles; não remover o ring de
inputs mecanicamente.

### Categoria F — Consistência de superfície

#### P-20 · Duas páginas nunca migradas ao DS · **P2 · local**

`/documentos/[id]/pdf` e `/prescricoes/[id]/pdf` usam Tailwind stock e paleta
crua:

```tsx
className="h-[80vh] w-full rounded border border-gray-300"
className="… border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
```

`border-gray-300` **não tem variante dark** → borda quase invisível no tema
escuro. São as únicas cores cruas relevantes que restam no sistema.

#### P-21 · Defeitos de acentuação na UI · **P2 · local**

Texto visível ao usuário sem acentuação — diretamente contra a percepção de
maturidade que o redesign persegue:

| Texto | Local |
| --- | --- |
| "Solicitacoes LGPD" / "Responsavel, prazo … e comunicacao ao titular." | [lgpd/page.tsx:75](<src/app/(app)/(shell)/configuracoes/lgpd/page.tsx:75>) |
| "Importar historico da agenda" | [importar/page.tsx:36](<src/app/(app)/(shell)/agenda/importar/page.tsx:36>) |
| "Ausencias medicas" | [agenda/page.tsx:73](<src/app/(app)/(shell)/agenda/page.tsx:73>) |
| "Esta acao bloqueia operacoes futuras" | [patient-death-form.tsx:45](<src/app/(app)/(shell)/pacientes/[id]/patient-death-form.tsx:45>) |
| "Historico de tratamento" | [lgpd/page.tsx:202](<src/app/(app)/(shell)/configuracoes/lgpd/page.tsx:202>) |

#### P-22 · `Select` nativo · **P2 · global**

[select.tsx](<src/components/ui/select.tsx>) estiliza um `<select>` nativo. O
controle fechado respeita os tokens atuais; o menu aberto é desenhado pelo
sistema operacional e não oferece o mesmo controle de tema, grupos, ícones ou
descrições. Isso é trade-off, não falha automática: listas curtas podem migrar
para Radix após aprovação da dependência; busca usa Combobox; native permanece
quando a experiência do picker do sistema for melhor.

#### P-23 · ADRs de UI referenciados mas inexistentes · **P3 · global**

`ADR-018`, `ADR-031` e `ADR-035` são citados em ~10 arquivos-fonte, incluindo o
[globals.css](<src/app/globals.css>) ("Fonte da verdade: design_system/DSv2.html —
ADR-031"). **Nenhum existe em `docs/adr/`** — foram removidos na migração de docs
em curso, e `docs/ui-refactor/` está vazio. A UI não tem documento normativo
vigente; este arquivo passa a ocupar esse lugar.

#### P-24 · Sem opção "sistema" no tema · **P3 · global**

[use-theme.ts:29](<src/components/shared/use-theme.ts:29>) resolve
`saved === 'dark'` — sem valor salvo o tema é sempre claro, ignorando
`prefers-color-scheme`.

#### P-25 · Responsividade não testada · **P2 · global**

[playwright.config.ts:70](<playwright.config.ts:70>) define **um único projeto**
(`chromium` / Desktop Chrome). Nenhum viewport tablet ou mobile é exercitado
pelos 47 specs E2E.
---

## Princípios do novo design

1. **Um conceito, uma implementação.** Se existe `<Card>`, não existe
   `.cardblock`. Toda duplicação é resolvida deletando, não abstraindo.
2. **O token é a única fonte de medida.** Nenhum valor arbitrário de fonte,
   espaçamento ou cor entra em código novo. O que não cabe na escala é sinal de
   que a escala precisa de revisão — não de exceção.
3. **Densidade a serviço da leitura.** Mais informação por viewport, sem
   apertar. Alvo: a fileira de KPI + o início da tabela visíveis na dobra em
   1440×900.
4. **Card só quando há unidade de informação.** Borda é semântica, não
   decoração. Tabela, formulário simples e lista não pedem card.
5. **Preset shadcn como linguagem visual, sem apagar os contratos do produto.**
   Cor, neutro, raio e tipografia serão derivados do preset `b5J5Qtmtc` depois
   de decodificado. O que permanece do Qoro é o que carrega significado
   operacional, não estilo: estados clínicos/financeiros, o marcador de IA e a
   marca.
6. **Não simular o que não existe.** Princípio já vigente no produto
   ([modules.ts](<src/components/painel/modules.ts>)) — o redesign o reforça:
   painel "em breve" sai da dobra principal.
7. **Estado é parte do design.** Toda superfície define default, loading, empty,
   error, disabled e sem-permissão antes de ser considerada pronta.

---

## Design tokens

### Gate ativo: preset `b5J5Qtmtc`

A direção visual solicitada passa a ser o preset shadcn `b5J5Qtmtc`. O comando
de referência é:

```bash
pnpm dlx shadcn@latest init --preset b5J5Qtmtc --template next
```

Esse comando é **implementação** e pode escrever `globals.css`, aliases,
dependências e componentes. Por isso, o `init` ainda não foi executado no
projeto. O comando oficial não mutante `preset decode`, conferido também por
round-trip com o decoder oficial, produziu a composição abaixo em 2026-08-20:

| Eixo | Valor confirmado |
| --- | --- |
| Version | `b` |
| Style | `nova` |
| Base color | `zinc` |
| Theme | `blue` |
| Chart color | `sky` |
| Font | `dm-sans` |
| Heading font | `inherit` |
| Radius | `medium` |
| Menu accent | `subtle` |
| Menu color | `default` |
| Icon library do preset | `tabler` |

O código do preset não inclui o eixo `base`; a integração deste produto deve
declarar Radix explicitamente, preservando a stack existente. Há também uma
exceção intencional e já aprovada: o preset pede Tabler, mas o produto exige
Lucide e já usa `lucide-react`; portanto `iconLibrary: "lucide"` prevalece, sem
adicionar outra biblioteca de ícones.

**Status do gate:** metadados `PASS`; CSS/tokens exatos e diff do scaffold
`NOT TESTED` até a execução isolada fora do repositório. Nenhum valor histórico
de `b1s9bZdKy` pode preencher essa lacuna.

> **Referência histórica bloqueada:** a composição abaixo foi capturada para o
> preset anterior `b1s9bZdKy`. Ela explica a estratégia mecânica, mas nenhum
> valor, fonte, raio, cor, nome de `style` ou biblioteca de ícones abaixo deve
> ser copiado para a implementação do preset novo sem nova confirmação.

<details>
<summary>Exibir especificação histórica do preset anterior</summary>

Composição real do preset (lida da própria ferramenta):

| Eixo | Valor |
| --- | --- |
| Style | **Nova** |
| Base Color | **Zinc** (neutro frio, hue ~286) |
| Theme | **Blue** — `oklch(0.488 0.243 264.376)` |
| Chart Color | **Cyan** (rampa de 5) |
| Heading / Font | **Inter** nas duas |
| Icon Library | **Tabler Icons** |
| Radius | **Medium** — `0.625rem` (10px) |
| Menu | Default / Solid |
| Menu Accent | **Bold** → `--accent` = `--primary` |

> "Menu Accent: Bold" é o que diferencia este preset do `b5J5Qtmt` citado no
> briefing original: `--accent` deixa de ser o cinza de hover e passa a ser o
> **azul primário**. Hover de menu, item ativo e seleção ficam azuis, não cinzas.

### A restrição mecânica

**Não é possível substituir o `globals.css` pelo do preset.** O preset define ~25
tokens; o código consome ~60 nomes do DS atual — `--surface`, `--surface-2`,
`--text-2`, `--border-strong`, `--primary-600`, `--sp-4`, `--fs-sm`, `--r-lg`,
`--viz-1` — em **209 arquivos**, mais **3.951 linhas** de CSS legado que também
os referenciam. Um `globals.css` novo deixaria a maioria apontando para variável
inexistente.

### Estratégia: remap de valores

**Os nomes de token do Qoro permanecem; os valores passam a ser os do preset.**

```
ANTES  --surface: var(--neutral-0)      → porcelana quente (hue 98)
DEPOIS --surface: oklch(1 0 0)          → branco puro do preset

ANTES  --primary: var(--primary-600)    → navy oklch(0.478 0.15 264)
DEPOIS --primary: var(--primary-600)    → blue oklch(0.488 0.243 264.376)
```

Vantagens: zero alteração em arquivo `.tsx`, zero alteração no CSS legado, e o
visual muda de verdade — porque `@theme inline` já liga as utilities Tailwind a
essas vars. É a mesma alavanca que o dark mode usa hoje.

Isso **inverte** a estratégia anterior (nomes shadcn → valores Qoro). Agora é
nomes Qoro → valores do preset, mais uma camada de alias com os nomes shadcn para
que componentes instalados pelo CLI funcionem sem edição.

### Exceção preservada: o marcador de IA

Decisão do founder: **o orchid continua reservado à IA.**

No preset, `--accent` é o próprio azul primário. Se aplicado puro, trabalho do
agente ficaria visualmente indistinguível do trabalho humano — uma distinção
operacional real neste produto, não uma preferência estética.

| Token | Destino |
| --- | --- |
| `--accent`, `--accent-foreground` | assumem o significado shadcn = **azul primário** (Menu Accent Bold) |
| `--brand-accent` (novo nome do orchid) | **preservado** — `oklch(0.566 0.194 320)` |
| `--ai`, `--ai-soft`, `--ai-border`, `--ai-tint` | **preservados**, derivam de `--brand-accent` |

O gradiente da marca (`--brand-gradient`) fica preservado pelo mesmo motivo: é
ativo de marca usado em logo/hero, não faz parte da superfície de aplicação e não
conflita com o preset.

### Valores históricos do preset anterior — não implementar

Capturados do preview oficial do `b1s9bZdKy`, em oklch autoral.

```css
/* light */
--background: oklch(1 0 0);
--foreground: oklch(0.141 0.005 285.823);
--card: oklch(1 0 0);
--card-foreground: oklch(0.141 0.005 285.823);
--popover: oklch(1 0 0);
--popover-foreground: oklch(0.141 0.005 285.823);
--primary: oklch(0.488 0.243 264.376);
--primary-foreground: oklch(0.97 0.014 254.604);
--secondary: oklch(0.967 0.001 286.375);
--secondary-foreground: oklch(0.21 0.006 285.885);
--muted: oklch(0.967 0.001 286.375);
--muted-foreground: oklch(0.552 0.016 285.938);
--accent: oklch(0.488 0.243 264.376);        /* = primary (Bold) */
--accent-foreground: oklch(0.97 0.014 254.604);
--destructive: oklch(0.577 0.245 27.325);
--border: oklch(0.92 0.004 286.32);
--input: oklch(0.92 0.004 286.32);
--ring: oklch(0.705 0.015 286.067);
--radius: 0.625rem;
--chart-1: oklch(0.865 0.127 207.078);
--chart-2: oklch(0.715 0.143 215.221);
--chart-3: oklch(0.609 0.126 221.723);
--chart-4: oklch(0.52 0.105 223.128);
--chart-5: oklch(0.45 0.085 224.283);
--sidebar: oklch(0.985 0 0);
--sidebar-primary: oklch(0.546 0.245 262.881);
--sidebar-accent: oklch(0.967 0.001 286.375);
--sidebar-border: oklch(0.92 0.004 286.32);

/* dark */
--background: oklch(0.141 0.005 285.823);
--foreground: oklch(0.985 0 0);
--card: oklch(0.21 0.006 285.885);
--popover: oklch(0.21 0.006 285.885);
--primary: oklch(0.424 0.199 265.638);
--primary-foreground: oklch(0.97 0.014 254.604);
--secondary: oklch(0.274 0.006 286.033);
--muted: oklch(0.274 0.006 286.033);
--muted-foreground: oklch(0.705 0.015 286.067);
--accent: oklch(0.424 0.199 265.638);        /* = primary (Bold) */
--accent-foreground: oklch(0.97 0.014 254.604);
--destructive: oklch(0.704 0.191 22.216);
--border: oklch(1 0 0 / 10%);
--input: oklch(1 0 0 / 15%);
--ring: oklch(0.552 0.016 285.938);
--sidebar: oklch(0.21 0.006 285.885);
```

### Mapa histórico de remap — recalcular após decodificar `b5J5Qtmtc`

| Token Qoro | Recebe de | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | `--background` | `oklch(1 0 0)` | `oklch(0.141 0.005 285.823)` |
| `--surface` | `--card` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` |
| `--surface-2` | `--muted` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` |
| `--text` | `--foreground` | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)` |
| `--text-2` | `--muted-foreground` | `oklch(0.552 0.016 285.938)` | `oklch(0.705 0.015 286.067)` |
| `--border` | `--border` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 10%)` |
| `--field-border` | `--input` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 15%)` |
| `--primary` | `--primary` | `oklch(0.488 0.243 264.376)` | `oklch(0.424 0.199 265.638)` |
| `--on-primary` | `--primary-foreground` | `oklch(0.97 0.014 254.604)` | idem |
| `--ring` | `--ring` | `oklch(0.705 0.015 286.067)` | `oklch(0.552 0.016 285.938)` |
| `--danger-600` | `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| `--viz-1`…`--viz-5` | `--chart-1`…`5` | rampa cyan | idem |
| `--r-lg` | `--radius` | `0.625rem` (já é 10px) | idem |

### Escalas candidatas a re-derivar — valores pendentes

O preset entrega **um** valor por papel; o código usa rampas. Duas precisam ser
regeradas — trabalho de token, não de componente:

| Escala | Hoje | Passa a ser |
| --- | --- | --- |
| `--neutral-0` … `--neutral-950` (13 passos) | porcelana/tinta quentes, hue 98–108 | **zinc frio, hue ~286**, ancorado em `oklch(0.967 0.001 286.375)` e `oklch(0.274 0.006 286.033)` |
| `--primary-50` … `--primary-950` (11 passos) | navy, chroma ~0.15 | **blue do preset**, ancorado em `oklch(0.488 0.243 264.376)`, chroma mais alto |

As demais (`success`, `warning`, `info`) não têm equivalente no preset e
permanecem — são semânticas de status, não de marca. `--danger-*` re-ancora no
`--destructive`.

### Raio histórico — decisão pendente do preset ativo

Preset `--radius: 0.625rem` = 10px = exatamente o `--r-lg` atual. A escada shadcn
deriva os demais do base; a do Qoro diverge em dois passos:

| | xs | sm | md | lg | xl |
| --- | --- | --- | --- | --- | --- |
| Qoro hoje | 3 | 5 | 7 | 10 | 14 |
| shadcn (`--radius` 10px) | — | 6 | 8 | 10 | 14 |

Alinhar `--r-sm` 5→6 e `--r-md` 7→8. Diferença de 1px, mas é o que faz botão e
input parecerem do mesmo sistema que os componentes vindos do CLI.

### Tipografia histórica — decisão pendente do preset ativo

Preset usa **Inter** em heading e body. Inter **já está carregada** no projeto
([layout.tsx:14](<src/app/layout.tsx:14>)) como `--font-inter`, hoje só para
display. A mudança é de ponteiro, não de dependência:

| Token | Hoje | Passa a ser |
| --- | --- | --- |
| `--font-sans` | Hanken Grotesk | **Inter** |
| `--font-display` | Inter | **Inter** (sem mudança) |
| `--font-mono` | IBM Plex Mono | IBM Plex Mono — **mantido** |

**Hanken Grotesk sai** e o import correspondente pode ser removido do root
layout — menos uma família de fonte carregada. O preset especifica Geist Mono,
mas mono aparece só em números tabulares, timestamps e breadcrumb; trocar custaria
uma dependência nova por ganho imperceptível. **Recomendação: manter IBM Plex
Mono.**

### `components.json` — rascunho histórico, não copiar

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "<gerado-pelo-preset>",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/app/globals.css",
                "baseColor": "zinc", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/ui/cn",
    "hooks": "@/hooks"
  }
}
```

`utils` deve apontar para o `cn()` **existente** — nenhum helper novo, nenhum
`lib/utils.ts` duplicado. O valor de `style` será o produzido/aceito pelo CLI
atual para `b5J5Qtmtc`; o placeholder de `style` acima não é contrato.

### Biblioteca de ícones — decisão fechada: Lucide

O preset anterior especificava Tabler Icons; o briefing atual torna
**Lucide Icons obrigatório** e o projeto já usa `lucide-react` em 51 arquivos.

| Opção | Custo | Ganho |
| --- | --- | --- |
| Manter lucide | zero | nenhum |
| Migrar para Tabler | 68 mapeamentos × 51 arquivos + dependência nova | fidelidade ao preset |

Ícone é o eixo do preset com **menor impacto no "look"** — Tabler e Lucide têm
traço e grid muito próximos (2px, 24×24). O que define a percepção visual é cor,
raio e tipografia, e esses três são adotados integralmente.

**Decisão: manter Lucide**, com `iconLibrary: "lucide"` no `components.json`.
Se o preset decodificado trouxer outra biblioteca, apenas esse eixo será
sobrescrito para Lucide; nenhuma dependência de ícones será adicionada.

### Tokens candidatos a corrigir após o gate

| Ação | Token | Motivo |
| --- | --- | --- |
| Renomear | `--accent` → `--brand-accent` | libera `--accent` para o significado shadcn (= primary); orchid segue vivo alimentando `--ai` |
| Re-derivar | `--neutral-*` (13), `--primary-*` (11) | rampas zinc e blue do preset |
| Re-ancorar | `--danger-*` | em `--destructive` |
| Ajustar | `--r-sm` 5→6, `--r-md` 7→8 | escada do shadcn |
| Repontar | `--font-sans` → Inter | preset |
| Remover | `--content-maxw`, `--maxw` | mortos (P-06); largura real vira `--page-maxw` |
| Remover ou usar | `--stack` | morto (P-06) |
| Criar | contratos de largura workspace/data/form/read | substitui `max-w-330` hardcoded sem outro máximo universal (P-07/P-34) |
| Criar | `--page-px`, `--page-pt`, `--page-pb` | padding de página deixa de ser literal no shell |
| Criar | camada de alias shadcn | `--background`, `--card`, `--muted`… apontando para os nomes Qoro |
| Ativar | `[data-density]` | ligar ao seletor de densidade (Fase 6) |

### Camada de alias shadcn — estratégia aprovada, valores pendentes

Depois do remap, os nomes shadcn passam a ser **apelidos** dos nomes Qoro — assim
qualquer componente instalado pelo CLI funciona sem edição. O trecho abaixo é
estrutural e ilustrativo; mapeamentos como `--accent` só serão fechados depois
da leitura do preset ativo:

```css
:root {
  --background: var(--bg);
  --foreground: var(--text);
  --card: var(--surface);
  --card-foreground: var(--text);
  --popover: var(--surface);
  --popover-foreground: var(--text);
  --primary-foreground: var(--on-primary);
  --secondary: var(--surface-2);
  --secondary-foreground: var(--text);
  --muted: var(--surface-2);
  --muted-foreground: var(--text-2);
  --accent: var(--primary);            /* Menu Accent: Bold */
  --accent-foreground: var(--on-primary);
  --destructive: var(--danger-600);
  --input: var(--field-border);
  --radius: var(--r-lg);
  --chart-1: var(--viz-1); --chart-2: var(--viz-2); --chart-3: var(--viz-3);
  --chart-4: var(--viz-4); --chart-5: var(--viz-5);
}
```

`--primary`, `--border` e `--ring` já têm o nome certo nos dois sistemas — não
precisam de alias.

### Projeção visual histórica do preset anterior — não é aceite do novo

| Superfície | Antes | Depois |
| --- | --- | --- |
| Fundo da aplicação | porcelana quente `oklch(0.973 0.0045 98)` | **branco puro** |
| Neutros | quentes (hue 98–108) | **zinc frios** (hue 286) |
| Primária | navy sóbrio, chroma 0.15 | **azul saturado**, chroma 0.243 |
| Hover de menu / item ativo | cinza | **azul** (Menu Accent Bold) |
| Gráficos | 8 hues categóricos | **rampa cyan de 5** |
| Fonte de interface | Hanken Grotesk | **Inter** |
| Marcador de IA | orchid | **orchid** (preservado) |

Essa projeção descreve apenas `b1s9bZdKy`. O aceite de `b5J5Qtmtc` será feito
com screenshots pareados light/dark nas rotas críticas; não se conclui a paleta
do novo preset a partir desta tabela.

</details>

---

## Tipografia

A família do preset ativo ainda precisa ser confirmada. Inter e Hanken Grotesk
já existem no projeto; nenhuma fonte será removida nem adicionada antes do diff
de `b5J5Qtmtc`. IBM Plex Mono permanece como primeira hipótese para dados
tabulares por já estar carregada e ter função operacional clara.

A escala de tamanhos abaixo é independente do preset e continua valendo: o
problema que ela resolve é uso, não escolha de família.

### Escala normativa

A escala do DS já existe e é adequada. O que falta é **proibir o desvio**.

| Papel | Token | px | Peso | Uso |
| --- | --- | --- | --- | --- |
| Page title | `--fs-h2` | 30 | 600 | `<PageHeader>` — hoje `text-[27px]` |
| Section title | `--fs-h3` | 23 | 600 | seções dentro de página |
| Card title | `--fs-h4` | 18 | 600 | `<CardTitle>`, `<EmptyState>` |
| Panel title | `--fs-sm` | 13.5 | 600 | `<PanelCard>` (título compacto) |
| Body | `--fs-base` | 15 | 400 | texto corrido, descrição do header |
| Control / table | `--fs-sm` | 13.5 | 400 | inputs, botões, células |
| Metadata | `--fs-xs` | 12 | 400 | hints, timestamps, badges |
| Caption / eyebrow | `--fs-2xs` | 11 | 500 | labels de grupo, `tracking-label` |

**Números e métricas** continuam em `font-mono` + `tabular-nums` — já é o padrão
em `TableHead numeric` e `StatCard`, e deve ser exigido em toda coluna monetária.

### Regra de migração

| De | Para |
| --- | --- |
| `text-[9.5px]`, `text-[10px]`, `text-[10.5px]`, `text-[11px]` | `--fs-2xs` (11) |
| `text-[11.5px]`, `text-[12.5px]` | `--fs-xs` (12) |
| `text-[13px]` | `--fs-sm` (13.5) |
| `text-[14.5px]`, `text-[15px]` | `--fs-base` (15) |
| `text-[27px]` | `--fs-h2` (30) |
| `text-[34px]` | `--fs-h1` (38) ou `--fs-h2` conforme contexto |
| `text-sm` / `text-xs` (stock) | `--fs-sm` / `--fs-xs` |

Reduz de 3 escalas simultâneas para 1. **189 ocorrências de Tailwind stock** são
o volume real dessa migração — feita por módulo, não em um passe global.

---

## Espaçamento

### Escala normativa (derivada de `--sp-*`, já existente)

| Papel | Token | px |
| --- | --- | --- |
| Page padding (desktop) | `--sp-8` | 32 |
| Page padding (mobile) | `--sp-4` | 16 |
| Section spacing | `--sp-6` | 24 |
| Card padding | `--card-pad` | 24 (18 em compact) |
| Panel padding (denso) | `--sp-4` | 16 |
| Grid gap | `--sp-4` | 16 |
| Form gap (entre campos) | `--sp-4` | 16 |
| Field gap (label→controle) | `--field-gap` | 7 |
| Inline gap (ícone→texto) | `--sp-2` | 8 |
| Dialog padding | `--card-pad` | 24 |
| Table cell | `--cell-py` | 12 (7 em compact) |

### Regra

Utilities Tailwind (`gap-2`, `p-4`) já pertencem a uma escala e **não devem ser
reescritas mecanicamente**. Tokens semânticos ficam reservados a medidas globais
que precisam mudar em conjunto (`page-px`, `row-h`, `control-h`, `card-pad`). O
review deve sinalizar valor arbitrário sem justificativa e divergência entre
componentes equivalentes, não a simples ausência de `var(--sp-*)`.

### Ganho de densidade proposto

| Medida | Hoje | Proposto | Ganho |
| --- | --- | --- | --- |
| `max-w` conteúdo | 1320px universal | 4 modos: workspace/data/form/read | usa espaço sem esticar formulários/texto |
| `pt` da página | 24px | 20px | −4px |
| `pb` da página | 64px | 32px | **−32px** |
| Altura do `EmptyState` | ~200px | ~120px (`py-(--sp-8)`, ícone `size-10`) | **−80px** |
| KPI: colunas por viewport | 3 | metric strip/container | elimina fileira órfã sem apertar com sidebar |

Nenhuma dessas mudanças reduz tamanho de fonte, altura de linha ou área de
clique — a densidade vem de **remover vazio**, não de comprimir conteúdo.

---

## Componentes — inventário inicial

> Esta seção registra a primeira proposta da auditoria. O
> [Mapa canônico de componentes](#mapa-canônico-de-componentes), mais abaixo,
> substitui decisões de adotar Command, Sonner, Sheet, ScrollArea, Calendar ou
> Select sem medir necessidade e aprovar dependências.

### Preservar sem alterar

`Button` (CVA, 8 variantes, `focus-visible` correto, estado `loading`),
`Table` kit, `Dialog`, `Drawer`, `DropdownMenu`, `Tabs`, `Checkbox`, `Badge`,
`StatusBadge`, `Alert`, `Toaster`, `Skeleton`, `Spinner`, `Field` (após P-17),
`TableToolbar`, `TablePager`, `PageHeader` (após P-05), `Breadcrumbs`.

### Substituir por shadcn

| Atual | shadcn | Ganho | Problema resolvido |
| --- | --- | --- | --- |
| `Select` (nativo) | `select` (Radix) | menu temático, grupos, ícones, dark mode | P-22 |
| `Combobox` (189 linhas à mão) | `command` (cmdk) + `popover` | teclado/a11y mantidos por biblioteca | P-02, P-16 |
| `confirm()` (5×) | `ConfirmDialog` existente | temático, consequência explícita, loading e mobile | **P-13** |
| `date-field` | `calendar` + `popover` | seleção por calendário, faixas | — |
| — | `sonner` | fila de toast madura (avaliar vs `Toaster` atual) | — |

### Adicionar (só onde há problema real)

| Componente | Onde | Resolve |
| --- | --- | --- |
| `separator` | seções de formulário, `/configuracoes` | substitui cards decorativos (P-01) |
| overflow nativo | `NavTabs` no curto prazo | **P-18** sem dependência nova |
| `accordion` / `collapsible` | campos avançados/raros de configuração | densidade |
| `avatar` | `/equipe`, `/conversas` | hoje é `<span>` com iniciais em 3 lugares |
| `progress` | limite de assentos, uso do plano | hoje `.pbar` em CSS legado |
| `sheet` | filtros no mobile | responsividade |
| `radio-group` | escolha de plano | hoje botões improvisados |

### Não adotar

`sidebar` (o shell atual é melhor e já resolve mobile+scrim+persistência),
`navigation-menu` (nav é vertical), `slider`, `carousel`, `menubar`,
`context-menu`, `toggle-group` — sem problema correspondente.

### Componentes compartilhados a criar

Só onde há **repetição comprovada**:

| Componente | Repetições hoje | Escopo |
| --- | --- | --- |
| `<KpiRow>` | 3 grids de StatCard idênticos (dashboard, financeiro, relatórios) | encapsula o grid responsivo correto — resolve P-09 num lugar só |
| `<FormSection>` | padrão título+descrição+campos repetido em 8 formulários | substitui `<Card>` decorativo por `<section>` + `separator` |
| `<ListRow>` | `.listrow`/`.lr-*` em 12 arquivos (CSS legado) | porta o padrão para React, permite deletar o CSS |
| `<DestructiveAction>` | 5 `confirm()` + 2 `ConfirmDialog` | um caminho único para ação destrutiva — resolve P-13 |

**Não criar:** `DataTable` genérico. O padrão RSC atual (`TableWrap` +
`TableToolbar` + `Table`) é composável e mantém o fetch no servidor; um
`DataTable` client-side com TanStack quebraria isso. Os primitivos existentes já
são a resposta certa — falta usá-los com paginação (P-12).

---

## Layout global

### Estrutura (mantida)

```
<html> ─ THEME_INIT (anti-FOUC)
  └─ (shell)/layout.tsx
      ├─ AnnouncementPopup · ImpersonationBanner · HandoffWatcher
      └─ PainelShell
          ├─ ShellSidebar (256px, fixa acima de 900px / drawer abaixo)
          └─ <main> conteúdo
```

### Ajustes

| Item | Hoje | Proposto | Motivo |
| --- | --- | --- | --- |
| `max-w` | `max-w-330` (1320px) literal | modo workspace/data/form/read | P-07/P-34 |
| `pb` | `--sp-16` (64px) | `--sp-8` (32px) | P-11 |
| Padding | literal no shell | `--page-px` / `--page-pt` | tokenização |

**Sem topbar** — decisão do founder, mantida. Busca global é feature posterior,
dependente de endpoints/RBAC; ações de página
continuam no `PageHeader`, com a regra de no máximo **1 primária + 1 secundária**
e o resto em `DropdownMenu` (resolve o `/agenda`, que hoje tem 4 botões).

---

## Sidebar

Preservar: largura 256px, grupos (`Operação`/`Clínico`/`Gestão`/`Administração`),
identidade do tenant no topo, bloco de usuário + tema + sair no rodapé, badge de
handoff com número e `aria-label`, breakpoint `nav` (900px) com scrim.

| Melhoria | Motivo |
| --- | --- |
| manter scroll nativo do `<aside>` e validar altura baixa | o aside já usa `overflow-y-auto`; não adicionar ScrollArea sem falha observada |
| Estado ativo em subrotas | `/agenda/ausencias` já ativa "Agenda" (`startsWith`) — manter e documentar |
| `aria-current="page"` no link ativo | **já existe** em `SideNavLink`; preservar |
| Colapso para ícones (opcional) | só após testar se recupera largura sem prejudicar descoberta |

---

## Header (PageHeader)

`<PageHeader>` é o elemento que estabelece hierarquia em **todas** as páginas.

| Ajuste | De | Para |
| --- | --- | --- |
| Título | `text-[27px]` | `--fs-h2` (30px) |
| Descrição | `text-[14.5px]` | `--fs-base` (15px) |
| Margem inferior | `--sp-5` (20px) | `--sp-5` (mantém) |
| Ações | ilimitadas | **máx. 1 primária + 1 secundária**; excedente em `DropdownMenu` |
| Breadcrumbs | dois caminhos (`crumbs` + `breadcrumb` legado) | manter `crumbs`; depreciar `breadcrumb` |

**Regra de ações** (resolve `/agenda`, que hoje empilha 4 botões que quebram no
mobile): sub-rotas de um módulo pertencem a uma navegação secundária
(`NavTabs`), não a botões do header.

---

## Responsividade

### Breakpoints em uso

`sm:` 41 · `lg:` 29 · `md:` 14 · `nav:` 12 (900px, custom) · `xl:` 11 · `2xl:` 4.

O tratamento é desktop-first e o mobile é servido quase só pelo shell.

### Alvos iniciais — substituídos pelos modos de largura útil

| Viewport | Comportamento esperado |
| --- | --- |
| ≥1536px | modo workspace/data usa largura extra; form/read continuam controlados |
| 1280–1535px | split views apenas com coluna lateral ≥320px real |
| 900–1279px | sidebar fixa; grids por container; tabelas com scroll |
| 768–899px | sidebar global vira drawer; detalhes operacionais viram drawer |
| <768px | uma coluna; filtros progressivos; ação primária alcançável |

### Riscos conhecidos por módulo

| Módulo | Risco |
| --- | --- |
| `/configuracoes` | 10 tabs sem scroll — **quebra abaixo de 800px** (P-18) |
| `/agenda` | 4 botões no header quebram; grid de mês/semana é o maior risco de overflow |
| `/consultorio` | `lg:grid-cols-[1fr_2fr_1fr]` — 3 colunas viram pilha longa no mobile |
| `/conversas/[id]` | painel de conversa + painel de contexto lado a lado |
| Tabelas | ✅ sem risco — `TableScroll` em 11/11 |

---

## Acessibilidade

| Item | Estado | Ação |
| --- | --- | --- |
| Labels de formulário | ⚠️ 44 de 109 Fields sem `htmlFor`, incluindo grupos válidos | classificar; `controlId` ou `fieldset/legend` (**P-17**) |
| Foco visível | ⚠️ política divergente | testar teclado; ring de input em `focus` pode permanecer (P-19) |
| Navegação por teclado em overlay | ✅ Radix | manter |
| Tabs alcançáveis | ⚠️ sem overflow | `overflow-x-auto` imediato; SettingsNav elimina excesso (**P-18**) |
| Botões só com ícone | ⚠️ parcial (57 `aria-label`) | auditar; `Tooltip` (hoje 0 usos) |
| Contraste | ✅ desvio de `--text-link` no dark já documentado no token | validar após alias |
| `aria-current` | ✅ `NavTabs` e `SideNavLink` | preservar nos novos settings/subnav |
| Mensagens de erro | ⚠️ visuais; associação/live announcement não é global | ligar erro/hint ao controle e anunciar mutações |
| Loading anunciado | ⚠️ `aria-busy` só em `Button` | estender a `PageSkeleton` |
| Confirmação destrutiva | ⚠️ `confirm()` nativo | `alert-dialog` (**P-13**) |
---

## Auditoria de cards

Classificação conforme o briefing (§7), aplicada aos usos reais.

### Card necessário — manter

| Uso | Local | Por quê |
| --- | --- | --- |
| `PanelCard` de gráfico/agenda/atividade | dashboard | unidades independentes com ação própria |
| `Card` de consentimento | [consent-card.tsx](<src/app/(app)/(shell)/pacientes/[id]/consent-card.tsx>) | contexto jurídico separado |
| `Card` de vínculos do paciente | [patient-relationships-card.tsx](<src/app/(app)/(shell)/pacientes/[id]/patient-relationships-card.tsx>) | entidade relacionada distinta |
| `Card` de troca de plano | [plan-change-form.tsx](<src/app/(app)/(shell)/configuracoes/assinatura/plan-change-form.tsx>) | comparação lado a lado |
| Plan cards | assinatura/onboarding | comparação lado a lado justifica boundary próprio |

### Card questionável — converter

| Uso | Local | Substituir por |
| --- | --- | --- |
| `Card` envolvendo formulário simples | [agent-config-form.tsx](<src/app/(app)/(shell)/configuracoes/agente/agent-config-form.tsx>), [audit-export-form.tsx](<src/app/(app)/(shell)/configuracoes/auditoria/audit-export-form.tsx>) | `<FormSection>` (`section` + `separator`) |
| `Card` de "chips" em relatórios | [relatorios/page.tsx:118](<src/app/(app)/(shell)/relatorios/page.tsx:118>) — `flex flex-wrap gap-8 p-(--card-pad)` | lista com `separator`; `gap-8` é vazio puro |
| `Card` de importação | [importar/page.tsx](<src/app/(app)/(shell)/agenda/importar/page.tsx>) | conteúdo direto na página |
| 12 `Card` do hub de configurações | [configuracoes/page.tsx:140](<src/app/(app)/(shell)/configuracoes/page.tsx:140>) | ver [redesign](#redesign-de-configuracoes) |

### Card desnecessário — remover

| Uso | Local | Problema |
| --- | --- | --- |
| **Card por item de lista** | [sugestoes/page.tsx:63](<src/app/(app)/(shell)/configuracoes/sugestoes/page.tsx:63>) | cada sugestão é um `<Card>` → N bordas empilhadas, fragmentação máxima. Vira `<ListRow>` dentro de um container. |
| **Card como empty state** | [sugestoes/page.tsx:53](<src/app/(app)/(shell)/configuracoes/sugestoes/page.tsx:53>) | `<Card><CardContent className="py-10 text-center">` reimplementa `<EmptyState>` |
| **EmptyState dentro de PanelCard** | [dashboard](<src/app/(app)/(shell)/dashboard/page.tsx>) | card + empty aninhados somam ~280px para dizer "em breve" (P-08, P-10) |
| **`.cardblock` no `/admin`** | 35 usos | duplica `<Card>` com padding divergente (P-01) |

---

## Auditoria por página

Legenda de prioridade: **A** = redesenhar primeiro · **B** = segundo passe ·
**C** = alinhamento apenas.

### Operação

| Rota | Propósito / role | Componentes | Problemas | Prio |
| --- | --- | --- | --- | --- |
| `/dashboard` | pulso operacional · todos | `PageHeader`, `StatCard`×5, `PanelCard`×5, `RevenueChart`, `ActivationChecklist` | P-08 (2 painéis "em breve"), P-09 (KPI órfão), P-14 (3 tratamentos de vazio no mesmo arquivo), botão "Atualizar" é `<Link>` para a própria rota | **A** |
| `/agenda` | mês/semana/dia · `view:agenda` | `PageHeader`, `AgendaNav`, `AgendaCalendar`, `NewAppointmentDrawer` | 4 ações no header (quebra no mobile), sub-rotas como botões em vez de nav secundária, P-21 ("Ausencias medicas") | **A** |
| `/agenda/ausencias` | bloqueios · `manage:availability` | formulário + lista em duas colunas | herda `agenda/loading.tsx`; `limit: 100` sem paginação ou filtros | B |
| `/agenda/lista-espera` | fila de espera | `waitlist-manager` (321L) | herda `agenda/loading.tsx`; formulário ocupa a largura e a lista oculta preferências/notas após salvar | **A** |
| `/agenda/importar` | importar histórico | `Card` + form | Card desnecessário; P-21 ("historico") | C |
| `/consultorio` | board de atendimento | `consultorio-board` (278L), 3 drawers | melhor workspace atual; preservar. O breakpoint `lg` considera viewport, não os 256px da sidebar, e pode ativar 3 colunas com apenas ~704px úteis | B |

### Clínico

| Rota | Propósito / role | Componentes | Problemas | Prio |
| --- | --- | --- | --- | --- |
| `/pacientes` | listagem · `view:patient` | `PageHeader`, `TableWrap`, `TableToolbar`, `Table` | **P-12** (`limit: 50` sem paginação), sem `loading.tsx`, ações de linha como `<span>` com hover manual | **A** |
| `/pacientes/[id]` | ficha · `view:patient` | 4 `Card` + formulários | fragmentação em cards; **P-13** (2 `confirm()` — excluir e óbito) | **A** |
| `/pacientes/[id]/prontuarios/[pid]` | prontuário · `view:clinical` | editor + `sign-dialog` | 2 `Card`; densidade a revisar | B |
| `/documentos` | documentos emitidos | `TableWrap` + toolbar | **P-12** (`limit: 100`) | B |
| `/documentos/[id]/pdf` | preview de PDF | — | **P-20** (Tailwind stock, `border-gray-300`, quebra no dark) | B |
| `/prescricoes/[id]/pdf` | preview de receita | — | **P-20** (idem) | B |
| `/modelos-receita` | modelos · `manage:templates` | `templates-manager` (294L) | **P-13** (`confirm()`), sem `loading.tsx` | B |

### Gestão

| Rota | Propósito / role | Componentes | Problemas | Prio |
| --- | --- | --- | --- | --- |
| `/financeiro` | lançamentos · `view:financial` | `StatCard`×5, `TableWrap`, toolbar | **P-09**, **P-12** (`limit: 50`) | **A** |
| `/financeiro/fornecedores` | fornecedores | `fornecedores-view` (226L) | 1 `Card`; sem paginação | C |
| `/caixa` | fluxo do dia · `view:financial` | `caixa-view` (605L, maior arquivo) | **P-12** (`.slice(0,5)`/`.slice(0,10)` — truncamento na camada de UI), 3 `EmptyState` seguidos, arquivo grande demais | **A** |
| `/conversas` | inbox IA · `view:conversations` | `TableWrap`, `TablePager` | ✅ **única tela tenant paginada** — é o modelo a replicar | C |
| `/conversas/[id]` | thread + handoff | `PanelCard`×2, `conversa-actions` (302L) | densidade da leitura; sem `loading.tsx` | B |
| `/relatorios` | relatórios | `StatCard`×2, `Card`×2 | `Card` com `gap-8` (vazio puro); `text-[34px]` | B |

### Administração (tenant)

| Rota | Propósito / role | Componentes | Problemas | Prio |
| --- | --- | --- | --- | --- |
| `/equipe` | membros · `manage:team` | `TableWrap`, `ConfirmDialog`, `invite-drawer` | ✅ **único módulo com `ConfirmDialog`** — é o modelo; `text-amber-600` cru | C |
| `/configuracoes/*` | 10 subrotas + hub | `NavTabs` + 11 cards | ver [seção dedicada](#redesign-de-configuracoes) | **A** |
| `/account/security` | MFA da conta | form | fora da árvore de configurações mas exposto como tab dela | B |

### Fora do shell

| Rota | Observação |
| --- | --- |
| `/login`, `/login/mfa`, `/reset-password` | `text-[2.1rem]`, `text-[2.5rem]`, `text-white/70` — fora da escala, mas é superfície de marca; **prioridade C**, tratar junto do polish |
| `/join/[token]`, `/convite` | onboarding com CSS próprio (`onboarding-flow.css`); avaliar na Fase 4 |

### `/admin` (super-admin, 11 rotas)

Débito concentrado: `.cardblock` 35 · `.listrow` 18 · `<Card>` 9. Área **interna**,
não voltada ao cliente. Prioridade **B/C** — migra por último, depois que os
padrões estiverem estabilizados no painel tenant.

---

## Achados adicionais da auditoria ampliada (2026-08-20)

Os itens abaixo complementam P-01…P-25. Quando houver conflito, esta revisão
mais recente prevalece.

### P-26 · Retorno dos previews aponta para rota inexistente · **P0 · clínico**

`/documentos/[id]/pdf` e `/prescricoes/[id]/pdf` voltam para
`/pacientes/{id}/prontuarios`, mas essa rota não existe. O destino real do hub é
`/pacientes/{id}?tab=prontuarios`. É um beco sem saída em uma tarefa clínica e
deve ser corrigido antes do redesign visual.

### P-27 · Dashboard admin converte timeout em KPI zero · **P0 · confiança**

`/admin` usa `withQueryFallback` com MRR, ARR, churn e clínicas zerados. Em caso
de timeout, a tela pode apresentar “R$ 0” e “nenhuma clínica” como se fossem
dados reais. Performance percebida não pode ser comprada com informação falsa:
mostrar estado indisponível, última atualização válida e retry preserva a
confiança operacional.

### P-28 · Agenda não funciona como superfície temporal · **P1 · operação**

A visão semanal é um grid de sete cards, não uma grade de horários; eventos não
são o alvo principal de interação e a criação pede data/hora manual sem exibir
disponibilidade. Não há painel lateral de detalhe, ações rápidas, edição inline
ou drag-and-drop. O mês resume só três itens por dia, o que é aceitável como
overview, mas semana/dia precisam virar o workspace de produção.

### P-29 · Pacientes é cadastro, ainda não CRM · **P1 · clínico**

A lista busca apenas por nome, envia filtro manualmente, corta em 50 e não tem
filtros avançados, tags ou status operacionais. O perfil abre edição completa o
tempo todo, fragmentado em quatro cards e duas tabs; não há timeline unificada
de consultas, documentos, mensagens e eventos financeiros. Além disso, a lista
pré-carrega 200 candidatos a responsável em toda visita, mesmo com o drawer de
novo paciente fechado.

### P-30 · Caixa usa um card por transação e cresce sem limite · **P1 · financeiro**

Recebíveis, parciais, recebidos e contas a pagar são quatro pilhas de cards sem
busca, filtro, paginação ou virtualização. As queries principais trazem todos os
abertos; no cliente, as transações de pagamento são filtradas de novo para cada
item. Os formulários inline de receber/cancelar/reembolsar são uma boa decisão e
devem ser preservados dentro de uma fila tabular ou split view.

### P-31 · Configurações mistura navegação, escopos e gerações de UI · **P1 · global**

Além das tabs e do hub divergentes, WhatsApp concentra 31 estilos inline e usa
`.panel/.btn/.badge`; Perfil mistura dados da clínica com a credencial do usuário
em uma coluna de 560px; Segurança da conta vive fora da árvore; Recursos usa
`select` e checkbox crus. A sidebar interna deve reorganizar sem duplicar
permissões já existentes em `/equipe` nem confundir clínica, profissional e
conta.

### P-32 · LGPD é uma pilha de casos com N+1 queries · **P1 · conformidade**

`/configuracoes/lgpd` carrega todas as solicitações, executa uma query de
histórico por solicitação e renderiza um card grande com múltiplos formulários
para cada caso. Não há paginação, busca, filtro de SLA, ordenação por atraso ou
detail view. O redesign deve ser uma work queue com tabela + painel de caso;
histórico é carregado sob demanda.

### P-33 · Conversa perde produtividade ao empilhar thread e atendimento · **P1 · operação**

Na conversa individual, o histórico completo vem antes da área de atendimento
humano. Em threads longas, assumir/responder/encerrar fica abaixo da dobra. Os
metadados técnicos do agente aparecem em cada mensagem para todo operador. O
alvo é split view com thread, composer/ações persistentes e diagnóstico técnico
recolhido sob disclosure.

### P-34 · Breakpoints usam viewport quando o que importa é a largura útil · **P1 · responsividade**

A sidebar desktop ocupa 256px, mas grids usam breakpoints de viewport. Em
1024px, por exemplo, `/consultorio` já ativa `lg:grid-cols-[1fr_2fr_1fr]` com
aproximadamente 704px úteis depois de sidebar e paddings. KPIs, agenda semanal e
workspaces devem responder ao container/conteúdo disponível. Em ultrawide, o
`max-w-330` deixa cerca de 492px vazios em cada lado do conteúdo num monitor de
2560px.

### P-35 · Skeletons existem, mas cobertura e anatomia ainda divergem · **P1 · performance percebida**

Só 12 rotas estão sob um `loading.tsx`. O `PageSkeleton` desenha quatro KPIs
quando Dashboard e Financeiro usam cinco, e o board skeleton usa três colunas
iguais enquanto Consultório é 1:2:1 — isso produz layout shift. Login e convite
podem ficar totalmente vazios pelo `fallback={null}`. Skeleton deve espelhar a
geometria final; ações frequentes podem usar atualização otimista localizada em
vez de 34 `router.refresh()` indiscriminados.

### P-36 · Motion e alvos de interação não têm política global · **P2 · acessibilidade**

Há cinco `transition-all`; Dialog, Drawer, menu, tooltip, toast e shimmer têm
animações, mas o `prefers-reduced-motion` do CSS legado não desativa esses novos
keyframes globalmente. Controles de ícone aparecem em 28–36px: atendem vários
casos de WCAG 2.2 AA, porém são desconfortáveis para uso repetido/touch. Meta de
produto: hit area de 40px no desktop e 44px em coarse pointer, transições apenas
de `transform/opacity/color/shadow`, e modo reduzido cobrindo o shell inteiro.

### P-37 · Marca e linguagem ainda divergem · **P2 · confiança**

O shell e login usam Qoro, mas MFA monta wordmark “ClinicaOS”, Sugestões fala no
“time do ClinicaOS” e WhatsApp menciona que o PIN não é salvo pelo ClinicaOS.
Somam-se os textos sem acentuação de P-21. Definir glossário de marca, escopo e
papéis evita que o produto pareça composto por módulos de épocas diferentes.

### P-38 · Recuperação de senha tem baixa descoberta · **P1 · autenticação**

Existe `/reset-password`, mas `/login` não oferece “Esqueci minha senha” nem
fluxo visível de solicitação. MFA também não oferece ajuda, recuperação ou volta
segura. Antes de criar UI, confirmar o contrato de envio/recuperação existente;
não inventar endpoint ou promessa de e-mail.

---

## Auditoria consolidada por rota — 51 de 51

### Método e limite da evidência

- Foram inspecionados os 51 `page.tsx`, layouts, boundaries, primitivos e os
  clientes principais de Agenda, Consultório, Caixa, Pacientes, Conversas,
  Configurações, onboarding e Admin.
- “Confirmado” abaixo significa observado no código atual e nos contratos da
  documentação canônica. “Alvo” é decisão proposta, ainda não implementada.
- Esta etapa não executou sessão autenticada no browser, matriz de viewport,
  axe/Lighthouse nem comparação visual do preset. Esses quatro itens são gates
  obrigatórios antes e depois de cada onda; não são reportados como PASS.

### Operação, clínico, gestão e configurações (30 rotas)

| Rota | UX confirmada | UI / densidade confirmada | Performance percebida | Alvo de redesign e ganho esperado |
| --- | --- | --- | --- | --- |
| `/dashboard` | Não prioriza exceções; dois painéis “em breve”; falta leitura executiva de confirmação, faltas e inadimplência | 5 KPIs com fileira órfã; três vazios diferentes; largura fixa | Fetch de nomes de auditoria após o fan-out; skeleton de 4 KPIs para tela de 5 | Faixa compacta de KPIs + tendências + agenda de hoje + filas de atenção; decisão em <3s |
| `/agenda` | Semana não permite operar o tempo; evento quase não é acionável; criação manual | Sete cards na semana; quatro ações no header; mês mostra até três itens/dia | RSC troca a tela inteira; `loading.tsx` existe | Grade temporal por profissional, now-line, click-to-create, detalhe lateral e ações inline; menos cliques/modais |
| `/agenda/ausencias` | Formulário/lista lado a lado é bom; faltam busca, filtros e navegação além de 100 | Dois painéis funcionais, mas hierarquia de ação e histórico é fraca | `limit: 100`; herda loading de Agenda | Tabela de bloqueios + editor lateral/inline, filtros por profissional/período/status |
| `/agenda/importar` | Fluxo raro e direto; código de exemplo compete com a tarefa | Card de formulário desnecessário e largura ociosa | Herda loading de Agenda | Seção de upload compacta + validação/progresso + histórico em tabela |
| `/agenda/lista-espera` | Criar/aceitar/recusar existe; preferências e notas somem após salvar; sem SLA/ordenação | Formulário ocupa uma cardblock inteira; lista legado | Nomes e casos carregados para a página; sem paginação própria | Fila priorizada, filtros, preferências visíveis e detalhe lateral; decisão rápida sobre cada vaga |
| `/consultorio` | Melhor fluxo do produto: check-in → fila → atendimento → finalizadas sem trocar de tela; “encerrar” merece confirmação de alto risco | Bom 1:2:1 e contexto clínico; quebra cedo demais em largura útil pequena | Realtime com polling de contingência; detalhe usa spinner; aviso de truncamento por coluna | Preservar arquitetura, corrigir container breakpoint, sticky patient header e confirmação contextual |
| `/pacientes` | Busca só por nome e submit; sem filtros/tags/status; sem paginação | Tabela é boa base; ação de linha e estados podem ficar mais compactos | Carrega 200 responsáveis com drawer fechado; sem loading | CRM list com busca instantânea, filtros salvos, tags dependentes de schema, paginação e quick preview |
| `/pacientes/[id]` | Edita tudo sempre; só Dados/Prontuários; sem timeline de consultas, docs, mensagens e cobrança | Quatro cards empilhados; clínica, relações, consentimentos e risco sem visão conjunta | Fetch inicial seguido dos dados da tab; sem loading | Workspace 2 colunas: resumo/ações à esquerda, timeline e módulos à direita; view/edit explícito |
| `/pacientes/[id]/prontuarios/[pid]` | Autosave, conflito e assinatura são bons; status/retorno podem ficar mais persistentes | Dois cards dentro de coluna de 860px; editor perde espaço em ultrawide | Sem loading de rota; carregamento do atendimento usa spinner em outro contexto | Editor focado com sticky status/save/sign, painel clínico recolhível e largura de leitura controlada |
| `/documentos` | Busca/filtro funcionam, mas exigem submit e só alcançam 100; ação principal é abrir PDF | Tabela consistente; select nativo; pouca informação de contexto | `limit: 100`; possui loading | Tabela paginada, filtros imediatos, tipo/status e preview lateral; manter densidade |
| `/modelos-receita` | CRUD funcional; exclusão usa confirm nativo | Manager isolado, sem padrão completo de tabela/filtro | Sem loading | Lista compacta com edição inline/drawer e ConfirmDialog existente |
| `/financeiro` | Ledger sem drill-down/ações por linha; faltam aging, projeção e comparativo | 5 cards de KPI e tabela; fileira órfã | `limit: 50`; possui loading | Stripe-like: metric strip, cash trend, aging e data table com detail panel |
| `/financeiro/fornecedores` | CRUD funcional, mas editar sempre abre modal; sem busca/paginação | Um card de lista é aceitável em baixo volume | Carrega todos; herda loading de Financeiro | Tabela/lista densa com edição lateral e busca; paginar quando volume justificar |
| `/caixa` | Formulários inline são bons; quatro filas longas, sem busca/filtros | Um card por transação + três empty states + banners extensos | Queries abertas sem limite; filtro O(n×m) de transações; refresh integral | Work queue tabular/split, segmentada por estado, com ação inline e detalhes sob demanda |
| `/conversas` | Boa referência: busca, status, SLA, paginação e auto-refresh | Tabela consistente; pode melhorar seleção e quick preview | Auto-refresh, mas sem loading de rota | Manter padrão e evoluir para inbox split no desktop; fila/linha continua sendo fonte da verdade |
| `/conversas/[id]` | Handoff/reply ficam abaixo de toda thread; diagnóstico técnico exposto | Dois PanelCards empilhados | Sem loading; refresh periódico da thread | Split view com composer e ações sticky; metadados em disclosure; resposta sempre alcançável |
| `/relatorios` | Totais sem tendência, comparação, drill-down ou insight acionável | Dois KPIs e cards com `gap-8`; baixa densidade | Possui loading; fan-out de relatório | Comparativos por período, gráficos legíveis, tabela de drivers e export no contexto |
| `/equipe` | Convite, papéis, credenciais e overrides já existem; faltam busca/filtro/uso de assentos | Boa tabela e ConfirmDialog; controles pequenos | Possui loading; lista completa | Preservar contratos, adicionar filtros, seat utilization e comparação de papel × override |
| `/configuracoes` | Hub duplica tabs, diverge delas e adiciona um clique | 11 cards para navegação; desperdício horizontal | Sem loading | Redirecionar para primeira seção permitida e usar sidebar interna persistente |
| `/configuracoes/agente` | Quatro regras reais; especialidades em CSV é frágil; sem estado “alterações não salvas” | Um card de 760px | Refresh total ao salvar; sem loading | Settings groups, tokens/chips para especialidades, save bar localizada e explicação de impacto |
| `/configuracoes/assinatura` | Comparação de planos é boa; cancelamento não pede confirmação contextual | Cards são corretos para comparação, não para navegação | Sem loading; actions mostram feedback | Manter plan cards, destacar uso/limites e usar AlertDialog/ConfirmDialog no cancelamento |
| `/configuracoes/auditoria` | Só exporta intervalo; não há preview de atividade recente | Form simples sem contexto | Sem loading | Grupo de export + histórico recente paginado conforme contrato existente |
| `/configuracoes/horarios` | Configuração funcional, mas longa e orientada a formulário | Manager de 337 linhas e legado visual | Refresh integral; sem loading | Agenda semanal de disponibilidade, edição inline, exceções separadas e save feedback local |
| `/configuracoes/lgpd` | Sem filtros/SLA/ordenação; todos os formulários abertos por caso | Um card grande por solicitação | Todas as linhas + N+1 de históricos; sem loading | Work queue paginada + painel de caso; histórico lazy; atrasados primeiro |
| `/configuracoes/perfil` | Mistura perfil da clínica e credencial do profissional atual | Coluna fixa de 560px, stack e breadcrumb legado | Sem loading; refresh integral por formulário | Seções separadas “Clínica” e “Meu perfil profissional”, largura de formulário legível |
| `/configuracoes/procedimentos` | CRUD funciona; desativação usa confirm nativo | Manager extenso e legado | Refresh integral; sem loading | Tabela compacta com preço/duração/status e edição lateral/inline |
| `/configuracoes/recursos` | CRUD mínimo; filtro “inativos” cru | `cardblock`, `listrow`, select e checkbox nativos | Refresh integral; sem loading | Lista densa com shadcn controls, filtros e criação inline consistente |
| `/configuracoes/sugestoes` | Envio + histórico é claro; cada item não tem detalhe | Um card por sugestão e marca “ClinicaOS” | Lista completa; sem loading | FormSection + lista de rows/status; alinhar marca Qoro |
| `/configuracoes/whatsapp` | Estados conectado/degradado/desconectado são bons; desconectar sem confirmação | Maior ilha legado tenant: 31 estilos inline, `.panel/.btn/.badge` | SDK Meta após interação; sem skeleton da seção | Status panel + settings groups shadcn, health/timestamp claros e confirmação de desconexão |
| `/account/security` | MFA é real, mas está fora da árvore e volta ao Dashboard | `stack/cardblock`, emoji de sucesso e id técnico truncado | Sem loading | Integrar visualmente à sidebar de conta, manter rota/políticas e usar status semântico |

### Autenticação, onboarding e documentos fora do shell (10 rotas)

| Rota | UX confirmada | UI / densidade confirmada | Performance percebida | Alvo de redesign e ganho esperado |
| --- | --- | --- | --- | --- |
| `/` | Redirect correto para login | Sem UI própria | Custo mínimo | Manter |
| `/login` | Fluxo simples; não descobre recuperação de senha | Split screen polido; ícone do olho é SVG próprio e hit area 32px | `Suspense fallback={null}` pode deixar tela vazia | Preservar composição, usar Lucide, fallback real e CTA de recuperação quando contrato existir |
| `/login/mfa` | Verificação direta; sem ajuda/volta/recuperação | Card pequeno e marca ClinicaOS em vez de Qoro | Sem boundary dedicado | Qoro auth shell, código segmentado/acessível, ajuda e recuperação confirmadas pelo backend |
| `/reset-password` | Troca de senha clara; rota não é descoberta no login | Card consistente | Sem loading | Conectar ao fluxo de solicitação real e manter feedback de token inválido |
| `/auth/auth-error` | Mensagem genérica e retorno | Card adequado | Sem loading | Erro acionável por causa conhecida, request id seguro e CTA correto |
| `/convite` | Verifica sessão no cliente antes de criar senha | Boa hierarquia, mas isolada | `fallback={null}` e fase textual | Skeleton do auth shell, progresso e erros sem blank screen |
| `/join` | Resolve convite/estado e encaminha ao wizard | Entrada isolada | Estados de bootstrap sem skeleton rico | Shell de onboarding consistente e progresso explícito |
| `/join/[token]` | Wizard retomável de 4 etapas é forte; checkout concentra muitos campos | 960 linhas de CSS + 1.042 TSX; cards de plano são semanticamente válidos | Animações próprias; dois `transition-all`; processamento dedicado | Preservar saga/etapas, convergir tokens/componentes e validar mobile/a11y sem reescrever negócio |
| `/documentos/[id]/pdf` | Botão voltar leva a rota inexistente | Tailwind stock, toolbar mínima, iframe 80vh | Sem loading/error dedicado | Corrigir link P0, usar document viewer shell responsivo e estados de download/erro |
| `/prescricoes/[id]/pdf` | Mesmo beco sem saída do documento | Mesma paleta crua e iframe | Sem loading/error dedicado | Mesmo viewer compartilhado, mantendo permissões e pipeline de PDF |

### Plataforma Admin (11 rotas)

| Rota | UX confirmada | UI / densidade confirmada | Performance percebida | Alvo de redesign e ganho esperado |
| --- | --- | --- | --- | --- |
| `/admin` | Pulso de negócio útil, mas timeout pode parecer dado zero | 5 KPIs + painéis + CSS legado | Cinco fallbacks independentes mascaram indisponibilidade | Estado stale/unavailable explícito, metric strip e filas de risco; confiança antes de estética |
| `/admin/clinicas` | Filtros/paginação bons; clínicas e convites disputam uma página longa | Tabelas densas são boa base | Sem loading admin | Subnav “Clínicas / Convites”, preservar filtros/pager e adicionar skeleton |
| `/admin/clinicas/[id]` | Ações e impersonação estão disponíveis; página longa dificulta localização | Muitos cards/cardblocks e resumo extenso | Sem loading | Sticky summary + seções/tabs; ações de risco separadas e contexto sempre visível |
| `/admin/billing` | Cobre faturamento/dunning/refund; tabelas não escalam bem | 5 KPIs e várias superfícies antes da ação | Repositórios usam limites 50/100 sem paginação da tela | Ledger paginado, dunning queue e refund detail; métricas compactas |
| `/admin/audit` | Bom conjunto de filtros e paginação | Toolbar muito larga; UUID cru | Sem loading | Filtros progressivos/salvos, detalhe de evento lateral e copy id |
| `/admin/metricas` | Tendências/top 5 úteis, mas gráficos têm contexto/labels fracos | Cards e barras decorativas | Sem loading | Métricas comparáveis, labels/eixos, drill-down e estado de dado |
| `/admin/saude` | Lista de serviços é clara; “atualizado agora” não dá timestamp exato | Boa densidade | Probes em cada render; sem loading/auto-refresh controlado | Timestamp real, refresh explícito/auto com pausa e histórico curto de incidentes |
| `/admin/conversas-ia` | Split view é boa direção; “q” filtra intent, não texto; só 50 | CSS legado e selects crus | `pageSize: 50` sem pager | Inbox split paginada, busca textual/intent separadas e detail URL estável |
| `/admin/feedbacks` | Fila existe, mas dashboard/charts vêm antes do trabalho | 4 KPIs + 2 charts + cards + tabela | Sem loading; paginação existe | Queue-first; métricas em aba/resumo recolhível e filtros persistentes |
| `/admin/feedbacks/[id]` | Detalhe/gestão em duas colunas é bom | Cards legados, mas hierarquia razoável | Sem loading | Preservar split, consolidar componentes e sticky action rail |
| `/admin/config` | Seis áreas reais, mas uma página/arquivo de 507 linhas concentra tudo | Tabs por query + muitos cardblocks/inline styles | Sem loading; cada troca reprocessa rota | Sidebar/subrotas por domínio, SettingsGroup e carregamento por seção |

---

## Redesign de /configuracoes

É a tela com o pior diagnóstico e a que mais melhora com reestruturação.

### Diagnóstico

**1. Navegação duplicada e divergente.** O layout renderiza `NavTabs` com **10
tabs** ([layout.tsx:18](<src/app/(app)/(shell)/configuracoes/layout.tsx:18>)) e a
página `/configuracoes` renderiza um grid com **11 cards**
([page.tsx:38](<src/app/(app)/(shell)/configuracoes/page.tsx:38>)) — as mesmas
seções, em dois lugares, com conteúdos diferentes.

**2. Duas seções são inalcançáveis pelas tabs.** `agente` e `auditoria` existem
como rota e como card do hub, mas **não estão em `TABS`**. Consequência: ao
entrar em `/configuracoes/agente`, a barra de tabs aparece **sem nenhuma tab
ativa** — o usuário perde a referência de onde está, e quem navega só pelas tabs
nunca descobre as duas seções.

**3. Ordem sem lógica.** As tabs começam em `Assinatura`, `Sugestões` e só então
`Visão geral` — a página-índice é a **terceira**. Nem alfabética, nem por
frequência, nem por importância.

**4. Escopos misturados.** `Segurança da conta` aponta para `/account/security`,
que é **da conta do usuário**, não da clínica — e vive fora da árvore de rotas de
configurações. Aparece lado a lado com `Perfil da clínica`.

**5. Quebra abaixo de 800px** (P-18): 10 tabs em `flex` sem `overflow-x-auto`.

**6. Sem `loading.tsx`** em nenhuma das 10 subrotas (P-15).

### Arquitetura proposta: sidebar de configurações

Avaliadas as alternativas do briefing (§6):

| Opção | Veredito |
| --- | --- |
| Tabs horizontais | ❌ é o que existe e já quebra com 10 itens; não escala para 12+ |
| Accordions numa página | ❌ perde deep-link por seção e o fetch RSC por subrota |
| Páginas filhas soltas | ❌ é o hub de cards atual — 2 cliques para tudo |
| **Sidebar interna + grupos** | ✅ escala, agrupa por escopo, mantém 1 rota por seção |

```
┌──────────────────────────────────────────────────────────────┐
│ Configurações                                                 │
├────────────────────────┬─────────────────────────────────────┤
│ CLÍNICA                │                                      │
│  Perfil da clínica     │   [conteúdo da subrota ativa]        │
│  Horários              │                                      │
│  Procedimentos         │   Server Component — cada seção      │
│  Salas e equipamentos  │   mantém o próprio fetch             │
│                        │                                      │
│ ATENDIMENTO            │                                      │
│  Conexão do WhatsApp   │                                      │
│  Agente de IA        ← │   (hoje inalcançável pelas tabs)     │
│                        │                                      │
│ CONFORMIDADE           │                                      │
│  Solicitações LGPD     │                                      │
│  Auditoria           ← │   (hoje inalcançável pelas tabs)     │
│                        │                                      │
│ CONTA E PLANO          │                                      │
│  Assinatura            │                                      │
│  Segurança da conta ↗  │   (escopo de usuário, marcado)       │
│                        │                                      │
│ ─────────────────────  │                                      │
│  Enviar sugestão       │   (não é configuração — rodapé)      │
└────────────────────────┴─────────────────────────────────────┘
```

### Decisões

#### Arquitetura de informação revisada e aderente às rotas reais

O briefing cita Clínica, Agenda, WhatsApp, IA, Equipe, Segurança, Financeiro,
Integrações e Assinatura. Esses nomes são válidos como modelo mental, mas não
devem virar nove páginas vazias. O mapa executável é:

| Grupo percebido pelo usuário | Destinos atuais | Tratamento |
| --- | --- | --- |
| Clínica | `/configuracoes/perfil` | seção interna; separar clínica de “meu perfil profissional” |
| Agenda | `horarios`, `procedimentos`, `recursos` | três seções internas sob um grupo |
| WhatsApp | `/configuracoes/whatsapp` | seção interna com status da integração |
| IA | `/configuracoes/agente` | seção interna; permissão `manage:agent` preservada |
| Equipe | `/equipe` | link contextual para módulo existente; não duplicar membros/permissões |
| Segurança e conformidade | `/account/security`, `lgpd`, `auditoria` | agrupar visualmente, mantendo escopos e rotas distintos |
| Financeiro | `/financeiro` | link contextual; não fingir que ledger é configuração |
| Integrações | WhatsApp é a única integração configurável atual | não renderizar categoria vazia; criar grupo quando houver segundo destino real |
| Assinatura | `/configuracoes/assinatura` | seção interna de conta e plano |
| Suporte | `/configuracoes/sugestoes` | ação no rodapé, não configuração estrutural |

O roadmap menciona uma futura configuração de pagamentos, mas a rota não existe
no checkout auditado. Ela só entra no grupo Financeiro quando comportamento,
permissão, testes e rota forem implementados.

| Decisão | Motivo |
| --- | --- |
| Sidebar interna substitui `NavTabs` | 11 destinos atuais não cabem em tabs; agrupamento dá hierarquia |
| **Hub de cards é eliminado** | `/configuracoes` passa a redirecionar para `/configuracoes/perfil` — a navegação duplicada some, e o usuário chega direto em conteúdo |
| 4 grupos por escopo | separa clínica / atendimento / conformidade / conta — resolve a mistura do item 4 |
| `Segurança da conta` marcada como externa | continua na sidebar (é onde o usuário procura) com indicador de escopo; a rota **não muda** |
| `Sugestões` sai da lista de seções | não é configuração; vira ação no rodapé da sidebar |
| Filtro por permissão preservado | a lógica de [layout.tsx:48](<src/app/(app)/(shell)/configuracoes/layout.tsx:48>) migra intacta — **é UX, não barreira de segurança**, e essa nota permanece no código |
| Mobile: sidebar vira `Select` no topo | abaixo de 900px, padrão consagrado para settings |
| Formulários passam a `<FormSection>` | `section` + `separator` no lugar de `Card` decorativo |

### Rastreabilidade de funcionalidades (nada se perde)

| Funcionalidade | Hoje | Proposto | Motivo |
| --- | --- | --- | --- |
| Visão geral (hub) | `/configuracoes` (grid de 11 cards) | **removido**; redireciona a `/configuracoes/perfil` | navegação duplicada; a sidebar já lista tudo |
| Descrição de cada seção | texto no card do hub | `title` da página + hint na sidebar | preserva a informação sem gastar uma tela |
| Assinatura | tab 1 | grupo "Conta e plano" | escopo correto |
| Sugestões | tab 2 | rodapé da sidebar | não é configuração |
| Agente de IA | só via card do hub | grupo "Atendimento" | **passa a ser alcançável pela nav** |
| Auditoria | só via card do hub | grupo "Conformidade" | **passa a ser alcançável pela nav** |
| Segurança da conta | tab 10 → `/account/security` | grupo "Conta e plano", marcada como externa | rota inalterada |
| Demais 6 seções | tabs | grupos correspondentes | — |

Nenhuma rota é deletada; nenhuma ação desaparece. A única remoção é a **página-hub
redundante**, cuja função (listar seções) passa a ser exercida pela sidebar de
forma permanente e sempre visível.

### Correções de conteúdo (P-21)

`Solicitacoes LGPD` → `Solicitações LGPD` · `Responsavel` → `Responsável` ·
`comunicacao` → `comunicação` · `Historico de tratamento` → `Histórico de
tratamento` · `Comprovacao` → `Comprovação`.
---

## Arquitetura visual alvo

O filtro para qualquer decisão é: **“como um produto enterprise usado oito
horas por dia reduziria tempo, ambiguidade e erro nesta tarefa?”** Aparência
premium é consequência de hierarquia, precisão e comportamento consistente.

### Hierarquia em quatro níveis

| Nível | Conteúdo | Regra visual |
| --- | --- | --- |
| 1 | título, escopo e ação primária da página | um `PageHeader`; título balanceado; no máximo uma ação primária e uma secundária visível |
| 2 | métricas/estado que mudam a decisão | faixa compacta com separadores, números tabulares e comparação; não uma parede de cards |
| 3 | conteúdo operacional | tabela, scheduler, timeline, board ou split view ocupa a maior área da tela |
| 4 | contexto secundário/diagnóstico | detalhe lateral, disclosure, tooltip ou linha auxiliar; não compete com a tarefa |

O teste de três segundos: usuário deve conseguir dizer **onde está**, **o que
merece atenção** e **qual é a próxima ação** sem percorrer a tela inteira.

### Quatro modos de largura, não um container universal

| Modo | Rotas | Comportamento alvo |
| --- | --- | --- |
| Workspace | Agenda, Consultório, Conversas, Caixa, perfil do paciente | largura fluida até ~1760px; colunas respondem ao container; painéis podem ficar sticky |
| Dados | Pacientes, Documentos, Financeiro, Equipe, Admin tables | largura fluida até ~1600px; tabela aproveita horizontal; toolbar não estica campos indefinidamente |
| Formulário | Configurações, criação/edição | conteúdo principal 680–840px dentro do split de settings; labels e hints têm linha legível |
| Leitura | Prontuário, mensagens longas, textos legais | 65–80ch para texto; controles/contexto podem ocupar colunas adjacentes |

`max-w-330` deixa de ser regra global. O shell expõe um `data-page-layout` ou
composição equivalente; a rota escolhe o modo sem duplicar paddings.

### Densidade e superfícies

- Controle padrão: 36–40px no desktop; hit area 44px em coarse pointer.
- Linha de tabela operacional: 40–44px, com expansão/detalhe sob demanda.
- Métricas compactas usam separadores verticais/horizontais; um card por KPI só
  quando o KPI é um objeto acionável com contexto próprio.
- Cards ficam reservados a entidade isolada, comparação de planos, modal/drawer
  e agrupamento que precise de boundary semântico.
- Formulário simples usa `FormSection + Separator`; lista usa tabela/data list;
  workspace usa split view. Borda não é decoração.
- Valores dinâmicos usam `tabular-nums`; headings usam `text-balance` e textos
  auxiliares `text-pretty` onde isso evita viúvas e layouts instáveis.

### Responsividade operacional

| Faixa útil | Comportamento |
| --- | --- |
| `< 640px` | uma coluna, ação primária sticky quando necessário, filtros em Sheet/Drawer, tabela vira lista apenas se semântica não for perdida |
| `640–899px` | sidebar global off-canvas; workspaces usam 1 coluna + detail drawer |
| `900–1199px` | sidebar fixa; decisões de grid por container, não por viewport; evitar três colunas apertadas |
| `1200–1599px` | split views e tabelas densas; contexto lateral quando houver ≥320px reais |
| `≥ 1600px` | terceira coluna/insights e mais campos de tabela; nunca esticar texto/formulário para preencher espaço |

### Motion, feedback e acessibilidade

- Remover `transition-all`; declarar apenas propriedades animadas. Entradas em
  160–220ms, saídas mais rápidas; transform/opacity/color/shadow.
- Botões podem usar `active:scale-[0.96]`; ícones contextuais aparecem dentro do
  controle, sem atravessar a tela. Nenhuma animação gratuita de page load.
- `prefers-reduced-motion: reduce` cobre Dialog, Drawer, menu, toast, skeleton e
  onboarding, não apenas `.reveal` legado.
- Toda mutação define idle/loading/success/error/disabled; mudanças rápidas de
  estado usam otimista somente quando rollback é seguro e idempotência já existe.
- WCAG AA: contraste medido nos dois temas, foco visível, navegação por teclado,
  headings/landmarks, nomes acessíveis e anúncio de erros/sucesso.

---

## Blueprints das telas de maior impacto

### Dashboard executivo

1. Header compacto com período e refresh que exponha “atualizado em”, não apenas
   recarregue a própria URL.
2. `MetricStrip` com Pacientes ativos, Consultas hoje, Ocupação, Confirmações,
   Faltas, Receita recebida e Inadimplência — cada rótulo explicita período.
3. Linha principal: tendência de receita/ocupação (2/3) + fila de alertas
   acionáveis (1/3).
4. Conteúdo operacional: próximas consultas, confirmações pendentes,
   faturamentos faltantes e cobranças humanas; remover painéis “em breve”.

| Métrica | Contrato necessário antes da UI |
| --- | --- |
| Pacientes ativos | definir “ativo” (não removido/falecido não basta para atividade) |
| Consultas hoje | estados incluídos e fuso da clínica |
| Ocupação | minutos agendados ÷ minutos disponíveis, por profissional, descontando bloqueios |
| Receita | recebido hoje ou mês; nunca usar “faturamento” sem período/regime |
| Inadimplência | saldo vencido, quantidade e aging; respeitar `view:financial` |
| Confirmações | confirmadas ÷ elegíveis do período |
| Faltas | faltas ÷ consultas esperadas; comparação com período anterior |

Nenhuma fórmula será inferida na camada visual. Se a query não existe, o item
fica como dependência de produto/dados, não como card vazio.

### Agenda operacional

- Mês continua como overview; semana/dia viram scheduler real com eixo de tempo,
  colunas por profissional, now-line e densidade configurável.
- Clique em espaço livre abre criação contextual já com data/hora/profissional.
- Clique em consulta seleciona e abre painel lateral com paciente, procedimento,
  status, recursos, notas e ações permitidas.
- Confirmar, check-in, falta e abrir paciente são quick actions. Edição de texto
  simples é inline; alteração complexa permanece no painel.
- Drag-and-drop só entra com detecção de conflito, alternativa de teclado,
  rollback e confirmação quando mudar profissional/dia. Não adicionar biblioteca
  de DnD sem aprovação e teste do contrato de disponibilidade.

### Pacientes como CRM clínico

- Lista: busca instantânea com debounce, filtros por estado operacional,
  profissional/último atendimento e tags **somente após schema confirmado**;
  paginação, ordenação e filtros persistidos na URL.
- Quick preview em desktop evita navegar para conferir telefone, alerta ou
  próxima consulta.
- Perfil: coluna esquerda fixa com identidade, contato, alertas, responsável e
  ações; coluna direita com timeline e módulos (Consultas, Prontuários,
  Documentos, Conversas, Financeiro, Consentimentos).
- View mode é padrão. “Editar” habilita o bloco relevante; ações destrutivas
  ficam separadas, com impacto explícito e confirmação consistente.

### Financeiro e Caixa

- Financeiro é ledger e análise: metric strip, cash trend, aging, projeções e
  tabela paginada com detail panel.
- Caixa é work queue: A receber, Parcial, Recebido hoje e A pagar como filtros
  segmentados da mesma superfície, não quatro pilhas.
- Receber/pagar continua inline; cancelamento e reembolso mostram saldo, método,
  transação de origem e efeito antes de confirmar.
- Virtualização só depois de paginação server-side e medição. Renderizar mais de
  200 linhas é o gatilho inicial de avaliação, não justificativa automática para
  dependência nova.

### Conversas, Configurações e LGPD

- Conversas desktop usam inbox split: fila à esquerda, thread ao centro,
  contexto/ações à direita quando houver largura; composer permanece visível.
- Configurações usam sidebar interna e `SettingsGroup`; cada seção mantém seu
  RSC/gate e salva apenas o bloco alterado.
- LGPD usa a mesma linguagem de inbox/work queue: tabela por SLA/status e painel
  do caso; histórico sob demanda e comunicação ao titular visível no contexto.

### Orçamento de interação

| Tarefa frequente | Hoje | Meta |
| --- | --- | --- |
| Ver detalhes de consulta na semana | navegar para o dia ou usar correção específica | 1 clique no evento, sem modal bloqueante |
| Criar consulta num horário visível | abrir drawer + preencher data/hora | 1 clique no slot + completar paciente/procedimento |
| Check-in / marcar falta | trocar para Consultório | ação disponível no contexto apropriado; no máximo 1 navegação |
| Encontrar paciente além dos 50 | impossível | busca/paginação direta |
| Conferir contexto completo do paciente | alternar cards/tabs e outras rotas | resumo imediato + 1 clique por módulo |
| Responder handoff em thread longa | rolar até o fim da página | composer sticky, sempre disponível |
| Confirmar recebimento no Caixa | abrir painel inline no card | manter 1 ação + confirmação dos dados no row/detail |
| Abrir seção de Configurações | hub/tab divergente, até 2 cliques | 1 clique na sidebar |

---

## Mapa canônico de componentes

Este mapa consolida o conteúdo que seria `ui-components-map.md`. “Depois” é o
padrão alvo; não significa que o componente já existe.

| Antes | Depois | Padrão adotado / justificativa UX |
| --- | --- | --- |
| `<Card>`, `<PanelCard>`, `.cardblock`, `.panel` | `<Card>` shadcn-compatible apenas para unidade isolada; `<Section>` sem chrome para agrupamento | reduz bordas e paddings duplicados; card deixa de ser layout universal |
| `<StatCard>` por métrica | `<MetricStrip>` + `<MetricItem>` | mais densidade, comparação e números tabulares sem mural de cards |
| `.stat-row`, grids `grid-cols-*` por página | composição responsiva ao container | evita fileira órfã e grid ativado pela largura errada |
| `.listrows/.listrow` | `DataList` para baixo volume ou kit de `Table` existente | uma semântica por tipo de dado; ações e seleção consistentes |
| `TableWrap/TableScroll/...` | preservar e compor como `DataTable` por rota | já resolve 11/11 overflows; não introduzir TanStack sem necessidade |
| filtros soltos em cada toolbar | `FilterBar`, chips ativos, “Limpar”, estado na URL | descoberta e reprodução de filtros; menos submits manuais |
| pager usado só em poucas telas | `TablePager` + contagem total em toda lista truncável | devolve acesso completo ao dado e posição “N–M de total” |
| `PageHeader` com ações ilimitadas | `PageHeader` em 3 zonas: contexto, título/descrição, 1 primária + 1 secundária | hierarquia em <3s; ações de navegação saem para subnav |
| `NavTabs` para até 10 destinos | `SecondaryNav` para 2–5 irmãos; `SettingsNav` vertical para Configurações | tabs não são índice de 11 seções; mantém deep links |
| hub de 11 cards em Configurações | redirect para primeira seção permitida + sidebar | elimina navegação duplicada e um clique |
| formulários dentro de Card | `FormSection` / `SettingsGroup` + `Separator` | largura de leitura controlada e menos chrome decorativo |
| `<Select>` nativo estilizado e 5 selects crus | shadcn/Radix `Select` para opções curtas; `Combobox` para busca | consistência e descoberta; native pode permanecer como exceção documentada quando beneficiar mobile |
| `confirm()` em 5 fluxos | `<ConfirmDialog>` existente; `AlertDialog` só se o preset justificar | evita dependência/duplicação e dá impacto, loading e foco consistentes |
| `Dialog` e `Drawer` atuais | preservar APIs shadcn-like e retematizar | Radix já resolve foco/portal; não instalar `Sheet` duplicado |
| toaster próprio | preservar e retematizar | já oferece feedback; não adicionar Sonner sem ganho/teste comprovado |
| `<EmptyState>` de ~200px | `EmptyState` `compact/default/full-page` | vazio interno não domina a tela; ação permanece contextual |
| `PageSkeleton` genérico | variantes por anatomia real da rota | reduz layout shift; quantidade/colunas espelham o destino |
| `Field` com `htmlFor` opcional | contrato `controlId` para controle; `FieldGroup` com legend para grupos | associação acessível sem clonar filho ou reutilizar id indevidamente |
| botão com `transition-all` + translate | propriedades explícitas + `active:scale-[.96]` | feedback tátil e animação barata/interrompível |
| controles só-ícone de 28–36px | `IconButton` visual compacto com hit area 40/44px e Tooltip | precisão no desktop, conforto touch e nome acessível |
| previews PDF duplicados | `DocumentViewer` compartilhado | corrige navegação, toolbar, tema, loading e erro uma vez |
| semana da Agenda feita de cards | `SchedulerGrid` específico do domínio | calendário shadcn genérico não resolve lanes, conflitos, recursos e estados clínicos |
| perfil do paciente em cards/tabs | `PatientWorkspace` + `Timeline` como composição de página | contexto persistente e menos navegação, sem criar primitivo global artificial |
| thread + ações empilhadas | `ConversationWorkspace` split | reply/handoff sempre alcançáveis; diagnóstico secundário recolhido |
| Caixa com `ItemCard` por transação | `CashQueue` + row/detail panel | escaneabilidade, filtro e ação inline sem perder confirmação contextual |

### Catálogo shadcn: adotar, adaptar ou não adicionar

| Componente do catálogo | Decisão | Condição |
| --- | --- | --- |
| Button, Card, Dialog, Dropdown Menu, Tabs, Checkbox, Switch, Tooltip, Popover, Skeleton | **adaptar os existentes** | manter contratos usados e aplicar tokens do preset |
| Alert Dialog | **reusar `ConfirmDialog` primeiro** | migrar apenas se semântica/a11y do AlertDialog trouxer ganho mensurável |
| Separator | **adotar** | base de FormSection/SettingsGroup; revisar diff do CLI |
| Select | **candidato a adotar** | exige nova dependência Radix; pedir confirmação antes e migrar por contexto |
| Sidebar | **não substituir shell inteiro** | aproveitar tokens/composições; preservar RBAC, handoff e identidade atuais |
| Sheet | **não adicionar** | Drawer existente já cumpre o papel |
| Scroll Area | **não é pré-requisito** | `overflow-x-auto/y-auto` nativo resolve tabs/sidebar; usar só com necessidade real |
| Command | **fase posterior** | depende de endpoint global autorizado e pode adicionar `cmdk` |
| Calendar | **não usar como scheduler** | pode servir a date picker; Agenda clínica continua bespoke |
| Data Table | **composição, não pacote** | kit atual + paginação server-side; virtualização só após medição |

Nenhuma dependência de produção é adicionada sem confirmação. O comando de
`init` será executado uma única vez, em mudança isolada, com backup/diff dos
arquivos que o CLI pretende tocar.

---

## UI/UX score por rota

Este quadro consolida o conteúdo que seria `ui-ux-score.md`.

- **Antes**: avaliação heurística baseada no código observado, ponderando
  descoberta (25%), eficiência da tarefa (25%), hierarquia (20%), consistência
  (15%) e feedback/performance percebida (15%).
- **Meta pós-plano**: target de aceite, **não resultado implementado**. Só vira
  “Depois” real após teste autenticado, responsivo, teclado e visual regression.

| Rota | Antes | Meta pós-plano |
| --- | ---: | ---: |
| `/dashboard` | 4,5/10 | 9,0/10 |
| `/agenda` | 4,5/10 | 9,2/10 |
| `/agenda/ausencias` | 5,5/10 | 8,5/10 |
| `/agenda/importar` | 6,0/10 | 8,0/10 |
| `/agenda/lista-espera` | 5,0/10 | 9,0/10 |
| `/consultorio` | 8,2/10 | 9,3/10 |
| `/pacientes` | 5,0/10 | 9,2/10 |
| `/pacientes/[id]` | 4,5/10 | 9,3/10 |
| `/pacientes/[id]/prontuarios/[pid]` | 7,5/10 | 9,0/10 |
| `/documentos` | 6,0/10 | 8,8/10 |
| `/modelos-receita` | 6,2/10 | 8,5/10 |
| `/financeiro` | 5,0/10 | 9,2/10 |
| `/financeiro/fornecedores` | 6,5/10 | 8,5/10 |
| `/caixa` | 4,8/10 | 9,2/10 |
| `/conversas` | 7,8/10 | 9,2/10 |
| `/conversas/[id]` | 5,8/10 | 9,2/10 |
| `/relatorios` | 4,8/10 | 8,8/10 |
| `/equipe` | 7,5/10 | 9,0/10 |
| `/configuracoes` | 4,0/10 | 9,0/10 |
| `/configuracoes/agente` | 6,5/10 | 8,8/10 |
| `/configuracoes/assinatura` | 7,4/10 | 9,0/10 |
| `/configuracoes/auditoria` | 6,0/10 | 8,5/10 |
| `/configuracoes/horarios` | 6,0/10 | 8,8/10 |
| `/configuracoes/lgpd` | 4,2/10 | 9,2/10 |
| `/configuracoes/perfil` | 5,0/10 | 8,8/10 |
| `/configuracoes/procedimentos` | 6,0/10 | 8,7/10 |
| `/configuracoes/recursos` | 5,5/10 | 8,5/10 |
| `/configuracoes/sugestoes` | 6,0/10 | 8,3/10 |
| `/configuracoes/whatsapp` | 5,0/10 | 9,0/10 |
| `/account/security` | 5,5/10 | 9,0/10 |
| `/` | 9,0/10 | 9,0/10 |
| `/login` | 7,5/10 | 9,0/10 |
| `/login/mfa` | 5,0/10 | 8,8/10 |
| `/reset-password` | 6,5/10 | 8,8/10 |
| `/auth/auth-error` | 6,5/10 | 8,5/10 |
| `/convite` | 6,0/10 | 8,8/10 |
| `/join` | 6,8/10 | 8,8/10 |
| `/join/[token]` | 7,8/10 | 9,0/10 |
| `/documentos/[id]/pdf` | 3,5/10 | 8,8/10 |
| `/prescricoes/[id]/pdf` | 3,5/10 | 8,8/10 |
| `/admin` | 4,5/10 | 9,0/10 |
| `/admin/clinicas` | 7,5/10 | 9,0/10 |
| `/admin/clinicas/[id]` | 5,5/10 | 8,8/10 |
| `/admin/billing` | 5,0/10 | 9,0/10 |
| `/admin/audit` | 7,0/10 | 8,8/10 |
| `/admin/metricas` | 5,5/10 | 8,7/10 |
| `/admin/saude` | 6,5/10 | 8,8/10 |
| `/admin/conversas-ia` | 6,5/10 | 9,0/10 |
| `/admin/feedbacks` | 6,5/10 | 8,8/10 |
| `/admin/feedbacks/[id]` | 7,0/10 | 8,8/10 |
| `/admin/config` | 5,0/10 | 8,7/10 |

Média heurística: **5,90/10 antes → meta 8,87/10**. A meta não é arredondada
para 10 porque produto enterprise sempre conserva trade-offs de segurança,
densidade e confirmação.

O score não substitui teste de tarefa. Para cada rota migrada, registrar tempo,
cliques, taxa de erro e entendimento do primeiro passo com a persona principal.

---

## Matriz de prioridades

| Ordem | Achado | Impacto | Esforço | Alcance | Por que entra aqui |
| ---: | --- | --- | --- | --- | --- |
| 1 | P-26 · links de retorno PDF inválidos | **P0** | baixo | 2 rotas | bloqueia tarefa clínica; correção independente de design |
| 2 | P-27 · Admin mostra zero em timeout | **P0** | médio | `/admin` | risco de decisão baseada em dado falso |
| 3 | P-12 · listas inacessíveis após 50/100 | **P0** | médio/alto | 4 módulos | produtividade e acesso a dado antes de estética |
| 4 | P-17 · contrato label/controle incompleto | **P1** | médio | 44 casos a classificar | acessibilidade e erro de formulário |
| 5 | P-13 · 5 confirmações nativas | **P1** | baixo | 4 módulos | risco clínico/operacional; componente já existe |
| 6 | P-35 · loading/skeleton divergente | **P1** | médio | global | reduz blank screen e layout shift |
| 7 | P-34 · breakpoint por viewport | **P1** | médio | shell/workspaces | corrige tablet/desktop estreito e ultrawide |
| 8 | P-28 · Agenda não é scheduler | **P1** | alto | Agenda | maior ganho diário de cliques/tempo |
| 9 | P-29 · Pacientes ainda não é CRM | **P1** | alto | Pacientes | concentra contexto clínico e reduz navegação |
| 10 | P-30 · Caixa em pilha ilimitada de cards | **P1** | alto | Financeiro | escala e velocidade operacional |
| 11 | P-32 · LGPD cards + N+1 | **P1** | médio/alto | Configurações | SLA, conformidade e custo de query |
| 12 | P-33 · thread e ações empilhadas | **P1** | médio | Conversas | responder handoff sem rolagem |
| 13 | P-31 · Configurações divergentes | **P1** | alto | 11 destinos | descoberta, consistência e redução de 1 clique |
| 14 | P-01/P-03 · quatro cards + CSS paralelo | **P1** | alto | global | fundação para não repetir dívida em cada tela |
| 15 | P-08/P-09 · Dashboard vazio/KPI órfão | **P1** | médio | Dashboard | leitura executiva em três segundos |
| 16 | P-37/P-21 · marca e conteúdo divergentes | **P2** | baixo | global | confiança/percepção de produto único |
| 17 | P-36 · motion e hit areas sem política | **P2** | médio | global | conforto, reduced motion e polish consistente |
| 18 | P-20 · viewers PDF fora do DS | **P2** | baixo | 2 rotas | tema, responsividade e estado de erro |
| 19 | P-14 · empty states divergentes | **P2** | baixo | global | densidade e feedback uniforme |
| 20 | P-22 · selects inconsistentes | **P2** | médio | formulários | migrar por contexto, sujeito a dependência aprovada |
| 21 | P-25 · matriz responsiva não testada | **P2** | médio | global | gate objetivo para cada onda |
| 22 | P-38 · recuperação de senha oculta | **P1** | indefinido | Auth | depende de confirmar contrato/backend; não inventar UI |
| 23 | P-16 · busca global | **P3** | alto | global | feature separada; só após endpoints e RBAC |
| 24 | P-24 · tema “sistema” | **P3** | baixo | global | preferência, não bloqueia produtividade |

---

## Plano de implementação priorizado — canônico

O plano segue impacto × esforço e o orçamento arquitetural documentado do
produto: cada PR tem objetivo único, idealmente ≤25 arquivos, ≤1.500 linhas e no
máximo dois contextos. Refatoração ampla, dependência de produção, mudança de
contrato de query e execução do `shadcn init` exigem confirmação antes.

### Gate A — baseline e preset, sem redesign

1. Capturar screenshots autenticados do estado atual em 390×844, 768×1024,
   1440×900 e 2560×1440, light/dark, nas rotas críticas.
2. Rodar navegação por teclado e axe nas rotas críticas e registrar PASS/FAIL.
3. Decodificar `b5J5Qtmtc`; registrar style/base/theme/font/radius/menu/icons.
4. Executar `shadcn init` apenas em mudança isolada e revisar o diff antes de
   aceitar qualquer arquivo. Lucide permanece obrigatório.
5. Fechar contratos ambíguos: Paciente ativo, Ocupação, Receita, Inadimplência,
   Confirmação, Faltas e recuperação de senha.

**Saída:** baseline visual/testável + tokens confirmados. Nenhuma tela muda.

### Onda 0 — confiança e acesso a dados

1. P-26: corrigir os dois retornos de PDF e adicionar teste de rota/link.
2. P-27: substituir KPI zero por estado unavailable/stale no Admin, com teste de
   timeout e retry.
3. P-12: desenhar/autorizar contrato de paginação e contagem; implementar uma
   lista por PR, começando por Pacientes, depois Financeiro, Documentos e
   Ausências.
4. Corrigir as strings P-21/P-37 de maior exposição sem misturar redesign.

**Aceite:** nenhum beco clínico, nenhum zero falso e todo limite visível possui
caminho para acessar o restante.

### Onda 1 — fundação visual e acessibilidade

1. Integrar os tokens confirmados de `b5J5Qtmtc` por aliases/compatibilidade, sem
   substituir o `globals.css` inteiro.
2. Criar `components.json` válido gerado pelo CLI; adicionar somente Separator
   e componentes sem dependência nova aprovados no gate.
3. Evoluir PageHeader, MetricStrip, FormSection/SettingsGroup, EmptyState,
   skeletons e layouts por largura útil.
4. Classificar os 44 Fields sem `htmlFor`; corrigir controle simples vs grupo e
   adicionar testes de nome acessível.
5. Migrar as cinco confirmações nativas para ConfirmDialog existente.
6. Definir reduced motion global, transições explícitas e hit areas.

**Aceite:** foundations light/dark e teclado aprovadas numa rota-piloto; nenhum
componente duplicado ou dependência não autorizada.

### Onda 2 — Dashboard, Agenda e ajuste do Consultório

1. Dashboard: remover “em breve”, implementar MetricStrip e filas usando apenas
   métricas com contrato fechado.
2. Agenda em slices: navegação/toolbar → detail panel → quick actions →
   scheduler dia/semana → drag-and-drop opcional por último.
3. Consultório: preservar board; corrigir container breakpoint, sticky context e
   confirmação de encerramento.
4. Ausências, lista de espera e importação adotam tabela/fila/progresso comuns.

**Aceite:** tarefas críticas dentro do orçamento de interação; collision,
permissão e teclado testados; nenhuma regressão na máquina de estados.

### Onda 3 — CRM de Pacientes e Documentos

1. Pacientes: paginação + busca/filtros URL + carregamento sob demanda dos
   responsáveis.
2. Perfil: summary rail + timeline e view/edit por seção, preservando
   consentimento, relação, óbito, LGPD e permissões clínicas.
3. Prontuário: sticky status/autosave/sign sem alterar imutabilidade.
4. DocumentViewer compartilhado e Documentos paginado/filtrável.

**Aceite:** funcionalidade rastreada 1:1, nenhum dado clínico exposto por layout
ou fetch novo, e fluxo completo acessível por teclado.

### Onda 4 — Financeiro e Caixa

1. Financeiro: metric strip, ledger paginado, aging/detail panel; projeções só
   com contrato real.
2. Caixa: trocar cards por CashQueue, manter pagamento/cancelamento/reembolso
   inline/contextual e otimista apenas com rollback seguro.
3. Fornecedores: busca e padrão de edição consistente.
4. Medir volume/performance antes de propor virtualização/dependência.

**Aceite:** totais e saldos reconciliam com o backend; ações idempotentes e
permissões preservadas; zero arredondamento/regressão financeira.

### Onda 5 — Configurações, LGPD, WhatsApp, IA e Equipe

1. SettingsNav interna, redirect do hub e mapa de grupos aderente às rotas reais.
2. Migrar uma seção por PR para SettingsGroup; Perfil separa clínica de
   profissional.
3. LGPD vira work queue + case panel e remove N+1 carregando histórico on demand.
4. WhatsApp preserva estados de saúde/Meta e remove ilha de inline CSS.
5. Agente, Horários, Procedimentos, Recursos, Assinatura, Segurança e Sugestões
   convergem sem duplicar `/equipe` ou `/financeiro`.

**Aceite:** todos os 11 destinos atuais alcançáveis conforme permissão, sem hub
duplicado, categoria vazia ou mudança em gate server-side.

### Onda 6 — Conversas, Relatórios, Auth e Onboarding

1. Inbox/thread split com composer sticky e diagnóstico recolhido.
2. Relatórios com comparativos/drill-down baseados em dados existentes.
3. Modelos e demais CRUDs convergem aos componentes canônicos.
4. Auth/convite recebem fallback, marca Qoro e recuperação somente após contrato.
5. Onboarding migra tokens/componentes sem reescrever saga, checkout ou
   separação de identidades de cobrança.

### Onda 7 — Admin e remoção de legado

Migrar Admin por rota, começando por confiança de dados, billing e work queues.
Remover `.cardblock/.listrow/.panel` somente depois do último consumidor
confirmado. `admin.css`, `app-shell.css` e `ds.css` são reduzidos/deletados por
evidência de zero uso, nunca em big-bang.

### Definition of Done por PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Além do ciclo verde: teste focado do comportamento novo, E2E da rota quando
aplicável, quatro viewports, light/dark, teclado, contraste/axe, revisão do diff e
tabela de rastreabilidade de ações. Se uma etapa não puder ser executada, marcar
explicitamente `NOT TESTED` ou `BLOCKED`.

---

## Plano de implementação inicial — arquivado

> Mantido como histórico da auditoria de 2026-08-19. Está substituído pelo plano
> canônico acima, usa o preset anterior e contém estimativas que não devem guiar
> implementação.

<details>
<summary>Exibir plano histórico substituído</summary>


Sete fases. Cada uma termina **verde** (`pnpm lint && pnpm typecheck && pnpm test
&& pnpm build`) e é entregável isoladamente. Não há big-bang.

### Fase 0 — Adoção do preset

**É a fase que muda o visual.** Ao contrário do resto do plano, o resultado aqui
é imediatamente perceptível em todas as telas — por isso vai isolada, em branch
própria, com revisão visual antes de qualquer outra fase.

1. Renomear `--accent` → `--brand-accent` e atualizar os consumidores
   (`bg-accent`, `text-on-accent`, `--ai*`). **Passo isolado** — libera `--accent`
   para o significado shadcn e mantém o orchid vivo alimentando o marcador de IA.
2. Re-derivar `--neutral-*` (13 passos, zinc hue 286) e `--primary-*` (11 passos,
   blue do preset). Re-ancorar `--danger-*` em `--destructive`.
3. Aplicar o remap de valores nos semânticos (`--bg`, `--surface`, `--text`,
   `--border`, `--ring`, `--viz-*`) em `:root` e `.dark`.
4. `--font-sans` → Inter; remover Hanken Grotesk do root layout.
5. Ajustar `--r-sm` 5→6 e `--r-md` 7→8.
6. Adicionar a camada de alias shadcn em `:root` e `.dark`.
7. Criar `components.json` (`style: nova`, `baseColor: zinc`, `iconLibrary:
   lucide`), com `utils` apontando para o `cn()` existente.
8. `pnpm dlx shadcn@latest init` **sem `--template`**, validando que o CLI não
   sobrescreve o `globals.css`.
9. Instalar 1 componente de teste (`separator`) e confirmar que herda o tema.
10. Criar `--page-maxw`, `--page-px`, `--page-pt`, `--page-pb`; remover
    `--content-maxw`, `--maxw`, `--stack`.

**Aceite:** app inteiro em zinc + blue do preset, sem nenhuma variável indefinida;
marcador de IA ainda orchid; `separator` do CLI visualmente idêntico aos
primitivos existentes; suíte verde.

**Revisão visual obrigatória** antes de seguir: `/dashboard`, `/agenda`,
`/pacientes`, `/conversas` (IA), `/configuracoes` — nos dois temas.

### Fase 1 — Correções de alto impacto e baixo custo

Ganho imediato, superfície pequena, independentes entre si.

1. **P-17** — `useId()` em `Field` (1 arquivo, corrige 48 campos).
2. **P-13** — `alert-dialog` + `<DestructiveAction>`; migrar os 5 `confirm()`.
3. **P-18** — `overflow-x-auto` em `NavTabs`.
4. **P-19** — `focus-visible:` em `input.tsx`.
5. **P-21** — correções de acentuação.
6. **P-20** — tokens nas 2 páginas de PDF.
7. **P-11 / P-07** — `pb` e `max-w` do shell.

**Aceite:** 0 `window.confirm()` no código; 109/109 campos com label associada.

### Fase 2 — Primitivos e shell

1. `PageHeader` para a escala de tipografia (P-05) + regra de máx. 2 ações.
2. `Card` unificado; `PanelCard` vira `<Card variant="panel">`.
3. `EmptyState` reduzido + variante `compact` (P-10).
4. `<KpiRow>`, `<FormSection>`, `<ListRow>`, `<DestructiveAction>`.
5. `select` (Radix) substituindo o nativo (P-22).
6. `scroll-area` na sidebar.

**Aceite:** um só componente por conceito; `PanelCard` e `.stat-tile` sem usos.

### Fase 3 — Telas de maior impacto

Ordem por valor operacional:

1. **`/configuracoes`** — sidebar interna, 4 grupos, hub removido, `loading.tsx`
   nas 10 subrotas. É o maior ganho isolado do plano.
2. **`/pacientes` + `/pacientes/[id]`** — **P-12** (paginação), desfragmentar a
   ficha, `loading.tsx`.
3. **`/dashboard`** — P-08, P-09, P-14; a dobra passa a mostrar KPI + gráfico +
   próximos.
4. **`/financeiro` + `/caixa`** — P-09, P-12; quebrar `caixa-view.tsx` (605L).

**Aceite:** `/configuracoes` navegável só pela sidebar, 12 seções alcançáveis;
listagens paginadas com "N de M".

### Fase 4 — Módulos restantes

`/agenda` (+3 sub-rotas, nav secundária), `/consultorio`, `/conversas/[id]`,
`/documentos`, `/relatorios`, `/modelos-receita`, `/equipe`, `/join`.

**Aceite:** 0 usos de classe do `app-shell.css` no painel tenant.

### Fase 5 — Admin

Migrar `.cardblock` (35), `.listrow` (18), `.stat-tile` para os primitivos.
**Deletar `admin.css` (672 linhas)** e as classes de shell agora órfãs.

**Aceite:** `admin.css` removido; `app-shell.css` reduzido ao que o shell usa.

### Fase 6 — Polish

1. `Command` ⌘K global (P-16).
2. Ativar `[data-density]` com seletor em preferências (P-06).
3. Tema tri-estado com `prefers-color-scheme` (P-24).
4. Varredura de a11y: `aria-current` na sidebar, `Tooltip` em botões só-ícone.
5. Micro-interações usando os tokens de motion que já existem.
6. Decidir sobre os primitivos mortos (P-02): usar ou deletar.
7. Avaliar remoção do `ds.css` — os 2.106 linhas são majoritariamente do
   showcase `DSv2.html`; **auditar antes de deletar**.

---

## Ordem de migração histórica — substituída

> O diagrama abaixo pertence ao plano inicial arquivado. A sequência vigente é
> Gate A → Ondas 0–7 no plano canônico.

```
Fase 0 ─ tokens ─────────────┐
                             ├─→ Fase 2 ─ primitivos ──┐
Fase 1 ─ quick wins ─────────┘                          ├─→ Fase 3 ─ telas A
                                                        │      │
                                                        │      ├─→ Fase 4 ─ módulos
                                                        │      │
                                                        │      └─→ Fase 5 ─ admin
                                                        └─────────→ Fase 6 ─ polish
```

Fase 1 não depende da Fase 0 (são correções pontuais) e pode entrar em paralelo —
é o caminho mais curto para valor visível.

Dentro da Fase 3, **`/configuracoes` primeiro**: é a tela mais criticada, a mais
isolada (não é caminho operacional crítico) e a que valida os padrões novos com
menor risco de interromper a operação da clínica.

---

</details>

## Dependências e gates atuais

| Trabalho | Depende de | Por quê |
| --- | --- | --- |
| Preset `b5J5Qtmtc` | decode + diff isolado do CLI | composição atual não foi verificada; não usar valores do preset anterior |
| Componente shadcn novo | aliases/tokens válidos | componente de registry deve herdar tema sem duplicar contrato existente |
| Select/Command/Calendar/virtualização/DnD | confirmação de dependência de produção | AGENTS.md exige autorização; benefício precisa ser medido |
| Paginação P-12 | query paginada + `count` sob tenant | UI não consegue fabricar total nem alcançar rows ausentes |
| KPIs do Dashboard | definição de fórmula/período + permissão | evita métrica bonita, mas semanticamente falsa |
| Scheduler drag-and-drop | collision/state machine/idempotência/teclado | mover consulta não é gesto puramente visual |
| Timeline do paciente | contratos cross-context seguros | não criar JOIN/fetch que amplie exposição clínica/tenant |
| SettingsNav | mapa de rota/permissão atual | navegação continua UX, nunca barreira de segurança |
| Recuperação de senha | contrato real de solicitação/envio | não prometer e-mail ou endpoint inexistente |
| Busca global | endpoints autorizados por entidade | resultado cross-context precisa respeitar RBAC e tenant |
| Remoção de CSS legado | zero consumidores confirmado por busca/build/visual | folhas são compartilhadas entre tenant/admin/join |

> **P-12 não é “só frontend”.** Paginar exige `count` total e cursor/offset nas
> queries de Patients, Documents, Financial e Absences. Cada contrato deve ser
> aprovado e testado sob tenant antes da respectiva UI.

---

## Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| `shadcn init` sobrescrever tokens/aliases/deps | **alta** | mudança isolada, working tree conhecido, revisar diff e restaurar só via patch consciente |
| Inferir `b5J5Qtmtc` a partir do preset anterior | **alta** | decode obrigatório; valores históricos estão bloqueados |
| Métricas/timeout exibirem dado enganoso | **alta** | fórmulas versionadas, unavailable/stale explícito, teste de fallback |
| Agenda violar máquina de estados ou disponibilidade | **alta** | slices pequenos, testes de collision/permissão/idempotência e alternativa de teclado |
| CRM ampliar exposição de dados clínicos | **alta** | manter gates server-side, contratos por contexto e teste cross-tenant |
| Financeiro alterar saldo/arredondamento | **alta** | reconciliar totais, testes monetários e zero mudança de regra no redesign |
| Onboarding confundir clínica, owner e titular do cartão | **alta** | preservar identidades e saga; migrar somente apresentação |
| WhatsApp parecer saudável durante falha Meta | **alta** | preservar health verdict, timestamps e estados degradados existentes |
| Densidade reduzir legibilidade | média | remover vazio/chrome, não fonte; validar 1280×800 e uso contínuo |
| Breakpoint de viewport apertar workspace | média | container queries/medição de largura útil e quatro viewports |
| CSS legado removido antes do último consumidor | média | busca + build + screenshots pareados por folha/regra |
| Nova dependência criar dois componentes equivalentes | média | mapa canônico e confirmação prévia; adaptar antes de adicionar |
| Escopo virar big-bang | média | orçamento por PR e vertical slice verde/revisável |

---

## Critérios de aceitação

### Gate do preset

- [ ] `b5J5Qtmtc` decodificado; composição anexada a este documento
- [ ] comando solicitado executado em mudança isolada e diff revisado antes de
      aceitar alterações
- [ ] `components.json` válido para o CLI atual; aliases apontam para os helpers
      e caminhos existentes
- [ ] Lucide permanece `iconLibrary`; nenhuma biblioteca duplicada
- [ ] `globals.css` atual não foi substituído cegamente; tokens legados continuam
      definidos durante a migração
- [ ] nenhuma variável CSS indefinida em runtime
- [ ] contraste WCAG AA medido em light/dark, incluindo muted text, borders,
      focus ring, status e gráficos
- [ ] screenshots pareados aprovados nas rotas críticas e quatro viewports

### Estruturais (verificáveis por busca)

- [ ] busca por `confirm(` em UI → 0 fluxos nativos
- [ ] 44 Fields classificados; controle simples associado e grupo nomeado por
      `legend`/`aria-labelledby`
- [ ] nenhum `transition-all` em componente migrado
- [ ] cada conceito usa a implementação do mapa canônico; duplicação nova → 0
- [ ] quatro modos de layout disponíveis sem `max-width` universal
- [ ] CSS legado só é removido após zero consumidores e screenshot pareado
- [ ] `components.json` existe e `utils` aponta para `@/lib/ui/cn`

### Funcionais

- [ ] Nenhuma rota removida; nenhuma ação inacessível
- [ ] Toda tela reorganizada tem tabela de rastreabilidade de ações
- [ ] links dos dois viewers retornam para uma rota existente
- [ ] timeout do Admin nunca vira KPI zero sem rótulo de indisponibilidade
- [ ] `/configuracoes`: 11 destinos atuais alcançáveis conforme permissão
- [ ] toda listagem limitada indica total e oferece paginação/cursor até o fim
- [ ] toda ação destrutiva usa confirmação temática com consequência explícita
- [ ] toda transição RSC relevante tem o boundary de loading mais próximo;
      nenhum `fallback={null}` produz tela vazia
- [ ] Filtro de navegação por permissão preservado, com a nota de que é UX e não
      barreira de segurança
- [ ] máquinas de estado de Agenda/Consultório, RBAC, tenant isolation, autosave,
      faturamento e onboarding não mudam sem teste/contrato específico

### Visuais

- [ ] Um componente por conceito (card, empty, header, toolbar, confirmação)
- [ ] Nenhum card usado só como decoração
- [ ] Nenhum `EmptyState` aninhado dentro de card sem variante `compact`
- [ ] KPI sem fileira órfã em 1280, 1440, 1920 e 2560px
- [ ] workspaces respondem à largura útil com sidebar aberta
- [ ] dobra em 1440×900 mostra nível 2 e início do conteúdo operacional
- [ ] nenhum formulário/texto é esticado só para ocupar ultrawide

### Dark mode

- [ ] Nenhuma cor crua de paleta (`gray-`, `amber-`, `red-`) em `src/app`
- [ ] Toda superfície nova legível nos dois temas
- [ ] Bordas visíveis no dark em tabelas, dialogs e cards
- [ ] gráficos/status não dependem apenas de cor

### Acessibilidade

- [ ] 100% dos campos com label associada
- [ ] foco visível em todo controle interativo; inputs podem manter ring em
      `focus`, botões usam `focus-visible`
- [ ] Todas as tabs/itens de nav alcançáveis por teclado em qualquer viewport
- [ ] Botões só-ícone com `aria-label` ou `Tooltip`
- [ ] `aria-current` no item ativo da sidebar e das tabs
- [ ] reduced motion cobre todos os keyframes de UI
- [ ] erros/sucessos importantes anunciados por região live adequada

### Performance percebida

- [ ] skeleton reproduz a anatomia/contagem final e não causa layout shift
- [ ] LGPD não executa uma query de histórico por card no carregamento inicial
- [ ] Pacientes não carrega 200 candidatos com drawer fechado
- [ ] Caixa não renderiza uma lista ilimitada de cards
- [ ] otimista aplicado apenas onde existe idempotência, rollback e feedback de
      falha; refresh integral permanece onde for mais seguro

---

## Testes necessários

Somente scripts que **já existem** no `package.json`.

### Build e estático — a cada fase

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm build
```

```bash
pnpm format:check
```

### Unitários — a cada fase

```bash
pnpm test
```

O checkout contém 249 arquivos `*.test/spec.ts(x)` e 47 specs E2E. O total de
casos aprovados deve ser capturado novamente no início da implementação; esta
auditoria docs-only não reivindica um baseline verde atual.

Cobertura de UI existente a manter verde: `button.test.tsx`, `use-toast.test.tsx`,
`use-action-feedback.test.tsx`, `admin-nav.test.tsx`, `handoff-watcher.test.tsx`,
`whatsapp-connect.test.tsx`, `horarios-manager.test.tsx`, `caixa-view.test.tsx`,
`prontuario-editor.test.tsx`.

**Testes novos a escrever:**

| Alvo | Teste |
| --- | --- |
| `Field` / `FieldGroup` | associa controle simples e nomeia grupo sem ids duplicados |
| `ConfirmDialog` + 5 fluxos | cancelar não muta; confirmar preserva payload/loading |
| `MetricStrip` | números tabulares, comparação e layout por container |
| `SettingsNav` | destino ativo, permissão e mobile navigation |
| `PageSkeleton` | anatomia/contagem coincide com cada rota crítica |
| `DocumentViewer` | retorno válido, loading, erro e download |
| Admin fallback | timeout renderiza indisponível/stale, nunca zero factual |
| Paginação | total, limites, próxima/anterior e isolamento por tenant |

### E2E — por onda de tela

```bash
pnpm test:e2e
```

47 specs. Os de navegação e mutação são os que mais tocam UI:
`login-and-navigation.spec.ts`, `authenticated-readonly-routes.spec.ts`,
`mutation-flows.spec.ts`, `production-authorized-mutations.spec.ts`.

> **Nota operacional:** `E2E_AUTH_REUSE=1` é opcional para o login normal e deve
> ser usado quando a execução precisa reutilizar uma sessão autenticada, em
> especial em auditorias amplas/remotas para reduzir login repetido e rate limit.
> Quando habilitado, o storage state precisa ter identidade e validade verificadas;
> uma sessão envelhecida pode redirecionar para `/login` e parecer regressão de UI.

**Especificações E2E novas:**

| Cenário | Fase |
| --- | --- |
| `/configuracoes`: 11 destinos atuais alcançáveis conforme permissão | Onda 5 |
| Ação destrutiva abre confirmação e cancelar não muta | Onda 1 |
| Listagem paginada navega até o final e mostra total | Onda 0 |
| Agenda quick actions e conflito por teclado/pointer | Onda 2 |
| Caixa receber/cancelar/reembolsar preserva saldo e idempotência | Onda 4 |
| Auth nunca usa blank fallback e mantém retorno seguro | Onda 6 |

### Responsividade — infraestrutura a adicionar

[playwright.config.ts:70](<playwright.config.ts:70>) hoje define **apenas**
`chromium` / Desktop Chrome. Adicionar projetos:

| Projeto | Device | Cobertura |
| --- | --- | --- |
| `desktop` | Desktop Chrome 1440×900 | atual |
| `tablet` | iPad (Pro) 768px | sidebar→drawer, tabs com scroll |
| `mobile` | Pixel 7 / 393px | toolbar empilhada, tabelas com scroll |
| `ultrawide` | Desktop Chrome 2560×1440 | largura útil, multi-coluna e leitura não esticada |

### Visual

Não há infraestrutura de screenshot no projeto hoje. Proposta **mínima**, sem
adicionar dependência: usar `page.screenshot()` do Playwright já instalado, em
spec dedicado, capturando antes/depois por tela migrada nos 4 viewports. Comparação
manual na revisão — regressão visual automatizada fica como decisão separada.

### Acessibilidade

Sem dependência nova, verificação manual roteirizada por tela migrada:

- [ ] `Tab` percorre a página em ordem lógica, sem armadilha de foco
- [ ] Anel de foco visível em todo controle
- [ ] Clicar no rótulo foca o campo
- [ ] `Esc` fecha dialog/drawer e devolve o foco ao gatilho
- [ ] Leitor de tela anuncia rótulo e erro dos campos

Adotar `@axe-core/playwright` cobriria contraste e ARIA automaticamente — **é uma
dependência nova e fica como decisão à parte**, não pressuposta por este plano.

### Regressão

```bash
pnpm arch:check
```

Detecta ciclos de importação — relevante ao introduzir componentes compartilhados
(`FormSection`, `MetricStrip`, `SettingsNav`, `DocumentViewer`).

---

## Anexo — comandos de verificação da auditoria

Reproduzem os números deste documento.

```powershell
@(rg --files src/app | Where-Object { $_ -match 'page\.tsx$' }).Count
```

```powershell
rg -n '<Card|<PanelCard|<StatCard|cardblock' src/app -g '*.tsx'
```

```powershell
rg -o 'text-\[[0-9.]+px\]' src/app src/components -g '*.tsx' | Sort-Object -Unique
```

```powershell
rg -o '\bgap-[0-9]+(\.[0-9]+)?\b' src/app src/components -g '*.tsx' |
  Group-Object | Sort-Object Count -Descending
```

```powershell
rg -n --pcre2 '(?<![\w.])confirm\s*\(' src/app src/components -g '*.tsx'
```

```powershell
@(rg --files src/app | Where-Object { $_ -match 'loading\.tsx$' }).Count
```

O total de Fields sem `htmlFor` foi obtido sobre a opening tag completa
(multiline) e depois classificado manualmente; uma busca linha a linha não
reproduz esse número com segurança.

---

## Checkpoint de implementação controlada — 2026-08-20

> Evidência viva e comandos completos: `ui-redesign-implementation.md`.
> Branch observada: `ui-redesign-controlled`. Nenhum merge, push, deploy,
> migration ou mutação externa foi executado.

### Decisões confirmadas do preset

- `b5J5Qtmtc` decodifica para Nova, zinc, blue, charts sky, DM Sans, radius
  medium e menu default/subtle; o código não carrega a base de primitives;
- Radix deve ser declarado explicitamente; Lucide permanece o override
  obrigatório. O equivalente do preset com somente esse override é
  `b5J5QtEnY`;
- `components.json` usa `style: "radix-nova"`, CSS em `src/app/globals.css` e o
  helper existente `@/lib/ui/cn`;
- o `init --template next` não foi executado no repositório, pois sobrescreveria
  botão, tokens, layout/fontes e instalaria dependências. Tokens foram integrados
  por diff controlado e cobertos por teste;
- o scaffold live continua `BLOCKED`: a sandbox negou acesso ao registry. A
  compilação processou CSS/Tailwind e parou apenas no download de DM Sans por
  `next/font` (`EACCES` após três tentativas). Fonte local depende de autorização
  para nova dependência de produção.

### Resultado implementado até este checkpoint

| Superfície | Antes | Depois | Estado |
| --- | --- | --- | --- |
| Pacientes, Financeiro, Documentos e Ausências | limites silenciosos de 50/100 | paginação/count server-side, total real, URL, ordem determinística e tenant explícito | `PASS` |
| Ações destrutivas | cinco `confirm()` nativos | `ConfirmDialog`/`DestructiveAction`, pending, cancelamento sem mutação, erro/retry e bloqueio de duplo envio | `PASS` |
| Fields | 40 controles simples sem associação e 4 grupos sem semântica | 111 simples com `htmlFor/id` e 4 `fieldset/legend`; zero restante nos 115 Fields atuais | `PASS` |
| Dashboard | mural com dois painéis “em breve” e auto-link Atualizar | métricas primeiro, conteúdo real, vazios compactos e nenhum fetch/HTML sensível sem RBAC | `PASS` |
| KPIs | cinco cards soltos com fileira órfã | `MetricStrip` único com auto-fit pela largura útil | `PARTIAL` global |
| Shell | `max-w-330` universal e 64 px de rodapé | modos workspace/data/form/read, tokens de página e 32 px de rodapé | `PASS` estrutural |
| Configurações | dez tabs incompletas + hub de onze cards | sidebar interna agrupada, todos os destinos reais permission-aware e redirect do hub | `PARTIAL` |
| Empty states | ~200 px e tratamentos divergentes | default reduzido + variante contextual `compact` | `PASS` no componente/Dashboard |
| Loading | 12/51 rotas efetivamente cobertas | 17/51; 15 loaders e teste contra skeleton errado/mascaramento de 404 | `PARTIAL` |
| Movimento e toque | cinco `transition-all`, sem política global | transições por propriedade, reduced motion e alvo 40 px/44 px touch | `PASS` estrutural |
| Tema | somente light/dark | light/dark/system, reação ao SO e anti-FOUC | `PASS` automatizado |
| PDF | tokens cinza fixos, botões filhos crus e retorno clínico inválido | páginas e regeneração usam tokens/`Button`/`Alert`; retorno para `?tab=prontuarios` | `PASS` |
| Agenda | quatro links misturavam navegação e ações; controles pequenos e sem agrupamento semântico | tabs de subrota, toolbar temporal, uma ação primária + menu contextual, teclado/RBAC e alvos 40/44 px | `PARTIAL` |
| Conversa individual | thread longa empurrava resposta e atendimento abaixo da dobra; diagnóstico repetido por mensagem | rail de atendimento prioritário no DOM, sticky no desktop, composer visível e diagnóstico recolhido | `PARTIAL` |
| Login e Convite | `Suspense fallback={null}` podia produzir tela totalmente vazia | fallback anatômico compartilhado, `aria-busy`, Logo Qoro e Lucide no controle de senha | `PASS` para blank fallback |
| Relatórios | KPIs em cards separados, período misturado às ações e valor de ocupação fora da escala | `MetricStrip` responsivo, período em toolbar própria, valores tabulares e volume em uma única seção semântica | `PASS` na rota |
| LGPD | `1 + N` queries e um card grande com formulários/histórico para cada caso | work queue tabular; zero histórico no carregamento e uma leitura somente no detalhe tenant-validado | `PARTIAL` |
| Paciente individual | cadastro longo e contexto clínico disperso | CRM em duas colunas, edição inline, contatos diretos e rail com apenas os 8 prontuários recentes + documentos reais | `PARTIAL` |
| Caixa | pilha crescente de cards por transação | work queue tabular com filtros, contexto financeiro, ações e paginação local | `PARTIAL` |
| WhatsApp | 31 estilos inline, 12 refs legadas e estados pouco diferenciados | primitives canônicos, zero inline/legado na tela, health completo e loading acessível | `PASS` na rota |
| Admin | `cardblock/listrow/panel` em dashboard, config e clínica | zero consumidores dessas classes em todo `src/app/(admin)`; métricas/listas/seções canônicas | `PASS` estrutural |
| Recovery/Auth | Login sem descoberta e MFA sem saída segura | solicitação anti-enumeração, buckets separados, redirect allowlisted e `Usar outra conta` com logout local | `PARTIAL` |

### Status consolidado dos gaps já tocados

| Gap | Estado | Observação de aceite |
| --- | --- | --- |
| P-07, P-08, P-10, P-11, P-12, P-13, P-17, P-18, P-20, P-24, P-26, P-36 | `RESOLVED` | testes focados e type-check aprovados; P-07/P-36 ainda aguardam inspeção browser nos quatro viewports |
| P-01, P-04, P-05, P-06, P-09, P-14, P-15, P-19, P-21, P-23, P-27, P-28, P-29, P-30, P-31, P-32, P-33, P-34, P-35, P-37, P-38 | `PARTIALLY_RESOLVED` | implementação por consumidor/rota ou gate manual/externo ainda incompleto |
| P-22, P-25 | `BLOCKED` | respectivamente dependência/decisão e credenciais E2E |

### Evidência automatizada acumulada

- paginações: Pacientes 20/20, Financeiro 15/15, Documentos 22/22 e Ausências
  33/33;
- acessibilidade de Fields: 11/11; destructive actions: 12/12;
- foundations: 21/21; tema/motion/settings focados: 7/7; Dashboard: 4/4;
- skeleton/loading: 25/25; Agenda/domínio: 35/35; conversa: 6/6;
  Relatórios/foundations: 5/5; LGPD/consistência: 16/16; WhatsApp: 11/11;
  Admin: 14/14 no dashboard/config e 32/32 no detalhe/export; Patient CRM/Clinical:
  77/77; Auth/UI/MFA focado: 14/14; rate-limit/confirm/URL/PDF: 65/65;
- gates finais: `pnpm typecheck` e `pnpm lint` `PASS`; `pnpm test`
  249/249 arquivos e 2.213/2.213 testes `PASS`; `pnpm arch:check` processou
  914 arquivos sem ciclos;
- a única falha temporal observada em `slot-floor.test.ts` era da fixture fixa,
  não do runtime: o relógio do caso foi congelado e o arquivo agora passa 11/11.
  O código produtivo que recusa janela passada não foi alterado. A suíte completa
  foi reexecutada e passou 2.213/2.213; não há reprodução confirmada desse erro em
  produção;
- `pnpm build` segue `FAIL` exclusivamente no gate observado de download da DM
  Sans via `next/font` (3 tentativas, `EACCES`); `format:check` encontra 128
  arquivos preexistentes fora do Prettier;
- a spec visual dedicada lista 8 testes/40 screenshots potenciais, mas os 8 ficam
  skipped sem credenciais; browser E2E, PNGs light/dark, quatro viewports e axe
  seguem `BLOCKED/NOT_TESTED`, não inferidos a partir de testes unitários.

### Bloqueios confirmados na segunda auditoria

- Agenda ainda pode truncar o mês em 500 consultas; a correção exige paginação
  ou particionamento sem tornar a grade factualmente incompleta;
- Caixa continua carregando o conjunto completo antes da paginação local;
- LGPD ainda precisa paginação de fila e histórico;
- Conversas usa as 500 mensagens mais antigas e deriva a janela Meta desse
  recorte. Classificação: `OUT OF UI SCOPE` até confirmar query/regra operacional;
- recovery real depende do template, redirect allowlist e SMTP do Supabase, todos
  `NOT_TESTED`; o grant one-time também exige claim atômico para eliminar a
  corrida entre duas trocas simultâneas;
- a branch não atende ao Gate 43 e não deve ser chamada `READY FOR HUMAN REVIEW`.
