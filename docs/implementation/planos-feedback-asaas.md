# Troca de planos e central de feedback

## Escopo

Esta implementação usa exclusivamente o Asaas. Não cria integração Stripe nem altera as quotas de pacientes, mensagens/IA ou agendamentos: elas continuam métricas de uso, sem bloquear uma troca de plano.

## Assinatura

- `subscription_change_requests` registra a intenção, autor, IP, origem, request id, rateio, estado do pagamento e aplicação.
- Upgrade persiste o pedido antes de chamar o Asaas. A cobrança avulsa recebe `externalReference=plan-change:<uuid>`; em timeout, a próxima tentativa busca a referência antes de criar um novo pagamento.
- O webhook verifica o pagamento no Asaas, confere o valor proporcional e só então aplica o plano local, histórico, evento de outbox e auditoria. A atualização de `subscriptions.plan_id` usa o trigger existente que renova as claims de permissões.
- Downgrade é agendado para o fim do ciclo. Tanto na solicitação como na virada, o sistema exige **exatamente um usuário ativo**. A reconciliação diária atualiza somente futuras cobranças da assinatura no Asaas e aplica a alteração local de modo idempotente.
- Dados nunca são removidos. Cancelamento permanece modelado com a mesma política de fim de ciclo; esta entrega não expõe uma nova ação de cancelamento.

## Feedback

- `feedback_suggestions` guarda sugestão, contexto técnico, status, notas e anexos como metadados. Não há bucket de upload específico já provisionado; portanto a UI não oferece upload nem aceita arquivos.
- Usuários veem apenas registros criados por eles (`clinic_id` e `user_id` no serviço tenant-scoped). O super-admin usa `dbAdmin`, AAL2 e `superAdminAction` auditada.
- `feedback_history` preserva criação, mudanças de status, arquivamento, exclusão lógica e o ator que alterou.
- O console `/admin/feedbacks` oferece pesquisa, filtros por status/categoria/data/clínica/usuário, ordenação, CSV limitado a 5.000 linhas e métricas agregadas.

## Validação desta entrega

- TypeScript: `tsc --noEmit`
- Testes focados: provider Asaas, troca de plano, webhook, ações críticas e isolamento do admin.
- Antes de aplicar em um ambiente, rode `pnpm check:migrations`; a migration `0072_plan_changes_and_feedback.sql` é aditiva e não deve ser aplicada automaticamente por esta entrega.

## Riscos e evolução

- A chamada remota de atualização da recorrência no fim do ciclo ocorre fora da transação local para não reter conexão durante I/O. Reexecuções são seguras porque a operação Asaas é PUT de estado desejado e a aplicação local é idempotente.
- Se for desejado anexar imagens, provisionar primeiro um bucket privado, regras de MIME/tamanho, varredura e URLs assinadas; só então popular `attachments`.
