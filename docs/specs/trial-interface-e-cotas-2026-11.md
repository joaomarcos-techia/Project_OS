# Avaliação com cotas e integrações após pagamento

Decisão do founder em 08/11/2026. Implementação candidata em `feat/billing-abacatepay-20261107`, sem ativação em ambiente remoto. O onboarding novo será discutido separadamente.

## Regra aprovada

O trial continua com prazo absoluto de 14 dias desde a criação no Auth. Na jornada candidata AbacatePay, o Qoro controla o prazo e solicita o checkout ao final. Esta entrega de cotas não troca a jornada Asaas existente nem ativa o gateway candidato.

| Categoria | Total permitido durante a avaliação |
| --- | ---: |
| Pacientes | 10 |
| Agendamentos, incluindo encaixes e registros de importação/recorrência | 15 |
| Documentos clínicos e receitas, somados | 15 |
| Registros de pagamento no financeiro | 15 |
| Contas a receber | 15 |
| Despesas | 15 |
| Procedimentos | 15 |
| Recursos da agenda | 15 |
| Modelos de documento/receita | 15 |

WhatsApp, conexão com Asaas e convite/reenvio de convite de equipe ficam indisponíveis enquanto a assinatura não tiver pagamento confirmado pelo servidor. O atendente incluído no plano também exige esse primeiro pagamento para ser convidado.

As cotas são por clínica, cumulativas durante toda a avaliação, sem reinício por dia ou mês. Excluir, cancelar, mesclar ou arquivar não recupera a cota. Reagendar gera um novo registro no modelo atual e também conta. Uma operação repetida com a mesma chave idempotente não cria outra linha nem consome de novo. Edição, leitura, exportação e regeneração de um PDF existente não consomem outra unidade. Receita e atestado não têm cotas separadas. Tentativas que falham/sofrem rollback não gastam cota.

Estornos e correções financeiras referenciadas não são novas vendas e não devem ser impedidos pela cota. Eventos, auditorias, versões técnicas e processamento de pagamentos não recebem cotas arbitrárias: limitar essas linhas quebraria consistência e segurança. As cotas aprovadas são as entidades comerciais da tabela, não todo `INSERT` técnico.

Após o pagamento, as restrições desta avaliação desaparecem. Permanecem as vagas de médicos/equipe contratadas, permissões, limites técnicos de segurança, rate limits e obrigações de reconciliação. Não há alteração de preço, vencimento, desconto vitalício ou direito legado.

## Quem recebe a regra

A migration `0136_trial_resource_limits.sql` não faz backfill. Um trigger inscreve somente assinaturas **criadas depois da aplicação**, com plano da oferta 2026, estado inicial `trial` e `enforce_trial_deadline=true`. O titular já deve existir na clínica. Assinaturas existentes, inclusive trials existentes, não são inscritas. Planos legados e contas já provisionadas como pagas são preservados.

As políticas têm vínculo com a assinatura e o titular; os contadores não armazenam conteúdo clínico. `authenticated` pode ler apenas a própria clínica e não pode inserir, alterar ou apagar políticas/contadores. A criação por SQL, IA, importação, recorrência, encaixe ou Server Action passa pelos mesmos triggers das tabelas de negócio.

Migration e funções verificam que seu proprietário tem os privilégios necessários para ler a coorte com FORCE RLS. Uma configuração inadequada falha explicitamente, em vez de tratar uma linha invisível como contrato legado. Depois de pago, os triggers não adquirem o lock de contagem da avaliação. A referência à invoice permite o cleanup autorizado da clínica inteira na mesma transação, sem permitir apagar isoladamente uma invoice ainda referenciada.

## Pagamento e liberação

`releaseTrialAfterVerifiedPaymentTx` só deve ser chamado por código privilegiado após leitura autoritativa do provedor. O fluxo Asaas existente chama a função na mesma transação de `markInvoicePaid`, após a ativação válida e a atualização do acesso. Uma assinatura cancelada não passa por essa liberação.

A função exige invoice positiva, paga, com data de pagamento e pertencente à mesma clínica/assinatura. Não aceita pagamento de paciente, invoice de outra clínica, invoice aberta ou zero. Não existe RPC pública de liberação. Marcar a assinatura como `active`, voltar pelo callback ou forjar uma invoice com a sessão `authenticated` não concede UPDATE na política. A integração candidata AbacatePay ainda precisa materializar a invoice verificada no worker e usar essa mesma fronteira; o parser do webhook sozinho não concede acesso.

Liberação e consumo se serializam na linha da política. Isso evita passar da cota na última vaga ou liberar parcialmente uma clínica. A liberação é idempotente e não zera/apaga os contadores históricos. Inadimplência posterior continua regida pelos controles de acesso do Billing; não transforma o cliente pago em novo trial.

## Arquivos e pontos de controle

- `src/lib/trial-access/policy.ts`: valores, rótulos e erros seguros.
- `src/lib/trial-access/index.ts`: leitura por tenant, preflight das integrações e liberação privilegiada.
- `src/contexts/billing/schema.ts`: tipos das duas tabelas novas.
- `drizzle/migrations/0136_trial_resource_limits.sql`: inscrição, RLS/grants, contagem atômica e travas de integração/equipe.
- `src/lib/idempotency/mutation.ts`: tradução apenas dos constraints conhecidos para erro legível, sem expor SQL.
- `src/contexts/messaging/actions.ts` e `src/contexts/payments/actions.ts`: recusa antes de chamar Meta/Asaas.
- `src/lib/messaging/connection-store.ts` e `src/lib/payments/account-store.ts`: repetição do gate na persistência.
- `src/contexts/identity/internal/members.ts`: recusa antes de criar Auth user, link ou e-mail.
- `src/contexts/billing/internal/subscriptions.ts`: liberação após pagamento confirmado.
- Layout do app e páginas de configurações/equipe: contadores e mensagens coerentes com o servidor.
- `src/app/(app)/(shell)/_actions/create-limited.ts`: adapters de UI para procedimentos e modelos; a cota volta como resultado legível em produção, sem alterar os contratos das actions de domínio. Falhas inesperadas continuam propagadas para monitoramento.

## Validação e ativação

O ensaio `scripts/security/trial-resource-limits.ts` usa o PostgreSQL local descartável do helper existente, endereço loopback fixo, migrations reais e somente identidades sintéticas. Não envia mensagens, cria cobranças ou conecta serviços. A evidência registra os resultados realmente observados; ver [relatório](../quality/trial-resource-limits-2026-11-08.md).

Não foi aplicada migration no DEV ou em produção nesta entrega. Para ativar no Preview: revisar/autorizar a 0136 no DEV, conferir o histórico antes de executar, publicar a branch candidata e testar uma nova clínica sintética. Uma clínica pré-existente não é fixture válida de inscrição automática porque o acordo preserva contas existentes. Não converter clientes reais em trial nem alterar assinaturas para fabricar essa evidência.

A geração automática do Drizzle encontrou drift anterior no snapshot (pergunta de rename de `clinics.cnpj` para `cnpj_encrypted`) e não gerou a migration. Nenhuma opção foi escolhida e nenhuma alteração daquela coluna foi incluída. A 0136 é SQL aditivo escrito/revisado e testado sobre o schema real; o journal recebe a entrada correspondente. O snapshot anterior não foi reescrito para esconder a divergência pré-existente.

Na aplicação futura: fechar novas entradas conforme o runbook, usar transação e `lock_timeout`, interromper se não adquirir os locks, conferir ausência de backfill e validar a clínica sintética antes de reabrir. Os triggers exigem locks breves nas tabelas de negócio; não há varredura/backfill de pacientes nem rewrite de contratos. Não remover políticas/contadores para rollback; preservar o histórico e preparar correção progressiva. Produção depende de autorização própria.
