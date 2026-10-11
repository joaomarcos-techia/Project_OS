# Integração isolada de 09/10/2026

Estado: **validação local e leitura DEV aprovadas; cadastro no Preview 7/7 PASS;
conta de pagamentos no Preview 6/6 PASS após correção; produção sem validação funcional**.

## Composição

A branch `integration/qoro-20261009` reúne o trabalho da PR #26 (base financeira e
WhatsApp), PR #31 (validade da C14), PR #32 (janela da oferta da lista de espera),
PR #33 (aceite, geração e vaga futura da oferta) e PR #30 (saúde de envio da WABA).
O commit de integração é `95ace68a`. A resolução dos conflitos preservou as
ADRs 063–066 e ambos os grupos de buscas do runbook; o inventário de Server
Actions foi regenerado a partir do código combinado.

O código de Gemini da PR #28 e a atualização de dependência da PR #29 já estão
na base integrada. Isso foi verificado comparando os arquivos alterados por essas
PRs, não implica que as PRs devam ser fechadas sem revisão. A PR #19 (editor do
perfil público do WhatsApp) permanece separada, com conflitos substantivos e
round-trip real do provedor ainda não testado.

## Evidência medida

| Camada | Comando / prova | Resultado |
| --- | --- | --- |
| Testes direcionados da integração | `npx vitest run` nos seis arquivos de lista de espera e saúde WABA | 87/87 PASS |
| Regressão local | `npx vitest run` | 5.452/5.452, 518 arquivos, exit 0 |
| Tipos e lint | `npx tsc --noEmit`; `npx eslint .` | Ambos exit 0 |
| Build Next com ambiente sintético | `npx tsx scripts/security/local-build.ts` | Exit 0; `dist/security-local/build-result.json` |
| Migrations e inventário | `npx tsx scripts/check-migration-safety.ts`; `npx tsx scripts/security/inventory.ts --check` | Ambos exit 0 |
| Arquitetura e observabilidade | `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src`; `npx tsx scripts/check-observability-drift.ts` | Ambos exit 0; 21 crons, 12 buscas |
| Isolamento de tenant | `npx tsx --conditions=react-server scripts/security/tenant-isolation.ts` | Exit 0; fixtures removidas |
| Migrations no DEV | `npx tsx scripts/probe-dev-migrations.ts` com arquivo de ambiente DEV e referência de projeto exigidos | Exit 0; marcadores 0115, 0116, 0117 e 0118 presentes; transação `READ ONLY` |
| Relógio da oferta no DEV | `npx tsx --conditions=react-server scripts/probe-waitlist-offer-dev.ts` com as mesmas guardas | Exit 0; prazo, vaga passada e varredura PASS; transação `READ ONLY` |
| CI do código corrigido (`23e70f93`) | [Run 38010506366](https://github.com/joaomarcos-techia/Project_OS/actions/runs/38010506366) | Exit 0; 5.455/5.455 testes em 520 arquivos, cobertura, build, inventário, isolamento e limites HTTP PASS; E2E público 6 PASS, 2 SKIP |
| Regressão local repetida em 10/10 após o conserto da oferta | `npx vitest run`; `npx tsc --noEmit`; `npx eslint e2e/production-waitlist-a.spec.ts src/contexts/scheduling/internal/waitlist-store{,.test}.ts` | 5.455/5.455 em 520 arquivos, três comandos exit 0; lint completo havia passado antes do conserto |
| Build isolado repetido em 10/10 após os consertos da oferta e hidratação | `npx tsx scripts/security/local-build.ts` | Exit 0 nas duas execuções, compilação Next e geração de 18 páginas estáticas; ambiente sintético |
| Lista de espera no Preview DEV (`b8cc9819`) | `npx playwright test e2e/production-waitlist-a.spec.ts --project=chromium` com fingerprint assinado DEV e flag de fixture | **3/3 execuções PASS**, cada uma com 1 cenário funcional: entrada normal/urgente pela UI, correção da consulta, oferta prioritária única, cancelamentos pela UI e cleanup com sete contagens residuais em zero; a terceira incluiu readback SQL dos dois cancelamentos |
| Aceite da oferta no Preview DEV (`28e82093`) | Mesmo spec com `E2E_WAITLIST_ACCEPT=1`, Auth e banco DEV fixados e fixture Clínica A | Após a correção: **4 PASS consecutivos**, **1 FAIL anterior** (`offered` sem causa conclusiva) e **1 pré-condição bloqueada** (anos da fixture ocupados, sem mutação). Nos PASS houve toast de sucesso, entrada `booked`, consulta `agendado` única na vaga, sem efeito externo e cleanup com sete contagens residuais em zero. |
| Regressão do cancelamento no mesmo runner | Mesmo spec sem `E2E_WAITLIST_ACCEPT`, Preview e banco DEV | **1/1 PASS** após as mudanças do runner: oferta prioritária, encerramento pela UI e cleanup com sete contagens residuais em zero. Soma-se às três execuções anteriores; não é prova de envio Meta. |

Os dois probes foram repetidos em 09/10, sem gravar no banco. A primeira invocação
do probe da lista de espera omitiu `--conditions=react-server` e falhou no pacote
`server-only`; a invocação correta passou. Isso é erro de execução do runner,
não falha funcional demonstrada. O `next build` direto sem `.env.local` neste
worktree isolado falhou por configuração ausente; o launcher de build com
variáveis sintéticas passou. Esses resultados não provam o build da Vercel.

O usuário informou que o login em navegador normal abriu em até aproximadamente
2 segundos. É observação manual, não medição automatizada do Preview integrado.
O carregamento de 30 segundos em browser automatizado não deve ser apresentado
como falha reproduzida para o usuário sem nova prova.

Em 10/10, um navegador Chromium novo, com a conta de teste configurada no DEV e
prova assinada do runtime Preview, mediu: `/dashboard` redirecionando ao login
em **4,5 s**, login até o dashboard em **7,8 s** e navegação autenticada a
`/conversas` em **3,0 s**. Não houve `pageerror` nem resposta HTTP 5xx. A espera
de 30 s **não se reproduziu nessa execução**; uma amostra não estabelece p95 nem
descarta lentidão intermitente. Nenhum screenshot, trace ou cookie foi salvo.

Uma sondagem durante o build da Vercel recebeu HTML de espera no endpoint da
prova assinada. O helper E2E foi corrigido para recusar esse conteúdo sem
despejar o corpo no erro; os dois testes dirigidos passaram. A sondagem não
comprovou o runtime naquele instante, pois o deploy ainda estava em `BUILDING`.
Após o build, a mesma prova assinada passou e confirmou Auth e banco DEV no
Preview da PR #34.

## Preview funcional

Em 09/10, `scripts/run-signup-confirmation-e2e.ts` executou sete cenários
funcionais no Preview do commit `8fd34d51`, com Resend DEV e Asaas Sandbox: **7/7 PASS,
exit 0, 5,7 min**. Foram exercitados recebimento do e-mail, link no segundo
aparelho, código na aba original, checkout recorrente, retomada do draft vencido,
conta legada, novo draft e reenvio que invalida o link anterior. O arquivo local
da fixture e o lock foram confirmados ausentes ao final. O pagamento efetivo do
checkout não faz parte desses sete cenários.

`payments-account-lifecycle.spec.ts` encontrou **FAIL** no ciclo de conexão e
desconexão da conta Asaas: após conectar, o botão da tela permaneceu inerte.
O readback após a execução mostrou **0 clínicas E2E residuais no DEV e 0
webhooks deste Preview no Sandbox**. A investigação isolou o erro React #418 de
hidratação: `formatDatePt` formatava o mesmo `connectedAt` como 10/10 no servidor
UTC e 09/10 no browser de São Paulo. A digitação no campo não alterava o botão
controlado por React; o clique não produziu a mutação de desconexão no banco.
Um teste novo reproduziu antes da correção (`10/10` recebido contra `09/10`
esperado). O formatter agora fixa `America/Sao_Paulo`; os testes dirigidos
passaram. No Preview atualizado (`23e70f93`), a suíte completa de conta de
pagamentos passou **6/6, exit 0, 3,5 min**: chave inválida, conexão e
desconexão, preços e repasses Pro/Clínica, bloqueio Solo por UI e Action, Caixa
Solo e Pro, e pausa/retomada com cobrança histórica. A hidratação foi conferida
por uma interação controlada antes do clique mutante. O readback final retornou
**0 clínicas E2E no DEV e 0 webhooks desse Preview no Sandbox**.

O primeiro CI da PR #34 aprovou testes e cobertura, mas falhou no inventário de
segurança: o script novo `probe-dev-migrations.ts` acrescentou três acessos a
`process.env` após a geração do inventário. `docs/security/acoes.md` foi
regenerado (294 acessos) e `inventory.ts --check` voltou a passar localmente.
O [CI do commit corrigido](https://github.com/joaomarcos-techia/Project_OS/actions/runs/38010506366)
terminou em **success** em 10/10 UTC. Foram 5.455/5.455 testes em 520 arquivos;
o build Next e o gate de segredos no bundle passaram. O gate E2E público executou
6 testes com PASS e pulou 2; os skips não são prova funcional dessas rotas.

Releitura da WABA e da mensagem enviada após o cadastro de pagamento em 10/10:
[evidência e limites medidos](waba-readback-2026-10-10.md). A Meta já não reporta
o bloqueio de pagamento; o callback da WABA aponta para outro Preview, e o
ingresso no Preview integrado continua sem prova.

Em 10/10, o usuário informou que concluiu manualmente o cadastro sem erro. O
relato fecha o roteiro humano; a leitura independente abaixo verifica os estados
persistidos sem assumir que houve pagamento ou primeira sessão autenticada.

**Readback independente do cadastro informado (10/10, DEV + Asaas Sandbox, somente
GET/SQL `READ ONLY`):** a busca pela caixa indicada pelo usuário encontrou uma
conta Auth confirmada, exatamente um profile, uma clínica em `trial`, uma
assinatura local em `trial` no plano Solo e nenhum draft remanescente. A
assinatura vinculada foi encontrada no Asaas com `ASAAS_API_KEY_DEV`: `ACTIVE`,
R$ 149,00, ciclo `MONTHLY`. `ASAAS_CHAVE_TESTE_2` devolveu 404 para o mesmo ID.
`GET /myAccount` nas duas chaves retornou HTTP 200, mas hashes distintos para o
e-mail da conta e listagens diferentes de webhooks; o 404 de uma chave isolada
não indica assinatura ausente na outra conta Sandbox.
O trial local termina em **17/10/2026**. O Asaas lista duas cobranças **PENDING**
de R$ 149,00, vencendo em 17/10 e 17/11; nenhuma está paga. A assinatura informa
`nextDueDate=17/12`, que designa a próxima cobrança **a gerar**, depois das duas
já geradas, conforme a [referência de atualização de assinaturas do Asaas](https://docs.asaas.com/reference/atualizar-assinatura-existente).
Assim, provisionamento e correlação com o provedor são **PASS**; pagamento efetivo
da mensalidade de 17/10 e primeira sessão de browser dessa conta permanecem
**NOT TESTED** por este readback. O e-mail e os IDs completos não foram registrados.

**Webhooks órfãos do Sandbox (10/10):** `GET /v3/webhooks` em cada uma das duas
contas de teste encontrou, na conta de `ASAAS_CHAVE_TESTE_2`, exatamente dois
webhooks de cobrança de paciente desativados e interrompidos apontando para um
Preview antigo. Ambos tinham **zero** vínculos em `clinic_payment_accounts` do
DEV. Com esse escopo fixado, cada um foi removido por `DELETE /v3/webhooks/{id}`:
HTTP 200, seguido por `GET` HTTP 404; nova listagem retornou **zero**. O webhook
**ativo** da conta `ASAAS_API_KEY_DEV` continuou presente, com um vínculo no
banco, apontando para o Preview usado pelo outro agente. Ele não foi alterado.
A [referência de remoção do Asaas](https://docs.asaas.com/reference/remover-webhook)
explica que a exclusão interrompe entregas futuras daquele webhook; ela não
recupera os eventos históricos que falharam nem prova uma futura entrega 2xx.

**Banco de produção (10/10, `READ ONLY`):** a conexão foi exigida no projeto
Supabase PROD conhecido antes da consulta a `_schema_version`. Entre 0107 e
0118, **só 0107** está aplicada. Portanto as onze migrations 0108–0118 da branch
integrada ainda não estão em produção. Nenhuma migration foi executada nesta
rodada. A publicação da PR #34 precisa de um rollout ordenado de banco e código;
o banco DEV e o CI verde não substituem essa etapa.

O E2E sintético da lista de espera foi exercitado no Preview integrado, com
fingerprint assinado de Auth e banco DEV, duas entradas reais pela UI e consulta
SQL da Clínica A. **A execução inicial falhou**: a Action de correção devolveu
`ok:false`, não alterou a consulta e não ofertou a vaga. A investigação isolou
`src/contexts/scheduling/internal/waitlist-store.ts`: a condição da oferta
vinculava um objeto JavaScript `Date` diretamente no template SQL; o driver
`postgres@3.4.5` recusou o parâmetro (`Received an instance of Date`), e a
transação inteira foi revertida. Uma transação de diagnóstico foi revertida
deliberadamente. A correção serializa o instante em ISO antes do bind, ainda
comparando a validade com `clock_timestamp()` do banco. O teste de regressão
verifica o parâmetro gerado; 21/21 testes dirigidos, TypeScript e lint passaram.
A primeira repetição no Preview comprovou oferta e evento, mas falhou no clique
de cancelamento da oferta. Uma repetição passou e a seguinte não recebeu a
resposta da Action em 30 segundos. As duas falhas nessa etapa foram limpas; a
diferença nas contagens de auditoria sustentou que a mutação nem sempre partia
do browser. A hipótese de clique antes da hidratação motivou uma guarda: os
botões mutantes e o filtro ficam desabilitados até o React montar. No commit
`b8cc9819`, **três execuções completas consecutivas passaram** no Preview:
correção `cancelado`, entrada urgente `offered`, normal `waiting`, exatamente
um evento de oferta, controle de aceite visível, dois cancelamentos refletidos
na UI, e nenhum envio externo. A terceira execução também confirmou no banco
que as duas entradas terminaram `cancelled`. Isso valida o caminho funcional
medido; não demonstra a entrega do template Meta ao paciente.
A tabela `appointment_corrections` e o marcador da migration 0059 estão no DEV;
ausência dessa migration foi excluída. Uma rodada teve deadlock no cleanup e
exigiu limpeza posterior guardada. O runner ganhou retry e valida a remoção de
pacientes, entradas, consultas, jobs, outbox, auditoria e idempotência; o
readback final das três execuções PASS confirmou zero em todas as sete contagens.
O CI do commit `b8cc9819` falhou apenas no inventário de segurança: o novo
estado de hidratação deslocou a linha de um `onSearch` documentado. A linha foi
regenerada e `inventory.ts --check` voltou a passar localmente. O [CI do commit
`28e82093`](https://github.com/joaomarcos-techia/Project_OS/actions/runs/38029789126)
passou, incluindo 5.455/5.455 testes e build Next; o deploy Preview também passou.

O aceite da oferta expôs outros dois binds de `Date` em
`src/contexts/scheduling/actions.ts`; ambos foram serializados em ISO antes da
comparação com `clock_timestamp()` no PostgreSQL. A execução inicial do aceite
reproduziu `offered` em vez de `booked`, mesmo com HTTP 200. Após o deploy da
correção, uma tentativa ainda ficou em `offered`, sem mensagem conclusiva
preservada; **não há causa raiz demonstrada para essa tentativa**. Duas execuções
seguintes passaram integralmente. Mais duas repetições, a última após limitar a
espera pelo toast de erro aos casos em que ele existe, passaram com zero resíduos.
O runner passou a exigir o toast específico de
sucesso antes do readback SQL e a procurar ano futuro livre numa faixa mais ampla,
pois os três anos originais já continham consultas da fixture. O cleanup também
faz segunda passagem estritamente vinculada aos IDs sintéticos: uma falha anterior
deixou um par audit/idempotency, removido por script temporário com guardas de DEV; nas quatro
execuções PASS, a segunda passagem removeu zero linhas e o readback final foi zero.
Uma leitura DEV confirmou que a Clínica A usa `absorb_fees`, portanto o bloqueio
intencional do aceite sob preço explícito não explica a falha observada.

## O que ainda precisa de prova

- **Preview integrado:** a lista de espera passou até oferta, controles,
  cancelamento e aceite efetivo com agendamento em `absorb_fees`. Faltam entrega
  do template ao paciente e E2E externo da C14. A saúde WABA teve leitura real na Meta e na UI
  em 10/10, mas isso não comprova a entrega de uma mensagem nova.
- **Migrations de produção:** readback de 10/10 confirmou 0108–0118 pendentes;
  nenhuma foi aplicada. Planejar backup, advisory lock, aplicação em ordem,
  readback e deploy compatível antes da ativação da branch integrada.
- **Editor de perfil público do WhatsApp (#19):** resolver conflitos depois de
  comparar contratos, testar upload e leitura reais no provedor e rodar regressão.
- **Pagamento do sinal no Sandbox e campanha Google Ads:** gates externos ainda
  abertos. O cadastro relatado em 10/10 teve Auth, tenant, trial e assinatura
  correlacionados por readback; não houve pagamento da primeira mensalidade.
- **Login automatizado:** uma medição nova não reproduziu 30 s nem erro 5xx;
  continuar observando latência intermitente, com amostras repetidas se o sintoma
  voltar. A medição única não equivale a SLA.

Esta é uma fotografia de evidência para revisão; **não é aprovação de go-live**.

## 10/10 — callback Meta no Preview integrado e mensalidade SaaS pós-trial

O usuário autorizou trocar **somente o override da WABA de teste** e simular uma
mensalidade no Asaas Sandbox. Nenhuma configuração da Meta para outras WABAs nem
nenhum recurso de produção foi alterado.

| Verificação | Evidência observada | Estado |
| --- | --- | --- |
| WABA de teste → Preview da PR #34 | O banco DEV apontou uma única conexão ativa em coexistência para o telefone de teste (final 2198). O `GET /{waba}/subscribed_apps` da Meta confirmou um app e override no Preview anterior. O novo endpoint respondeu HTTP 200 ao desafio `hub.challenge`. O `POST /{waba}/subscribed_apps` respondeu 200; novo `GET` confirmou `project-os-git-integration-qoro-344a22-clinic-os-v2-s-projects.vercel.app/api/webhooks/meta` com bypass presente. Um segundo readback independente confirmou o mesmo destino | **PASS de configuração e handshake**; mensagem Meta real após a troca **NOT TESTED** até novo ingresso |
| SaaS pós-trial no Preview | `SAAS_POST_TRIAL_E2E=ALLOW_DEV_SANDBOX`, `APP_BASE_URL` no Preview integrado e `QORO_ENV_FILE` apontando para env local; **três execuções exit 0**, duas delas pelo runner versionado `npx tsx --conditions=react-server scripts/asaas-post-trial-preview-e2e.ts`. Fixture única por execução, clínica sem profile/paciente, trial vencido, assinatura Solo mensal R$ 149, cobrança PIX `PENDING`. Endpoint de confirmação oficial do Sandbox respondeu 200 e `GET /payments/{id}` trouxe `RECEIVED`. O Asaas entregou um evento real ao Preview; `processed_webhooks` da fixture registrou `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`, uma invoice ficou `paid`, clínica e assinatura `active`, período avançou, replay manteve uma invoice e o mesmo período | **PASS real Asaas Sandbox → Preview → DEV**, incluindo idempotência; não equivale a pagamento com cartão nem à mensalidade da conta humana |
| Cleanup da fixture mensal | Nas três execuções, webhook temporário `DELETE 200 → GET 404`; assinatura e customer `DELETE 200 → deleted:true` no readback; clínica sintética `DELETE` e leitura 0. A terceira execução já usou o runner com falha explícita se qualquer readback de cleanup divergir. O webhook de paciente ativo e o webhook global antigo, desativado, foram preservados | **PASS para esses recursos**; o histórico da cobrança paga pode permanecer no Sandbox como histórico do provedor |
| PR #19, perfil WhatsApp | PR aberto no commit `95ae83b`, `mergeable=CONFLICTING` com a integração. A WABA atualmente conectada é de coexistência; o formulário se anuncia como gerenciado pelo WhatsApp Business, sem escrita pelo Qoro. O teste `round-trip real` da PR exige `E2E_WHATSAPP_PROFILE_WRITE=1` e um número dedicado com escrita. O teste não cobre upload da foto | **BLOCKED** para escrita/restore externo no número atual; não converter SKIP em PASS |

O runner usa somente `DATABASE_URL_DEV` com o ref DEV fixado e hosts HTTPS oficiais
do Asaas Sandbox; exige Preview Vercel e opt-in. Ele cria um webhook **temporário**
para não trocar nem reativar o webhook global antigo, nem tocar o webhook de
pacientes usado por outra sessão. Seu evento inicial `PAYMENT_CREATED` é um
bootstrap autenticado; o evento de **pagamento** veio do Asaas após a confirmação
oficial, conferido separadamente em `processed_webhooks`. A confirmação de
Sandbox não movimenta dinheiro real, conforme a [referência oficial do
Asaas](https://docs.asaas.com/reference/confirmar-pagamento).

O readback da WABA depois da troca continuou no Preview integrado. Uma consulta
`READ ONLY` ao DEV, para a janela após a troca, encontrou **0 mensagens de
entrada** até a medição. Assim, callback configurado não é prova de
Meta → ingress → IA → resposta nesse deploy. Para fechar: enviar uma mensagem
nova do número consentido ao Business de teste, conferir a persistência, o evento
de outbox e a resposta enviada/entregue; se a conversa estiver em handoff,
devolvê-la ao agente antes do envio. O Google Ads permanece para a etapa final,
com campanha atribuível ativa.

O primeiro Playwright `e2e/whatsapp-profile.spec.ts` no Preview obteve **4 PASS,
2 SKIP, 1 FAIL**. O FAIL aconteceu *antes* do caso de validação de campo:
o sexto login da mesma conta recebeu “Muitas tentativas. Aguarde alguns minutos”.
A suíte foi ajustada para autenticar **uma vez** por execução e reutilizar a sessão;
`npx playwright test e2e/whatsapp-profile.spec.ts` no mesmo Preview terminou com
**exit 0, 4 PASS e 3 SKIP em 40,1 s**. Os SKIPs são: ausência de número (não se
aplica), validação de entrada editável (coexistência é somente leitura) e escrita
real (opt-in desligado). Nenhum desses três é PASS funcional do editor editável.

Validação local após a última edição: `npx tsc --noEmit` exit 0;
`npx eslint e2e/whatsapp-profile.spec.ts scripts/asaas-post-trial-preview-e2e.ts`
exit 0; `npx prettier --check` nos quatro arquivos da rodada exit 0;
`npx vitest run` direcionado ao webhook e ao ciclo de assinatura, **52/52** em
4 arquivos, exit 0. O `next build` direto, sem `.env.local` neste worktree,
parou na validação de `DATABASE_URL` e `NEXT_PUBLIC_SUPABASE_URL`; o build
isolado oficial `npx tsx scripts/security/local-build.ts`, com valores sintéticos,
compilou e terminou com **exit 0**. Isso comprova o build sem usar credenciais.

A primeira CI do commit `cfe32f28` falhou no gate
`Security inventory (AST and explicit guard review)`: o runner novo acrescentou
12 referências a `process.env` e o inventário versionado estava desatualizado.
`npx tsx scripts/security/inventory.ts --write` atualizou somente
`docs/security/acoes.md`; a reexecução local com `--check` terminou com exit 0,
sem itens `unresolved` ou `publicEnv` indevidos. A CI desse ajuste precisa ser
avaliada separadamente; a falha inicial não é PASS.

## 11/10 — ingresso real após trocar o callback

Uma mensagem nova do número de teste consentido chegou à WABA de teste no
Preview integrado às **22:46:09 UTC**. A leitura `READ ONLY` do DEV confirmou:
conexão ativa na clínica de teste, uma linha em `inbound_messages_raw`, nenhum
órfão para o `phone_number_id`, evento `messaging.inbound.received` com
`status=processed`, uma tentativa e `error_code=NULL`, `processed_at` às
22:46:17 UTC e uma mensagem de entrada na conversa. O número recebido foi
comparado ao número consentido após decifrar **somente em memória**, sem registrar
telefone ou conteúdo na evidência. A rota rejeitou um `POST` externo sem
assinatura com HTTP **401** e corpo `invalid signature`, depois de comprovar que
o Preview usa Auth/banco DEV. Os testes direcionados de webhook, handoff, worker
e status de entrega passaram **42/42**, em 5 arquivos (`npx vitest run` direcionado).

Não houve resposta automática a essa mensagem: a conversa já estava em
`handoff` desde 08/10, sem responsável atribuído. O evento foi processado e
registrou entrada, mas gerou zero mensagens de saída e zero envios Meta, como a
regra de atendimento humano determina. A ação autenticada **Devolver ao agente**
foi executada no Preview; o readback no DEV às **22:53:05 UTC** encontrou
`status=active` e zero handoffs abertos. O teste de UI que esperava um toast
transitório expirou depois de a ação ter sido concluída; **a asserção do toast
falhou, mas a mudança de estado foi confirmada separadamente**. A primeira
mensagem não foi reprocessada retroativamente; a segunda, abaixo, mediu IA,
outbox, aceite e entrega Meta.

Observação de ambiente para futuros runners locais: o HMAC do telefone
recalculado com `CRYPTO_LOOKUP_SALT` do `.env.local` não coincidiu com o hash
armazenado pela instância Preview, embora a decifragem do telefone e sua
comparação com o número consentido tenham passado. O arquivo local não foi
alterado; a causa da diferença de salt **não foi demonstrada**. Não usar esse
hash calculado localmente como critério de correlação de mensagens do Preview
até reconciliar a configuração.

### Segunda mensagem, conversa ativa — fluxo completo

Após a devolução, uma segunda mensagem do mesmo número consentido entrou às
**23:06:12 UTC**. O readback `READ ONLY` no DEV encontrou `processed_at` às
23:06:30, evento `processed` em **uma** tentativa, uma mensagem `in` e uma
mensagem `out` da IA, zero `ai_agent_failures`, **um** `outbound_messages` e
`outbound_targets_sender=true`. A Meta aceitou o envio e entregou callbacks
`sent` e `delivered`; o estado persistido ficou `delivered` às **23:06:32 UTC**.
O usuário confirmou que a resposta apareceu no aparelho de teste. Assim,
**PASS real** para Meta → webhook Preview → clínica DEV → evento → IA →
resposta → outbox → Meta → WhatsApp do remetente. Nenhuma mensagem, telefone,
token ou conteúdo clínico foi copiado para o relatório.
