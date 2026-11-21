# P10.5 — coparticipação no Asaas Sandbox (13/11/2026)

Homologação **no alcance do Sandbox** do caminho cobrança → pagamento → webhook → baixa da
coparticipação de convênio. Clínica e paciente sintéticos (`e2e-hi-config-mwf3d1lt`), consulta de
R$ 150,00, coparticipação confirmada de R$ 45,00. Só chave de homologação (`$aact_hmlg_`); nada em
produção, nenhuma cobrança real. O pagamento foi feito pelo fundador (reCAPTCHA humano), com cartão
de teste do Sandbox.

## Linha do tempo

1. **Preparo (12 pontos, só leitura)** — `1-preparo-checkout-1.json`: checkout só no Sandbox,
   R$ 45,00 (a página não cita 150,00), sintéticos, sem credencial live, válido, webhook da branch
   habilitado e não interrompido, retornos na origem da branch, banco DEV, idempotência (índices),
   cobrança ligada à guia e à coparticipação, recebível pronto, consulta ao provedor.
2. **Correção antes do pagamento (`164a2af0`)** — sem cron no Preview, a baixa e a coparticipação
   "paga" não andariam depois do webhook. O webhook agora processa logo depois da resposta só os
   eventos desta cobrança e sincroniza a coparticipação; o `financial-reconcile` é a garantia.
3. **Tentativa por Pix** — o checkout criou uma cobrança Pix PENDENTE; no Sandbox o QR não é pago por
   app de banco, então nada foi pago e nada foi identificado (correto). Para não haver duas
   cobranças abertas: a Pix pendente foi cancelada no Sandbox (o link antigo ficou inutilizável) e
   um link novo foi gerado pela **renovação real do sistema** (`renewRemainderHostedCheckout`):
   geração 2 da MESMA cobrança. `3-preparo-checkout-2-cartao.json`.
4. **Pagamento por cartão** — `4-depois-do-pagamento.json`:
   - Asaas: `CONFIRMED`, R$ 45,00, `CREDIT_CARD`;
   - webhooks recebidos: `PAYMENT_CONFIRMED` e `CHECKOUT_PAID` (dois para o mesmo pagamento);
   - cobrança paga com o id do pagamento; geração 2 `paid`;
   - outbox: `patient_charge.paid`, `patient_credit.granted`, `lancamento.paid` processados na
     1ª tentativa, sem cron;
   - livro: recebível R$ 45,00 **pago**, **uma** transação (cartão);
   - coparticipação **paga** (4.500 centavos) sem ninguém clicar em "Atualizar situação".
5. **Reentrega** — `5-reentrega-do-webhook.json`: mesmo evento → `ignored`; evento novo do mesmo
   pagamento → `already_paid`; token errado → 401; continua uma baixa só.

## O que NÃO foi provado aqui

- **Estorno no Sandbox**: um estorno feito direto no Asaas (sem chargeback) **não** é refletido no
  Qoro — o webhook só confirma estornos que o próprio Qoro pediu (D50). Pela decisão vigente, a
  devolução é feita pela clínica no Asaas dela; o registro no livro é manual. Não executado para não
  deixar Asaas e Qoro divergentes de propósito. A conciliação automática de estorno externo fica
  como tarefa (ver plano mestre).
- **Auditoria**: o recebimento pelo gateway não gravava `audit_events`; corrigido depois desta
  evidência (`health_insurance.copay.synced_from_payment`, ator de sistema, com a origem). A prova
  está no harness `health-insurance-copay-charge-db.ts` (9a e 9c).
- Homologação com operadora real e produção: não se aplicam a este teste.
