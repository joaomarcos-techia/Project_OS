# R54: procedimento de homologação do estorno externo no Asaas Sandbox

**Estado:** preparado, **não executado**. Executar depende de autorização expressa do fundador (ver passo 0).
**Data:** 14/11/2026.

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
     reCAPTCHA humano (visto em 13/11). O Sandbox não tem endpoint para confirmar pagamento por API; a alternativa
     documentada é o botão "Confirmar pagamento" no painel do Sandbox, também humano.
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
