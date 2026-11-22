# ADR-067 — Cotas temporárias por clínica durante a avaliação

Status: aceito para implementação candidata pelo founder em 08/11/2026; ativação remota pendente.

## Contexto

O checkout candidato AbacatePay será solicitado ao fim do trial controlado pelo Qoro. O founder definiu que essa avaliação serve para explorar o sistema: 10 pacientes, 15 agendamentos, 15 documentos/receitas somados e 15 por categoria de cadastro financeiro/operacional aprovada. WhatsApp, Asaas recebedor e convites de equipe só devem estar disponíveis após pagamento. Contratos e trials existentes devem ser preservados.

A decisão não altera preços nem vagas contratadas e não autoriza ativar o gateway candidato. Regras completas e abrangência estão na [spec](../specs/trial-interface-e-cotas-2026-11.md).

## Decisão

1. Persistir uma coorte de avaliação separada do status da assinatura. A 0136 não faz backfill e só inscreve novas assinaturas versionadas em trial. `active`, callback e metadado do navegador não equivalem a pagamento.
2. Contabilizar criações efetivadas por triggers nas tabelas de negócio. Contadores cumulativos não diminuem com exclusões e não são reiniciados por período. Rollback também desfaz o consumo. Auditoria, versões e registros técnicos não recebem cotas comerciais.
3. Serializar consumo e liberação pela mesma linha da política. Isso cobre concorrência da última vaga, criação pela IA, importação, recorrência, encaixe e chamadas diretas sem duplicar lógica de contagem nos formulários.
4. Negar novas integrações e convites antes de qualquer efeito externo. Repetir o gate no seam de persistência e manter backstop no banco. Não desconectar nem remover dados de contas existentes.
5. Liberar mediante escrita privilegiada após leitura autoritativa e materialização de invoice positiva e paga, vinculada à mesma assinatura/clínica. `authenticated` não tem escrita nas políticas/contadores, mesmo tendo acesso legado a outras tabelas de Billing. Não oferecer função RPC pública que libere por status local.
6. Manter as cotas de médicos/equipe do plano e os controles de segurança após a remoção das restrições de avaliação. Cancelamento ou inadimplência continuam regidos pelo Billing; não recomeçar um trial.

## Consequências

- A cota se refere a registros criados, não à quantidade ainda visível. Reagendamento que cria outra linha conta novamente; regeneração de um PDF existente não conta.
- Receitas e outros documentos clínicos compartilham uma cota; não criar um limite independente por tipo que multiplique a franquia.
- Correções financeiras referenciadas continuam possíveis. Impedir estorno para impor cota seria comprometer a integridade financeira.
- O bloqueio do banco cobre atores de sistema que o gate genérico de inadimplência normalmente dispensa. O término do trial também é conferido para novas criações da coorte.
- A atualização exige migration antes do código que lê as tabelas. Antes de aplicá-la num DEV compartilhado, considerar os demais Previews: novas assinaturas elegíveis criadas por eles também serão inscritas. Em produção, manter novas entradas fechadas na janela coordenada.
- O worker candidato AbacatePay ainda deve usar a mesma fronteira de liberação após sua homologação. Esta ADR não apresenta um parser de webhook ou ensaio sintético como prova de pagamento externo.

## Validação

Usar o schema completo e identidades sintéticas em PostgreSQL loopback. Cobrir cotas exatas, corrida, rollback/exclusão, coorte antiga, RLS, pagamento falso/zero/cruzado, liberação idempotente, convites e integrações antes/depois do pagamento. Unitários verificam que os gates antecedem Meta/Asaas/Auth/e-mail e que erros conhecidos são legíveis sem expor SQL. Testes das telas mostram a explicação antes do checkout e removem o aviso após liberação. Evidências no [relatório](../quality/trial-resource-limits-2026-11-08.md).
