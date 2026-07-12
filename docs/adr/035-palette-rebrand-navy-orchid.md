# ADR-035 — Rebrand de paleta: petrol/clay → navy/orchid (Qoro) + swap do wordmark

- Status: accepted
- Camada: Fundação Visual (identidade Qoro)
- Refs: **supersede parcial do ADR-031 §2** (paleta); ADR-028 (reafirmado);
  `dsv2/tokens.css` (projeto claude.ai/design `7343b366-…`),
  `src/app/globals.css`, `src/components/shared/logo.tsx`,
  `docs/ui-refactor/design-system-map.md`

## Context

O ADR-031 fixou o DS v2 com primária **petrol** (hue 205) e acento **clay**
(hue 45), além do wordmark Qoro colorido (gradiente). O founder atualizou o
projeto no claude.ai/design (mesma fonte viva de `dsv2/tokens.css`) para a
identidade Qoro definitiva: primária **navy** — o azul da marca (hue 264) — e
acento **orchid** — o polo magenta do gradiente Qoro (hue ~320). O wordmark
passou a ser monocromático navy (assets `qoro-logo-navy` / `qoro-logo-white`).

Restavam também resíduos textuais **"ClinicaOS"** em superfícies user-facing
(fallback do nome de clínica na sidebar; cabeçalho do wizard de ativação).

Pedido do founder (2026-07-10): trocar a paleta principal e os botões e a logo,
**sem alterar mais nada** (layout/estrutura/copy intocados); escolha decente em
claro **e** escuro.

## Decision

1. **Repalette navy/orchid — só valores, nomes de token preservados.**
   `--primary-*` recebe navy (hue 264); `--accent-*` recebe orchid (hue ~320).
   Neutros porcelana e semânticas (success/warning/danger/info) inalterados.
   Superfícies **dark** retonalizadas do hue 230 para **265** (paridade com a
   navy). Valores 1:1 de `dsv2/tokens.css`. Como tudo lê de token (ADR-031 §3),
   re-tematiza o app inteiro (claro + escuro): botões, links, focus ring,
   sidebar, painel de marca do login (agora navy com brilho magenta), badges,
   data-viz (`--viz-1` navy, `--viz-2` orchid).

2. **Tokens novos `--brand-gradient` / `--brand-gradient-soft`** adicionados ao
   `:root` (ativo expressivo assinatura da marca). Ainda sem consumidor —
   disponível para hero/marcas; **não** aplicado ao painel do login (fora de
   "só cores e botões").

3. **Botões:** recolorem via token (`bg-primary`, `--primary-*`, `bg-accent`).
   Corrigidos os 2 hues hardcoded de sombra em `button.tsx`
   (primary 205→264, accent 45→320).

4. **Wordmark (`shared/logo.tsx`):** substituído pelo novo SVG navy, servido em
   `currentColor` — renderiza navy profundo (`primary-900`) no claro e branco no
   escuro (paridade com `qoro-logo-navy`/`qoro-logo-white`). Atualiza login,
   sidebar, admin, reset-password e convite automaticamente.

5. **"Recolor only" para marcas-ícone (decisão do usuário 2026-07-10):** o
   favicon (`app/icon.svg`, Q do gradiente da marca) e o mark de 4 quadrados do
   chip do tenant (`painel/icons.tsx#LogoIcon`) permanecem — apenas recoloridos
   via token. O wordmark é o único asset trocado. (O badge quadrado local do
   wizard de ativação também só recolore.)

6. **Resíduos "ClinicaOS" user-facing corrigidos:** fallback do nome de clínica
   → "Qoro" (`shell-identity.ts`); título do cabeçalho do wizard → "Qoro". O
   naming **interno** de arquitetura (ex.: "Asaas atualiza billing; ClinicaOS
   decide acesso") permanece de propósito.

## Consequences

- (+) Rebrand completo num único arquivo de token — reprova o valor dos tokens
  semânticos estáveis do ADR-031.
- (+) Dark mode coeso com a navy (hue 265) — escolha afinada em ambos os temas.
- (−) Supersede o item 2 do ADR-031 quanto à **paleta** (petrol/clay deixa de
  valer). `design-system-map.md` atualizado; ADR-031 permanece válido no resto.
- (−) O `design_system/DSv2.html` local (petrol/clay) fica defasado; a fonte
  viva é o projeto claude.ai/design (`dsv2/tokens.css`).

## Alternatives

- **Renomear tokens para `--navy-*`/`--orchid-*`:** rejeitado — churn no
  markup/CSS legado; ADR-031 já decidiu preservar nomes históricos.
- **Trocar favicon + mark de 4 quadrados para o Q navy:** rejeitado pelo usuário
  (recolor only, 2026-07-10).
- **Aplicar `--brand-gradient` no painel do login:** adiado — extrapola "só
  cores e botões"; o painel navy atual já fica correto.

## References

- `dsv2/tokens.css` (projeto claude.ai/design `7343b366-492d-48f3-8d44-2752267477d4`)
- `src/app/globals.css` (tokens), `src/components/ui/button.tsx`
- `src/components/shared/logo.tsx` (novo wordmark navy em currentColor)
- ADR-031, `docs/ui-refactor/design-system-map.md`
