# Rollback de provedor — roteiro futuro

**Ativar somente para a janela/capacidade autorizada.** Matrizes de decisão em [plano de rollback](../decoupling/12-plano-de-rollback.md); contexto em [cutover](provider-cutover.md). Não restaure banco sobre produção automaticamente.

## Procedimento

1. **Declarar contenção.** Registrar hora/run ID/falha/gate e responsável. Parar novas operações no componente afetado; preservar serviço de leitura se seguro. Não usar desligamento indiscriminado de clínica como controle técnico.
2. **Parar duplicidade.** Desligar scheduler/writer novo antes de reativar antigo; manter endpoints recebendo duravelmente onde implementado e não descartar eventos. Registrar leases e efeitos remotos desconhecidos.
3. **Fotografar os dois estados.** Exportar apenas metadados/contagens/checkpoints permitidos e backup protegido autorizado. Não registrar conteúdo clínico, segredo, payload bruto financeiro ou URL assinada em log.
4. **Classificar efeitos.** Houve escrita DB, upload/delete, senha/reset/revogação, cobrança/mensagem externa ou apenas troca de host? Commit/DNS só bastam no último caso e com schema/config compatíveis.
5. **Reconciliar antes do retorno.** Usar checkpoint/delta para registros, hashes/tombstones para objetos, epoch/subject/reset para identidade e readback no provider da obrigação para financeiro. Nenhuma cobrança incerta é recriada na origem sem prova.
6. **Escolher rollback ou forward-fix.** Se reverse sync não foi ensaiado, faltam deltas ou há efeitos irreversíveis, manter contenção e corrigir à frente com aprovação concreta. O plano não autoriza apagar esses efeitos.
7. **Retornar release/rota.** Promover última versão segura compatível com schema expandido; corrigir origens/proxy/TLS. Reautenticação pode ser necessária; não reativar credencial revogada para evitar atrito.
8. **Retomar um executor.** Religar writer/scheduler único; jobs com leases e guards; observar backlog, refunds/disputas e callbacks antigos. Guardar binding de provider que recebeu qualquer efeito.
9. **Validar.** Smoke funcional + segurança tenant + consistência DB/objetos/financeiro + health/alerta. Compare com snapshot e log de operações posteriores; zero perdas/duplicidades não explicadas.
10. **Encerrar incidente.** Owner confirma retomada; registrar duração observada, dados/obrigações preservados, exceções, comunicação autorizada e ações preventivas. Não remover destino/backup/evidência até retenção aprovada.

## Evidência mínima

SHA/releases retornados, ambiente e capacidade; checkpoints; número agregado de operações/objetos reconciliados; verificações de isolamento/ACL; dívida/recorrência/benefício por operação sintética; duração real; owner/aprovador. Se houver dados reais, registro protegido com acesso mínimo e sem identificadores pessoais neste relatório Git.

Não usar `DELETE`, reset scripts, migration DOWN ou restauração física de backup antigo como atalho de retorno. Nenhum comando destrutivo aparece aqui porque a reversão correta depende do estado da janela e deve ser revisada antes de execução.

## AbacatePay Sandbox — recuperar trabalho interrompido ou revisar ambiguidade

### Monitor de integridade de recorrências

O monitor da candidata inspeciona checkouts conhecidos, inclusive de gerações antigas e recontratação pendente. Faz somente GETs remotos; reserva/auditoria ficam no `billing_events` existente. Não altera valores, cotas, invoices, acesso ou recorrência. O propósito é sinalizar para revisão humana, **não impedir o pagamento de uma URL copiada no provedor**.

1. Confirmar branch/SHA, Sandbox e a conta antes de acionar uma leitura administrativa. Não usar contrato real nem copiar payload/credencial para o chat. A [seção 27](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md#27-continuidade-sem-aguardar-suporte--09112026) identifica as provas.
2. Consultar os eventos `subscription.recurrence.checked`, `observed`, `review_required` e `check_failed`. Correlacionar pelo `checkId`/`generationId` no ambiente protegido; `checked` sozinho significa reserva, não leitura concluída nem integridade financeira aprovada.
3. Em `multiple_subscriptions`, consultar os IDs estritamente necessários pelo painel autorizado e preservar a evidência. Não dar acesso à assinatura extra, não substituir o binding e não cancelá-la/reembolsá-la automaticamente. O suporte confirmou refund integral de assinatura pelo painel/portal, com cancelamento remoto imediato; isso não autoriza executá-lo durante diagnóstico. Invalidação da URL e preservação das consultas após delete ainda não foram garantidas.
4. Para cancelamento inesperado, referência ausente/divergente ou trial nativo, manter revisão e a política de acesso vigente. ACTIVE/CANCELLED não provam pagamento, vencimento, chargeback ou autorização para revogar direitos.
5. As métricas `billing.abacatepay.integrity_review` e `integrity_failed` levam somente motivo seguro; o capturador Sentry recebe exceção sanitizada. Conferir que o responsável recebe o sinal no projeto correto. Não declarar alerta entregue apenas por existir chamada de captura.
6. O cron existente continua diário. O monitor processa até três candidatos por chamada, com backoff de uma hora por geração, orçamento de tempo e exclusão concorrente. `integrity_scan.deferred=true` exige avaliar orçamento/backlog e cobertura; **não significa que todos os checkouts foram inspecionados**. Não alterar agenda/planos externos por conta própria.
7. Falha de API/commit fica auditada e não origina cobrança substituta. A próxima leitura retoma após backoff; resultado superseded/vínculo mudado não pode ser aplicado ao novo contrato. Não apagar reserva/histórico para forçar outra execução.

O suporte já respondeu; [transcrição integral encaminhada](../decoupling/asaas-to-abacatepay/SUPORTE-RESPOSTA-INTEGRAL-20261110.md). Não reenviar toda a solicitação. Somente as garantias de exclusão ainda aguardam complemento; renovação/histórico/simuladores têm limitações confirmadas. O [plano final](../decoupling/asaas-to-abacatepay/PLANO-FINAL-GO-LIVE-ABACATEPAY.md) distingue esses gates.

### Recuperação de jobs e conciliação

Aplicável somente à candidata da branch financeira; não autoriza Production, cobrança ou alteração de contrato real. [Evidências e gates atuais](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md#26-continuidade-enquanto-o-suporte-não-responde--09112026).

1. Identificar em leitura o ambiente/conta, intenção, geração, event ID e estado interno. Conferir vínculo interno e externo; não exportar payloads, tokens, dados pessoais ou recibos para logs.
2. Se o evento está `processing` e a lease ainda vale, não roubar a lease nem forçar reenvio. Se o processo morreu e a lease venceu, o conciliador existente retoma a mesma notificação; não há novo POST financeiro. Uma interrupção na última tentativa é encerrada como `review`, sem um 11º readback.
3. Em falha de leitura/persistência, o worker mantém retry limitado. O efeito financeiro, a política de acesso, a auditoria e a conclusão do inbox só são reconhecidos após commit. Confirmar a invoice/período/auditoria reais; HTTP recebido ou texto da IA não os comprovam.
4. `review` não significa pagamento recusado, reembolso executado nem permissão para estender acesso. O scanner normal não reabre automaticamente esses eventos. Na candidata atual, o superadmin pode autorizar uma releitura de evento recebido, com TOTP atual, snapshot e auditoria atômica; não há override financeiro. Seguir o [procedimento operacional](abacatepay-operacao.md). Sem vínculo verificável, permanecer em quarentena. Não editar estado financeiro para fabricar uma prova.
5. Sem qualquer webhook de renovação, preservar a obrigação e solicitar correlação/replay oficial; não correlacionar por preço/data/cliente, não reutilizar o bill inicial nem criar cobrança substituta no Asaas. Usar a [solicitação de suporte](../decoupling/asaas-to-abacatepay/SOLICITACAO-SUPORTE-HOMOLOGACAO.md).
6. Para refund/disputa, preservar período pago e revisão humana (ADR-071); evento antigo não encurta ciclo novo. Não executar `/checkouts/refund` para assinatura V2, não deduzir desfecho da disputa de PAID/ACTIVE e não excluir o checkout pago retido. Nenhum comando operacional destrutivo é necessário para o diagnóstico.
7. Registrar gate, SHA, contagens, códigos seguros de erro e conclusão. Após orientação oficial, preparar fixture/limpeza antes de qualquer novo ensaio remoto. Esta rotina não recebeu prova de rollback em Production nem de renovação temporal externa.

## AbacatePay — suporte e recuperação de eventos negativos (09/11/2026)

1. Refund de assinatura é integral pelo painel ou portal oficial; a API de refund avulso não atende esse produto. Não acionar reembolso durante diagnóstico. O portal permite efeitos financeiros e não deve ser publicado automaticamente como simples link de consulta.
2. Refund cancela a recorrência no provedor imediatamente. Esperar `checkout.refunded` e `subscription.cancelled`; disputa aberta usa `checkout.disputed`, perda usa `checkout.lost`. O Qoro mantém o período pago conforme ADR-071 e encaminha para revisão, sem nova cobrança ou revogação automática. Um evento antigo não deve retirar direitos de ciclo mais recente.
3. Para um incidente, registrar somente IDs técnicos necessários, horário, tipo de evento e execução do inbox. Conferir vínculo previamente persistido; comparar `payment.id` com `paymentIntentId` do extrato quando disponíveis. Não publicar payloads ou dados de pagador.
4. Sem webhook recebido não há API de cobranças por assinatura. Solicitar ao provedor reenvio e vínculo autoritativo, pelo canal aprovado. A lista da assinatura e o extrato sem esse vínculo não autorizam inferir ciclo nem ampliar acesso. Guardar a decisão operacional sem editar manualmente a invoice para aparentar reconciliação.
5. `checkout.lost` possui teste de observação auditada e replay em PostgreSQL real com HTTP sintético. Não é uma contestação efetivamente simulada no Sandbox; o provedor confirmou que não existe esse simulador.

[Resposta e limites](../decoupling/asaas-to-abacatepay/SOLICITACAO-SUPORTE-HOMOLOGACAO.md#resposta-recebida-e-consequência-técnica--09112026). A fixture paga permanece preservada até confirmação da invalidação da URL, sem testar delete ou cancelamento adicional.
