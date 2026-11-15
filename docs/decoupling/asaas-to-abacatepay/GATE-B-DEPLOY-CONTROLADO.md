# Gate B — proposta de deploy técnico com aquisição fechada

Preparado em 14/11/2026. **Preparação autorizada; execução NÃO autorizada. PR #53 draft. Production NO-GO.** Este procedimento complementa o [runbook](../../runbooks/abacatepay-operacao.md) e o [dossiê](ABACATEPAY-SaaS-GO-NO-GO-FINAL.md); não abre janela, aplica SQL ou aceita R1–R4.

## Candidato e correção indispensável

- Repositório `joaomarcos-techia/Project_OS`, PR #53, branch `feat/billing-abacatepay-20261107`.
- Baseline aprovada: `10e5d43b131cfd6852c5471f93151b8596690514`, CI43648783989, 7.206 testes/637 arquivos e22 E2E sem SKIP. Provas preservadas, não reexecutadas por inferência.
- Novo defeito de fechamento reproduzido: a entrada do cadastro verificava `SIGNUP_ENABLED`, mas `POST /api/signup/checkout` não. Uma sessão anterior alcançava Checkout Asaas ou provisionamento de trial com aquisição fechada. Os dois testes novos falharam com HTTP200 em vez de503.
- Correção localizada na mesma rota: respeitar o kill switch antes de consultar sessão/limitador/provedor. `POST /api/signup/checkout/status` continua disponível para reconciliar obrigação existente; não se desligaram flags de identidade/Auth, cron, webhooks ou contratos Asaas. Os contratos HTTP e o erro503 existente foram preservados.
- Depois da correção: **123 testes dirigidos/6 arquivos PASS**. TypeScript e lint dirigidos PASS. O novo SHA e seus checks oficiais precisam constar do checkpoint final do PR; não usar a CI do10e5d43b para aprovar esta alteração.
- O runtime restante, SQL das migrations, catálogo, preços, cotas e dependências permanecem congelados. Não existe flag funcional `SIGNUP_CHECKOUT_ENABLED` no parser atual; não usá-la como proteção.

## Composição proposta — somente após GO explícito

| Configuração existente | Valor proposto no deployment Gate B | Justificativa |
|---|---|---|
| `SIGNUP_ENABLED` | `false` | Fecha entrada e criação/provisionamento na rota de checkout, inclusive sessões anteriores |
| `SIGNUP_AUTH_ENABLED`, `SIGNUP_IDENTITY_ENABLED` | Preservar valores atuais habilitados | Mantém leitura/retorno e recuperação de pagamentos existentes; não usar como kill switch |
| `SAAS_SIGNUP_PROVIDER` | `asaas` ou ausência que resolve para `asaas` | Não seleciona aquisição AbacatePay. O kill switch acima impede nova contratação pelo fallback |
| `ABACATEPAY_NEW_CHECKOUTS_ENABLED` | `false` explícito | Segunda barreira para nova obrigação AbacatePay |
| `ABACATEPAY_CHECKOUT_CLINIC_IDS` | String vazia explícita | Coorte vazia é rejeitada; não preencher UUID fictício nem abrir piloto |
| `ABACATEPAY_ENVIRONMENT` | Ausente, não `production` nem string inventada | Em `VERCEL_ENV=production`, o guard nega tanto live quanto Sandbox; chave/loja presentes não ativam o runtime |
| `OFFER_2026_ANNUAL_NEW_SALES_ENABLED` | Preservar `false` | Sem nova venda anual ou alteração de contratos anteriores |
| Vercel `VERCEL_ENV`, `NODE_ENV` | Valores de sistema do deployment Production | Não falsificar essas variáveis para contornar o guard |
| API keys, loja, catálogo, segredo, Redis, Auth, Asaas | Preservar os segredos específicos de Production | Não copiar DEV; presença não comprova valor ou saúde. Não imprimir os valores |

Qualquer mudança de variável só passa a valer em **novo deployment**. O deployment Production anterior não conhece a correção da rota: fechar somente a configuração nele não prova fechamento de sessões já iniciadas. A janela deve conter criação de novos checkouts durante a transição por controle de tráfego aprovado, ou manter a operação em NO-GO até o novo deployment estar servindo. Não inventar uma regra WAF/flag que não esteja implementada/configurada; qualquer contenção adicional requer escopo explícito no GO.

### Barreira de transição proposta — mudança Production ainda não autorizada

A Vercel documenta regras customizadas com filtros **Environment, Route, Method** e ação **Deny**. Proposta concreta no projeto `project-os`: regra identificada `qoro-gate-b-signup-closed`, **Environment=Production AND Method=POST AND Route em [`/api/signup/sessions`, `/api/signup/checkout`]**, ação Deny. Comparação de rota exata; não usar prefixo `/api/signup`, que bloquearia status/retorno. A condição Route executa após middleware; conferir comportamento com path canônico, barra final e normalização antes de qualquer DDL. Não adicionar `@vercel/firewall`, rate limiting pago, managed ruleset ou configuração de build. [Parâmetros e ações oficiais](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration).

A [documentação atual de cobrança](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing), conferida14/11, informa que custom rules são gratuitas e tráfego negado não gera CDN Requests/FDT. Isso não promete fatura global zero ou capacidade disponível de regras na conta. Conferir limite/permissões e ordem/bypass existentes;se exigir upgrade,parar sem contratar. **Nenhuma regra foi criada nesta rodada.** Esta barreira é mudança de escopo que precisa constar expressamente da autorização GateB. Se não for aprovada ou verificável,o procedimento permanece NO-GO para uma transição garantidamente fechada. Não substituir por desligamento global de Auth/cron.

Na janela autorizada, guardar ID/versão anterior e evidência de bloqueio sem credenciais. Antes de mutação de banco: confirmar que POSTs de criação são negados e status/login/Asaas/webhooks existentes permanecem acessíveis com testes sintéticos não monetários. Após promoção,verificar também o guard503 da aplicação por caminho de teste aprovado,não criar bypass público para isso. Manter a barreira/kill switch até autorização expressa de reabertura;retirar somente a regra temporária aprovada,nunca apagar outras regras do projeto.

**Parada obrigatória:** não desarmar runtime se houver obrigação AbacatePay live existente. Reconfirmar código publicado, origem das assinaturas e existência de vínculos/eventos/receipts na janela. Nesse caso, esta composição não é aplicável: parar, preservar consumidores e propor janela que os mantenha. Não inferir ausência apenas de zero webhooks ou do histórico anterior.

## Matriz de impacto

“Antes” abaixo é o último snapshot documentado de14/11, não nova leitura de Production nesta rodada. Valores efetivos, drift e obrigações devem ser reconfirmados na janela.

| Componente | Estado antes | Estado previsto após Gate B | Risco | Como verificar |
|---|---|---|---|---|
| Aquisição SaaS AbacatePay | Não publicada/ativada no último snapshot; seleção ausente | Fechada, sem trial/contratação novos | Flags antigas ou sessão prévia | SHA efetivo + flags propostas + HTTP503 na entrada/rota de criação com fixture sintética autorizada; zero tentativa/provedor novo |
| Checkout live | Catálogo existe; habilitação não autorizada | Nenhum checkout AbacatePay criado; ramo Asaas de aquisição bloqueado | Links hospedados antigos não são revogados por flag local | Inventariar tentativas/links pendentes por metadados. Se algum link externo ainda aceitar nova venda, parar e tratar seu escopo; não cancelar automaticamente |
| Webhook live | Zero configurações no último GET conhecido | Não cadastrado/ativado; rota503 pelo runtime desarmado | Confundir503 com teste de HMAC | Readback autorizado do provedor e teste HTTP não monetário.503 esperado não equivale a autenticidade validada |
| Consumidores financeiros | Asaas atende obrigações existentes | AbacatePay no-op antes de banco/provedor; Asaas preservado | Desligar cron inteiro prejudica outras clínicas | Guards em `acquisition.ts` e jobs; tests de processing/outbox; heartbeats e ausência de chamada AbacatePay no alvo |
| Scanner | Implementado na candidata, sem operação live comprovada | AbacatePay recovery/integrity/watch/closure no-op | Kill de checkout sozinho não o desliga | Guard de runtime + zero trabalho/HTTP AbacatePay; não invocar scan global para fabricar prova |
| Cron | Outbox por minuto; billing-reconcile/dunning diários; jobs de pacientes | Agenda e cron compartilhados continuam | Efeitos financeiros Asaas existentes continuam por desenho | `vercel.json`, `withCron`, heartbeats, ledger e saúde de filas; não acionar manualmente um cron financeiro global |
| Entitlements | Contratos legados e permissões vigentes | Preservados, sem novo direito pago ou nova cota | Alteração de schema/claims/RLS | Fingerprints de contratos/catálogo, postflight, login/MFA e regressão dirigida com dados sintéticos |
| Assinaturas legadas Asaas | Permanecem no Asaas | Reconciliação/webhooks/cancelamentos existentes preservados | Trocar key, provider global ou bloquear retorno pago | Credenciais/origem preservadas; rota de status e jobs Asaas não desarmados; hashes/condições antes/depois |
| Cobranças de pacientes | Asaas por conta/credencial da clínica | Continuam operacionais | Confundir assinatura Qoro com cobrança do paciente | Não alterar client/conta/chaves/rotas Asaas de pacientes; smoke de leitura, sem nova cobrança de teste |
| Convênios TISS | Desenvolvimento separado;0160 só no DEV conhecido | Código/menu/rota funcional fora do pacote; não habilitar módulo | SQL compartilhado necessário ao journal | Manifesto congelado160,24 pendentes,0160 ausente; entitlements não ativam `hi_clinic_settings.enabled` |

**Limite da exclusão “sem cobrança real”:** o operador não criará obrigação/teste monetário novo. Não significa impedir cobranças legítimas que o Asaas já executa nem desligar fluxos financeiros existentes dos clientes. Nenhum kill switch isolado desliga com segurança cada componente compartilhado.

## Preflight e ensaio: provas separadas

Já comprovado e reutilizado por identidade dos160 hashes: ensaio descartável136→160,24 migrations reais,16 verificações,cinco contratos legados sintéticos preservados;52 verificações de compatibilidade161. Duração de aplicação local cerca de4,9s, **não estimativa de locks/duração em Production**. Não houve repetição desse ensaio nem nova consulta de Production nesta rodada.

O preflight existente confere projeto/ambiente/journal/hash/ordem/pacote contra Git e objetos financeiros críticos em REPEATABLE READ READ ONLY. Bloqueia entrada ausente,hash/sequência divergentes,pacote incompleto e schema crítico incompatível. Não é comparação completa de todo o Supabase nem hook do migrator: a ordem de operações abaixo é obrigatória e exige janela exclusiva.

Complemento preparado: [inventário SQL somente leitura](migrations/gate-b-catalog-readonly.sql), com relações/colunas/grants,funções,triggers,policies,índices,constraints,dependências e locks. Definições saem como hashes,sem corpos de função ou dados clínicos. **É inventário, não aprovação automática de drift.** Comparar com o schema136 autorizado/restore do mesmo backup e com o delta SQL revisado0136–0159. Adições gerenciadas do Supabase ou diferenças legítimas exigem revisão explícita; nunca aceitar qualquer diferença apenas porque o journal confere. Se não houver baseline confiável suficiente para uma categoria, marcar pendente e parar antes do DDL.

Nova execução isolada do complemento: **4 checks PASS**,nove seções;detectou função adicionada e RLS desabilitado,com sete seções estruturais iguais ao estado inicial após reverter as alterações sintéticas. Cerca de0,7s apenas para essas consultas;scaffold e136 arquivos SQL reais,sem clone de Production. Zero conexão de Production/provedor e zero leitura de registro clínico. A primeira execução do harness recusou BEGIN em pool não reservado (`UNSAFE_TRANSACTION`);o harness foi corrigido para reservar conexão,sem alterar a SQL ou contornar o driver. Não confundir este teste com o ensaio anterior das24 migrations ou validação de todo schema Production.

Na janela autorizada, em console dedicado, na pasta do pacote exportado do SHA aprovado, com segredos Production carregados pelo mecanismo aprovado e nunca em argumentos/logs:

```powershell
node --conditions=react-server --import tsx scripts/abacatepay-release-preflight.ts --release '<PACOTE_APROVADO>' --ref '<SHA_COMPLETO_APROVADO>' --project '<REF_PRODUCTION_APROVADA>' --phase before
```

Somente com código de saída0,136 entradas exatas e24 pendentes. Não preencher `<REF_PRODUCTION_APROVADA>` por suposição. Não executar a0160; se ela ou qualquer entrada inesperada aparecer, parar e revisar nova composição.

Para o suplemento, `psql -X --set=ON_ERROR_STOP=1 --no-align --tuples-only --file docs/decoupling/asaas-to-abacatepay/migrations/gate-b-catalog-readonly.sql`, **somente** com `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE` carregados de forma protegida para o mesmo alvo já conferido e `PGOPTIONS=-c default_transaction_read_only=on`. Não colocar URL/senha no comando. Guardar somente JSON técnico em destino restrito. Não executar essas instruções em Production nesta preparação.

Antes/depois, comparar em transação somente leitura contagem e fingerprint de `subscriptions` (campos anteriores, excluindo a coluna nova `billing_provider`), `plans` e `prices`, usando o procedimento já ensaiado em `scripts/abacatepay-release-rehearsal-db.ts`. Conferir último titular, hook/claims, RLS/grants, FKs/constraints validadas e índices válidos. Nada de alterar linhas para fazer uma comparação passar.

## Backup, recuperação e ferramentas

| Evidência | Estado e alcance |
|---|---|
| Restore real30/10 | PASS histórico: backup cifrado SHA256 `488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992`, Supabase/Postgres17.11 e Vault0.3.1, public+auth e15 migrations anteriores; execução04:20:30–04:20:57UTC, cerca de26,5s. Não é o pacote136→160 nem um RTO de Production |
| Restore Storage/Auth | Provas históricas no [runbook de recuperação](../../runbooks/disaster-recovery.md); não repetir ou tratar como snapshot atual |
| Backup físico gerenciado atual | ID,data,escopo e restauração atual NÃO VERIFICADOS; não clicar Restore no projeto ativo |
| Backup pré-Gate B | AINDA NÃO CRIADO. Necessário dump lógico cifrado public+auth/journal, hash, tamanho, versões e restauração estrita isolada antes de qualquer DDL |
| Arquivo histórico28/10 | Não encontrado no caminho documentado nesta máquina. Isso não invalida o restore histórico,mas esse caminho não pode ser usado como prova de cópia disponível agora |
| Ferramentas locais | Node22.23.4,pg_dump/psql17.5;GPG2.4.9 existente em `C:\Program Files\Git\usr\bin\gpg.exe`, fora do PATH observado. Não precisa comprar/instalar GPG. Preparar PATH só na sessão e validar versões contra o servidor; restore que use `\restrict` requer cliente compatível,como a imagem oficial17.11 já usada |

O script `db-backup-prod.ts` transmite SQL ao GPG sem gravar plaintext; `prod-encrypted-backup.ts` confere saída e marcador final por stream. **Marcador final não substitui restore estrito.** O dump não inclui bytes Storage,segredos/configurações externas Auth nem prova recuperação do backup físico gerenciado. Neste GateB não se alteram Storage/Auth gerenciado;recuperação completa continua procedimento separado,não RTO prometido.

Preparação local reversível do operador,sem instalação e sem editar `.env`:

```powershell
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
gpg --version
pg_dump --version
psql --version
```

Na janela autorizada,na pasta exportada aprovada,com `SUPABASE_PROJECT_ENV=prod`,`DATABASE_URL_PROD` e `BACKUP_PASSPHRASE` já carregados de forma protegida: `node --import tsx scripts/db-backup-prod.ts`. A conexão é somente de leitura e a cópia é cifrada;este comando ainda **não foi executado** nesta preparação. Registrar SHA256 do arquivo cifrado,exit code e restore isolado,sem imprimir o conteúdo. Não converter presença de senha em prova de que há uma cópia/chave independente.

Manifesto obrigatório da janela: `ID do backup / UTC / tipo lógico ou físico / origem conferida / public+auth+journal / versão pg_dump e destino / bytes / SHA256 cifrado / local protegido / chave recuperável / responsável / início+fim do restore / exit codes / inventário e integridade / resultado`. Não registrar senha,URL assinada,payload ou dados clínicos. Destino local cifrado com ACL restrita já autorizado; nenhuma cópia para serviço externo sem autorização específica. Restaurar só em destino isolado,sem saída para provedores,preferencialmente tmpfs/logs desativados. Original preservado.

**Parada antes de DDL:** backup atual indisponível,senha/cofre inacessível,restore não concluído,versão incompatível,drift,transação longa/lock esperando ou falta de responsável. Informar o manifesto para avaliação; não converter o aceite anterior de RPO em dispensa desta prova. Caso a aprovação recebida não cubra a coleta/restore ou exija revisão do manifesto antes do SQL,solicitar apenas essa liberação específica e não ultrapassar a parada.

## Sequência proposta e pontos de parada

1. **Autorização e preparação local:** conferir SHA exato/CI/manifests, destino, responsáveis, segredos específicos e regras de aquisição/consumidores acima. Não promover pacote do outro agente ou substituir journal pelo HEAD TISS.
2. **Pré-voo read-only autorizado:** comparar projeto/history/schema, obrigações live,links externos pendentes e locks. Parar se a hipótese de runtime AbacatePay desarmado for incompatível com qualquer obrigação existente.
3. **Backup e restore isolado:** criar/verificar cópia cifrada e manifesto acima; comparar schema/contratos do mesmo snapshot. **Parada P0 antes de qualquer migration.** A existência do botão Restore não basta.
4. **Contenção da transição:** aprovar/conferir proteção efetiva durante a troca do deployment. A versão antiga não fecha a criação para sessões anteriores só com `SIGNUP_ENABLED=false`. Se não houver contenção aprovada suficiente,não iniciar DDL/deploy sob promessa de aquisição totalmente fechada. Não desligar Auth/cron/Asaas como atalho.
5. **SQL somente com GO de execução:** pacote aprovado, backup recuperável,preflight imediatamente antes,sem drift/lock. Usar `scripts/db-migrate-prod.ts` na exportação,journal160,0136–0159. O script cria seu backup e usa sentinel/advisory no session pooler; não é exclusão contra todo DDL nem garante timeout da sessão do migrator. Confirmar limites efetivos do próprio migrator antes de executar; não presumir que o lock da conexão auxiliar limita a outra sessão. Sem limite/observação de espera aprovado,parar. Nada de SQL avulso,DOWN ou edição de histórico.
6. **Pós-voo antes de tráfego:** preflight `--phase after`,160 entradas exatas,22 relações críticas protegidas,funções/triggers/policies/grants/FKs/índices e fingerprints legados/catálogo conferidos. Se falhar,conter e investigar; não publicar consumidor sobre schema parcial.
7. **Deployment controlado:** promover exatamente o artefato aprovado sem merge automático; aplicar composição GateB por novo deployment; verificar domínio/SHA,cadastro/criação503,AbacatePay503,cron compartilhado saudável,login/MFA e leitura clínica/financeira. Testes sintéticos autorizados,sem enviar mensagens ou criar pagamentos reais.
8. **Encerrar:** registrar evidência UTC e resultados,retirar controles temporários somente se autorizado e compatível com aquisição ainda fechada,confirmar obrigações antigas preservadas. **Parar antes do Gate C**. Sem webhook live,consumidor novo,piloto,abertura de coorte ou cobrança.

Comandos futuros de deployment,**somente após GO e pós-voo de SQL**,na pasta exportada do SHA aprovado,sem misturar arquivo de outro worktree:

```powershell
vercel link --yes --project project-os --scope clinic-os-v2-s-projects
vercel deploy --prod --scope clinic-os-v2-s-projects
```

Usar CLI já autorizada/autenticada;conferir projeto antes de confirmar o comando. `--prod` publica em Production e **não está autorizado agora**;não usar `git merge` como substituto,nem promover build Preview feito com variáveis DEV. As flags GateB devem estar no ambiente Production antes do novo build. [CLI deploy](https://vercel.com/docs/cli/deploy),[CLI link](https://vercel.com/docs/cli/link). Falha de permissão/projeto ou divergência de origem exige parar,sem contratar plano ou substituir credencial.

## Rollback por camada

| Camada | Recuperação segura proposta |
|---|---|
| Código | Voltar apenas a artefato comprovadamente compatível com schema160 e obrigações. Se a versão anterior reabrir o checkout para sessão prévia,ela não é rollback fechado seguro sem contenção adicional |
| Configuração/flags | Guardar snapshot protegido antes da janela;aplicar restauração aprovada por novo deployment. Não imprimir segredos,não copiar DEV,não confiar em efeito retroativo |
| Webhook | GateB não cria nem ativa. Se surgir webhook/consumidor inesperado,interromper;desativação é mudança de escopo que exige avaliação das obrigações |
| Workers/cron | Preservar jobs compartilhados/Asaas;AbacatePay apenas no-op se não há obrigações dele. Nunca desligar tudo para conter novas vendas |
| Estado financeiro | Preservar IDs,inbox,ledger,invoices,receipts e fim pago. Código anterior não desfaz dinheiro;nenhum refund,cancelamento ou replay automático |
| Migrations | Falha antes do commit: respeitar transação/sentinel e verificar rollback real. Após commit: correção à frente aprovada ou recuperação protegida;sem DOWN automático ou restore sobre ativo |
| Recuperação do serviço | Comparar com snapshot preservado,reconciliar eventos externos posteriores,avaliar dados criados no intervalo e pedir GO específico antes de restaurar/trocar destino. RTO completo ainda não medido |

## Gate C, riscos e integração

O [checklist vigente do webhook](../../runbooks/abacatepay-operacao.md#checklist-futuro-do-webhook-live--não-executar-nesta-rodada) prepara POST HTTPS `app.qoro.dev/api/webhooks/abacatepay`,segredo exclusivo,HMAC de corpo bruto,inbox/dedup,retries/leases,recuperação,cron/scanner/watch/closure e alertas. Registro no provedor,entrega autenticada e processamento financeiro são três provas diferentes. Nada disso é ativado pelo GateB; não adicionar webhook agora nem chamar um503 de teste de autenticidade aprovado.

- **R1:** reserva/idempotência controladas;fechamento automático live não observado. No GateD,uma clínica consentida,uma obrigação;parar por múltiplas assinaturas/invoices/direitos,link ambíguo,estado desconhecido ou closure persistente. Sem POST/refund cego.
- **R2:** observação natural13/12/2026 preservada;ACTIVE não cria novo período. Só receipt/ciclo com prova válida;ambiguidade em revisão. Nenhuma cobrança antecipada para fabricar homologação.
- **R3:** manter N01–N17 do dossiê,com provas locais/externas distintas;políticas já aprovadas,cancelamento e fim pago preservados. Sem nova carência,reembolso ou reativação inventada.
- **R4:** piloto proposto1→3→10,sem SLA. Observar inbox/idade/leases,erros401/403/429/5xx,latência,pagamento não conciliado,duplicidade e alertas. Limiares propostos:qualquer divergência financeira/tenant,idade>2min,lease>60s sem resolução,401/403,coordenação indisponível ou429 persistente exigem contenção/revisão,não aceitação automática.

R1–R4 continuamPARTIAL e sem aceite. GateB fechado não executa suas provas financeiras nem exige aceitar venda;se não for possível permanecer desarmado,reavaliar o gate,sem aceite implícito. GateC exige segurança/entrega/monitoramento próprios;GateD exige decisão expressa sobreR1–R4;GateE reavalia o piloto e cada aumento.

[Handoff UI](HANDOFF-UI-BILLING-SaaS.md) publicado,leitura não confirmada;nenhum agente UI/TISS acessível nesta árvore. Incidente7590707702 não reaberto. Repaginação integral e TISS117/117 não são dependências;mudança crítica compartilhada exige regressão billing.

**Asaas live com DEV relatado pela UI:** o client do RC aceita a credencial/baseURL fornecidas e não deriva o ambiente do banco. Não usar flags AbacatePay para resolver isso,nem copiar/alterar credenciais. UI/Payments devem manter DEV/Preview em Sandbox e implementar/revisar a barreira central contra base/chave live fora de Production,antes de testes com egress habilitado. Usar mocks ou bloqueio de saída aprovado até esse guard ser comprovado. Não é autorização para alterar contratos de pacientes ou worktree alheio.

## Solicitação preenchida para avaliação

- **Identificação:** `joaomarcos-techia/Project_OS`,PR53 draft,Production `app.qoro.dev`. SHA exato do novo candidato corrigido e CI final:checkpoint do PR53,obrigatórios no formulário antes da aprovação;10e5d43b é a baseline anterior preservada.
- **Janela proposta:**15/11/2026,10h–11h,America/Sao_Paulo,**a confirmar pelo titular**,sem agendamento automático. Orçamento operacional60min,estimativa de planejamento:15min pré-voo/backup/restore,10min SQL/pós-voo,20min deployment,15min smoke/encerramento. O build Preview histórico5min35s e os ensaios locais4,9s/26,5s não comprovam esses tempos em Production. Se prova/restore/locks consumirem o orçamento,parar antes do próximo estágio e reagendar;não prolongar sem responsável/GO.
- **Técnico,operacional,incidentes,rollback:** **A DEFINIR PELO TITULAR**. Pode haver acúmulo de funções se explicitamente aprovado;nenhuma pessoa foi presumida disponível.
- **Comprovado antes da solicitação:** causa/correção/testes locais do fechamento;baseline histórica;pacote/journal/hashes/ensaios preservados;procedimentos e matriz. Novo SHA/CI devem estar verdes no checkpoint final.
- **Na janela,antes de DDL:**projeto/history/schema atuais,ausência de obrigação AbacatePay que impeça desarme,links anteriores,contenção da transição,backup atual/restore/integridade,chave disponível,locks/timeouts,secrets/flags/cron/alertas e rollback compatível. Nenhum item pendente recebePASS por presunção.
- **Excluído:**sem cobrança de teste real,clínica piloto,nova contratação,abertura de allowlist,webhook/consumidores AbacatePay live,merge automático,alteração de preços/cotas/contratos,aceiteR1–R4 ou execução0160. Atividade legítima Asaas existente permanece;links hospedados anteriores são uma verificação explícita,não uma garantia de revogação local.
- **Pontos de não avanço:**qualquer pré-requisito não comprovado,drift,backup não restaurado,contenção insuficiente,contrato alterado,duplicidade,consumidor inesperado ou perda de saúde exige interromper antes da próxima mutação. Financeiro novo exigiria GateC/D separado.

**Recomendação:** **APTO PARA SOLICITAR AUTORIZAÇÃO CONDICIONADA DO GATE B**, somente depois de CI verde do novo SHA; **NÃO APTO PARA EXECUTAR agora**. Solicitação inclui explicitamente a barreira WAF acima,sem contratação adicional,mas não sua execução automática. A autorização depende de preencher SHA/checks finais,janela/responsáveis e aprovar os pontos de parada. Se a exigência for evidência atual de backup/schema antes da própria autorização de SQL/deploy,liberar primeiro somente coleta/restore/preflight read-only e devolver seu manifesto para essa decisão. Não iniciar qualquer dessas operações de Production por este documento.

## Limpeza local opcional, sem relação com Production

O ensaio criou somente dados sintéticos em `C:\Users\joaom\AppData\Local\Temp\qoro-scratch-schema-hQHtf0`. `pg_ctl status` retornou3 e não há processo PostgreSQL associado. A revisão automática recusou sua exclusão recursiva com `blocked by policy`;não houve tentativa de contorno. A pasta pode ser removida pelo titular no Explorador quando conveniente,conferindo o nome exato. Não remover outros scratches. A primeira tentativa do harness também deixou um diretório sintético sem identificação suficiente no relatório;nenhum diretório foi escolhido por suposição para excluí-lo. Isso não bloqueia GateB nem altera as evidências históricas.
