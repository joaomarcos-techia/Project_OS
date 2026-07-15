# Runbook — Webhook Asaas não chegou / pagamento divergente

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-15 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> C16 FASE 9. SEV2. Há rede de segurança automática — não precisa de pânico.

## Sintoma
- Pagamento confirmado no Asaas mas a invoice local segue `overdue`/`pending`.
- Cliente reclama de cobrança/suspensão indevida.
- Better Stack: ausência de eventos `billing.webhook.*` num período esperado.

## Como o sistema já se protege
- Webhook idempotente + dedup por `processed_webhooks` (asaas_event_id).
- **Safety-net**: o cron diário **`/api/cron/billing-reconcile`** consulta o Asaas e corrige divergências pelo MESMO caminho idempotente do webhook (ADR-025). Ou seja, um webhook perdido é reconciliado em até ~24h sozinho.
- **Verify-then-act (A2, 2026-07-15)**: o webhook não confia no corpo. Ele extrai só os ids e consulta `getPayment()` no Asaas para decidir. Consequência operacional: **se o Asaas estiver fora, o webhook devolve 500 e NÃO persiste nada** — de propósito. O Asaas re-entrega e o reconcile cobre. Um 500 aqui é fail-safe, não perda de dado.

## Diagnóstico
1. No Asaas: o pagamento existe e qual o status? Há tentativa de webhook falhada (Asaas mostra o log de entrega)?
2. Validação: o webhook usa header `asaas-access-token` (constant-time). Token errado → 401 (não processa). Confira `ASAAS_WEBHOOK_TOKEN`.
3. Better Stack: o POST chegou (e foi rejeitado) ou nunca chegou?
4. **Filtrar `billing.webhook.verify`** (A2). O `outcome` diz onde está o problema:
   - `timeout` → Asaas lento/indisponível ou circuit breaker aberto. Nada foi perdido; aguarde a re-entrega ou force o reconcile.
   - `failure` → o `payment.id` do corpo **não existe no Asaas** (4xx). Isso é anomalia: webhook forjado, pagamento apagado, ou token/ambiente trocado (sandbox × prod). **Investigar, não ignorar.**
   - `duration_ms` subindo (p95 > 5s) → ver `c16/slo.md` §3.1; caminhando para estourar o `maxDuration` de 30s.
5. **`billing.webhook.unparseable`** → corpo sem `body.id`. O Asaas sempre manda `evt_...`; se aparecer, é corpo forjado ou mudança de contrato do provider.

## Resolução
- **Token divergente**: alinhe `ASAAS_WEBHOOK_TOKEN` (env) com o configurado no painel Asaas; redeploy.
- **Webhook perdido / urgência**: rode **`/api/cron/billing-reconcile`** manualmente (Bearer CRON_SECRET) para reconciliar já, em vez de esperar o ciclo diário.
- **Divergência persistente**: compare invoice local vs Asaas; a reconciliação reaplica o estado do provedor (fonte da verdade do pagamento).
- **`verify.outcome=failure` recorrente**: trate como incidente de segurança em potencial — alguém pode ter o token e estar postando eventos forjados. O A2 impede que isso mude estado, mas o token deve ser **rotacionado** (`runbooks/secret-rotation.md`).

## Comunicação
- Se houve suspensão indevida (dunning D+15/D+30): após reconciliar, o acesso é restaurado pela transição de estado; confirme `clinics.status` e avise o cliente.
