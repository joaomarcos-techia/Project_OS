# Operação e recuperação AbacatePay

Atualizado em 10/11/2026. Executável somente na candidata Sandbox do PR #53. Não usar em Produção. Não substituir o gateway de uma assinatura Asaas nem modificar pagamentos de pacientes.

## 1. Detectar e abrir incidente

1. Abra [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) e o Preview do SHA indicado no corpo do PR. Não use um deployment histórico para testar uma função nova. Entre legitimamente com o superadmin DEV e MFA.
2. Nesse mesmo host de Preview, abra `/admin/billing/operacao` (também há link em **Pagamentos** do admin). A página é restrita a superadmin AAL2; uma conta de clínica não deve acessá-la.
3. Confira a fila, o horário do evento mais antigo e as renovações sinalizadas. A página mostra no máximo 50 ocorrências por lista. Contagem maior que a lista exige triagem: ausência na primeira página não significa resolução.
4. **Renovação sem comprovação local** significa fim do período pago sem avanço conciliado; não prova pagamento nem perda de webhook. Registre um incidente protegido, por exemplo `INC-20261110-001`. Guarde os IDs técnicos e horários estritamente necessários, sem dados do paciente, cartão, payload bruto ou URL de recibo neste repositório/chat.
5. Confira o heartbeat de `billing-reconcile` na página **Saúde da plataforma**, o run mais recente e os sinais abaixo. Nunca use uma lista vazia como prova de que o monitor rodou.

Responsável proposto: financeiro pelo vínculo e valor; engenharia pelo processamento e incidente. A pessoa de plantão e o destino efetivo dos alertas precisam ser definidos e ensaiados antes de qualquer piloto real. A implementação de captura não comprova entrega da notificação.

## 2. Conferir a prova no provedor

1. Abra o [painel AbacatePay](https://app.abacatepay.com/) da loja correta, explicitamente em Sandbox. Não crie nova cobrança, refund, portal ou cancelamento para investigar.
2. Correlacione o `subscription.id`, cliente, checkout original e geração com o binding já registrado. Para renovação, o `checkout.id` deve ser o **bill da renovação**, e o `payment.id` deve corresponder ao `paymentIntentId` do extrato. Não reutilize o bill inicial PAID para estender acesso.
3. Confira moeda, valor integral, produto/plano, ciclo, estado financeiro e eventual refund/disputa. Valores ou datas parecidos não identificam uma obrigação. `ACTIVE` sozinho não confirma pagamento.
4. Guarde a evidência no registro protegido do incidente. O campo da tela recebe só o identificador desse registro; ele não valida a existência do ticket nem substitui o readback remoto.
5. Sem evento original, o suporte confirmou que **não existe histórico de cobranças por assinatura**. Solicite ao canal já aberto a entrega/reentrega autenticada do evento original e a correlação oficial dos IDs. Não invente endpoint de replay nem reconstrua um webhook manualmente a partir de valor/data. A documentação pública lista criar/listar/buscar/excluir webhooks, sem API de reenvio comprovada.

## 3. Uma nova leitura de evento em revisão

Usar quando o evento original já foi recebido e autenticado, mas sua prova ainda não estava disponível ou a API estava indisponível. A ação não serve para anexar uma cobrança desconhecida a outra clínica.

1. Localize o evento na tela de operação e compare **clínica, tipo, evento e motivo** com o incidente. Só aparecem formulários onde há vínculo verificável entre conta, cliente e assinatura original/recontratação. Referências insuficientes ou conflitantes aparecem em revisão sem formulário.
2. Escolha o motivo: **Provedor voltou a responder**, **Vínculo conferido** ou **Evidência remota disponível**. Informe o código interno do incidente (8–80 caracteres; letras, números, hífen ou sublinhado). Não informe senha, link, e-mail ou comprovante.
3. Abra seu autenticador e informe os seis dígitos atuais. Clique **Autorizar uma nova leitura** uma vez. O MFA é verificado novamente nessa operação; uma sessão antiga AAL2 não dispensa esse passo.
4. A autorização, o snapshot e o log `super_admin_actions` são persistidos na mesma transação. O contador não é zerado. A seguir ocorre uma tentativa imediata do worker, usando somente os leitores e efeitos financeiros já validados. Se o processo cair, a autorização fica na fila e o cron pode retomá-la.
5. **Continua em revisão:** a prova ainda é insuficiente; não houve liberação por decisão manual. Investigue a causa registrada. **Leitura executada:** confira inbox, observação financeira, invoice, período e cota; o texto da tela sozinho não comprova pagamento.
6. A tela desatualizada ou um segundo operador não pode reaproveitar o mesmo snapshot. Atualize antes de nova avaliação. Há no máximo **3 autorizações por evento em 24 horas**, somadas entre operadores; após isso, encaminhe à engenharia e ao provedor. Não edite a tabela para ultrapassar o limite.
7. Cada autorização permite uma tentativa adicional; não amplia automaticamente o limite original de 10 leituras. Uma lease final abandonada pode gerar uma reserva extra somente para encerrar a tentativa em revisão, sem novo GET. O histórico cumulativo continua íntegro.

**Proibido:** editar invoice, preço, plano, período, provider, cliente, payload/hash ou ID de pagamento para conciliar; reaproveitar token/OTP; inserir evento fictício; reabrir `applied`/`ignored`; gerar cobrança substituta. O operador não pode informar valor ou período na ação.

## 4. Resolver e encerrar

1. Após confirmação autoritativa, conferir uma única observação/invoice por pagamento e período coerente com o calendário original. Um replay com outro event ID não pode gerar outro ciclo para o mesmo pagamento.
2. O monitor registra `subscription.renewal_watch.observed` com `state=resolved` quando o período avançou ou deixou de exigir renovação (por exemplo, cancelamento já registrado). **Resolved não significa necessariamente pago**: confira a causa e a situação financeira. Não há botão para declarar um pagamento por intervenção humana.
3. Registrar no incidente: SHA/ambiente, event ID, autorização, resultado, horário da conciliação e causa do encerramento. Sem dados pessoais ou recibos públicos. Medir tempo de resolução a partir da primeira detecção, distinguindo atraso do cron de atraso do provedor.
4. Para refund/disputa, manter ADR-071 e a revisão financeira. Evento antigo não encurta ciclo novo. O painel não emite reembolso, não cancela e não promete recuperar externamente uma cobrança ausente.

## 5. Monitoramento e capacidade

| Sinal | Significado | Ação |
|---|---|---|
| `billing.abacatepay.renewal_watch` | `scanned`, `due`, `opened`, `resolved`, `deferred` do lote local | Investigar `opened>0`; `resolved` não comprova pagamento; conferir cobertura se adiado |
| `subscription.renewal_watch.checked/observed` | Auditoria local com contrato/geração/período e fingerprint | Correlacionar no ambiente protegido; não exportar conteúdo financeiro |
| `billing.abacatepay.integrity_review/integrity_failed` | Duplicidade remota, vínculos ou GET inconclusivo | Preservar contrato e encaminhar ao responsável; não cancelar/reembolsar automaticamente |
| `billing.abacatepay.integrity_scan` | Cobertura de até 3 gerações por chamada | `deferred` exige reduzir cohort ou aprovar capacidade adicional |
| `billing.abacatepay.reconcile_failed/reconcile_deferred` | Falha técnica ou orçamento insuficiente | Conferir heartbeat e fila, recuperar a mesma operação |
| `billing.abacatepay.event_reconciled` | Resultado do worker | Cruzar com commit da invoice/período; não usar como substituto da prova |
| `billing.abacatepay.negative_event_review` | Refund/disputa/falha a revisar | Aplicar ADR-071 sem inventar desfecho financeiro |
| `super_admin.action` e `abacatepay_review_replay_authorized` | Autorização administrativa | Conferir ator, incidente e snapshot no histórico privado |

O cron atual é **diário às 09:00 UTC**, não horário. Nenhuma configuração de agenda foi alterada. O monitor novo processa até **10 contratos por chamada**, com backoff de uma hora, orçamento local de 7 segundos, timeout SQL de 5 segundos e lock de 2 segundos. Parada pelo orçamento marca lote adiado; o próximo lote retoma pela auditoria. O monitor remoto existente inspeciona até 3 gerações por chamada. Em cohort maior que esses limites, não existe SLA de detecção em 24 horas comprovado. O cron preserva seu orçamento de 35 segundos para iniciar trabalho AbacatePay e não inicia GET após esgotá-lo.

Antes do piloto, definir volume, capacidade, responsável e alerta externo; comprovar recebimento de erro sintético sem dados de clientes. Isso ainda não foi executado. Alertas de cobertura adiada também usam captura Sentry sanitizada, sem garantir roteamento do serviço externo.

## 6. Contenção e rollback

1. Duplicidade remota, correlação incorreta, qualquer efeito cruzado, falha persistente de inbox ou renovação não recuperável exige conter novas aquisições da candidata e preservar as obrigações existentes. Acione o responsável; nenhuma concessão provisória de acesso foi criada.
2. Na candidata, `SAAS_SIGNUP_PROVIDER` controla aquisição; os consumidores continuam baseados no binding quando a aquisição está parada. Alterar env exige deployment novo. `SIGNUP_ENABLED=false` fecha o cadastro, não remove checkouts já emitidos nem cancela recorrências.
3. **Não aplique esses ajustes em Production nesta rodada.** O runtime atual da AbacatePay é deliberadamente Sandbox; `abacatepay_sandbox` em Production é rejeitado. A composição Production e o cohort restrito precisam de implementação/revisão específica antes de ativação; copiar variáveis do Preview não a prepara.
4. Retornar a release somente se ela entender os bindings já criados e mantiver os consumidores dos dois provedores. Não retornar ao código Asaas antigo eliminando recebimento de eventos AbacatePay. Se isso não puder ser garantido, manter aquisição parada e corrigir à frente.
5. Preservar a migration aditiva 0142 e os históricos. Não fazer DOWN, delete/reset, reassociar contrato ao Asaas, reativar cancelamento irreversível, apagar checkout pago ou restaurar banco antigo por cima de produção. Rollback de código não desfaz cobrança remota.

## 7. Reproduzir as provas locais

No PowerShell, na branch financeira com dependências instaladas:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:NODE_OPTIONS = '--conditions=react-server'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-renewal-db.ts
```

O script inicia um PostgreSQL loopback descartável com todas as migrations reais, usa identidades sintéticas, bloqueia rede externa e para o cluster ao terminar. O resultado fica em `dist/abacatepay-renewal-db.json`. O snapshot versionado da execução aprovada está ligado no plano final. **Não é um comando de replay em DEV/Production, nem simula financeiramente uma renovação real no Sandbox.** Não precisa ser repetido para cada operador.
