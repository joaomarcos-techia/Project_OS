# Runbook — Webhook Asaas não chegou / pagamento divergente

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
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

## Diagnóstico
1. No Asaas: o pagamento existe e qual o status? Há tentativa de webhook falhada (Asaas mostra o log de entrega)?
2. Validação: o webhook usa header `asaas-access-token` (constant-time). Token errado → 401 (não processa). Confira `ASAAS_WEBHOOK_TOKEN`.
3. Better Stack: o POST chegou (e foi rejeitado) ou nunca chegou?

## Resolução
- **Token divergente**: alinhe `ASAAS_WEBHOOK_TOKEN` (env) com o configurado no painel Asaas; redeploy.
- **Webhook perdido / urgência**: rode **`/api/cron/billing-reconcile`** manualmente (Bearer CRON_SECRET) para reconciliar já, em vez de esperar o ciclo diário.
- **Divergência persistente**: compare invoice local vs Asaas; a reconciliação reaplica o estado do provedor (fonte da verdade do pagamento).

## Comunicação
- Se houve suspensão indevida (dunning D+15/D+30): após reconciliar, o acesso é restaurado pela transição de estado; confirme `clinics.status` e avise o cliente.
