---
title: "Pagamentos, taxas e repasses"
description: "Fronteiras entre dinheiro do paciente, ledger da clínica, antecipações e repasse aos médicos."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Três responsabilidades

| Contexto | Responsabilidade |
| --- | --- |
| `payments` | Instrumento de cobrança do paciente, conta recebedora da clínica, checkout e fatos do provedor |
| `financial` | Obrigação a receber, ledger, conciliação, caixa e cálculo/revisão de repasse |
| `billing` | Mensalidade da Qoro e direitos contratados pela clínica |

A conta Asaas recebedora do paciente pertence à clínica. A assinatura da Qoro é
outra relação de cobrança. Uma falha em um desses fluxos não autoriza interpretar
ou alterar o outro.

## Preço, bruto, taxa e líquido

O procedimento tem um preço. O paciente pode escolher um meio permitido no
checkout; a lógica de aumento de preço por Pix/cartão foi retirada. Snapshots e
pagamentos históricos não devem ser reescritos para se adequar à regra nova.

Bruto é o valor cobrado. Taxa e líquido dependem dos fatos fornecidos pelo Asaas.
Estimativa de tarifa não é liquidação; não presuma uma tarifa universal para todas
as contas. Referências da conta e fatos conciliados têm papéis diferentes.

## Sinal e crédito antecipado

Pagamento anterior à consulta é representado como crédito antecipado. Ele não
cria uma segunda obrigação concorrente com o recebível. Ao concluir o atendimento,
o financeiro reconhece o recebível e concilia o crédito correspondente.

Pagamento parcial deixa o saldo correto; pagamento integral antecipado pode quitar
o recebível após a conclusão. Não conclua que houve quitação pela página de sucesso
do checkout: confirme webhook/readback e a persistência financeira.

O [ADR-051](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/adr/051-conciliacao-sinal-e-recebivel.md) registra a decisão de que
`lancamentos` é a obrigação e `patient_charges` é o instrumento, sem dois ledgers
independentes para o mesmo dinheiro.

## Estorno

O caminho atual de intenção de estorno orienta ação manual da clínica e acompanha
o resultado por readback/webhook. `payments/internal/excess-refund.ts` não solicita
novos estornos automáticos ao Asaas; intenções legadas continuam reconciliáveis.

Um pedido aceito, código aprovado no painel ou HTTP 200 não comprovam conclusão.
O código considera os fatos terminais do provedor, incluindo `DONE`, antes de
confirmar o efeito financeiro. Falhas e pendências não devem ser apresentadas ao
usuário como dinheiro devolvido.

## Repasse ao médico

A regra do procedimento escolhe base **GROSS** ou **NET**. O cálculo mantém os
snapshots necessários; a base líquida pode ficar pendente enquanto faltarem fatos
do provedor. Mudar a regra hoje não recalcula silenciosamente o atendimento antigo.

Estorno ou perda relevante pode suspender o repasse e exigir revisão humana.
O histórico original permanece auditável; a pessoa autorizada decide dentro dos
limites validados pelo servidor, com motivo. Uma proporção sugerida não é aplicada
sozinha.

A competência do relatório mensal é a consulta concluída. Doutor e gestor devem
receber somente os dados permitidos por seu papel e escopo. Valor calculado ou
revisado não é comprovante de transferência bancária ao médico.

Fontes: `financial/internal/professional-payout.ts`, `payout-review.ts`, contratos
de `payments`, handlers financeiros e gates de `billing`.

## Limites

Recibo/comprovante e exportação contábil não equivalem a emissão de Nota Fiscal.
Não anuncie NF ou execução automática de estorno/transferência sem implementação
e integração que comprovem essas ações. A especificação em camadas e seus
checkpoints permanecem localizáveis no [índice de specs](/specs/index).
