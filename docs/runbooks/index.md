---
title: "Procedimentos operacionais"
description: "Encontre o procedimento certo para migração, publicação, recuperação e diagnóstico, sem confundir instrução com autorização."
docType: "index"
---

Um runbook descreve como executar uma operação. A existência do documento não
autoriza alterações em banco, provedores ou Produção. Confira o ambiente, a
revisão do código e as permissões antes de seguir os comandos.

## Rotinas centrais

| Preciso fazer | Comece por | Confira também |
| --- | --- | --- |
| Preparar uma publicação | [Prontidão](/runbooks/production-readiness) | [Deploy e observabilidade](/operations/deployment-observability) |
| Examinar migrations | [Migrations](/runbooks/migrations) | [Banco e tenancy](/database/schema) |
| Recuperar o serviço | [Recuperação de desastre](/runbooks/disaster-recovery) | Cobertura separada de banco, arquivos Storage, Auth, chaves e configurações |
| Diagnosticar inscrição ou pagamento | [Cadastro](/onboarding/signup) | [Assinaturas](/billing/subscriptions) e [provedores](/integrations/providers) |
| Diagnosticar mensagem ou agendamento | [WhatsApp](/whatsapp-connection-flow) | [Agente](/ai/agent) e [agenda](/domains/scheduling-financial) |

## Procedimentos específicos e janelas anteriores

O [catálogo completo](/catalog) reúne também runbooks de uma janela,
fornecedor ou versão específica. Um roteiro datado de publicação não significa
que os passos continuam pendentes nem permite repeti-los sobre Produção.
Cruze os registros com o journal, o deployment e o estado remoto autorizado.

## Evidência operacional

Registre data, ambiente, revisão, identificador sanitizado, resultado observado,
critério de interrupção e recuperação. Nunca inclua senha, conteúdo clínico,
código ativo, token, link assinado ou URL com bypass. Um restore SQL aprovado
não comprova sozinho a recuperação de arquivos e configurações gerenciadas.
