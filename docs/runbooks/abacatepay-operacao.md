# Operação e recuperação AbacatePay

**Checkpoint vigente: observação de renovação abaixo e relatório§56. EARLY-01 já paga e encerrada; não repetir create, fechamento ou pagamento.** Seções antigas são evidência histórica, não ordens para repetir aplicação DEV ou pagamentos.

## Incremento operacional de12/11 — contenção e escala

Estado corrente: [relatório §48](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md#48-inbox-de-minuto-estornos-e-tiss-até-0158--12112026), [matriz G01–G28](../decoupling/asaas-to-abacatepay/MATRIZ-CENARIOS-E-TESTES.md#matriz-corrente-g01g28--scanner-incremental-12112026) e seção final deste runbook. Nenhum comando autoriza DEV compartilhado ou Production. As provas e instruções explicitamente históricas abaixo não substituem este checkpoint.

O transporte usa o par `UPSTASH_REDIS_REST_URL/TOKEN` já existente, com chave opaca por loja. Redis indisponível fecha o acesso ao provedor; não contornar desligando o guard.502/503/504 e falha de rede alimentam circuito;401/403 pausam60s;429 respeita cooldown limitado. Investigue disponibilidade/permissões pelo painel sem copiar a chave e sem repetir POST desconhecido. O circuito é distribuído; reiniciar uma instância não o limpa. Uma resposta positiva não apaga uma pausa vigente.

O inbox continua durável, com lease60s, até10 tentativas e revisão autorizada. Falha transitória aguarda5s,10s,20s…até3600s, contadas a partir de `processed_at`; evento recebido pela primeira vez não espera. Não alterar `attempts/processed_at` no ambiente compartilhado para forçar retry. O replay administrativo existente exige superadmin/MFA, motivo e autorização. O cron processa até10 eventos, sem iniciar item adicional depois de15s do job compartilhado; seu primeiro item conserva a admissão até35s. Cada item mantém reserva independente e só faz consultas financeiras verificadas. Métrica nova: `billing.abacatepay.inbox_batch` com `scanned/limit`.

Métricas de contenção: `billing.abacatepay.request_control`, outcomes `deferred`, `provider_rate_limited`, `provider_failure`, `coordination_unavailable`, sem corpo/credenciais/IDs de paciente. Persistência/revisão e heartbeat continuam as fontes operacionais; Sentry indisponível não é confirmação de saúde. Alertas propostos: qualquer401/403 ou coordenação indisponível;429 persistente; idade de inbox>2min; lease>60s sem resolução; período pago vencido sem receipt novo. Antes de Production, testar regras e entrega no canal aprovado. Não criar probes financeiros reais.

**Capacidade ainda não homologada remotamente:** a candidata reutiliza o tick de minuto de outbox para recuperação em lotes, além do cron diário. Não foi alterada a agenda externa. Com SQL aprovado, o scanner CARD_APPROVED retoma cursores entre execuções sem teto acumulado de 500; sem as tabelas, permanece o fallback limitado. Estornos também usam checkpoint de finalidade própria; o limite de cinco páginas permanece somente no fallback N-1. As cargas locais preservaram invariantes, mas não comprovam capacidade HTTP/worker/provedor. Nenhum novo índice, plano pago ou configuração de Production foi ativado.

## Reproduzir as novas provas locais

Em PowerShell, pasta `C:\dev\Qoro_billing_abacatepay_20261107`, usando Node22 e as dependências existentes:

```powershell
$env:QORO_TISS_WORKTREE='C:\dev\Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF='120e8195e4ad267a64157239cb9bc0c22b432033'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-composition-checks-db.ts
$env:QORO_ABACATEPAY_SCALE='1'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_ABACATEPAY_SCALE
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
```

O primeiro comando gera `dist/abacatepay-tiss-release-158-120e8195`, com 160 entradas somente no pacote descartável. O migrador real ensaiou 144→160, preservou catálogo/hashes históricos e comprovou segunda execução sem reaplicar. A posição financeira após 0156 não está reservada; há trabalho TISS posterior em edição. **Não usar essa proposta no DEV compartilhado.** O `when` é chave de ordenação posterior à cauda fixada, não data de criação. Manifest e queries ficam em `dist/abacatepay-tiss-{composition.json,preflight.sql,postflight.sql}` e foram exercitados no scratch. O journal do repositório permanece intacto. A carga grava `dist/abacatepay-scale-db.json` e `dist/abacatepay-scale-concurrency-N-db.json`: p50/p95/p99, pool/transação, conexões, locks, RSS e plano SQL, sem dados reais. O padrão é 32 tarefas; use `QORO_ABACATEPAY_SCALE_CONCURRENCY=8` apenas no ensaio local para comparar a fila. Falha interrompe o teste; arquivo antigo não comprova PASS. Após congelar uma nova cauda, revisar o helper e repetir apenas os gates afetados.

O ensaio Redis usa exclusivamente um contêiner descartável identificado, porta `127.0.0.1:63799`, imagem oficial Redis7.4, sem persistência ou API financeira. Com Docker disponível:

```powershell
docker run -d --name qoro-abacate-scale-20261112 --label qoro.synthetic=abacate-scale-20261112 -p 127.0.0.1:63799:6379 redis:7.4-alpine redis-server --save '' --appendonly no
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-rate-db.ts
docker stop qoro-abacate-scale-20261112
```

Se esse contêiner identificado já existir parado, use `docker start qoro-abacate-scale-20261112` em vez de criar outro. O harness confere o label e recusa outro destino. `QORO_DOCKER_BIN` pode apontar ao executável oficial quando não estiver no PATH. O teste não comprova o plano, a latência ou a capacidade do Redis gerenciado. Não subir carga em Preview, DEV compartilhado ou Production.

RPO continua dependente do backup efetivamente saudável; não declarar perda zero. A restauração de banco/Storage/Auth tem evidências históricas próprias e o aceite anterior sem PITR permanece restrito a esse risco. Um replay financeiro após restore precisa consultar o provedor e preservar IDs/ledger, sem recriar checkout/pagamento. O ensaio local de recuperação financeira não mede o RTO de reconstrução de todos os serviços.

Atualizado em 12/11/2026. Executável somente na candidata Sandbox do PR #53. Não usar em Produção. Não substituir o gateway de uma assinatura Asaas nem modificar pagamentos de pacientes. A seção 11 preserva o ensaio histórico com 0151; a seção 47 do relatório e o início deste runbook registram o snapshot revisado até 0158. O SQL candidato não foi aplicado ao DEV compartilhado. Sentry Preview e jornada normal MFA já passaram; não repetir probes/login para esses gates.

## 1. Detectar e abrir incidente

1. Abra [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) e o Preview do SHA indicado no corpo do PR. Não use um deployment histórico para testar uma função nova. Entre legitimamente com o superadmin DEV e MFA.
2. Nesse mesmo host de Preview, abra `/admin/billing/operacao` (também há link em **Pagamentos** do admin). A página é restrita a superadmin AAL2; uma conta de clínica não deve acessá-la.
3. Confira a fila, o horário do evento mais antigo e as renovações sinalizadas. A página mostra no máximo 50 ocorrências por lista. Contagem maior que a lista exige triagem: ausência na primeira página não significa resolução.
4. **Renovação sem comprovação local** significa fim do período pago sem avanço conciliado; não prova pagamento nem perda de webhook. Registre um incidente protegido, por exemplo `INC-20261110-001`. Guarde os IDs técnicos e horários estritamente necessários, sem dados do paciente, cartão, payload bruto ou URL de recibo neste repositório/chat.
5. Confira o heartbeat de `billing-reconcile` na página **Saúde da plataforma**, o run mais recente e os sinais abaixo. Nunca use uma lista vazia como prova de que o monitor rodou.

Responsável proposto: financeiro pelo vínculo e valor; engenharia pelo processamento e incidente. A pessoa de plantão e o destino efetivo dos alertas precisam ser definidos e ensaiados antes de qualquer piloto real. A implementação de captura não comprova entrega da notificação.

## 2. Conferir a prova no provedor

1. Abra o [painel AbacatePay](https://app.abacatepay.com/) da loja correta, explicitamente em Sandbox. Não crie nova cobrança, refund, portal ou cancelamento para investigar.
2. Correlacione o `subscription.id`, cliente, checkout e geração com o binding já registrado. A documentação atual permite o mesmo `checkout.id` original nas renovações. Exija **um novo `payment.id`**, correspondente ao `paymentIntentId` do extrato, com prova inequívoca de receipt, valor e período. Não exigir um bill diferente, nem usar apenas o estado PAID do checkout inicial para estender acesso. Os formatos antigos só são aceitos quando o leitor comprova a mesma obrigação, sem aproximar datas/valores.
3. Confira moeda, valor integral, produto/plano, ciclo, estado financeiro e eventual refund/disputa. Valores ou datas parecidos não identificam uma obrigação. `ACTIVE` sozinho não confirma pagamento.
4. Guarde a evidência no registro protegido do incidente. O campo da tela recebe só o identificador desse registro; ele não valida a existência do ticket nem substitui o readback remoto.
5. Sem evento original, a recuperação GET-only da seção 9 pode conciliar o período atual somente com cliente, assinatura, receipt, valor e período exatos. Ela depende do schema candidato e não foi ativada no DEV/Production. Não existe histórico completo de cobranças por assinatura comprovado. Se faltar correlação ou o ciclo for antigo/ambíguo, manter revisão e solicitar ao canal já aberto a entrega/reentrega autenticada do evento original e a correlação oficial. Não invente endpoint de replay nem reconstrua webhook a partir de valor/data.

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

Antes do piloto, definir volume, capacidade, responsável e alerta Production. Em 11/11 o founder confirmou o recebimento do probe Preview específico 414eb196, além do teste de canal; esse gate Preview está concluído. Não repetir o probe nem atribuir essa prova ao roteamento/SLA de Production. Alertas de cobertura adiada também usam captura Sentry sanitizada.

## 6. Contenção e rollback

1. Duplicidade remota, correlação incorreta, qualquer efeito cruzado, falha persistente de inbox ou renovação não recuperável exige conter novas aquisições da candidata e preservar as obrigações existentes. Acione o responsável; nenhuma concessão provisória de acesso foi criada.
2. Na candidata, `SAAS_SIGNUP_PROVIDER` controla aquisição; os consumidores continuam baseados no binding quando a aquisição está parada. Alterar env exige deployment novo. `SIGNUP_ENABLED=false` fecha o cadastro, não remove checkouts já emitidos nem cancela recorrências.
3. **Não aplique esses ajustes em Production nesta rodada.** O runtime atual da AbacatePay é deliberadamente Sandbox; `abacatepay_sandbox` em Production é rejeitado. A composição Production e o cohort restrito precisam de implementação/revisão específica antes de ativação; copiar variáveis do Preview não a prepara.
4. Retornar a release somente se ela entender os bindings já criados e mantiver os consumidores dos dois provedores. Não retornar ao código Asaas antigo eliminando recebimento de eventos AbacatePay. Se isso não puder ser garantido, manter aquisição parada e corrigir à frente.
5. Preservar a migration aditiva 0142 e os históricos. Não fazer DOWN, delete/reset, reassociar contrato ao Asaas, reativar cancelamento irreversível, apagar checkout pago ou restaurar banco antigo por cima de produção. Rollback de código não desfaz cobrança remota.

## 7. Reproduzir as provas locais

Para o próximo pagamento humano **Sandbox**, não repetir a fixture antiga nem esta suíte PostgreSQL: seguir [operação preparada do checkout](../decoupling/asaas-to-abacatepay/PROXIMO-CHECKOUT-SANDBOX.md). O comando `prepare` deixa somente manifesto/credencial locais; `create` depende do pedido explícito “criar checkout” e `verify` confere o pagamento informado. Não há limpeza automática em caso de demora do founder.

No PowerShell, na branch financeira com dependências instaladas:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:NODE_OPTIONS = '--conditions=react-server'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-renewal-db.ts
```

O script inicia um PostgreSQL loopback descartável com todas as migrations reais, usa identidades sintéticas, bloqueia rede externa e para o cluster ao terminar. O resultado fica em `dist/abacatepay-renewal-db.json`. O snapshot versionado da execução aprovada está ligado no plano final. **Não é um comando de replay em DEV/Production, nem simula financeiramente uma renovação real no Sandbox.** Não precisa ser repetido para cada operador.

## 8. Fechamento operacional de 11/11/2026

As cinco primeiras compras estão homologadas e preservadas. **Não criar checkout, pagar, cancelar, excluir ou reenviar o pagamento antigo para executar este roteiro.** [Evidência e limites atuais](../decoupling/asaas-to-abacatepay/evidencias/operacao-continua-20261111.json).

### Conferir o alerta sem credenciais no chat

1. Abra o [Sentry](https://sentry.io/) na sua conta administrativa. Selecione o projeto cujo ID é **4511646341726208**. Não precisa criar conta nem contratar plano.
2. Em Issues, filtre o ambiente **preview** e procure a mensagem **Qoro Sandbox operational alert probe**. O evento aceito tem ID `fc2862ce570d48c6966747db2022aa5b`; run `f4b90206-b481-4764-a227-4bc8066aa9d1`, enviado em 11/11 às **08:43:25 de Brasília**. Não contém pagamento ou paciente. Encontrar o evento confirma visibilidade; não confirma recebimento de notificação.
3. Abra [Monitors → Alerts](https://sentry.io/monitors/alerts). Confira a regra desse projeto e ambiente **preview**, seus filtros e a ação de entrega ao responsável. A documentação atual é [Creating an Alert](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/). Não altere a regra de Production nesta validação. Se faltar regra Preview, informe isso antes de escolher destinatários ou canal.
4. Se já existe uma regra, confira se você recebeu a notificação do probe no canal previsto. Se a regra foi criada depois dele, o evento anterior não prova entrega: a engenharia pode enviar **um novo probe sintético**, sem cobrança, após a regra estar pronta.
5. Responda somente: `Sentry: evento visível [sim/não]; regra Preview [presente/ausente]; notificação [recebida/não recebida]; responsável [função]`. Não envie token, screenshot de eventos clínicos ou configuração com segredos.

A API administrativa disponível retornou **401**, por isso a engenharia não conseguiu ler destinatários/regras automaticamente. O HTTP 200 obtido comprova apenas ingestão de um envelope sintético, não a passagem de um pagamento pelo webhook ou a entrega de e-mail/Slack. Não é necessário trocar uma chave financeira para resolver isso.

### Conferir MFA operacional

1. Abra o [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53), confirme o commit do relatório e acesse o Preview pelo check Vercel correspondente. Entre com seu **superadmin DEV** e o MFA legítimo; não compartilhe senha ou código.
2. Abra `/admin/billing/operacao`. Confira que uma sessão comum/sem MFA não obtém a função de autorizar nova leitura e que o superadmin precisa de TOTP atual na ação. **Não faça replay de nenhum evento ou contrato deste lote**: a engenharia deverá preparar uma fixture específica antes de ensaiar a autorização positiva completa.
3. Informe apenas `MFA Qoro: login confirmado [sim/não]; operação exige código atual [sim/não]`. A consulta automática já encontrou **2/2 superadmins DEV com fator nativo verificado**; não é necessário cadastrar outro operador. Isso não prova a jornada interativa positiva.
4. MFA de Qoro, GitHub, Vercel, AbacatePay e cofre são independentes. Não presuma que a autenticação no GitHub protege a conta do provedor. Nenhuma política global foi alterada; o campo de MFA não foi informado pela API própria do GitHub, e os demais painéis não foram auditados por sessão autenticada.

### Coordenar o SQL financeiro com TISS

O [SQL candidato](../decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql) está testado somente no PostgreSQL local. **Não execute esse arquivo manualmente em DEV ou Production.** O PR #55 contém 0143–0147, e o financeiro não escolheu um prefixo concorrente nem editou o journal desse agente. A estratégia e os ensaios atualizados estão na seção 9.

A engenharia precisa conciliar o histórico exato das duas branches e do DEV, registrar o candidato na próxima versão livre, executar os gates e obter a autorização específica antes da aplicação remota. A sua parte é aprovar essa integração de schema quando apresentada; não há comando SQL que você precise executar agora. Não há autorização implícita de merge/main/Production.

### Condições de interrupção e níveis de alerta

| Sinal | Prioridade | Deduplicação e responsável | Ação |
|---|---|---|---|
| Mais de uma assinatura por checkout, vínculo/tenant divergente | P1 | Audit por fingerprint/geração; financeiro + engenharia | Conter novas aquisições; conferir IDs sem cancelar/refundar por suposição |
| Evento autenticado não persistido ou conteúdo conflitante | P1 | Inbox e agrupamento Sentry; plantão técnico | Preservar retorno não-2xx e a mesma obrigação; não cobrar novamente |
| Tentativas esgotadas/revisão de prova | P1 | Estado terminal por lease; uma captura na transição | Releitura autorizada com MFA, sem zerar contador |
| Ativação concluída depois de 120s | P2 | Somente aplicação efetiva, sem alertar duplicate | Medir idade e duração; investigar o HTTP sanitizado |
| Período pago do provedor à frente do Qoro | P1 | Audit deduplicado, sem fabricar evento/invoice | Recuperar a origem oficial; não conceder mês por ACTIVE/valor/data |
| Webhook não autenticado | Métrica de segurança | Não enviar alerta por request; investigar agregados | Recusar antes da persistência; não expor a URL com segredo |

Destinatário e recebimento ainda dependem da conferência Sentry acima. Não há SLA de aviso em 120 s: o sinal é emitido na próxima execução/conclusão, e o cron de contingência continua diário. Nenhuma agenda, custo ou plano foi alterado. A recuperação sem webhook agora está implementada conforme seção 9, mas depende do schema ainda não aplicado e de prova financeira inequívoca; o código novo não significa ativação no DEV ou em Production.

### Kill switch e rollout futuro, sem execução agora

`ABACATEPAY_NEW_CHECKOUTS_ENABLED=false` recusa novas obrigações antes do journal/POST. `ABACATEPAY_CHECKOUT_CLINIC_IDS` aceita UUIDs exatos separados por vírgula; inválidos/duplicados bloqueiam. Consumidores, conciliação e cancelamento não dependem dessas flags. Alterar env na Vercel exige **novo deployment**. As flags foram implementadas, sem configurar qualquer ambiente externo.

**O runtime permanece Sandbox e rejeita Production.** Não copie credenciais nem configure `abacatepay_sandbox` no ambiente real. Antes de um piloto: schema coordenado e aplicado com autorização, recovery sem evento completo, contrato de leitura após fechamento de checkout validado, MFA/alerta reais, composição live implementada/testada e janela aprovada. Backup/rollback e consumidores Asaas continuam obrigatórios. Nenhuma alteração de contrato, pagamento de paciente ou desconto vitalício está incluída.

### Retorno do operador sobre o probe

Em 11/11 o founder confirmou a Issue **7842026780** no painel e informou que **não recebeu notificação fora do Sentry**. Não precisa procurar o evento ou repetir o probe novamente. Falta conferir/criar a regra de alerta de Preview, definir responsável/canal e, só depois, ensaiar uma nova notificação sintética. A API administrativa retornou 401; nenhuma regra ou destinatário foi alterado automaticamente. Os erros históricos de localhost e de hidratação em outro Preview não são falhas financeiras deste probe; a classificação do ambiente no browser foi corrigida na candidata, sem afirmar reparo da hidratação.

## 9. Recuperação sem webhook, fechamento e integração de schema

### O que a engenharia executa

O novo worker só faz GETs externos, exige geração paga e confere loja, assinatura, cliente, produto/valor, período e um receipt de cartão exato. Guarda uma origem API imutável, sem fabricar webhook. Aplicação financeira é atômica e idempotente; fonte insuficiente fica em revisão. O cron existente é diário, processa um candidato por chamada e respeita o orçamento restante; não há SLA de recuperação em 120s. A ausência do schema novo o mantém inativo, sem fallback permissivo.

Uma assinatura marcada ACTIVE, um checkout PAID antigo, `nextChargeAt` ou uma coincidência de valor/data não permitem completar a conciliação. Não criar outra cobrança, editar status manualmente ou preencher um paymentId por suposição. Uma ambiguidade/ausência de histórico de ciclos exige triagem financeira, preservando os direitos já pagos.

O comando interno de fechamento exige uma invoice já paga e vínculo imutável. Tem journal `close_paid_checkout`, um único POST e resultado `confirmed` ou `unknown`. Em `unknown`, não repetir com outro UUID/chave: inspecionar a assinatura, o journal e os readbacks. Fechamento de link não cancela assinatura. O código está preparado, mas não há fechamento automático habilitado nem autorização para apagar as cinco fixtures retidas nesta rodada.

### Estratégia coordenada com PR55

1. Manter os dois PRs draft. **Não importar nem misturar migrations TISS na branch financeira.** Não editar journal/migrations no worktree TISS. A primeira prova fixou `b450a560897d4004b2de305ac91c3ffa1197ec89` até0149; depois de a 0150 ser publicada, o ensaio foi estendido ao snapshot remoto `6b101e892e4e856c5653e7bb89a1791ce452815c`. Ambos só leem objetos Git imutáveis. Não é merge dos módulos nem homologação funcional integral do TISS.
2. Conferir no DEV hashes **e timestamps**, não só contagem: readback de 11/11 às 20:49 UTC,144 entradas;0143 exata aplicada,0144–0150 ausentes, sem conflitos de timestamp e candidato financeiro ausente. O preflight da aplicação futura deve incluir os hashes finais e qualquer migration posterior. Qualquer deriva interrompe o preparo.
3. Preservar os números/hashes TISS. **0149 e0150 são da frente TISS.** Não reservar qualquer número financeiro unilateralmente. A ordem de revisão PR53→PR55 não autoriza aplicar SQL fora da sequência compartilhada. O candidato financeiro fica separado, sem número, até o histórico futuro ser acordado.
4. Não registrar o financeiro com timestamp alto e tentar aplicar TISS antigo depois. O Drizzle usa o último timestamp aplicado; migrations inseridas para trás podem ser ignoradas. Não renumerar/recriar 0143 já aplicada. Caso a ordem SQL precise mudar, acordar a alocação dos ainda não aplicados com TISS e repetir somente o ensaio afetado.
5. Após registro conjunto, executar gates de migrations e o ensaio abaixo. Só solicitar autorização de aplicação DEV com diff, número, hash e ordem definitivos. **O founder não precisa rodar SQL manualmente.**

Ensaio reprodutível, somente PostgreSQL descartável e arquivos TISS lidos sem modificá-los:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:\dev\Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '6b101e892e4e856c5653e7bb89a1791ce452815c'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-tiss-schema-db.ts
node --conditions=react-server node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-renewal-db.ts
```

Essa é uma prova local, executada pela engenharia. O primeiro comando confere 21 checks de ordem, rollback, dados preservados, índices/constraints/RLS, definições dos gatilhos compartilhados, cobertura congelada e correção administrativa da0149. O segundo executa os120 cenários reais de aplicação financeira com151 migrations compostas em memória (0000–0150) mais candidato; HTTP do provedor é sintético e rede externa proibida. O journal da branch não muda. Sem `QORO_TISS_REF`, a suíte financeira mantém sua execução anterior com143 migrations próprias e salva outro artifact; as provas históricas até0147/0149 são preservadas. O helper aceita somente snapshots revisados que terminem em0149 ou0150 e exige SHA completo. Mudou o SQL TISS ou o histórico? Revisar e fixar outro commit, não ampliar o teto apenas para obter PASS.

**Schema agregado de código:** a comparação dos índices das duas branches mostra exports exclusivos em ambos os lados (`billing/gateway-schema` no financeiro e `health-insurance/schema` no TISS). A integração de código futura deve preservar ambos e resolver os handlers/eventos/configuração, com typecheck, arquitetura e registro estrito. A composição SQL comprovada não prova essa integração TypeScript e não autoriza substituir um índice pelo outro.

**Sequência recomendada depois do congelamento TISS:** preservar a revisão independente dos PRs; deixar a ativação financeira bloqueada sem seu schema; o responsável TISS integra seu histórico sobre a base financeira aprovada; então preparar uma migration financeira em etapa separada, com a próxima posição realmente livre, timestamp posterior e preflight exato do DEV. Nada disso autoriza merge ou aplicação agora. Não inserir uma migration financeira de timestamp alto e tentar aplicar TISS mais antigo depois.

| Alternativa | Consequência | Avaliação atual |
|---|---|---|
| Revisar PR53 primeiro, sem ativar o SQL candidato | Preserva as branches; código permanece inativo quando falta schema | Compatível com a ordem pedida, não é ativação da integração |
| Registrar o SQL financeiro numa etapa posterior e separada | Permite preservar0143–0149 e validar o histórico efetivamente congelado | Recomendada após o acordo entre responsáveis; nenhum número reservado agora |
| Compor os journals nesta branch agora | Importaria trabalho TISS ainda em elaboração e anteciparia uma decisão compartilhada | Não executar, conforme instrução posterior do founder |

### Preflight e postflight do candidato financeiro

A engenharia deve confirmar backup recuperável e versão compatível do código; schema de origem até0142 e histórico0143/TISS reconciliado; constraints originais esperadas; inexistência da nova tabela/colunas/categoria; permissões do executor; nenhuma duplicidade financeira preexistente por payment/statement/ciclo; zero outra janela de schema em andamento.

O SQL usa `lock_timeout=2s` e `statement_timeout=15s`. ALTER TABLE requer lock forte em `operations` e `recurring_payment_observations`, mantido até commit; pode competir com webhook/worker. Não prometer duração ou disponibilidade de Production com base no banco pequeno do teste local. Interromper em timeout, schema/hash inesperado, lock prolongado, violação de constraint ou mudança em contratos/valores. Não repetir cegamente.

No postflight conferir: todos os contratos/invoices/bindings anteriores preservados; unicidade por pagamento/extrato e ciclo mantida; origem XOR webhook/API e FK compostas; tabela nova com RLS forçada; anon/authenticated/runtime sem acesso; service_role só SELECT/INSERT, sem UPDATE/DELETE; operação de fechamento suportada; contagem/hash exatos no journal. Verificar readiness em Preview antes de ensaiar uma fixture.

Recuperação: antes de commit uma falha aborta a transação. Depois de commit, não executar DOWN, apagar ledger, cancelar assinatura nem restaurar banco compartilhado por iniciativa própria. Conter novas aquisições, manter consumidores dos dois provedores e usar correção à frente/release compatível. Se houver perda/inconsistência, parar e executar o plano de recuperação autorizado. Reverter código não desfaz comando remoto.

### Prova externa futura do fechamento, sem novo pagamento

Depois do schema DEV autorizado, a engenharia apresentará **um checkout Sandbox já pago**, a clínica sintética exata e o snapshot anterior para autorizar seu fechamento. Não precisa criar/pagar outro checkout.

O ensaio deve: comprovar devMode e loja; preservar invoice/receipt/IDs; chamar uma única vez o endpoint documentado; conferir que o link não aceita novo pagamento sem efetuar transação; reler assinatura e lista pelo checkout; reler extrato e os IDs já pagos; verificar histórico/recibo; conferir mudança de plano e cancelamento somente nos limites autorizados; testar reprocessamento local sem invoice/vaga nova. Renovação futura não vira PASS por fechar o link. Se a resposta se perder, preservar `unknown` e não reenviar o comando. Enquanto essa prova não existir, B1 permanece PARTIAL.

## 10. Ações humanas que continuam necessárias

### 10.1 Alerta Preview — prova de entrega concluída

**PASS operacional em 11/11:** o founder confirmou a criação da regra Preview, o recebimento do **Send Test Notification** e depois o alerta específico **414eb196**. Um único probe foi enviado às **15:29:32 BRT**; ingestão HTTP200, evento `04822f778d5649b3a0a19e28ce798236`, `environment=preview`, `flow=billing.abacatepay.sandbox_probe`. Nenhum pagamento, paciente ou dado sensível no evento. A regra Production não foi alterada. Não repetir essa prova nem criar outra regra.

A API administrativa retornou HTTP401 e o acesso visual estava indisponível. Condições, destinatário e histórico interno da regra não foram auditados diretamente pela engenharia; o recebimento confirmado do evento exato comprova a cadeia externa para esse flow. O probe usa ingestão Sentry direta, não provoca erro de banco/cron no Preview: os testes de captura do worker são uma evidência separada. Isso não mede SLA, todos os tipos de alerta ou futura entrega em Production.

**O roteiro abaixo fica somente para diagnóstico futuro se o canal parar; não é uma tarefa humana pendente agora.**

1. Abra [Monitors → Alerts no Sentry](https://sentry.io/monitors/alerts), entre na organização do projeto **qoro** e abra **a regra Preview que você já criou**. Se ela não aparecer, informe o nome/tela; não crie outra.
2. Sem mudar nada, confira os rótulos da regra: projeto `qoro`, ambiente `preview`, regra ativa, evento capturado, filtros `flow` começando por `billing.abacatepay.` e nível pelo menos `error`, destinatário sendo sua conta/canal, sem silenciamento. Confira o limite de frequência, recomendado em 5 minutos. Se os valores forem diferentes, informe somente a divergência. Não altere Production.
3. No bloco de notificação, clique uma vez em **Send Test Notification**. Confira caixa de entrada e spam do destinatário configurado. Esse botão verifica o canal; não comprova o disparo de um evento financeiro. Não precisa pagar, alterar credencial ou configurar outra regra.
4. Responda `Regra Preview [nome]; teste de canal [recebi/não recebi]; horário [BRT]`. Se não recebeu, confira o destinatário, as [preferências pessoais](https://sentry.io/settings/account/notifications/), spam e eventual silenciamento. Envie somente os estados/rótulos, sem dados de paciente, tokens ou screenshot de segredos.
5. **Somente depois da confirmação de recebimento**, a engenharia enviará **um único probe** com `environment=preview`, `flow=billing.abacatepay.sandbox_probe`, identificador próprio e nenhum dado financeiro ou clínico. Correlacionará o evento, regra/disparo e notificação. O responsável confirma o recebimento externo com horário. Ingestão aceita e Issue visível, sozinhas, continuam insuficientes para PASS. Não repetir pagamento nem enviar probes para forçar o alerta.

Se alguma opção não aparecer, informe só seu rótulo/permissão e a etapa. Não criar regra All Environments como substituto. A fonte dos controles é a [documentação oficial atual de alertas](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/). O intervalo de throttle e preferências pessoais podem impedir aviso mesmo com evento visível; não declarar entrega antes de recebê-lo.

### 10.2 Conferir MFA do operador e dos serviços externos

**Jornada normal PASS, confirmada pelo founder em 11/11:** no Preview `b18407c3`, login com autenticador, acesso a `/admin/billing/operacao`, logout com bloqueio da página e novo login com MFA. Não é necessário repetir esse roteiro para fechar essa prova. A resposta foi “tudo ok”; não foram solicitadas senhas/OTP e nenhum reprocessamento financeiro foi executado.

O DEV já tinha 2/2 superadmins com fator nativo verificado. A ação financeira com TOTP novo/replay, sessão expirada à força, recuperação após perda do fator, revogação global e MFA dos provedores externos não foram testados interativamente nessa confirmação. Os testes locais cobrem as recusas correspondentes, sem transformar simulação em operação real. Para um ensaio destrutivo, preparar operador sintético e autorização específica; não usar contas existentes nem fixtures pagas. A engenharia prepara uma ocorrência sintética antes do ensaio positivo da ação de reprocessamento.

Roteiro de referência já cumprido nos passos 1–3, sem alterar fatores ou credenciais:

1. Abra o Preview financeiro informado no PR53, use `/login` e conclua o desafio normal do autenticador. Se o sistema enviar para `/account/security?force=1`, não remova fator: informe a tela encontrada.
2. Abra `/admin/billing/operacao`. O superadmin com segundo fator deve alcançar a página; não clique em autorizar reprocessamento de uma fixture paga. Registre só acesso aprovado/erro, sem nomes de pacientes, OTP ou cookies.
3. Saia pelo comando normal do Qoro, volte à URL administrativa e recarregue. O conteúdo financeiro deve ficar inacessível. Faça novo login e conclua novamente o segundo fator. Não usar apenas o botão Voltar como prova de sessão válida.
4. Se quiser conferir outro dispositivo, faça login legítimo em janela privativa ou outro aparelho, com o próprio autenticador. A sessão do primeiro navegador não deve ser tratada como autenticação do segundo. Não enviar senha/código pelo chat.
5. Expiração, remoção do fator, recuperação após perda do aparelho e revogação global não serão forçadas na conta administrativa existente. Os testes automatizados cobrem recusa de sessão/fator/operador inválidos, mas não são prova dessa operação real. Um ensaio destrutivo exige operador sintético dedicado e autorização própria.
6. O Qoro informa em sua tela de segurança que o TOTP do Supabase não emite códigos de recuperação. Confira se o backup do autenticador/segredo original já está em cofre, sem mostrá-lo. Redefinir a senha não deve ser usado como procedimento presumido de remoção de MFA. Na ausência do fator e de seu backup, parar e solicitar recuperação assistida aprovada; não desativar proteção por script.

Resposta segura: `Preview [SHA]; login/MFA [PASS/erro]; operação financeira [acessível/negada]; logout e novo login [PASS/erro]; segundo dispositivo [PASS/não executado]; recuperação em cofre [disponível/pendente]`. Isso não confirma MFA das plataformas externas abaixo.

Depois confira separadamente as contas de administração usadas nestes serviços:

| Acesso | Página inicial | O que confirmar, sem compartilhar códigos |
|---|---|---|
| GitHub | [Settings → segurança](https://github.com/settings/security) | 2FA habilitado na conta que revisa/mescla; recuperação disponível em cofre |
| Vercel | [Conta](https://vercel.com/account) | Proteção de acesso/MFA da conta ou do IdP efetivo; equipe correta |
| AbacatePay | [Dashboard](https://app.abacatepay.com/) | Segurança/MFA oferecido para o administrador financeiro; se não aparecer, informar a ausência para tratamento operacional, não presumir proteção |
| Supabase | [Conta/projetos](https://supabase.com/dashboard) | MFA da conta administrativa/IdP e responsáveis de recuperação |
| Sentry | [Segurança pessoal](https://sentry.io/settings/account/security/) | MFA/IdP efetivo da conta que administra alertas |
| Cofre | Conta corporativa já aprovada | MFA e recuperação independente do mesmo aparelho; não enviar chave/código |

Os painéis externos não foram inspecionados em sessão autenticada nesta rodada; seus menus internos podem variar. A proteção de um serviço não prova a dos outros. Responda `MFA: GitHub [...], Vercel [...], AbacatePay [...], Supabase [...], Sentry [...], cofre [...]` usando `ativo`, `pendente` ou `indisponível no painel`. Nenhuma autenticação global do Qoro foi alterada.

### 10.3 Aprovações técnicas que ainda não são comandos para o founder

Depois da coordenação com TISS e do diff/hash definitivos, aprovar ou rejeitar o schema financeiro **somente no DEV**. Separadamente, aprovar o fechamento de uma fixture Sandbox já paga para comprovar os readbacks posteriores. A engenharia executará as operações e a limpeza autorizada. Não editar journal, rodar SQL, deletar checkout ou pagar links antigos manualmente. Production, merge e credenciais reais continuam fora da autorização.

## 11. Trial, entitlements e composição com 0151 — 12/11

**Regra vigente da candidata.** Avaliação de 14 dias desde o Auth original, com as cotas anteriores. Asaas de pacientes e agentes de IA são recusados pelo gate comercial no backend enquanto não houver pagamento verificado; WhatsApp/conexão Asaas/convites continuam sob os bloqueios existentes. TISS permanece indisponível operacionalmente nesta branch. Leitura histórica e processamento financeiro de reconciliação não são apagados/bloqueados como se fossem novas vendas.

O titular pode contratar durante ou após o trial. Um clique abre o checkout correspondente ao catálogo; cliques repetidos reutilizam o journal. Criar checkout, voltar ao app ou receber evento sem readback financeiro válido não libera módulos. Na conversão antecipada, o primeiro período começa na contratação confirmada, não no fim dos 14 dias. O claim privado comprova a origem Auth; a avaliação nunca reinicia. Uma recontratação continua impedida até acabar o período pago anterior.

### Reproduzir somente em banco local descartável

Os comandos abaixo não aplicam SQL ao DEV. Só usar o SHA completo revisado; o helper rejeita outro histórico comum/ordem e não importa arquivos em edição. Na pasta financeira:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '2a70788046752df4c8b349b871a089bc432a8609'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-tiss-composition.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-tiss-schema-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_TISS_WORKTREE,Env:QORO_TISS_REF -ErrorAction SilentlyContinue
```

Resultados de 12/11: **33/33 composição SQL**, **49/49 trial/entitlements**, **120/120 financeiros**, sem rede externa ou escrita remota. Resultados em `dist/abacatepay-tiss-0151-schema-db.json`, `dist/signup-free-trial-tiss-0151-db.json`, `dist/abacatepay-renewal-tiss-0151-db.json`; snapshot versionado na evidência canônica. A suíte de trial sem TISS também passou 49/49, cobrindo a compatibilidade N/N-1. Não somar números sobrepostos como novos cenários externos.

O gate central usa a mesma transação/escopo da clínica e consulta `qoro_premium_denial(uuid,text)` quando presente. `patient_payments` é traduzido para o nome SQL `patient_charges`. Qualquer recusa SQL vence; resultado ausente/malformado falha, sem autorização implícita. A proteção da aplicação acrescenta período/invoice e indisponibilidade operacional; ela não substitui permissões, flags ou autorização de liberar TISS. A fusão final dos controles ainda precisa de revisão dos dois PRs, não foi simulada como merge TypeScript concluído.

### Sequência proposta antes de qualquer aplicação compartilhada

1. Congelar/acordar a cauda TISS. O snapshot ensaiado termina na **0151**, SHA acima; arquivo 0151 com SHA256 `a0e446dbce4121c538c4a3e206a406e0977d5d1729ed14b03417a3937b71ae0b`.
2. Preservar 0000–0143 já registradas no DEV. Leitura somente leitura de 12/11, 04:09 UTC: 144 entradas, 0143 com hash/timestamp exatos; 0144–0151 ausentes, sem conflito, candidato financeiro ausente. Revalidar antes da janela.
3. Propor o candidato financeiro **depois da cauda TISS acordada**, sem reservar 0152 nem editar journal agora. Seu SHA256 normalizado LF é `5a1c7bd1a6f073972d7010998703d6f26667ee133f404dd358153fc5e2164b1a`. Número e `when` definitivos dependem do histórico congelado; não inserir timestamp anterior ao último aplicado.
4. Revisar o diff/journal composto e repetir somente os gates afetados pelos inputs finais. Novo SQL TISS posterior à 0151 invalida a aprovação automática da composição, não as provas históricas.
5. Apresentar a sequência/hashes finais para **aprovação específica do DEV**. Só então executar preflight, backup aprovado, transação com `lock_timeout`/`statement_timeout` e postflight dos contratos, RLS/grants, índices/constraints/funções, isolamento e gate de trial.
6. Interromper por qualquer drift, conflito de timestamp, lock, invariantes ou recusa de permissão inesperada. Reverter a transação falha; após commit, recuperação por correção à frente/backup aprovado. Não apagar ledger/histórico nem inventar DOWN.

**Nenhuma ação humana ou pagamento novo é necessário para repetir os gates já aprovados.** Dependências restantes são acordo do schema final, autorização da aplicação compartilhada, prova externa de renovação/fechamento e implementação/revisão da composição live. A variável live já cadastrada não dispensa nenhuma dessas etapas.

**Verificação posterior do código4b666cc0:** CI43154102122 PASS7061/22E2E semSKIP, build/segurança/isolamento; E2E autenticado ativo PASS1/1 no Preview, desktop/celular, usando fixture antiga sem nova conta/checkout/invoice. Readbacks antes/depois preservados. A autenticação de teste não é leitura pura do Auth. Não repetir a prova para fechar gates já aprovados; consultar os checks do PR53 para o commit documental posterior.

## Restrição operacional após o incidente da CLI

Não usar `vercel env run` neste ambiente até esclarecer o despacho observado em12/11. Uma tentativa Preview/local criou um projeto auxiliar remoto, sem alterar o Qoro. Não repetir comandos de deploy/ambiente para diagnosticar. Preferir inspeções GET explícitas com projeto/time/ambiente conferidos; não usar `env pull` para criar cópia em texto claro de segredos. Operadores antigos de `dist` não são o runbook e não devem ser executados por inferência, especialmente os que escolhem uma chave genérica.

A limpeza pendente diz respeito somente a `run-scale-preview-redis` / `prj_htYpK9lthoj7LG78fVa8JsH3VzRn` e `dpl_HX9mrERFQab1U74efzo4NjX7yKdh`; exige a confirmação específica já solicitada. Não remover `project-os`, projeto Supabase, Git, integrações ou contratos. O arquivo do auxiliar é um wrapper sem credenciais, protegido por SSO; inventário/prova do SHA estão no registro canônico. Esta exceção não autoriza Production, nem deve ser ocultada pelo resultado verde dos testes.

## Scanner incremental e tick de recuperação — candidato de 12/11

O SQL `saas_period_snapshot.candidate.sql` continua fora do journal. Sem suas tabelas novas, a aplicação usa o caminho N-1 limitado: **não declarar a fila incremental operacional no DEV/Preview antes da aplicação especificamente autorizada**. A numeração financeira deve ser escolhida após congelar a cauda TISS; 0155/0156 já são da outra frente e há trabalho posterior em edição.

O serviço persiste páginas de até 100 registros por loja/mês/finalidade (card_approved ou adjustments), sem misturar prova de pagamento e observação de estorno. Cada execução faz no máximo dez páginas no lote de cron e duas na leitura interativa. Não há limite acumulado de 500. Um snapshot completo é necessário antes de usar os comprovantes. Depois, a leitura curta do topo evita repetir toda a loja por clínica; varredura integral periódica alcança backfills antigos. Horizonte de frescor e revisão integral: 60 segundos/15 minutos na candidata. Sem tick saudável isso não é garantia temporal.

`/api/cron/outbox` já tem agenda de minuto; o código candidato reutiliza esse tick, com lote financeiro paralelo de até 35 segundos, **ainda bloqueado em Production**. Não foi alterada a agenda externa. O reconciliador diário permanece adicional. A Vercel executa crons no ambiente de produção; publicar um Preview não prova execução recorrente. Validar a rotina em Preview com chamada autenticada de teste após o schema aprovado, preservando fixtures e sem expor CRON_SECRET. A futura composição live deve ativar consumidores por binding e preservar Asaas; não remover o guard Sandbox para fazer um teste passar.

### Diagnosticar atraso sem criar nova cobrança

1. Identificar o ambiente e o SHA. Consultar somente metadata e a clínica autorizada; não copiar chave live para Preview.
2. Conferir heartbeat `outbox`, `billing.abacatepay.recovery_batch` e `billing.abacatepay.statement_scan`: páginas/linhas, `pendingPartitions`, `oldestPendingMs`, falhas, `leaseLost`, `providerMs`, `databaseMs` e duração total. Os tempos de banco incluem admissão no pool; não representam tempo puro de CPU/lock.
3. Em banco autorizado, consultar apenas estado, contadores e idade dos jobs. Não copiar payload, cursor, token de lease ou identificadores de clientes em alertas. `next_attempt_at` futuro indica backoff; lease válida não deve ser removida manualmente.
4. Verificar os eventos privados `subscription.renewal_recovery.checked`/`observed` e o inbox. `statement_scan_pending` significa continuidade automática; não é prova de pagamento nem exige criar outro checkout.
5. Falha transitória retoma sem reenviar POST. Cursor inválido reinicia geração com backoff. Conflito de identidade, valor, cliente ou período exige revisão, sem crédito provisório.
6. Persistência de cinco falhas no scanner gera alerta. Monitorar também ausência de heartbeat/backlog crescente: um job que nunca roda não emite seu próprio alerta. Preparar regra Production equivalente à de Preview; configuração externa ainda exige aprovação.
7. Se o provedor não informar vínculo/período suficiente para uma renovação sem webhook, manter revisão. O scanner não inventa a associação `subs_` ausente no extrato. Guardar `payment.id`/evento autenticado existente; usar somente o operador de revisão autorizado.

**SLOs propostos, ainda não aprovados nem comprovados em Production:** confirmação HTTP do inbox p95≤500 ms; ativação assíncrona usual≤5 min; alerta de pagamento não tratado/backlog sem progresso≤10 min. Medir ingresso, fila, provider/Redis, admissão no banco, transação e processamento separadamente. Carga do domínio não prova latência HTTP, SLA do provedor ou capacidade da Vercel. Registrar indisponibilidade externa e limites da máquina; não aumentar pools/planos sem avaliar limites e custos.

### Ensaiar localmente, sem serviços remotos

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '120e8195e4ad267a64157239cb9bc0c22b432033'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-statement-scan-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-composition-checks-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
Remove-Item Env:QORO_TISS_WORKTREE,Env:QORO_TISS_REF -ErrorAction SilentlyContinue
```

Esses scripts exigem PostgreSQL local e recusam rede externa. Produzem JSON em `dist`, com ambiente `loopback_synthetic`. Não adicionar `--env-file`, chave real ou endpoint remoto. A prova do scanner distingue cache de comprovantes de invoices/acesso; a prova financeira valida sua aplicação transacional. Não somar testes locais como pagamentos externos.

### Inspeção e futura remoção exclusiva do auxiliar

Preflight: `node node_modules/tsx/dist/cli.mjs scripts/security/vercel-auxiliary-preflight.ts '<caminho absoluto do vercel/dist/vc.js já instalado>'`. O helper valida ID/time, lista domínios/recursos e confere o Qoro por GET. Saída sanitizada em `dist/vercel-auxiliary-preflight.json`. Não usa comandos default da CLI nem lê valores de env.

Após **aprovação específica** e novo preflight, a operação exata prevista é `DELETE /v9/projects/prj_htYpK9lthoj7LG78fVa8JsH3VzRn?teamId=team_ml9fFeF262JqUMwFB6Vy61Cj`. Não executada. Conferir ausência de domínio personalizado, variável, Git, recurso vinculado e uso por outro operador. Parar se qualquer dependência aparecer. O Qoro `prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ` deve permanecer intacto. Depois, exigir GET404 do auxiliar e readback inalterado do Qoro. Não presumir custo zero nem apagar recurso externo associado por inferência.

### Atualização final do tick e do schema revisado

Além da busca sem webhook, o tick retoma até dez eventos já recebidos no inbox, com lease/backoff e deadline propagado a todos os leitores. Aguarda outbox, recuperação e inbox terminarem antes de responder com erro. Comprovantes de cartão são imutáveis; movimentos do cache de estornos podem ser atualizados sob a mesma identidade, preservando o histórico processado no audit. Alteração de identidade gera revisão e nunca contamina a finalidade de cartão.

Snapshot SQL revisado até 0158 (120e8195), 160 entradas no pacote de laboratório, sem reserva do número financeiro. Provas atuais: scanner 22, financeiro 122, trial 50, SQL 41 e Drizzle 8. As verificações adicionais de TISS cobrem compatibilidade e segurança; não substituem a homologação funcional do PR #55. Acordar a cauda e aprovar os hashes antes de qualquer DDL compartilhado.

**Preview não recebe a agenda automática:** a [Vercel invoca cron somente em deployments Production](https://vercel.com/docs/schedules/cron-jobs/quickstart). Portanto, o código de minuto está preparado, não comprovado como scheduler ativo do Sandbox. A validação futura precisa de uma execução autenticada e restrita à fixture financeira, depois da aprovação do schema. Não disparar o outbox global do DEV compartilhado para medir Redis: ele também contém handlers de mensagens e outras clínicas. Não usar `vercel crons run` como se aceitasse Preview nem recorrer ao caminho `env run` do incidente. A ausência de tick automático não é um bug de código ou autorização para ativar Production.

## Aprovação executiva de 12/11 — aplicação DEV e preparação live

A cadeia completa 0144–0158 + financeira0159 foi autorizada para DEV, após esclarecimento do journal único. Inputs fixos em [release-manifest.json](../decoupling/asaas-to-abacatepay/migrations/release-manifest.json). Nunca usar esse pacote em Production. Antes de aplicar, conferir refs e ausência de edição na cauda, hashes, histórico real, DDL concorrente, transações longas, locks, backup e os relatórios locais125/22/41/50/9. Qualquer drift interrompe a aplicação; não renumerar ou corrigir hashes históricos. O migrator oficial deve executar o journal composto, e a segunda execução deve ser vazia.

O backup DEV cifrado de12/11 fica sob LOCALAPPDATA/Qoro/Recovery/dev-before-0159-20261112; a evidência registra hash e decifragem sem conteúdo SQL. A recuperação primária de uma falha na aplicação é rollback transacional; não restaurar o DEV inteiro nem apagar trabalho de outros agentes automaticamente. Depois de commit, preferir correção à frente sob revisão e preservar todos os fatos financeiros.

A composição live está preparada no código, com variáveis descritas na auditoria. Não basta a API key. Production permanece sem ativação; manter a aquisição parada até configuração, catálogo, webhook, observabilidade e gates externos aprovados. Uma volta do seletor de aquisição para Asaas não migra contratos AbacatePay já emitidos; seus consumidores devem continuar ativos.

Incidente auxiliar: exclusão do projeto prj_htYpK9lthoj7LG78fVa8JsH3VzRn confirmada em12/11 às22:20UTC, após preflight e autorização específica. Não repetir a remoção. Production Qoro e superfícies legítimas preservadas. O preflight anterior é histórico, não representa ausência de autorização atual.

### Aplicador DEV da composição congelada (12/11)

Somente após autorização específica e backup cifrado com decifragem verificada. No worktree financeiro, defina `QORO_TISS_WORKTREE` para a pasta TISS autorizada (somente leitura), `QORO_TISS_REF` para o SHA do manifesto e `QORO_LOCAL_ENV_FILE` para o `.env.local` já existente, sem copiá-lo. Execute `pnpm exec tsx scripts/security/abacatepay-tiss-composition.ts` e `pnpm exec tsx scripts/security/abacatepay-dev-release.ts` (padrão: preflight). Após commit dos inputs, a execução autorizada é `pnpm exec tsx scripts/security/abacatepay-dev-release.ts --apply --commit=<SHA completo revisado>`. O destino fixo é DEV pqhkirrszzpwezdaqrai; Production é recusada. O operador aceita baseline144,159 ou160 após conferir cada hash; aplica apenas pendentes pelo migrator oficial, nunca insere histórico manualmente. Bloqueia cauda de migrations em alteração, ref remoto diferente, DDL ativo observado, transações longas e locks esperando. O lock consultivo só coordena operadores que o respeitam; os timeouts continuam obrigatórios. Relatórios sanitizados em `dist/abacatepay-dev-release-*.json`. Não usar este script para Production ou desfazer a aplicação do outro agente.

### Checkpoint executado — DEV160 e fechamento Sandbox (12/11/2026)

A aprovação da cadeia foi reconciliada com a execução independente do agente TISS:0144–0158 já estavam aplicadas; este operador aplicou somente0159 pelo pacote fixado, sem reaplicar ou editar o histórico. O readback passou159→160,224 tabelas existentes preservadas e segundo migratornoop. Backup cifrado privado c499ab2d… antes da aplicação; não restaurar compartilhado automaticamente. Fonte: relatório§50/registro executiveFollowup. O root journal das branches independentes não deve ser sobrescrito por cópia inteira; o manifesto e o gerador preservam todos os SQLs/hashes da composição reproduzível. Antes de futura migração Production, integrar/aprovar esse pacote e conferir seu histórico real; a autorização DEV não o autoriza.

O fechamento **já foi executado uma vez** no Sandbox, no bill_WDnCdCcreJeqUyz65paa4WXt. Não repetir POST nem novo pagamento. O journal devolveu resultado confirmado sem outro POST; assinatura, invoice, período, liberação e extrato preservados. O checkout saiu da listagem e continua consultável por GET(PAID). Evento tardio sintético assinado percorreu o Preview sem mutação financeira. Esses readbacks não comprovam cobrança após um mês. A documentação oficial atual ([índice](https://docs.abacatepay.com/llms.txt), item subscriptions/checkouts/delete) declara bloqueio do link excluído; a resposta HTTP200 do link não demonstra capacidade de pagar. Respeitar a inspeção observacional registrada, sem tentar novo pagamento.

A prova Preview utilizou credencial Sandbox já cifrada com DPAPI e bypass legítimo da Vercel somente em memória; não exportou variáveis sensíveis, mudou Production ou criou endpoint de teste. Falha/circuito429 e volume permanecem provas em ambiente isolado; não desligar Redis nem rodar um tick global para produzir evidência às custas de outras clínicas DEV.

### Composição de código reproduzível — engenharia, sem merge/publicação

Inputs: financeiro04a4fd7332795be9c83906c8edefffaa8b30137a eTISS9b463168f438f5ec59d192351b2f96179e81d197. A diferença SQL/schema desde o pin operacional62edb485 é vazia. O manifesto aplicado DEV continua preservado; novo HEAD de código não autoriza alterar um registro de migration.

1. No worktree financeiro, executar `git merge-tree --write-tree --name-only 04a4fd7332795be9c83906c8edefffaa8b30137a 9b463168f438f5ec59d192351b2f96179e81d197`. O resultado conhecido é a árvore f747432246f026581cfcf5885b19a0be1f35c4d4, com conflitos somente em docs/security/acoes.md, drizzle/migrations/meta/_journal.json e scripts/arch-db-check.ts. Exit1 nesse comando descreve conflitos; não é aprovação do merge. Se a lista mudar, parar e revisar. Não executar git merge no worktree do outro agente.
2. Exportar essa árvore com git archive para uma pasta nova em dist. Nenhum arquivo .env ou credencial deve ser copiado. A extração não é um novo branch e não altera index/refs.
3. Usar na cópia o journal160 e0159 produzidos pelo gerador da composição congelada; a0159 deve ter SHA256 LF eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74. Preservar exatamente as entradas0000–0158. Não ordenar timestamps para ocultar conflito.
4. Resolver a allowlist mantendo nominalmente abacatepay-dev-release.ts e o operador TISS guardado já revisado, sem liberar diretórios inteiros. Regenerar docs/security/acoes.md com `pnpm exec tsx scripts/security/inventory.ts --write` na cópia; inventário não é resolvido escolhendo um lado do conflito.
5. Aplicar somente na cópia o patch docs/decoupling/asaas-to-abacatepay/migrations/tiss-ledger-integration.patch. O patch não contém linhas de contexto vazias para passar no gate de whitespace. Usar `git apply --check --unidiff-zero <patch>` e depois `git apply --unidiff-zero <patch>` somente sobre o arquivo do SHA fixado; o check passou contra o arquivo9b463168; não reaplicar se já contiver a correção. O teste passa tanto com a faixa financeira histórica ausente quanto integralmente presente e aceita somente a sucessora congelada.
6. Rodar typecheck, arch:db-check e os três testes migration-journal, migration-safety e health-insurance/migration-ledger. Na cópia,36/36 passaram. Build não dispensa o E2E autenticado das páginas alteradas pelo TISS; o incidente CARE_TYPES deve ser corrigido pelo responsável PR55 antes de um GO conjunto.
7. Um Preview exclusivo foi criado para o build da composição, com SAAS_SIGNUP_PROVIDER=abacatepay_sandbox, ABACATEPAY_ENVIRONMENT=sandbox e ABACATEPAY_NEW_CHECKOUTS_ENABLED=false como overrides somente desse deployment. Não usar para pagar ou substituir as cinco fixtures. Não copiar a configuração para Production. A Vercel não aceita --skip-domain em Preview; a primeira tentativa foi recusada antes de criar deployment. O retry permaneceu explicitamente Preview, no ID existente do Qoro, com referência exclusiva de verificação.

O fechamento Sandbox já comprovado revelou currentPeriodStart2026-11-11/currentPeriodEnd2026-12-11/nextChargeAt2026-12-11 no GET da assinatura. Isso comprova a configuração/consulta futura, **não** uma renovação realizada. Não repetir checkout, pagamento, fechamento, MFA ou probe para obter esse mesmo resultado.

**Build composto confirmado:** Preview exclusivo https://project-dnyxo3r3q-clinic-os-v2-s-projects.vercel.app, READY,5min35s. É um artefato de verificação com checkout bloqueado, não o destino de novas homologações de pagamento nem substituto do Preview financeiro do PR53. O snapshot contém o TISS9b463168 com incidente RSC conhecido; não usar o build verde para fechar esse incidente. O tsc local desse snapshot parou por heap2GB; Next remoto verificou tipos/lint sem desabilitar gates.

## Checkpoint executável — 13/11, composição e144 e infra isolada

Estado comprovado: DEV160/0159 já aplicada, apenas readback nesta rodada; catálogo45 relações e227 fingerprints preservados. Não executar migration novamente. Composição testada: financeiro5144e6b5 mais diff do incremento, TISS e14408d3. Mudanças posteriores do proprietário não estão automaticamente homologadas. Ver relatório§52 e finalTissReconciliation na evidência canônica.

### Reproduzir somente quando o código afetado mudar

No worktree financeiro, PowerShell, sem carregar .env nem usar chave real:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = 'e14408d3d947ec426c36abd390d5f4c3002264c8'
$env:QORO_ABACATEPAY_OPERATIONAL = '1'
$env:QORO_FINANCIAL_REF = (git rev-parse HEAD)
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_ABACATEPAY_OPERATIONAL
```

Pré-requisitos: Docker Engine ativo, PostgreSQL local compatível com o helper scratch, porta55492 livre e dependências já instaladas. Esse comando cria somente banco descartável e Redis com label qoro.synthetic=billing-operational em loopback. Fonte do provedor é HTTP sintético; saída de êxito: dist/abacatepay-operational-http.json com status PASS. Redis é removido e cluster é parado pelo harness. Não reaproveitar esses dados, executar contra DEV, passar --env-file ou interpretar esse teste como renovação externa. Se houver falha, preservar o diagnóstico; não alterar status no banco para fazê-lo passar.

A composição descartável usa merge-tree/export, journal gerado160, patches tiss-ledger-integration.patch e tiss-composition-harness.patch. Para aplicá-los a uma pasta aninhada no repositório, executar a partir da **raiz financeira** com --directory apontando para essa pasta; git apply dentro da subpasta pode ignorar paths que considera fora do prefixo. Usar --unidiff-zero nos dois patches e sempre verificar --check antes, confirmando que o arquivo foi realmente alterado. O segundo patch só adapta testes do SHA e144; não altera regras de TISS, dados, SQL ou worktree do proprietário.

### Preview e falha de configuração

Preview composto atual: https://project-m6qti314r-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura. Login/cota/readbacks/desktop/mobile passaram com fixture já paga. Novas aquisições ficam fechadas (503 esperado). Não criar/pagar checkout nessa URL. A mensagem de indisponibilidade de gestão é segura, mas **não equivale a configuração correta**: verificar os nomes/escopo Sandbox e o caminho pago antes de fechar incidente. Nunca habilitar controles Asaas para um binding AbacatePay para contornar a mensagem. A correção não altera contratos.

### Monitorar eventual piloto, somente após autorização

1. Fixar commits/checks, catálogo/live, loja atestada, segredo HMAC próprio, cohort aprovado e plantão. Não usar recursos Sandbox como live. A presença da APIkey não libera aquisições.
2. Com aquisição parada, conferir recebimento/consumidores por binding, cron de minuto e scanner. Preview não recebe cron automático; operação Production só na janela autorizada, sem tick global no DEV para ensaiar.
3. Medir idade do inbox, attempts, filas em received/processing/review, lease vencido, falha de ativação e scan pendente. Pagamento comprovado sem invoice/período/cota correto é incidente; aquisição deve parar sem parar reconciliação.
4. Proposta conservadora de início: até10 clínicas listadas; nenhuma expansão automática. Rever com base na cobertura efetiva do cron/alertas e comportamento do provedor. Isso é proposta operacional, não capacidade garantida.
5. Em renewal ausente/ambíguo, manter revisão explícita; confirmar payment.id, loja, cliente, valor, competência e obrigação pelo leitor/receipt/extrato suportados. Usar reprocessamento existente com MFA e audit. Nunca estender acesso por texto da IA, inventar vencimento ou fazer novo POST de cobrança para reconciliar.
6. Uma prova de renovação futura exige evento/receipt de um novo ciclo, invoice única, período único, cota correspondente, UI, duplicata recusada e alerta/reconciliação consistentes. Consulta de data futura e fixtures não encerram esse aceite.

Interromper novas aquisições por: vínculo cruzado, duplicidade financeira, recibo sem proveniência, drift de contrato legado, ativação sem comprovação, worker/alerta sem cobertura ou backlog sem recuperação. Desligar aquisição não apaga obrigações nem autoriza rollback destrutivo. Preservar inbox/invoices/readbacks/journal e corrigir à frente se o release anterior não suporta os bindings.

## Operação preparada — fechamento live, watch e rotação,13/11

Checkpoint corrente: relatório§53 e dossiê de decisão no plano final. TISS bf59cbc3, SQL sem delta desde e144; DEV160/0159 apenas conferido. O gerador scripts/security/abacatepay-code-composition.ts exporta fontes imutáveis, resolve apenas os três conflitos conhecidos, aplica os patches revisados e registra inputs; nunca mescla branches ou escreve no worktree TISS. Executar antes o gerador SQL com os refs completos do manifesto. Se a exportação já existir, ele recusa substituí-la; preserve a prova e use outro par de SHAs revisado, sem remover pastas às cegas.

### Fechamento após pagamento e cobertura de renovação

O consumidor preparado fecha **somente checkout live comprovadamente pago**, com invoice/vínculo/loja/modo/assinatura/cliente/produto/valor conferidos, journal at-most-once e audit idempotente. Atéuma geração por tick, orçamento20s, independente da flag de aquisição. Não cancela a recorrência nem reverte acesso/invoice. Sandbox continua exclusivamente no operador manual anterior: não fecha as cinco fixtures retidas. Operação running/unknown fica em revisão, sem novo POST; concorrência in_progress não é tratada como nova autorização de executar. Falha autenticada gera alerta e não registra heartbeat saudável.

O observador de período também participa do cron de minuto, além da conferência diária existente: o gate por assinatura/hora, locks e fingerprint impedem alertas/audit duplicados. É uma detecção de divergência para revisão, sem conceder período provisório. Ver limites/backoff/cohort e regras de parada no plano de piloto. Alteração do código só chega a Production depois do GO; nenhum cron remoto foi chamado para produzir evidência.

### Rotação planejada do segredo, sem perda intencional de pendências

1. Abrir janela de rotação e conferir captura de alertas; pausar novas aquisições com flagfalse e novo deployment, mantendo consumidores. Guardar segredo atual e novo no cofre com acesso restrito; não enviar valores por chat/terminal visível.
2. Configurar o novo ABACATEPAY_WEBHOOK_SECRET e, na variável opcional ABACATEPAY_WEBHOOK_PREVIOUS_SECRET, JSON privado com secret antigo e expiresAt UTC absoluto de no máximo24h. Verificar antes em Preview. Criar novo deployment e comprovar que ambas as autenticações previstas são aceitas com HMAC e mesmo inbox; nada libera acesso por segredo apenas.
3. No painel/API oficiais, apontar o webhook para o novo segredo durante a sobreposição, preservando o mesmo endpoint e eventos. A API documentada expõe criar/listar/consultar/excluir; não existe update comprovado. Se for necessário criar outra configuração, registrar ambos IDs e aceitar duplicatas idempotentemente. **Não excluir o anterior enquanto houver entregas pendentes:** a documentação informa que a exclusão as descarta. Não imprimir URLs com webhookSecret.
4. Conferir logs e inbox do destinatário para o segredo novo, pendências do anterior e ausência de duplicação financeira. Se a janela não for suficiente, interromper a rotação e decidir formalmente a transição; não manter segredo anterior indefinidamente nem estender datas automaticamente. A rotina de reconciliação continua como contingência, sem substituir prova financeira ausente.
5. No prazo absoluto, o antigo é recusado401, inclusive sem redeployment. Depois de drenar/conferir a configuração anterior, retirar o JSON antigo na Vercel por novo deployment, remover a configuração obsoleta somente com autorização própria e arquivar a evidência sanitizada. A chave API não participa dessa rotação e não deve ser recriada.

Teste unitário controla o relógio e prova aceitação atual/anterior, HMAC inválido, deduplicação e recusa na expiração; isso não é uma rotação operacional já executada no provedor. Nunca copiar o segredo do Sandbox para live.

### Recuperação operacional e significado do ensaio

O modo QORO_ABACATEPAY_OPERATIONAL_PROFILE=pilot usa10 clínicas sintéticas, Redis/PG isolados, dois processos frios e ticks separados por60s reais. A fixture de indisponibilidade72h deve ter pagamento/período históricos coerentes com received_at: envelhecer só o evento e deixar o pagamento no futuro é corretamente recusado. O ensaio não antecipa lease/backoff nem comprova renovação externa. A perda de resposta HTTP permite redelivery limitado de ECONNRESET/UND_ERR_SOCKET e exige inbox durável/finais únicos. Consultar a evidência para o resultado efetivamente medido; falha do harness não recebe PASS por documentação.

O harness financeiro completo agora usa Redis Docker isolado nos cenários de comando com contexto live sintético. Isso preserva a exigência de coordenação, sem introduzir bypass Production. Não carregar chave live. O provider HTTP continua sintético e o banco exclusivamente loopback.

Auxiliar run-scale-preview-redis: GET do ID exato retornou404 em13/11 10:35UTC; limpeza anterior concluída. Não tentar excluí-lo novamente nem usar buscas amplas para apagar outros projetos. QoroProduction permaneceu no5620a098.

### Reproduzir somente o pacote de revisão, sem DDL/deploy

Inputs usados nesta rodada: financeiro1703b3f2acfa4f31d1c74a3d1649d532bc1a4ecd e TISS4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269. Execute no worktree financeiro, não na main ou no worktree TISS:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE='C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF='4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269'
$env:QORO_FINANCIAL_REF='1703b3f2acfa4f31d1c74a3d1649d532bc1a4ecd'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-tiss-composition.ts
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-code-composition.ts
```

Os dois comandos apenas projetam arquivos em dist e usam git show/merge-tree; não fazem merge nem migration. O segundo recusa sobrescrever o export existente. Nesse caso, leia composition-inputs.json e confira os dois SHAs/hash0159; preserve o pacote, não o apague para forçar reexecução. O journal160 gerado só pertence à composição, não substitui journals aplicados das branches por conveniência.

Para validar um export novo, instale as mesmas dependências do lockfile, sem copiar .env; execute nele types/lint e regressões afetadas. Neste Windows, o tsc do pacote atingiu o heap padrão2GiB e passou com **node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit**. Foi somente parâmetro de processo local; não foi modificado tsconfig, CI, build, versão, teste ou política de segurança. O build remoto e o login/readback/UI1440/390 do pacote também passaram. Falta de memória não deve ser registrada como erro TypeScript nem como PASS sem o reteste.

O Preview de composição não herda overrides restritos à branch apenas por metadata. Seus cinco valores Sandbox precisam ser resolvidos por acesso autorizado e aplicados apenas em memória ao deployment, como nesta rodada; nenhum valor Production é permitido. Conferir source metadata e release antes de usar a fixture já paga. O Preview não gera cron automático; o perfil pilot chama o seam real em dois processos frios com intervalo60s, sem se apresentar como medição do scheduler Vercel.

## Janela técnica 13/11 encerrada e EARLY-01 preparada

**Já executado, não repetir:** catálogo live 5/5 (mensalidades R$ 197/397/544/691/838), cinco nomes Production com checkouts desativados, segredo exclusivo e alerta sintético Production `ed622a74` recebido. Janela 11:48:44–12:06:43, America/Fortaleza. Release `5620a098` preservada; endpoint financeiro 404. Nenhum webhook live cadastrado, migration, checkout live ou contrato alterado. Ver relatório §54/JSON canônico para antes/depois e IDs de rollback. Configuração salva não altera deployment antigo.

**Sandbox preparado:** run `d2d0e84d-059b-4b29-9074-f3305a3fc97f`, clínica `8b12f2da-b881-4409-815f-a18ec71fd1c6`, assinatura `1c21ff83-9e46-4eee-bffa-d19aa2be9135`. Trial de 14 dias desde Auth, até 27/11 às 15:12:42.157 UTC. E2E real PASS em 1440/390; zero checkout, invoice, operação e liberação paga. Senha sintética protegida com DPAPI; nenhum envio de e-mail. Não reconstruir a conta nem repetir os cinco pagamentos iniciais.

### Histórico da criação EARLY-01 — já executada, não repetir

O comando abaixo é **para a engenharia após essa mensagem**, não uma solicitação para o founder executá-lo agora. O operador confere ambiente/loja/produtos/branch/hashes DEV antes de qualquer mutação. Se houver checkout, faz readback e reutiliza; não cria outro intent. Entregar somente o link realmente devolvido pelo Qoro.

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$qoroSessionPath = Join-Path $env:LOCALAPPDATA 'Qoro\SandboxBilling\next-checkout-earlypayment-20261113\session.json'
$qoroPrepared = Get-Content -LiteralPath $qoroSessionPath -Raw | ConvertFrom-Json
node --use-env-proxy --use-system-ca --conditions=react-server --import tsx scripts/abacatepay-checkout-operator.ts --action create --preview $qoroPrepared.origin --vercel-cli C:/Users/joaom/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js --plan consultorio_2026 --scenario early_payment --session next-checkout-earlypayment-20261113
```

Após pagamento humano Sandbox, usar os mesmos argumentos com **--action verify**, sem trocar session/origin/plan. Consultar o provedor antes de declarar pago; evento completed e efeito local são conferidos separadamente. Exigir uma invoice/attempt/receipt, binding correto, período pago, cotas e UI. Se a rede falhar, preservar manifesto e retomar; nunca limpar por timeout. A ativação antecipada usa Auth como limite inferior do período, sem exigir que o trial termine.

Se o Preview/webhook mudar de release, o preflight bloqueia antes do checkout. Reconciliar origem/manifesto e comprovar novamente ausência de operação; não ignorar o guard, copiar segredo live ou criar outra fixture. Não pagar duas vezes o mesmo link. O pagamento não ativa TISS automaticamente nem autoriza conectar integrações reais durante o teste.

### Riscos e encerramento

R1: closure automática live e consumidores exigem release compatível autorizado; não ativar endpoint 404. R2: renovação natural e R3: mudança efetivada em novo ciclo não possuem acelerador localizado no Sandbox em 13/11. Coortes locais 1/3 passaram e complementam 10/100/500/1000 preservadas; não representam capacidade remota. Nenhum risco R1–R4 foi aceito.

Para reverter a configuração desta janela, conferir IDs no JSON e remover somente as cinco entradas criadas, se inalteradas. Manter API key, variáveis anteriores e produtos intactos. Não apagar webhook compartilhado nem parar consumidores existentes. O segredo está protegido pelo Windows CurrentUser e na Vercel sensitive; não é uma cópia de DEV. A ficha de responsáveis/cohort do piloto real permanece no plano; disponibilidade nesta janela não equivale a plantão permanente.

### Estado corrente EARLY-01 — pagamento e fechamento comprovados em 13/11

**Não executar novamente create nem pagar o link antigo.** Checkout `bill_KJRNEFgyUExtx4EKFwZA2WFk`, assinatura remota `subs_e1A14YHx3uK3sFWYPEJpna2F`, R$197 Sandbox. Pagamento real Sandbox/completed/inbox/invoice/cotas/UI PASS; uma invoice paga e um receipt. Período Qoro13/11–13/12, conversão antes do trial terminar27/11. Prova e IDs completos no relatório §55/JSON canônico, sem credenciais.

O fechamento foi realizado pelo operador no seam Sandbox, com journal/audit únicos e readback posterior. Assinatura ACTIVE e invoice preservadas. Esse comando não cancela recorrência. Fixtures Sandbox não entram no reconciliador automático live. Não chamar fechamento manual de automático nem ausência da listagem de prova de uso único do link.

Após o fechamento, o GET do checkout apagado pode não estar disponível. Portanto o operador `verify`, que usa esse GET, não é o caminho para conferir de novo essa geração encerrada. Usar o receipt imutável/journal/audit, GET da assinatura e readback da invoice/período/cota; não criar outro checkout para substituir a prova. Credencial e manifesto ficam retidos com DPAPI/ACL privada; sem cleanup por timeout.

Idempotência desta geração: reapresentação interna dos mesmos IDs/hash retornou duplicate; worker e recuperação não reaplicaram nada; snapshot inalterado. Não se fez replay HTTP assinado do provedor nem falha artificial no banco compartilhado. As provas isoladas dessas falhas continuam referenciadas no relatório.

Incidente R51 permanece aberto: erro #418 reproduzido no dashboard da Preview TISS a04a1535, sem demonstrar Production afetada. Não suprimir erros. A correção de ambiente Sentry já existe no PR53 e precisa ser preservada na composição com o PR55; a causa de hidratação exige investigação própria. As 22 verificações de navegação/logout na Preview financeira sem pageerror são uma amostra, não prova de eliminação do R51.

## Observação segura da próxima renovação EARLY-01 — vigente em13/11

**Apenas para o operador técnico. Não pagar, recriar, fechar novamente ou cancelar esta fixture.** O código abaixo usa somente GET do provedor e transações SQL READ ONLY. Não precisa abrir navegador, descriptografar a senha de teste ou copiar chaves. Usa a chave **Sandbox** já existente no arquivo local; recusa Production e qualquer manifesto não verificado.

No PowerShell, execute estas duas linhas separadamente:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
node --use-env-proxy --use-system-ca --conditions=react-server --import tsx scripts/abacatepay-observe-renewal.ts --session next-checkout-earlypayment-20261113
```

Resultado comprovado13/11: `observationStatus=PASS`, `state=awaiting_next_cycle`, `officialNextChargeDate=2026-12-13`, `recordedCycles=0`, `closureConfirmed=true`. O período Qoro termina13/12 às17:44:27.418UTC; **a API informou só a data da cobrança, sem garantir horário ou sucesso**. O relatório sanitizado fica em `dist/abacatepay-renewal-observation-d2d0e84d-059b-4b29-9074-f3305a3fc97f.json`; o manifesto privado original não muda.

Agenda proposta: executar uma leitura em12/12, outra em13/12 e após a chegada de evento/aviso. Não instalar tarefa recorrente nem depender de processo permanente para conceder acesso. Os crons reais de inbox/watch/scanner são a automação do produto e precisam estar publicados/operacionais no ambiente autorizado; o observador é uma prova separada. A existência de cron no repositório/Preview não prova execução agendada em Production.

| Resultado | Ação segura |
|---|---|
| `awaiting_next_cycle` | Preservar fixture e aguardar; ACTIVE/data futura não são renovação paga |
| `due_unobserved` (saída2) | Verificar inbox/recibo/extrato pelos fluxos existentes; abrir incidente no canal configurado; não prorrogar acesso manualmente |
| `renewal_recorded_requires_external_review` | Conferir novo payment.id, invoice paga, período, cota e prova do provider/statement. Registrar observação natural separada da simulação; o observador não concede PASS temporal sozinho |
| `recurrence_stopped` | Conferir cancelamento documentado, manter direitos até o fim pago; não reativar ou pagar por conta própria |
| `review_required` / `BLOCKED` | Conferir motivo sanitizado e vínculos. Se mudança concorrente, repetir **somente leitura**. Nunca executar create/POST por causa de erro do observador |

Se houver webhook tardio ou ausente, usar a recuperação/inbox e revisão com MFA já documentadas neste runbook, preservando conta/ambiente/payment.id/ciclo. Não inserir comprovantes manualmente, alterar datas, zerar tentativas ou reaplicar um evento applied. Refund/disputa preservam acesso até fim pago e exigem revisão, conforme decisão comercial anterior.

Fechamento automático:131 cenários PostgreSQL PASS no incremento, incluindo crash e falha antes do POST sem duplicidade. Limite atual1geração/tick, deadline20s; reserva running/unknown exige revisão e não é retomada às cegas. Backlog10 consome no mínimo10ticks elegíveis; monitorar idade da fila, operações pendentes, heartbeat outbox, Redis/429/circuito e entrega do alerta. Isso não é SLA de Vercel/AbacatePay. Nenhuma regra/canal Sentry comprovado precisa ser configurado ou testado de novo por este incremento.

### Pin atual de composição — execução local, não publicação

Em13/11 a cópia revisada é financeiro `c2431ab79a34e52c58650f578654d5771e43db06` + TISS `30126efff8aec0aa8284fceb908e3e49e0a892da`. Diretório `dist/abacatepay-code-c2431ab7-30126eff`, Preview [dpl_4kk22srPhRSRBZAq4aCmE1F8A5i3](https://project-9tgdeqhy2-clinic-os-v2-s-projects.vercel.app), build READY e aquisição fechada. As exportações mais antigas deste documento são históricas. Não fazer merge/publicar por esses comandos. O estado completo está no relatório§56G e no checkpoint canônico.

O exportador exige patches com contexto e checagem sintática antes de concluir. Não usar `--unidiff-zero`: a evolução do harness TISS já causou inserção dentro de template SQL. Se um patch não casar, interromper e revisar o diff; não aceitar deslocamento por número de linha nem ignorar erros. Checagem sintática não substitui tipos/lint/build e regressão.

O navegador de composição deve aguardar o conteúdo esperado, além do shell, e reprovar qualquer pageerror. A observação antiga de26 navegações sem erro não comprovava h1 pronto em todas as capturas; preservada e corrigida no relatório. A conta EARLY-01 retida já serve ao readback pago; não criar conta ou pagar novamente para testar navegação.

As referências atuais do provedor divergem de respostas históricas sobre uso único do checkout e ID original nas renovações. Preservar closure, inbox e correlação por novo payment.id/período/receipt. Não retirar controles por mudança de texto da documentação. Nova cobrança, API avulsa ou data artificial não substitui observação natural do segundo ciclo.
