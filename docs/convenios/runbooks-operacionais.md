# Runbooks operacionais do módulo Convênios (P15.1)

Estado em 19/11/2026. **Produção: NO-GO.** Estes roteiros valem para o DEV e o Preview hoje, e para a produção só depois da liberação (P15.8). Cada passo usa uma tela ou ação que existe no código. Onde o detalhe já está em outro documento, o roteiro aponta para ele em vez de repetir.

Quem pode fazer cada ação está na matriz `matriz-permissoes-i2.md`. O módulo só opera em clínica com assinatura paga e ativa e com o interruptor ligado. No trial de 14 dias o módulo é só demonstração (`bloqueio-comercial-trial.md`, `modulo-desligado.md`).

---

## 1. Faturar (rotina do mês)

**Objetivo:** levar os atendimentos de convênio concluídos até o dinheiro conciliado, sem estado falso.

| Passo | Onde | O que conferir |
| --- | --- | --- |
| 1. Ver o que está pendente | `/convenios/guias`, filtro "Pendências" e "Responsável pela pendência" | Toda guia nasce da conclusão do atendimento. A que nasceu com falta de dado aparece como pendente e diz de quem é a correção (recepção, médica ou gestão). |
| 2. Resolver pendências | Guia → itens apontados; "Corrigir cobertura", carteirinha, credenciamento (`/convenios/configuracao`) | Nada é preenchido pelo sistema sem fonte: o que falta é corrigido na origem e a guia é recalculada. |
| 3. Conferir | Guia → "Marcar como conferida" (só aparece sem pendência) | Recepção ou gestão conferem; aprovar exige a permissão do financeiro, conferida no banco na hora (matriz I.2). |
| 4. Aprovar e emitir | Guia → "Aprovar e emitir" | Gera o snapshot cifrado e o PDF oficial ("Baixar (leitura registrada)"). Aprovada e fora de lote ainda pode ser devolvida; depois de exportada, correção é substituição (roteiro 2). |
| 5. Montar o lote | `/convenios/lotes` → "Montar lote" | Uma operadora, um tipo de guia, até 100 guias. Guia em outro lote ativo é recusada. |
| 6. Gerar e validar o XML | Lote → "Gerar e validar XML" (ou "Gerar XML em segundo plano" para lote grande) | Só sai XML que passou no XSD oficial 4.03.00. Validador fora do ar = nada sai (fail closed). O arquivo fica guardado com SHA-256. |
| 7. Enviar | Portal da operadora, com o XML baixado em "Baixar XML (TISS)" | Hoje o envio é sempre manual. O conector SOAP (P6.5) só entra depois da homologação de cada operadora (`conector-soap-homologacao.md`). |
| 8. Registrar o envio | Lote → "Marcar como enviado" | Exige canal, data e comprovante. Sem registro, o lote não é "enviado". |
| 9. Registrar o protocolo | Lote → "Registrar protocolo" ("Protocolo da operadora") | Exige número do protocolo e comprovante. O mesmo protocolo não se repete na operadora. |
| 10. Acompanhar | Lote → "Operadora iniciou a análise"; `/convenios/relatorios` | Idade do pendente, taxa de glosa e prazo médio por operadora (P9.10). |
| 11. Importar o retorno | `/convenios/conciliacao` → "Importar demonstrativo da operadora" | O arquivo passa por envelope, XSD e hash antes de qualquer efeito. Divergência é preservada e mostrada, nunca "ajustada". Importar o mesmo arquivo de novo não duplica (SHA). |
| 12. Glosas | Guia → "Contestar" ou "Aceitar como definitiva" | Contestar abre o recurso. "Gerar XML do recurso (TISS)" sai validado no XSD. |
| 13. Pagamento e encerramento | Conciliação → alocar o pagamento; guia → "Conciliar e encerrar" | Saldo da guia = `valor - valorPago - valorGlosado`. O botão só aparece com saldo zero e nenhuma glosa em aberto. |

**Conferência do mês:** em `/convenios/relatorios`, a soma por operadora tem de bater com o livro. Exporte o CSV pela própria tela; a exportação fica registrada na auditoria. A visão `hi_ledger_drift` tem de estar vazia (diferença entre a conta da guia e o recebível no financeiro).

## 2. Corrigir uma guia

Depende de onde a guia está. **Nunca editar XML à mão, nem mexer no banco** para corrigir guia.

| Situação da guia | Como corrigir |
| --- | --- |
| Pendente ou pronta para conferir | Corrigir o dado na origem (cobertura, carteirinha, credenciamento, contrato do procedimento) e conferir de novo. |
| Conferida ou aprovada, fora de lote | Guia → "Devolver para correção", dizendo o que precisa ser corrigido; volta para quem é dono da pendência. |
| Atendimento que não deveria ser faturado (pendente, conferida ou aprovada) | Guia → "Cancelar guia", com o motivo (10 a 500 caracteres). O cancelamento é final e o atendimento fica livre para uma guia nova. Repasse já autorizado ou pago vai para revisão humana, sem estorno automático. |
| Em lote ainda não enviado | Lote → "Cancelar lote", com o motivo: as guias voltam a aprovadas, prontas para outro lote. Depois, corrigir a guia como acima. O XML do lote cancelado fica guardado como histórico, sem valer. |
| Exportada, enviada ou em análise | **Substituição** (`substituicao-guia.md`): pedir o cancelamento à operadora ("Baixar o XML do pedido" `cancelaGuia` ou o portal), registrar o **recibo de cancelamento da operadora** e então "Substituir". A substituta só vale aprovada e com o recibo; a original passa a substituída na mesma transação. Sem recibo, não há substituição. |
| Com resultado (paga ou glosada) | Não se substitui: usa-se o recurso de glosa (roteiro 1, passo 12). Valor já recebido não é "corrigido" por cima. |

## 3. Reprocessar

| Sintoma | Mecanismo existente | O que fazer |
| --- | --- | --- |
| Atendimento de convênio concluído sem guia | A guia nasce do evento da própria conclusão, logo depois da resposta (p95 medido em 19/11: 133 ms; Preview p95 16 s). O cron do outbox é a reserva, e o `financial-reconcile` varre "convênio sem guia" e registra a pendência (tentativas, código, próxima tentativa). | Esperar a próxima volta do `financial-reconcile`. Se continuar, a pendência diz o motivo (ex.: credenciamento ausente): corrigir a causa. A próxima volta gera a guia sem duplicar (trava por atendimento). |
| XML em segundo plano não terminou | Tela do job no lote; handler idempotente pela chave do pedido. | Gerar de novo pela mesma tela: o mesmo pedido não cria outro arquivo. Falha do validador (indisponível, tempo, memória) aparece como falha, nunca como "válido". |
| Evento do outbox `failed` (6 tentativas esgotadas) | Backoff do worker. Depois disso, **replay só manual** (`src/lib/outbox/backoff.ts`). | Ver `last_error`/`error_code`. Corrigir a causa antes. O replay (voltar a `pending`) é operação de banco: só com GO específico, nunca em produção sem a liberação e nunca em evento financeiro sem conferir antes o estado do provedor. |
| Fila do outbox crescendo | Cron de 1 minuto com `OUTBOX_BATCH_SIZE` (padrão 50) e `OUTBOX_PARALLELISM` (5). | Benchmark de 20/11: um pico de 50 conclusões por minuto deixa até 8 min de fila com lote 50. A correção é só de configuração, com a operação controlada (registrar, aplicar, monitorar, critérios de interrupção, retorno) de `outbox-capacidade.md`, e só com GO do fundador. |
| Demonstrativo importado com divergência | A importação preserva a divergência e não aplica o efeito dela. | Conferir com a operadora. Se ela reenviar o arquivo corrigido, importar o novo (o antigo fica no histórico). Não editar o arquivo recebido. |
| Pagamento do paciente (coparticipação) sem baixa | Webhook do Asaas + `financial-reconcile` (sincronização da coparticipação). | Conferir a cobrança no Asaas e o webhook antes. Nunca criar baixa manual nem reenviar um evento fabricado (ver `homologacao-r54-sandbox.md`). |

## 4. Reverter (rollback)

Do menor para o maior impacto. Cada nível preserva a obrigação já faturada: guia emitida, lote enviado, arquivo guardado e pagamento continuam consultáveis.

1. **Desligar o módulo numa clínica:** interruptor em `hi_clinic_settings.enabled` (`modulo-desligado.md`). Bloqueia operação nova; consulta e preservação seguem. O interruptor de plataforma (P1.13) depende do painel do #57.
2. **Voltar ao envio manual numa operadora:** tirar a operadora do registro de homologados. O conector cai no manual sem estado falso (P6.4/P6.5).
3. **Voltar o código:** promover o deploy anterior. As migrations do módulo são aditivas; código anterior convive com o schema novo (conferido no plano de aplicação, `aplicacao-0153.md` §7 e §8).
4. **Reverter migrations:** só com GO do fundador, backup verificado por restauração e a sequência de `aplicacao-0153.md` (scripts `reversao-cauda-0144-0158.sql` e `reversao-0163-0164.sql`). **Nunca** apagar tabela com obrigação financeira ou arquivo TISS sem a política de retenção (B6, `retencao-lgpd.md`). Em produção, nada disso está autorizado hoje.

## 5. Incidente

**Primeiros 15 minutos (qualquer tipo):**
1. **Delimitar:** qual clínica, qual operadora, desde quando. Pistas: auditoria (`audit_events`), histórico do lote (`hi_batch_events`), eventos do outbox, logs do Sentry com a tag `flow`.
2. **Conter sem apagar:** desligar o módulo da clínica afetada (rollback nível 1) ou voltar a operadora ao manual (nível 2). Não apagar registro, arquivo nem evento: são evidência e obrigação.
3. **Preservar a evidência:** SHA-256 dos arquivos (`hi_files`), recibos, demonstrativos, o trecho de log sem dado pessoal.
4. **Avisar:** fundador. Se envolver dado pessoal, o encarregado (LGPD) decide sobre a comunicação à ANPD e aos titulares.

| Tipo | Sinal | Resposta |
| --- | --- | --- |
| Operadora recusou o XML | recusa no portal ou `tissFault` `SchemaInvalido`/`HashInvalido` | O Qoro só exporta o que passou no XSD: comparar a versão do padrão aceita pela operadora (`VersaoInvalida`) e o arquivo guardado (SHA). Não reenviar o mesmo lote sem entender. Se for regra própria da operadora, registrar e corrigir pela guia (roteiro 2). |
| Lote possivelmente enviado duas vezes | dois protocolos ou envio sem registro | O protocolo não se repete por operadora. Confirmar no portal antes de qualquer ação. Pedir o cancelamento do duplicado à operadora, com recibo. |
| Glosa em massa | `/convenios/relatorios` com taxa de glosa fora do normal | Agrupar por código de glosa. Causa de cadastro (contrato, credenciamento) → corrigir e recorrer em lote pelo recurso. |
| Validador XSD indisponível | erro do motor (`unavailable`, `integrity`, `timeout`, `memory`) | Fail closed: nenhum XML sai. Conferir a integridade do pacote e dos XSD (`r41-xsd.md`, rota `/api/health/tiss-xsd`). Não contornar validando fora do app. |
| Conector eletrônico fora (quando houver) | circuito aberto, `invalid_response` | O manual continua valendo. Em envio, conferir no portal antes de reenviar (a operadora pode ter recebido). |
| Divergência financeira | `hi_ledger_drift` com linhas; conciliação com saldo estranho | Não ajustar valores à mão. Achar o evento que faltou (outbox, webhook) e reprocessar pelo mecanismo (roteiro 3). |
| Suspeita de acesso indevido | leitura de dado sensível fora do padrão | Leituras privilegiadas são auditadas (`auditoria-leituras-privilegiadas.md`): levantar quem leu o quê. Credencial de operadora suspeita → revogar na tela (rotação revoga a anterior). |

**Alertas:** a regra de alerta do provedor para a manutenção do convênio (P12.6) depende do fundador (ficha em `decisoes-pendentes.md`). Até lá, os sinais são as métricas `insurance.reconcile.*` e `worker.tick` nos logs.
