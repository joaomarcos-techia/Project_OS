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

---

## Ações que mudaram de lugar

Registro exigido pelo Contract §5: o redesign não altera fluxo sem aprovação; quando uma ação
muda de lugar, fica registrado onde estava, onde ficou e por quê.

| Data | Ação | Onde estava | Onde ficou | Motivo | Aprovação |
| --- | --- | --- | --- | --- | --- |
| _(a preencher)_ | | | | | |
