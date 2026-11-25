# ADR-070 — cancelamento da renovação e nova contratação AbacatePay

## Complemento — escolher outro plano ao recontratar (24/11/2026)

O titular que pagou por Pix Automático pode usar o cancelamento da renovação para trocar a mensalidade. O acesso e as cotas atuais duram até o fim do período pago; não existe cobrança proporcional. Depois do término e da confirmação do cancelamento externo, a tela oferece os planos mensais configurados. O novo preço e produto são resolvidos no servidor; a capacidade ativa da clínica precisa caber no plano menor. O checkout gera uma nova autorização Pix ou cartão e permanece único por geração cancelada. Uma tentativa pendente fixa o plano escolhido e deve ser retomada, não substituída silenciosamente. O Qoro só atualiza plano, preço, invoice e direitos quando comprova o pagamento integral da nova assinatura. Checkout expirado ou estado ambíguo exige reconciliação, sem repetir criação cegamente. O código candidato está no PR #53 `8f8cd606`; Production e Asaas legado não foram alterados. Este complemento não autoriza C4 nem publicação.

Status: regra aprovada pelo founder em 08/11/2026 (Brasília); 47 verificações PostgreSQL aprovadas, 0139 autorizada/aplicada somente no DEV e cancelamento da fixture Sandbox comprovado em 09/11. Recontratação após passagem temporal real continua pendente; código testado com relógio/dados sintéticos locais. Não altera contratos Asaas nem autoriza Produção ou migrations remotas adicionais. [Evidências e limites](../quality/abacatepay-cancelamento-recontratacao-2026-11-08.md).

## Regra aprovada

A [AbacatePay cancela a assinatura de modo irreversível](https://docs.abacatepay.com/pages/subscriptions/cancel). O Qoro não apresentará “Manter assinatura” para essa origem. A solicitação cancela a renovação, conserva o período já pago e não solicita estorno automático. O sucesso exige readback autenticado de CANCELLED, na conta/cliente/assinatura persistidos. Timeout não significa sucesso e não permite repetir POST cegamente.

Depois do fim exato do período pago, o titular pode fazer uma nova contratação pelo mesmo cadastro/clínica. É um novo checkout e uma nova assinatura externa, sem novo trial, sem sobrescrever IDs antigos e sem reabrir a clínica somente por redirect. Novo pagamento integral comprovado abre um novo mês pela política da ADR-069, com início nunca anterior ao término do contrato anterior. Nenhum checkout novo deve ser emitido durante o período pago remanescente.

Login e leitura seguem a política existente; cancelamento financeiro não desativa profiles nem apaga prontuários. Ao terminar o período cancelado, a tolerância de inadimplência não o estende. Recontratar exige pagamento verificado para voltar a escrever.

## Persistência e implementação

O binding inicial da 0138 é imutável e foi preservado. A migration aditiva 0139 implementa intenções de cancelamento e novas contratações privadas, FKs compostas, snapshots imutáveis, FORCE RLS, privilégios mínimos e deduplicação. O registro atual de subscriptions é a projeção vigente da clínica; cada contratação externa e sua invoice permanecem identificadas no histórico privado. O journal possui uma categoria própria para checkout de nova contratação. Não editar a 0138 já aplicada.

O cancelamento resolve o contrato externo vigente, congela período/identidade antes do comando, registra auditoria e só confirma o estado local após leitura da origem. A nova contratação fica vinculada ao cancelamento confirmado anterior, ao preço resolvido no servidor e a uma única obrigação. Cliques repetidos e resultados desconhecidos conservam a mesma operação. Webhook tardio do contrato anterior não pode cancelar ou reativar o contrato seguinte.

As rotas devem usar origem confiável, sessão/permissão fresca e clinicId do servidor. Não aceitar preço, período, conta ou tenant do navegador. As telas informam a data final e a indisponibilidade de desfazer o cancelamento. Os comandos Asaas e seus botões mantêm o comportamento existente.

## Validação necessária

PostgreSQL real com dados sintéticos: concorrência, rollback, histórico imutável, isolamento, cancelamento confirmado/timeout, período ainda ativo, fim do período, um novo checkout, pagamento completo/incompleto, invoice única, eventos antigos e trial não reiniciado. Testes de rota/UI e regressão Asaas. A homologação externa deve identificar a fixture antes de cancelar no Sandbox e preservar os registros financeiros. Passagem temporal simulada não é observação de um mês real.

Aplicação da 0139 no DEV foi autorizada especificamente após os gates: histórico 139 → 140, somente essa migration, dados anteriores preservados. Nenhuma nova cobrança real, migration de Produção ou migração de clientes está autorizada. A prova externa conservou a invoice paga e o acesso até o prazo original; não apagou a fixture nem emitiu novo checkout.
