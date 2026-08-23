# Component Decisions

> Registro exigido pelo [Contract](CONTRACT.md) §3: **antes** de criar qualquer componente,
> registrar o que já existia, se foi avaliado e por que não serviu.
>
> Uma linha por decisão. Se a coluna "Avaliados" estiver vazia, o componente não entra.

| Data | Componente | Avaliados | Por que não serviram | Decisão |
| --- | --- | --- | --- | --- |
| 2026-08-23 | Mapa semântico de status | `ui/badge.tsx`, `ui/status-badge.tsx` | Serviram: o `Badge` já tem os 7 tons e o `status-badge` já mapeava agendamento e pagamento | **Estendido**, não criado. `ProntuarioStatusBadge` e `PatientStatusBadge` novos; `PaymentStatusBadge` ganhou `overdue` |
| 2026-08-23 | Papéis tipográficos | escala `--fs-*` existente | Serviu como escala crua; faltava a camada de papel que o plano pede | `--fs-page/section/subsection/body/caption` como aliases. Nenhum nome existente renomeado |
| 2026-08-23 | Matriz de estados de campo | `fieldControlClassName` em `ui/input.tsx` | Serviu: já é compartilhado por Input/Textarea/Select/DateField | Estendido no lugar. A matriz vive num ponto só |
| 2026-08-23 | `EntityCell` | `ui/table.tsx` (`TableCellStack`) | Serviu para a pilha de duas linhas, faltava o avatar | **Compõe** `TableCellStack` + `Avatar`; não reimplementa a pilha |
| 2026-08-23 | `DataTable` | `TableWrap`, `TableScroll`, `TableFoot`, `TablePager` | Serviram, mas cada rota recopiava o cerco e escrevia a contagem de um jeito | Moldura fina. **Não recebe `columns`/`rows`** — o conteúdo segue sendo `TableHeader`/`TableBody` na página, para não virar componente de 30 props |
| 2026-08-23 | `FilterBar` | `ui/table-toolbar.tsx` | Não serviu: a toolbar vive DENTRO da moldura da tabela; a referência filtra no nível da página | Coexistem, com fronteira explícita no JSDoc de cada um |
| 2026-08-23 | `Avatar` | — | Nada equivalente no repo | Criado. Iniciais, não foto: o sistema não guarda retrato de paciente |
| 2026-08-23 | `MetricStrip` | o próprio | Servia, mas colava os cards com `gap-px` sobre a borda | **Reescrito, não substituído.** Cards separados por gap; as 5 telas que já usavam herdaram o visual da referência de uma vez |
| 2026-08-23 | `StatCard` | o próprio | API derivava a cor da direção e não expressava "despesa subindo é ruim" | `tone` semântico + `emphasis` + `valueTone`. Dois chamadores migrados |
| 2026-08-23 | `BarChart` | `dashboard/_components/revenue-chart.tsx` | Era específico do dashboard e sem rótulo sobre a barra | Extraído. `RevenueChart` virou casca fina. **Sem biblioteca**: recharts custaria ~100kB para desenhar `div` com altura percentual |
| 2026-08-23 | `StackedBar` | — | Nada equivalente | Criado e **adotado em `/relatorios`**, onde a grade de 4 números virou proporção |
| 2026-08-23 | `BreakdownList` | — | Nada equivalente | Criado e **adotado em `/caixa`** (recebimentos por forma), agrupando dado já carregado — sem query nova |
| 2026-08-23 | `SummaryList` | — | Nada equivalente | Criado. Adoção prevista no drawer de fechamento do Caixa (Wave 6) |
| 2026-08-23 | `Metric` (local em `caixa-view.tsx`) | `StatCard` | Era duplicata: rótulo uppercase + valor tabular | **Removido**, substituído por `StatCard` |
| 2026-08-23 | `FormSection` | `ui/field.tsx`, `<fieldset>` solto no `patient-form` | O Field rotula UM campo; faltava o rótulo de GRUPO | Criado como `fieldset`+`legend` (não div+span): o leitor anuncia o grupo em cada campo. Adotado no drawer de documento e no formulário de paciente |
| 2026-08-23 | `OptionCardGroup` | `ui/select.tsx`, `ui/segmented.tsx` | `<option>` não comporta descrição em duas linhas; o segmented é trilho de 2–4 itens curtos | Criado com `input[type=radio]` real. Adotado no tipo de documento |
| 2026-08-23 | `ChipGroup` | `ui/segmented.tsx`, `ui/select.tsx` | — | **Não criado.** A referência usa chips para TIPO/DURAÇÃO/STATUS, campos que não existem aqui: duração vem do procedimento e status é derivado. Procedimento e profissional são listas dinâmicas, onde `Select` é o certo |

---

## Desvios da referência

Registro exigido pelo Contract §6: onde a UX operacional venceu a referência visual, e por quê.

| Data | Tela | O que a referência mostra | O que foi feito | Motivo |
| --- | --- | --- | --- | --- |
| 2026-08-23 | Documentos | Badges `Finalizado`, `Em análise`, `Recusado` | `Rascunho` e `Assinado` | O domínio tem dois estados (`prontuarioStatus` em `clinical/schema.ts`). Inventar três seria mudar regra de negócio para caber na imagem — Contract §5 |
| 2026-08-23 | Caixa | Badge `Aberto` / `Fechado` | Nada | Não existe enum de status de caixa no domínio. Deixado para a Wave 6, quando a tela for feita e a fonte do estado ficar clara |
| 2026-08-23 | Pacientes | Badge `Ativo` / `Inativo` | Derivado de `deletedAt` | Paciente não tem enum de status; o que existe é soft delete. O badge traduz sem criar estado novo |
| 2026-08-23 | Financeiro | Badge `Vencido` | Prop `overdue` no `PaymentStatusBadge` | "Vencido" não é estado armazenado: o Financial deriva de `due_date` vs hoje no fuso da clínica (`dunning-candidates.ts`). A regra continua lá; aqui só a apresentação |
| 2026-08-23 | Sidebar (todas) | Item ativo sem nenhum destaque aparente | Ativo por **contraste + peso**, sem preenchimento | A referência distingue por contraste (na tela de Pacientes, "Pacientes" é visivelmente mais escuro que "Documentos"), mas o briefing §9 exige estado ativo identificável. Contraste sozinho seria cor-apenas (WCAG 1.4.1); o peso é o segundo sinal, e o `aria-current` já cobre o leitor de tela |
| 2026-08-23 | Sidebar (todas) | Sem bloco de identidade da clínica | **Removido** por decisão do founder | Eu havia mantido por §30 (multi-tenant, o usuário precisa saber qual clínica está ativa). O founder decidiu remover. Consequência aceita: o nome da clínica deixa de aparecer no shell — segue disponível em Configurações → Perfil da clínica. Props `clinicName`/`clinicPlan` do `PainelShell` removidos junto |
| 2026-08-23 | Sidebar (todas) | Sem toggle de tema, sem "Sair", sem assinatura | **Tema e Sair viraram menu; assinatura removida** | Decisão do founder após ver o preview. Eu havia mantido os três por §30. Funcionalidade preservada: tema e logout viraram itens do menu do usuário; só a assinatura, que é decorativa, saiu. Fluxo mudou (dois cliques em vez de um), com aprovação explícita |
| 2026-08-23 | `/configuracoes` | — | Pílula azul do submenu removida | Inconsistência que a Wave 2 criou: com o menu primário quieto, a pílula do submenu invertia a hierarquia. Mesma regra agora nos dois (§37) |
| 2026-08-23 | `/admin` | — | Rodapé antigo mantido | Fora de escopo desta rodada. É um console visualmente distinto e o `SidebarUserMenu` é compartilhado, então adotar depois é uma linha |
| 2026-08-23 | `/pacientes` | Colunas de CPF, telefone, idade, sexo, último atendimento, próximo e profissional | Só nome + e-mail | **A lista não descriptografa** (decisão de privacidade 5.13): `PatientListItem` expõe `id`, `nome`, `email`, `deletedAt` e nada mais. Trazer os campos da referência exigiria decifrar a lista inteira a cada página — mudança de regra, não de UI |
| 2026-08-23 | `/pacientes` | Coluna de status `Ativo`/`Inativo` | Omitida | Na lista ativa todos seriam "Ativo" e na lixeira todos "Inativo": uma coluna de badges idênticos é ruído. O `PatientStatusBadge` existe para onde o estado varia |
| 2026-08-23 | `/documentos` | Badge de tipo colorido | Ícone + rótulo no `EntityCell` | O badge repetia a mesma cor em toda linha e não distinguia nada. A referência usa tile de ícone, que carrega o tipo sem gastar cor |
| 2026-08-23 | `/financeiro` | Painéis "por serviço", "por profissional" e "formas de recebimento" | Nenhum criado | Não existe query agregada por serviço nem por profissional. Construir a UI exigiria inventar o dado (§39) ou escrever query nova, que é backend, não UI |
| 2026-08-23 | Dashboard | Barra de "hoje" destacada em outra cor | Todas iguais | O eixo já traz o dia e a última coluna é sempre hoje — pintar diferente gastava significado de cor para repetir o que a posição dizia |

---

## Ações que mudaram de lugar

Registro exigido pelo Contract §5: o redesign não altera fluxo sem aprovação; quando uma ação
muda de lugar, fica registrado onde estava, onde ficou e por quê.

| Data | Ação | Onde estava | Onde ficou | Motivo | Aprovação |
| --- | --- | --- | --- | --- | --- |
| _(a preencher)_ | | | | | |
