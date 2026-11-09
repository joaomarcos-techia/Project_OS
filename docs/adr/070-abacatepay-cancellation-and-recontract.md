# ADR-070 — cancelamento da renovação e nova contratação AbacatePay

Status: regra aprovada pelo founder em 08/11/2026 (Brasília); implementação e validação em andamento, somente candidata Sandbox. Não altera contratos Asaas nem autoriza Produção ou migrations remotas adicionais.

## Regra aprovada

A [AbacatePay cancela a assinatura de modo irreversível](https://docs.abacatepay.com/pages/subscriptions/cancel). O Qoro não apresentará “Manter assinatura” para essa origem. A solicitação cancela a renovação, conserva o período já pago e não solicita estorno automático. O sucesso exige readback autenticado de CANCELLED, na conta/cliente/assinatura persistidos. Timeout não significa sucesso e não permite repetir POST cegamente.

Depois do fim exato do período pago, o titular pode fazer uma nova contratação pelo mesmo cadastro/clínica. É um novo checkout e uma nova assinatura externa, sem novo trial, sem sobrescrever IDs antigos e sem reabrir a clínica somente por redirect. Novo pagamento integral comprovado abre um novo mês pela política da ADR-069, com início nunca anterior ao término do contrato anterior. Nenhum checkout novo deve ser emitido durante o período pago remanescente.

Login e leitura seguem a política existente; cancelamento financeiro não desativa profiles nem apaga prontuários. Ao terminar o período cancelado, a tolerância de inadimplência não o estende. Recontratar exige pagamento verificado para voltar a escrever.

## Persistência e implementação

O binding inicial da 0138 é imutável e será preservado. Preparar a migration aditiva 0139 com intenções de cancelamento e novas contratações privadas, FKs compostas, snapshots imutáveis, FORCE RLS, privilégios mínimos e deduplicação. O registro atual de subscriptions é a projeção vigente da clínica; cada contratação externa e sua invoice permanecem identificadas no histórico privado. O journal terá uma categoria própria para checkout de nova contratação. Não editar a 0138 já aplicada.

O cancelamento resolve o contrato externo vigente, congela período/identidade antes do comando, registra auditoria e só confirma o estado local após leitura da origem. A nova contratação fica vinculada ao cancelamento confirmado anterior, ao preço resolvido no servidor e a uma única obrigação. Cliques repetidos e resultados desconhecidos conservam a mesma operação. Webhook tardio do contrato anterior não pode cancelar ou reativar o contrato seguinte.

As rotas devem usar origem confiável, sessão/permissão fresca e clinicId do servidor. Não aceitar preço, período, conta ou tenant do navegador. As telas informam a data final e a indisponibilidade de desfazer o cancelamento. Os comandos Asaas e seus botões mantêm o comportamento existente.

## Validação necessária

PostgreSQL real com dados sintéticos: concorrência, rollback, histórico imutável, isolamento, cancelamento confirmado/timeout, período ainda ativo, fim do período, um novo checkout, pagamento completo/incompleto, invoice única, eventos antigos e trial não reiniciado. Testes de rota/UI e regressão Asaas. A homologação externa deve identificar a fixture antes de cancelar no Sandbox e preservar os registros financeiros. Passagem temporal simulada não é observação de um mês real.

Aplicação da 0139 no DEV depende de autorização específica após os gates locais. Nenhuma nova cobrança real, migration de Produção ou migração de clientes está autorizada.
