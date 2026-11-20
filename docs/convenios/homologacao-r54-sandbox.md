# R54: procedimento de homologação do estorno externo no Asaas Sandbox

**Estado:** preparado, **não executado**. Executar depende de autorização expressa do fundador (ver passo 0).
**Data:** 14/11/2026; pedido de autorização revisto no fim da noite de 14/11/2026.

## Pedido de autorização (14/11, fim da noite)

| Item | Proposta |
| --- | --- |
| Ambiente | Preview do #55 (banco DEV) e conta **Asaas Sandbox** da homologação (`ASAAS_CLINIC_SANDBOX_KEY`, prefixo `$aact_hmlg_`; o roteiro recusa qualquer outra chave). Nenhum dinheiro real. |
| Fixture | Clínica sintética **nova** (`e2e-hi-r54-<data>`), paciente sintético novo, cliente Asaas Sandbox novo. Nada da cobrança de R$ 45 é reutilizado: o id dela é anotado no pré-voo e o roteiro para se encontrar o mesmo id. |
| Valor | **R$ 10,00** (estorno parcial de R$ 4,00 e depois o restante). Mínimo do Asaas: R$ 5,00 pela central de ajuda (lida à tarde de 14/11; no fim da noite a página respondeu 403). O pré-voo reconfirma; se a criação recusar o valor, o roteiro para, sem tentar outro. |
| Método | Cartão de crédito de teste do Sandbox (Visa 4539 6560 4839 2220), no **checkout hospedado** que o Qoro gera. |
| Operações | 1) o Qoro cria **um** Checkout de R$ 10,00; 2) **você** paga no checkout; 3) o agente estorna R$ 4,00 e depois o restante, pela API com a chave Sandbox, simulando a clínica; 4) reentrega do webhook e varredura do cron. |
| Intervenção humana | **Só o pagamento**: o checkout do Sandbox exige reCAPTCHA. O `POST /v3/payments/{id}/payWithCreditCard` existe e dispensaria o checkout, mas não serve aqui: o Qoro cria a cobrança de paciente como **Checkout** (`POST /v3/checkouts`), e o payment só passa a existir depois que alguém conclui o checkout. Pagar por fora do checkout seria outro fluxo, não o do R54. O agente não contorna captcha. |
| Estados esperados | tabela do item 5 abaixo: `paid` com uma baixa → parcial (cobrança `paid`, 1 evidência, estorno ligado à baixa original, `valor_pago` −4,00) → total (`refunded`, 2 evidências, baixa original preservada); coparticipação `refunded` só quando estornos ≥ pago; repasse suspenso/sinalizado, nunca compensado sozinho; nenhuma cobrança nova ao paciente. |
| Riscos | webhook indo a outro deploy (pré-voo confere `APP_BASE_URL` da branch); estorno pela API não é idempotente (antes de repetir, ler `GET /payments/{id}/refunds`); cobrança de R$ 45 afetada (conferida antes e depois, ids diferentes); evidência com dado pessoal (ids mascarados, nada de cartão nem CPF). |
| Verificação | `GET /payments/{id}` e `/refunds` antes e depois; linhas de `patient_external_refunds`, `payment_transactions`, `patient_credit_adjustments`, `audit_events`; reentrega → `200` sem linha nova; cron → `externalRefundSkipped`; soma do livro = bruto − estornos `DONE`. |
| Interrupção | Se qualquer passo divergir, o roteiro para e registra o estado; nada é desfeito automaticamente. Uma cobrança paga e não estornada fica como está no Sandbox (sem efeito real). |

**Autorização necessária, em uma frase:** "Autorizo criar uma cobrança Sandbox de R$ 10,00 numa clínica sintética nova,
que eu pagarei no checkout com o cartão de teste, e estorná-la em duas partes (R$ 4,00 e o restante) pela API Sandbox."

O R54 está **implementado e validado localmente** (Postgres descartável com o Asaas simulado: 14 provas, ciclo de
14/11). Isso **não** é homologação externa. A homologação prova o mesmo fluxo com o Asaas Sandbox de verdade: webhook
real, leitura real de `GET /payments/{id}/refunds` e a varredura do cron no Preview.

## Respostas às 10 perguntas do ciclo

1. **O Sandbox permite homologar o estorno numa fixture descartável?** Sim.
   - O Asaas documenta o estorno de cobrança (`POST /v3/payments/{id}/refund`, total sem corpo ou parcial com `value`)
     e a lista de estornos (`GET /v3/payments/{id}/refunds`; só conta o estorno com status `DONE`).
   - Cobrança de cartão pode ser estornada depois de confirmada ou recebida.
   - Fontes: [Estornar cobrança](https://docs.asaas.com/reference/estornar-cobranca),
     [Listar estornos](https://docs.asaas.com/reference/listar-estornos-de-uma-cobranca).
2. **Exige pagamento prévio?** Sim. Só se estorna cobrança confirmada ou recebida. No Sandbox não há dinheiro real: o
   pagamento usa cartão fictício (ex.: Visa 4539 6560 4839 2220 aprova), sem adquirente.
   - Fonte: [Testando pagamento com cartão](https://docs.asaas.com/docs/testando-pagamento-com-cart%C3%A3o-de-cr%C3%A9dito).
3. **Precisa de interação do fundador?** Sim, em dois pontos:
   - **(a) Pagar.** A cobrança de paciente do Qoro nasce no checkout hospedado do Asaas, e o checkout do Sandbox exige
     reCAPTCHA humano (visto em 13/11). Correção de 14/11 (fim da noite): o Asaas tem `POST /v3/payments/{id}/payWithCreditCard`
     ([Pagar uma cobrança com cartão](https://docs.asaas.com/reference/pagar-uma-cobranca-com-cartao-de-credito)),
     que processa na hora e não é idempotente. Mas ele exige um payment já existente, e o Checkout do Qoro só cria o
     payment quando alguém o conclui. Para o fluxo real do R54, o pagamento continua humano.
   - **(b) Autorizar o estorno.** Mesmo no Sandbox ele é uma operação financeira nova. Quem estorna é a clínica no
     Asaas dela; esse é exatamente o caso do R54.
   - O agente pode executar o estorno pela API com a chave Sandbox da clínica sintética, simulando a clínica, **só
     com autorização**.
4. **Valor mínimo apropriado:** **R$ 5,00**, o mínimo por cobrança do Asaas.
   - Fonte: [limites para criação de cobranças](https://central.ajuda.asaas.com/hc/pt-br/articles/31972480144795-Quais-s%C3%A3o-os-limites-para-cria%C3%A7%C3%A3o-de-cobran%C3%A7as).
   - Para provar o parcial e o total na mesma cobrança, **R$ 10,00**: estorno parcial de R$ 4,00, depois total do
     restante.
5. **Estado inicial e final observados:**

   | Momento | Qoro | Asaas |
   | --- | --- | --- |
   | Antes | `patient_charges.status = paid`, uma baixa (`payment_transactions` payment), `valor_pago` cheio | `CONFIRMED`/`RECEIVED`, sem estornos |
   | Depois do parcial (R$ 4,00) | cobrança continua `paid`; 1 linha em `patient_external_refunds` (`external_total` 4,00, `full_refund` false); 1 `payment_transactions` refund ligada à baixa original; `valor_pago` −4,00; pendência "não cobrar novamente sem decisão" | `GET /payments/{id}/refunds`: 1 item `DONE` de 4,00 |
   | Depois do total | cobrança `refunded`; 2ª linha de evidência (`external_total` = bruto, `full_refund` true); a baixa original **continua lá** | 2 itens `DONE` somando o bruto; `REFUNDED` |

   Nenhuma nova cobrança é criada ao paciente. Nenhum repasse é pago ou compensado automaticamente.
6. **Como preservar as evidências** (pasta nova `evidence/tiss-r54-estorno-sandbox-<data>/`, sem dado pessoal):
   - leitura antes e depois de `GET /payments/{id}` e `GET /payments/{id}/refunds`, com ids mascarados;
   - corpo do webhook recebido, já gravado em `asaas_webhook_events`;
   - linhas de `patient_external_refunds`, `payment_transactions`, `patient_credit_adjustments` e `audit_events`
     (`payments.patient_charge.external_refund_recognized`);
   - log do cron `financial-reconcile` (campos `externalRefund*`).
7. **Como garantir que a cobrança de R$ 45 não é afetada:**
   - clínica sintética **nova e própria** (a fixture `e2e-hi-*` desta execução), com cliente Asaas Sandbox próprio;
   - o roteiro recusa seguir se o `provider_payment_id` for o da cobrança de R$ 45 (o id é anotado no pré-voo);
   - a leitura do estado dela antes e depois deve dar exatamente o mesmo resultado.
8. **Reentrega de webhook:**
   - reenviar o mesmo evento pelo painel do Sandbox, ou deixar o Asaas reentregar. Esperado: `200` e nenhuma linha
     nova (idempotência pelo nível acumulado `external_total`, UNIQUE por cobrança);
   - depois, rodar a varredura (`/api/cron/financial-reconcile` com `CRON_SECRET` no Preview) com o webhook já
     processado. Esperado: `externalRefundSkipped`, nada novo.
9. **Como conferir o livro financeiro:**
   - soma de `payment_transactions` da cobrança = bruto − estornos `DONE`;
   - `lancamentos.valor_pago` igual;
   - coparticipação (se a fixture for de coparticipação) `refunded` só quando estornos ≥ pago (função `0158`);
   - o diferencial do R38 (`hi_ledger_entries`) não muda para guia de operadora, porque coparticipação não entra no
     repasse TISS.
10. **Como identificar divergência externa:**
    - total `DONE` no Asaas ≠ soma das evidências → o cron marca a cobrança para nova checagem;
    - valor do pagamento ≠ bruto da cobrança (`amount_mismatch`), estorno acima do pago (`amount_exceeds`), disputa
      aberta ou estorno pedido pelo Qoro ainda aberto → **revisão humana**, sem compensação automática;
    - leitura atrasada (menos estornos do que já registrado) → `unchanged` + métrica; nunca desfaz uma evidência.

## Roteiro (só com autorização)

0. **Autorização do fundador**, por escrito, para:
   - criar uma cobrança Sandbox de R$ 10,00 numa clínica sintética nova e pagá-la com cartão de teste no checkout;
   - estornar R$ 4,00 e depois o restante dessa cobrança, pela API com a chave Sandbox da clínica sintética ou pelo
     painel.
1. Pré-voo, só leitura:
   - Preview com o SHA do #55;
   - `APP_BASE_URL` da branch (memória: webhook vai ao deploy errado sem ela);
   - webhook do paciente habilitado na conta Sandbox da clínica sintética;
   - id e estado da cobrança de R$ 45 anotados.
2. Fixture: `fixture-run.mjs` cria a clínica sintética com conta Asaas Sandbox. O Qoro gera a cobrança de R$ 10,00
   (checkout).
3. **Fundador:** paga no checkout com o cartão de teste aprovado (reCAPTCHA). Conferir no Qoro: cobrança `paid`,
   baixa única.
4. Estorno parcial (R$ 4,00) → aguardar o webhook → conferir a linha 5 da tabela acima.
5. Reentrega do webhook e varredura do cron → nada novo.
6. Estorno do restante → conferir o estado final.
7. Cobrança de R$ 45: estado igual ao do pré-voo.
8. Evidência e plano mestre: só então "R54 homologado no Sandbox".

Até lá, o estado oficial é **R54 implementado e validado localmente; homologação externa pendente de autorização.**

## Participação do fundador: procedimento curto (17/11)

O único passo que precisa de você é **pagar o checkout do Sandbox**, porque ele tem reCAPTCHA. O agente não
contorna o captcha e não usa serviço de resolução. O resto é do agente.

| Item | O que é |
| --- | --- |
| Ambiente | Preview do #55 (banco e Auth do DEV, provados pela prova assinada) e conta **Asaas Sandbox** da clínica sintética. Sem dinheiro real |
| Prova de que é Sandbox | o checkout abre em `sandbox.asaas.com`; a chave da clínica sintética tem o prefixo `$aact_hmlg_` (o roteiro recusa qualquer outra) |
| Fixture | clínica sintética **nova** `e2e-hi-r54-<data>`, paciente e cliente Asaas Sandbox novos. A cobrança histórica de R$ 45 não é usada; o id dela é anotado antes e o roteiro para se aparecer |
| Valor | **R$ 10,00** |
| URL do checkout | gerada **na hora**, quando você disser "pronto" (o checkout expira; gerar antes deixaria uma cobrança Sandbox parada) |

**Passo a passo:**
1. Você responde "pronto para o R54".
2. O agente cria a cobrança de R$ 10,00 pela tela do Qoro e devolve a URL do checkout.
3. **Você** abre a URL, paga com o cartão de teste (Visa 4539 6560 4839 2220, validade futura qualquer, CVV
   qualquer) e resolve o reCAPTCHA.
4. **Você** responde "paguei" e, se possível, o horário aproximado.
5. O agente confere que a cobrança ficou paga, com uma baixa só, e faz o estorno pela API do Sandbox: R$ 4,00 e
   depois o restante. Para isso basta o "pronto" do passo 1, que já cobre o estorno Sandbox.
6. O agente confere o webhook, a reentrega, a varredura do cron, o livro financeiro e o estado da cobrança de
   R$ 45, e grava a evidência em `evidence/tiss-r54-estorno-sandbox-<data>/`.

**Critério de conclusão:** "R54 homologado no Sandbox" só com os três estados da tabela do item 5 (antes,
depois do parcial e depois do total) conferidos no Qoro e no Asaas, a reentrega sem linha nova e a cobrança de
R$ 45 igual. Até lá: **BLOCKED (participação humana)**.

## Execução de 18–19/11 (GO do fundador para UM checkout de R$ 10,00)

**Checkout:** criado em 18/11 às 23h27 UTC pelo caminho real do Qoro, com a fixture `setup-r54`
(`scripts/security/hi-dev-e2e-fixture.ts`, lançador `r54-run.mjs` no scratchpad com ambiente limpo: banco/Supabase/cifra do
DEV, `ASAAS_BASE_URL` conferido como `sandbox.asaas.com`, `APP_BASE_URL` do Preview da branch; nenhuma variável de produção).
Fluxo: atendimento de convênio concluído → guia → coparticipação conferida e confirmada em R$ 10,00 → recebível pelo handler
real → `requestCopayCharge` com `paymentsApiV1.createCopayCheckout`. Clínica sintética `e2e-hi-config-*` (a que tem a
conta Sandbox conectada e o webhook do Preview desta branch). Ajustes só de dados de teste nessa clínica: gestora e médica
sintéticas (as contas da configuração tinham ido para clínicas mais novas), módulo religado (um teste de "módulo desligado"
o deixou desligado) e credenciamento da clínica na operadora (regra da P2.2, posterior à cobrança de R$ 45). A fixture é
idempotente: com cobrança já criada para o atendimento do R54, não cria outra. Validade do checkout: 24 h.

**Verificação de 19/11 (só leitura; `evidence/tiss-r54-estorno-sandbox-2026-11-19/verificacao-pagamento.json`):**
o Asaas Sandbox não tem pagamento ligado ao checkout (`GET /payments?checkoutSession=<id>` vazio; o pagamento mais recente
da conta é o de R$ 45 de 13/11) e a página do checkout segue em "Finalizar pagamento". No Qoro: cobrança `pending`, sem
pagamento do provedor, sem baixa, sem webhook novo; recebível de R$ 10,00 pendente. A cobrança de R$ 45 está igual (paga).
Estado: **PARTIAL / PAYMENT PENDING** — o pagamento não chegou a ser concluído no provedor; o mesmo link serve até a validade.

**Estornos (preparados, não executados):** só depois de pagamento, webhook, baixa única e livro comprovados, e com GO
específico. Ordem: `GET /payments/{id}/refunds` (nada) → `POST /payments/{id}/refund` com `value: 4.00` → conferir o item
`DONE` e o webhook → conferir no Qoro (cobrança `paid`, 1 evidência, refund ligado à baixa original, `valor_pago` 6,00) →
só então o restante (R$ 6,00) → `refunded`, 2 evidências, baixa original preservada. Nunca repetir uma chamada de estorno
com resposta ambígua: ler `/refunds` antes.

**Pagamento (19/11, 02h55 UTC; `pagamento-confirmado.json`):** pagamento `pay_0_u1…iroo` de R$ 10,00 **CONFIRMED** no Asaas, cartão, um só para o checkout. Webhooks reais processados no Preview: `PAYMENT_CONFIRMED` (02:55:59) e `CHECKOUT_PAID` (02:56:03). No Qoro: cobrança `paid` (bruto 10,00, tarifa 0,68, líquido 9,32, igual ao Asaas); **uma baixa** do recebível (R$ 10,00, cartão) apesar de dois eventos; recebível `pago` (saldo `valor - valorPago - valorGlosado` = 0); despesa da tarifa de R$ 0,68 lançada; coparticipação `paid` (recebido 1.000 centavos), com trilha `health_insurance.copay.synced_from_payment`. Nenhuma outra clínica teve baixa, cobrança, webhook ou lançamento na janela; a cobrança de R$ 45 segue igual. Estado: **PARTIAL / REFUND AUTHORIZATION PENDING** (faltam os dois estornos, a reentrega e a varredura do cron, que dependem do GO).

**Estornos autorizados (19/11, "SIM, TUDO"):** o estorno parcial de R$ 4,00 foi recusado pelo Asaas Sandbox duas vezes (02h59 e 03h06 UTC, HTTP 400): "Esta transação só pode ser estornada parcialmente no próximo dia." Regra do provedor para cartão: o parcial só vale depois do processamento, no dia seguinte ao pagamento. Nenhum estorno foi criado (lista de estornos vazia depois de cada tentativa) e o Qoro não mudou. Próximo passo: repetir o parcial UMA vez durante o dia 19/11, lendo o estado antes; o restante de R$ 6,00 só depois do parcial concluído (`estorno-parcial-tentativas.json`).

**Retomada de 19/11, 00h13 de Brasília (`retomada-0013.json`, só leitura):** no Asaas, o pagamento segue `CONFIRMED`, com `confirmedDate` e `clientPaymentDate` em 18/11, `creditDate` previsto para 21/12, `anticipable` falso e nenhum estorno. No Qoro, nada mudou desde antes das tentativas: cobrança `paid`, uma baixa de R$ 10,00, recebível `pago`, coparticipação `paid`, nenhuma evidência de estorno nem trilha nova, e a cobrança de R$ 45 igual. A documentação oficial ([estornar cobrança](https://docs.asaas.com/reference/estornar-cobranca), [guia de estornos](https://docs.asaas.com/docs/estornos)) não publica regra de prazo para o parcial no cartão, nem endpoint de elegibilidade; a única fonte da regra é a mensagem do provedor. A segunda recusa já foi no dia 19/11 pelo calendário de Brasília, então a virada do dia não basta: a condição é o processamento do provedor, que não tem sinal observável na API. **Nenhuma chamada de estorno nesta retomada.** Estado: **R54 PARTIAL — PROVIDER TIMING BLOCKED**. Próxima condição verificável: a partir de 19/11 às 09h00 de Brasília, depois de uma janela noturna completa, ler o estado (`CONFIRMED`, estornos vazios) e fazer UMA tentativa de R$ 4,00; se vier a mesma recusa, nada de nova tentativa no mesmo dia.

**19/11, manhã (`consulta-0715.json`, `estorno-parcial-0901.json`):** às 07h15, consulta só leitura, sem mudança. Às 09h00, condição registrada, nova leitura: pagamento `CONFIRMED`, estornos vazios, Qoro igual ao baseline, cobrança de R$ 45 intacta. Feita **UMA** chamada de estorno parcial de R$ 4,00 às 09h01: HTTP 400, com a mesma mensagem ("Esta transação só pode ser estornada parcialmente no próximo dia"). Conferência só leitura depois da recusa: nenhum estorno no Asaas, nenhum webhook, nenhuma linha nova no Qoro, nenhuma trilha nova. A regra não é a virada do dia pelo calendário, porque 19/11 já é o dia seguinte ao pagamento de 18/11, e a API não expõe o processamento que libera o parcial. No Sandbox, esse processamento pode nem existir. Estado: **R54 PARTIAL — PROVIDER TIMING BLOCKED**. Próxima condição: UMA tentativa no próximo dia útil, segunda 23/11, a partir das 09h00 (20/11 é feriado nacional). Se vier a mesma recusa, parar e levar ao fundador a pergunta ao suporte do Asaas sobre estorno parcial de cartão no Sandbox. Estorno integral de R$ 10,00 no lugar do parcial só com GO novo e específico.

### Pergunta ao suporte do Asaas (rascunho; enviar só se a tentativa de 23/11 for recusada de novo)

> **Assunto:** Sandbox, estorno parcial de cobrança paga com cartão
>
> Olá. No ambiente Sandbox, temos uma cobrança de R$ 10,00 paga com cartão de crédito em 18/11/2026, às 23h55 (Brasília), com status CONFIRMED. Ao chamar `POST /v3/payments/{id}/refund` com `value: 4.00`, recebemos HTTP 400 "Esta transação só pode ser estornada parcialmente no próximo dia." A mesma resposta veio em 18/11 às 23h59, em 19/11 às 00h06 e às 09h01, e em 23/11 às [horário]. Não há estorno registrado na cobrança.
>
> 1. O Sandbox permite estorno parcial de cobrança de cartão? Se sim, a partir de quando (dia útil seguinte, liquidação da captura, outra regra)?
> 2. Depois de um estorno parcial, é possível estornar o saldo restante da mesma cobrança, num segundo estorno?
> 3. Existe alguma limitação do ambiente de homologação para isso que não exista em produção?
>
> Identificador da cobrança: [preencher pelo painel do Sandbox]. Obrigado.

**Até a resposta, nada se conclui:** não declaramos que o Sandbox não suporta o parcial e não trocamos o roteiro por estorno integral sem GO específico.
