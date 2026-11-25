# ADR-071 — reembolso, disputa e acesso AbacatePay

Status: **aprovada pelo founder em 09/11/2026; implementação local validada, homologação financeira externa pendente**. Somente assinaturas SaaS AbacatePay. Não altera contratos Asaas, descontos vitalícios ou pagamentos dos pacientes.

## Decisão

Reembolso ou chargeback mantém o acesso até o fim do período pago e encaminha a ocorrência para revisão humana. Um evento de ciclo antigo não pode bloquear um ciclo novo já pago. Não cancelar a recorrência, emitir reembolso, cobrar retroativamente ou reescrever o histórico por consequência automática dessa notificação.

## Evidência e efeito

O webhook autenticado sinaliza a ocorrência, mas não substitui a consulta financeira vinculada à loja, assinatura, cliente, produto e cobrança corretos. Um checkout que ainda aparece como PAID não prova nem refuta um refund. O leitor procura débitos de categoria refund no extrato; reversões ou dados insuficientes ficam ambíguos. Disputa recebida não significa disputa perdida ou ganha.

O histórico registra a evidência e encaminha para revisão. Quando há débito de refund confirmado para o exato período pago atual e sua geração, a carência termina junto com esse período; não são acrescentados quinze dias não pagos. O fim contratado e a invoice original permanecem intactos. Um evento antigo ou sem prova financeira suficiente não encurta período nem carência novos. Uma renovação nova comprovada pode conceder seu período normal.

Essa automação não representa uma decisão sobre o mérito de disputa ou uma quitação do estorno. O responsável humano deve conferir o provedor antes de qualquer ação financeira ou alteração adicional de direitos.

## Validação e limites

`scripts/security/abacatepay-renewal-db.ts` usa PostgreSQL real, migrations reais e HTTP sintético, sem rede externa. Cobre reembolso parcial/integral, falha temporária, concorrência, auditoria única, escrita durante o período, bloqueio após projeção local do término e proteção do ciclo novo contra refund antigo. A projeção temporal não equivale a observar o mês transcorrer no Sandbox.

Eventos externos de refund, disputa, chargeback e reversão ainda precisam de prova própria. Não alterar a fixture paga/cancelada retida para produzir essa evidência. Ver [relatório final](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md).
