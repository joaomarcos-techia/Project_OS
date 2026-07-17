# ADR-031 — Design System v2: rebrand petrol/clay + governança de UI + estrangulamento do CSS legado

- Status: accepted
- Camada: Fundação Visual (refatoração UI/UX pós-C15)
- Refs: ADR-018 (supersede parcial — especificação visual), ADR-028 (reafirmado),
  `design_system/DSv2.html`, `docs/ui-refactor/ui-inventory.md`,
  `docs/ui-refactor/design-system-map.md`, CONVENTIONS §Governança de UI

## Context

O ADR-018 estabeleceu a fundação de UI sobre o DS v1 (azul-confiança hue 258 +
Geist). Na prática, o DS v1 foi portado como CSS monolítico
(`ds.css` ~127 KB) que **redefinia o layer inteiro de tokens** por cima do
`globals.css` — violando a própria regra do ADR-018 de recriação idiomática — e
a camada React ficou fina: sem Dialog/Drawer/Table/Toast/Skeleton, gerando
duplicação concreta (6 tabelas à mão, ~54 banners `msg={ok,text}`, overlays
copiados) e zero `loading.tsx`.

O founder produziu o **DS v2** (`design_system/DSv2.html`, export standalone do
claude.ai/design, 2026-07-02): rebrand completo, eixo de densidade, escada de
elevação/z-index nomeada, specs de todos os componentes que faltam e padrões de
superfície de IA. Decisões confirmadas com o founder em 2026-07-02: rebrand
completo; migração total em ondas; densidade fixa (comfortable) com tokens
preparados; busca ⌘K fake removida (command palette fica como dívida).

## Decision

1. **`design_system/DSv2.html` é a fonte única da verdade de UI** (substitui o
   DS v1 nessa função). Fatos de produto/arquitetura continuam com os ADRs.

2. **Rebrand travado (supersede o item 2 do ADR-018):** primária **petrol**
   (oklch hue 205); acento único quente **clay** (hue ~45), reservado para
   IA + ênfase rara; neutros porcelana/tinta **quentes** (hue 98–108);
   tipografia **Hanken Grotesk** (sans) + **Inter** (display) + **IBM Plex
   Mono**; light default, dark por `.dark` E `[data-theme='dark']` (paridade —
   sistema afinado light-first).

3. **Tokens vivem SOMENTE em `src/app/globals.css`** (`:root`/dark + `@theme
   inline`). Nenhum outro CSS redefine tokens — o bloco duplicado do `ds.css`
   foi removido. Nomes históricos preservados (`--primary-*`, `--sh-*`,
   `--bg-subtle`, `--dur-fast/base/slow`) com valores 1:1 do DS v2 — zero churn
   de markup; desvios documentados em `design-system-map.md`.

4. **Densidade é eixo de token** (`--control-h`, `--row-h`, `--card-pad`, …)
   com bloco `[data-density='compact']` pronto. O app usa comfortable; toggle
   de UI é dívida registrada.

5. **Radix primitives autorizados agora** (gatilho "quando a 1ª tela precisar"
   do ADR-018 disparado): Dialog (Drawer = Dialog posicionado), DropdownMenu,
   Popover, Tooltip, Switch, Checkbox, Tabs. Caseiros: Toast (store singleton,
   sem Context), Table kit RSC-first (sort/paginação por URL), Skeleton,
   Segmented, Breadcrumbs, StatCard. Ícones: **lucide-react** vence;
   `painel/icons.tsx` vira re-export de compatibilidade.

6. **Estrangulamento do CSS legado** (`ds.css`, `app-shell.css`, `admin.css`,
   `onboarding-flow.css`): retematizado via tokens na fundação; cada onda migra
   telas para Tailwind/React e deixa classes órfãs; deleção só com auditoria de
   uso zero (grep de todos os seletores contra `src/`).

7. **Governança de UI permanente** em CONVENTIONS §Governança de UI: Design
   Authority; escada de minimização de navegação (Inline → Popover → Dropdown →
   Dialog → Drawer → Nova aba → Nova página); "essa tela deveria existir?";
   justificativa escrita de rota nova; zero duplicação (grep antes de criar);
   Provider/Context/hook global como exceção justificada; UI Audit por onda;
   checklist de Engenharia de Produto.

8. **ADR-028 reafirmado:** o DSv2.html demonstra theming por tenant — **não
   implementar**. White-label continua restrito ao cabeçalho de PDF; a
   arquitetura de tokens permite revisitar no futuro sem retrabalho.

## Consequences

- (+) Troca de paleta/fonte re-tematizou o app inteiro (incl. CSS legado) num
  único arquivo — prova do valor de tokens semânticos estáveis.
- (+) Padrões que faltavam (overlay, toast, tabela, skeleton, densidade,
  z-ladder) passam a ter spec única e componentes canônicos.
- (+) Bug pré-existente corrigido de carona: anti-flash de tema lia
  `localStorage['theme']`, shells gravam `clinicaos-theme` — nunca funcionou.
- (−) `@radix-ui/*` entra como dependência (pin exato) — aceito pelo custo de
  a11y correta em overlays/menus.
- (−) Durante as ondas, telas migradas e legadas coexistem com o mesmo tema —
  divergências pontuais de componente são esperadas até a Onda 7.
- (−) Dívidas registradas: command palette, toggle de densidade, calendário
  visual da Agenda, `/conversas` tenant.

## Alternatives

- **Manter marca azul/Geist e adotar só componentes:** rejeitado pelo founder
  (2026-07-02) — DS v2 é fonte única, rebrand completo.
- **Renomear tokens para `--petrol-*`/nomes do DS:** rejeitado — churn em todo
  o markup/CSS legado sem ganho funcional; mapa de nomes documentado.
- **Big-bang (reescrever telas junto com tokens):** rejeitado — ondas com PR
  verificável mantêm o app sempre funcional (mesma tese do ADR-018).
- **shadcn CLI:** continua rejeitado (ADR-018) — naming semântico próprio
  brigaria com os tokens do DS; base CVA/cn permanece shadcn-compatível.

## References

- `design_system/DSv2.html` (+ mockups `dashboard.html`, `tconsulta.html`,
  `ClinicaOS - Admin (standalone).html`)
- `src/app/globals.css` (tokens), `src/app/layout.tsx` (fontes/anti-flash)
- `docs/ui-refactor/ui-inventory.md`, `docs/ui-refactor/design-system-map.md`
- CONVENTIONS §Governança de UI
