# ADR-018 — UI / Design Foundation (quando e como aplicar o Design System)

- Status: accepted
- Camada: Fundação Visual (pré-C8)
- Refs: VisãoGeral §3.1 (stack shadcn/Tailwind), `docs/ClinicaOS Design System (standalone) (1).html`, ADR-001 (bounded contexts), CONVENTIONS (anti `lib/utils.ts`)

## Context

Até C7 o frontend era esqueleto: `globals.css` continha só `@import 'tailwindcss'`,
sem tokens; nenhuma lib de componente instalada; telas com Tailwind cru e cores
hardcoded (`bg-black`, `border-gray-300`); sem shell de navegação, fonte ou tema.
A documentação escolheu a stack (Next 15 + shadcn/ui + Tailwind 4) mas **nunca
definiu um design system** — cores, tipografia, componentes, hierarquia.

Paralelamente, o founder produziu um **Design System completo** (Claude Design)
exportado como HTML autônomo: tokens oklch (azul-confiança hue 258 + teal de
acento), tipografia Geist, light default + dark, e — o ponto central — uma
**Biblioteca de Componentes organizada por domínio clínico** (Paciente →
Workflow clínico → Agenda → Financeiro → Auditoria → Comunicação → IA →
commodities por último), onde *"o espaço de cada componente reflete seu valor
para o negócio"*.

Pergunta de timing: aplicar UI agora (antes do C8) ou por último? Os dois
extremos são armadilhas. "Por último" repinta 8 camadas de telas cruas — é a
hidra visual, contra a própria tese do PlanoAção ("conserte a fundação antes de
empilhar"). "Design system completo agora" é overengineering (mockar telas sem
backend = mock-débito). O C8 (Consultório) é a tela de maior aposta de UX e
merece nascer sobre uma base real.

## Decision

1. **O Design System HTML é a fonte da verdade de _design_.** Em qualquer
   conflito de **fato de produto/arquitetura** (não-design), os demais docs
   prevalecem. Exemplo canônico: o DS ainda mostra "domínio/subdomínio dedicado
   por clínica", recurso **removido do roadmap** (VisãoGeral §3.9) — vale o doc,
   não o DS.

2. **Decisões de marca travadas (do transcript do DS):** primária azul-confiança
   `oklch(0.585 0.182 258)` (~#1F5FD6); acento teal (hue 195) usado com
   parcimônia; tipografia **Geist + Geist Mono**; **light é o default** com dark
   mode por classe `.dark`; arquétipo 70% Operação / 20% Saúde / 10% IA.

3. **Foundation-first, não big-bang.** Antes do C8 entra só a **fundação**:
   tokens, fonte, tema, shell e primitivos. Os **componentes de domínio**
   (Patient/Consultório/Financeiro/Auditoria/IA do §08 do DS) são implementados
   **junto com a camada que os usa** (Consultório em C8, Financeiro em C9, …),
   lendo a seção correspondente do DS como spec. Nunca mockar tela sem backend.

4. **Tokens → Tailwind 4 `@theme inline` + `:root`/`.dark`** em `globals.css`.
   Valores crus nas vars; binding inline faz as utilities referenciarem as vars,
   então **dark mode e white-label re-tematizam em runtime** sem rebuild.

5. **White-label** = sobrescrever `--primary-*` por clínica (mesma mecânica do
   theme switch). A geração da escala completa a partir de uma cor é refinamento
   futuro; o ponto de injeção já existe.

6. **Primitivos em `src/components/ui/`**, construídos com `class-variance-authority`
   + `cn` (`clsx` + `tailwind-merge`, em `src/lib/ui/cn.ts` — **não** `lib/utils.ts`)
   + `lucide-react`. É **compatível com shadcn** (mesma base CVA/cn/Radix), mas
   **não rodamos o CLI** nem adotamos os nomes semânticos do shadcn — os tokens do
   DS são a fonte. `npx shadcn add ...` continua funcionando se for desejado.

7. **Commodities são infraestrutura** (DS §08.9): button/input/select/badge/alert
   ficam visualmente discretos. Componentes clínicos dominam. *"Se um botão está
   mais impressionante que um prontuário, a implementação está errada."*

8. **Chrome via route-group `(app)/(shell)/`**: o app shell (sidebar 268px +
   drawer mobile + theme toggle) envolve só as rotas autenticadas. Route-group
   entre parênteses **não altera URL**. Auth real continua no middleware +
   `requireUser`; o layout do shell é puramente visual.

## Consequences

- (+) Base coesa antes da tela mais crítica (C8); todo módulo seguinte herda
  tokens + shell + primitivos → retorno composto.
- (+) Dark mode e white-label "de graça" via CSS variables.
- (+) Telas de PDF/impressão (`prescricoes`, `documentos`) e auth (`login` etc.)
  ficam fora do shell por construção.
- (−) Duas convenções de nome de cor convivem: escalas numéricas do DS
  (`bg-primary-600`) + semânticas (`bg-surface`, `text-fg`). Assumido.
- (−) Labels/cores de status (`AppointmentStatusBadge`) duplicam enums dos
  contexts porque componentes não importam contexts (boundaries). É decisão de
  UI; aceito.
- (−) `geist`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`
  adicionados (pin exato). Radix/Dialog/Tooltip ficam para "quando a 1ª tela
  precisar" (provavelmente C8).

## Alternatives

- **Deixar UI por último:** rejeitado — repintura de N camadas = hidra visual.
- **DS completo agora (todas as telas):** rejeitado — mocks sem backend viram
  débito e serão refeitos.
- **Rodar `shadcn init` + pull de componentes:** rejeitado por ora — traria
  naming semântico próprio que brigaria com os tokens do DS (fonte da verdade);
  a base que montamos é shadcn-compatível, então é reversível.
- **Copiar o CSS do DS verbatim:** rejeitado — o DS é protótipo HTML; recriamos
  em Tailwind/React idiomático, casando o output visual (orientação do README do
  bundle).

## References

- `docs/ClinicaOS Design System (standalone) (1).html` (fonte da verdade visual)
- `src/app/globals.css` (tokens), `src/lib/ui/cn.ts`, `src/components/ui/*`,
  `src/components/shared/app-shell.tsx`, `src/app/(app)/(shell)/layout.tsx`
- VisãoGeral §3.1 (stack), §3.9 (domínio por clínica removido)
