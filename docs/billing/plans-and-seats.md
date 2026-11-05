---
title: "Planos, médicos e equipe"
description: "Catálogo versionado, cotas separadas, adicionais, recursos e preservação de contratos legados."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Fonte da regra

Consulte `src/contexts/billing/proposed-offer.ts`, `billing/api.ts`, o catálogo
persistido, as migrations e `src/lib/auth/practitioner.ts`. O nome histórico
`PROPOSED_OFFER` da constante não significa que toda a implementação continua
apenas planejada. A disponibilidade de contratação também depende da configuração
e dos registros ativos no ambiente.

## Oferta versionada de 2026

| Plano/variante | Mensal | Médicos | Equipe administrativa | Total máximo de logins |
| --- | ---: | ---: | ---: | ---: |
| Consultório | R$ 197 | 1 | Até 3 | 4 |
| Clínica — entrada | R$ 397 | 2 | Até 3 | 5 |
| Clínica — 3 médicos | R$ 544 | 3 | Até 3 | 6 |
| Clínica — 4 médicos | R$ 691 | 4 | Até 3 | 7 |
| Clínica — 5 médicos | R$ 838 | 5 | Até 3 | 8 |

Os códigos são `consultorio_2026` e `clinica_2026_2` a `clinica_2026_5`.
O cadastro inicial oferece os códigos de entrada; médicos adicionais pertencem
à assinatura existente. Cada médico adicional na Clínica custa R$ 147/mês.

Atendente, gestão e financeiro ocupam os acessos administrativos incluídos.
Não existe compra online de um quarto acesso administrativo nesta oferta.

## Quem conta como médico

- Papel `doctor`: conta como médico mesmo antes de preencher CRM.
- `owner` ou `gestor` com CRM não vazio: conta como médico e não é contado outra
  vez na cota administrativa.
- `owner` ou `gestor` sem CRM: conta na equipe administrativa.
- `attendant` e `financial`: não ganham capacidade médica por um CRM retido.

Esse predicado interno não consulta a situação do registro em um conselho.
TypeScript e SQL devem permanecer equivalentes. Convite, reativação, troca de
papel e alteração de CRM não podem contornar a cota do servidor/banco.

## Recursos e autorização

Na família nova, permissões com ajuste individual, relatório por médico e regras
de repasse são recursos da **Clínica**, sem liberação no Consultório. Os contratos
legados que já têm direito a esses recursos, incluindo Pro, são preservados.

Ter o recurso no plano não concede automaticamente toda permissão ao usuário.
Plano, role, override permitido, vínculo e escopo de dados continuam sendo
verificados no servidor.

## IA, trial e anual

A referência é 500 conversas por médico, com aviso ao atingir marcos de consumo,
sem bloqueio ou cobrança automática de excedente. A contagem específica considera
paciente e janela de 24 horas depois do aceite da mensagem pela Meta; não confunda
esse contrato com a chave diária mantida por compatibilidade no ledger genérico.

O [trial do cadastro novo](/onboarding/signup) dura 14 dias desde a criação
no Auth. A modalidade anual permanece no código, mas novas vendas dependem de
`OFFER_2026_ANNUAL_NEW_SALES_ENABLED`; o default é fechado. Não anuncie anual como
contratável sem confirmar a configuração e os critérios de ativação.

## Contratos existentes e mudanças

Plano, preço e direito contratado são conceitos separados. A oferta nova não
reprecifica silenciosamente contratos legados ou com desconto vitalício.
O `price_id` contratado deve ser preservado conforme a política de compatibilidade.

Upgrade, downgrade e inclusão de médico usam a saga e a reconciliação descritas em
[assinaturas](/billing/subscriptions). A vaga adicional não deve ser liberada apenas
porque o checkout foi criado ou o navegador voltou de uma página do provedor.
