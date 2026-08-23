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

---

## Ações que mudaram de lugar

Registro exigido pelo Contract §5: o redesign não altera fluxo sem aprovação; quando uma ação
muda de lugar, fica registrado onde estava, onde ficou e por quê.

| Data | Ação | Onde estava | Onde ficou | Motivo | Aprovação |
| --- | --- | --- | --- | --- | --- |
| _(a preencher)_ | | | | | |
