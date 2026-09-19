# Design System Contract

> Congelado no GATE 2, antes da Wave 1. As waves seguintes **citam** este documento;
> não o reescrevem. Alterar o contrato exige aprovação explícita do founder.

Regras invioláveis, válidas em todas as waves do redesign. PR que as viole é rejeitado.

---

## 1. Tokens

- **Zero cor hardcoded** (`#`, `rgb(`, `hsl(`, `oklch(`) fora de `src/app/globals.css`.
- **Zero espaçamento arbitrário** (`p-[13px]`, `gap-1.25`, `mt-[17px]`) — só a escala.
- **Zero tipografia arbitrária** (`text-[27px]`, `text-[14.5px]`) — só a escala.

`globals.css` é a única origem de tokens. `@theme inline` faz o binding das utilities às
vars, então trocar tema ou densidade re-tematiza em runtime, sem rebuild.

## 2. Componentes

- **Variantes com CVA**, nunca `if` de className. Padrão: `src/components/ui/button.tsx`,
  `src/components/ui/alert.tsx`.
- **`data-slot="nome"`** na raiz de cada componente, para composição via seletor pai.
  Padrão: `ui/stat-card.tsx`, explorado por `ui/metric-strip.tsx`.
- **Passthrough tipado**: `ComponentProps<'div'> & {…}`, className mesclado por `cn()`
  (`src/lib/ui/cn.ts`).
- **Server-first**: `'use client'` só quando há estado ou evento.
- **Teste colocado** (`*.test.tsx`) para cada primitivo novo. Padrão:
  `ui/ui-foundations.test.tsx`.

## 3. Arquitetura

### Reusar antes de criar — e provar que reusou

```
buscar equivalente → verificar se atende → reutilizar
                              ↓ não atende
                        adaptar o existente
                              ↓ não dá
                           criar novo
```

**Obrigação operacional:** antes de criar qualquer componente, registrar em
[`COMPONENT-DECISIONS.md`](COMPONENT-DECISIONS.md) quais componentes existentes foram
avaliados e por que não serviam. Componente novo sem esse registro não entra. Uma linha
por decisão, não um ensaio.

### Compor antes de configurar

`DataTable` é um conjunto de peças combináveis, não um componente com 30 props.
Proibidos: `SuperCard`, `UltimateCard`, `UniversalPanel`, `MegaForm`, `GenericPageLayout`.

### Deletar o duplicado depois de migrar

Criar o novo sem remover o antigo é o que produz `DataTable` + `PatientTable` +
`GenericTable` convivendo. Todo primitivo novo tem **duas** etapas obrigatórias além da
criação: **adoção** (migrar os usos) e **limpeza** (remover o equivalente antigo).

## 4. Qualidade

**Conformidade técnica não substitui qualidade visual.**

É possível cumprir este contrato à risca — zero hex, zero espaçamento arbitrário — e ainda
entregar uma UI genérica, com `gap-4 p-4` em tudo. Passar no lint não é o objetivo; o
objetivo é hierarquia legível e densidade útil.

Um resultado tecnicamente conforme e visualmente insosso **reprova** no GATE 3. A revisão
avalia hierarquia, densidade, proporção, alinhamento, ritmo vertical, prioridade de ação e
legibilidade.

## 5. Segurança e escopo

- Sem alteração de **regra de negócio**, banco, contratos de API, permissões, RLS, auth,
  lógica financeira ou de IA.
- **Sem mocks**: usar os dados reais; fixtures só em teste.
- **Nunca merge ou deploy na `main`.** O trabalho vive em `redesign/qoro-ds-v3` com preview
  isolado.
- **O redesign altera apresentação, hierarquia e composição visual. Não altera fluxo
  operacional, disponibilidade de ações, labels de negócio ou significado de dados sem
  aprovação explícita.** Ação que muda de lugar precisa de registro: onde estava, onde
  ficou, por quê.
- **Nenhum teste existente pode ser removido ou enfraquecido.** Teste que quebra por
  mudança de seletor é atualizado; teste que quebra por mudança de comportamento **para a
  wave**.

## 6. A referência não é especificação funcional

As 8 imagens em [`refs/`](refs/) definem a direção visual. Elas **não** mostram estados de
erro, permissões, LGPD, listas longas, telas administrativas nem casos de borda.

**Quando a referência conflitar com uma necessidade operacional do Qoro, a UX operacional
vence** — e o desvio é registrado em `COMPONENT-DECISIONS.md`.

O objetivo não é copiar as telas. É extrair os princípios que as geraram e aplicá-los ao
sistema inteiro, inclusive nas rotas que não aparecem nas imagens.

---

## Definição de "tela migrada"

Critério objetivo. Uma tela só conta como migrada quando responde **sim** a todos:

- [ ] Usa o page layout (`shared/page-layout.ts`) e o `PageHeader` compartilhados
- [ ] Zero cor hardcoded
- [ ] Zero espaçamento arbitrário
- [ ] Zero tipografia arbitrária
- [ ] Nenhum componente duplicado do que já existe no DS
- [ ] Tabela = `DataTable`; filtros = `FilterBar`; status = `StatusBadge`
- [ ] Tem loading state
- [ ] Tem empty state
- [ ] Tem error state
- [ ] Foco por teclado visível e navegável
- [ ] Funciona em mobile (390) sem overflow horizontal
- [ ] Contraste AA nos dois temas
- [ ] Cobertura funcional da wave passando
- [ ] Aprovada na revisão visual (hierarquia, densidade, ritmo, prioridade)

A checklist técnica é o **piso**; a revisão visual é o **teto**. Uma tela precisa das duas.
