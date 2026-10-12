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

## 11/10 — editor de perfil integrado à coexistência

O commit `95ae83b` da PR #19 foi integrado à base da PR #34 em
`integration/qoro-whatsapp-profile-20261011`, sem mudar o callback da WABA de teste. Os conflitos
foram resolvidos preservando o perfil em modo somente leitura para coexistência. O upload da foto
passa pela mesma guarda de escrita no servidor, e uma falha de rede durante o envio binário não
carrega a URL assinada do upload na cadeia de causas. O E2E impede opt-in de escrita fora de um
Preview isolado da Vercel e exige prova assinada de Auth e banco DEV antes da escrita.

| Evidência | Resultado | Limite |
| --- | --- | --- |
| `npx vitest run` | **PASS**, 5.467 testes em 520 arquivos, exit 0 | Testes locais; não provam escrita aceita pela Meta |
| Cinco arquivos focados de perfil | **PASS**, 109 testes | Inclui guarda de coexistência; não inclui upload real |
| `npx tsc --noEmit`, ESLint direcionado, Prettier e inventário de segurança | **PASS**, exit 0; inventário com 199 actions e zero pendências | Verificação estática |
| Build Next com ambiente sintético | **PASS**, exit 0 | Não equivale ao deploy nem à execução no Preview |
| Leitura em coexistência no novo Preview | **PASS**, 4 testes executados e 3 SKIP condicionais com a conta de teste da Clínica A | Não prova escrita, que a Meta não suporta em coexistência |
| Escrita, releitura e restauração em número dedicado | **PASS final** em recado inicial não vazio: Playwright escreveu, navegou, releu da Meta, restaurou e releu o original. A suíte completa terminou 6 PASS / 2 SKIP, exit 0 | A primeira tentativa havia recebido resultado indeterminado; limpar o recado para vazio retornou HTTP 500/código 131000 nesta conta. O PASS final não prova limpeza para vazio |
| Foto real na Meta | **NOT TESTED** | Requer imagem sintética e restauração verificável da foto anterior |

### 11/10 — número dedicado, verificação da empresa e resultado indeterminado do perfil

Uma consulta `READ ONLY` ao DEV encontrou a conexão ativa da clínica sintética
“teste” em modo dedicado (`coexistence=false`). A conta E2E correspondente abriu
o editor no Preview integrado. Seu diagnóstico de envio era `limited`, com o
código **141010**, a pendência de verificação empresarial. O aviso agora oferece
o botão **Verificar empresa na Meta**, que abre o Centro de Segurança da própria
Meta em outra aba. O botão só aparece com esse código; uma pendência apenas de
pagamento não o exibe. Não se alterou o painel da Meta, o método de pagamento ou
a verificação empresarial.

O Playwright de leitura nessa conta executou **4 PASS e 3 SKIP**, sem escrever no
perfil. O primeiro opt-in de escrita confirmou Auth e banco DEV por fingerprint
assinado antes do POST. O teste falhou ao esperar confirmação visual; a releitura
posterior encontrou o recado de teste efetivamente publicado. A tentativa de
restaurar o campo vazio pela UI não o removeu. Uma chamada direta, usando o
mesmo token da conexão sem expô-lo, mediu **HTTP 500/código Graph 131000** ao
enviar `about: ''`, seguida de readback sem mudança. Uma única escrita de
recuperação para “Conta de teste da Qoro” recebeu **2xx** e o readback confirmou
que não restou marcador de E2E. O valor vazio anterior não foi restaurado; a
conta de teste permanece com o recado neutro. Não há evidência de impacto em
produção ou em conta de cliente.

O comportamento revela dois limites distintos: um 5xx pode acompanhar uma
mudança que a Meta aplicou, e a limpeza para vazio não funcionou nesta conta.
O produto agora apresenta **Resultado não confirmado** para o primeiro caso,
orienta a reler o perfil antes de qualquer repetição e não afirma que nada foi
salvo. O E2E também deixa de escrever sobre um recado original vazio até a
restauração ser comprovada; falhas de confirmação continuam FAIL.

No commit seguinte, o Preview passou no gate da Vercel e o Playwright autenticado
confirmou o botão de verificação na conta com código 141010. A primeira execução
com escrita teve **5 PASS, 2 SKIP e 1 FAIL do teste**: o `finally` esperava que
“Salvar perfil” voltasse a ficar habilitado, mas após restauração bem-sucedida
ele fica desabilitado porque não há diferença pendente. Uma releitura direta do
Graph confirmou o recado neutro, sem marcador. Corrigida essa asserção, o caso
focado passou **1/1**; a execução final da suíte inteira passou **6 PASS,
2 SKIP, 0 FAIL**, exit 0 em aproximadamente 1 minuto. Os SKIPs são os estados
sem número e coexistência, que não se aplicam à conta dedicada. O caso de
escrita passou por fingerprint assinado do Auth/banco DEV antes de qualquer
POST e por releitura da Meta após a restauração. A foto real continua NOT TESTED.

Regressão local da versão publicada: **5.470/5.470 testes em 520 arquivos**,
`npx tsc --noEmit`, ESLint, Prettier, inventário de segurança e build Next
isolado com ambiente sintético em exit 0. O deploy Vercel do commit anterior
falhou sem causa conclusiva no log disponível; o commit atual terminou em
`success`, e os quatro checks da PR #35 passaram. Nenhuma migração, painel de
produção ou dado de cliente foi alterado.

## 12/10 UTC — PRs integradas e banco de produção

| Etapa | Evidência | Estado |
| --- | --- | --- |
| PR #35 → #34 | Merge `a9f3d202`; suíte de perfil em Preview 6 PASS, 2 SKIP; checks da PR #35 verdes | **PASS** para a integração do código na branch |
| PR #34 → `main` | Merge `ea1189cf` após CI da PR #34 em success (typecheck, lint, testes/cobertura, isolamento, build, E2E público), Vercel Preview, Snyk e Semgrep verdes | **PASS** para merge, não para runtime de produção |
| Pré-flight PROD | Projeto Supabase PROD conferido sem expor a URL; `READ ONLY`: journal 108, apenas 0107 entre 0107–0118; 64 atendimentos, zero cobranças/contas de pagamento de paciente e zero lançamentos `auto` legados sem atendimento | **PASS** de identidade e estado inicial |
| Backup | `npx tsx scripts/db-backup-prod.ts` exit 0, 2.308.596 bytes, hash SHA-256 prefixo `23D5C96F6782D033`; `db-migrate-prod.ts` gerou outro dump de 2.308.598 bytes, prefixo `6E64C95549DBBB28`. Ambos têm marcador de conclusão e ficam em `backups/` ignorado pelo Git | **PASS** da criação e inspeção estrutural; restore em scratch **NOT TESTED** |
| Migration | `npx tsx scripts/db-migrate-prod.ts` exit 0; backup, lock 4242 adquirido/liberado, `drizzle-kit migrate` concluído; sem `MIGRATION_FAILED.md` | **PASS** do migrador |
| Readback PROD | `READ ONLY`: journal 119, último `when=1791868800000` (0118), tabelas/colunas econômicas e WhatsApp presentes, RLS ENABLE+FORCE em `professional_payout_reviews`, índice 0118, zero contas inativas habilitadas para cobrar e zero advisory locks 4242 | **PASS** das verificações indicadas |
| Deploy Vercel PROD | Deployment GitHub `7005284162` do SHA `ea1189cf` em `success`; URL de deployment `https://project-f9fasxokr-clinic-os-v2-s-projects.vercel.app` | **PASS** do deploy reportado pela Vercel; não é prova de integração externa |
| HTTP público PROD | `curl` com exit 0: `/login` 200, `/cadastro` 200, `/api/health` 401 sem autenticação e `/api/health/outbox` 401 sem autenticação | **PASS** dessas quatro respostas; health interno autenticado **NOT TESTED** |
| Shell autenticado PROD | `playwright test e2e/authenticated-readonly-routes.spec.ts --grep 'todas as rotas' --project=chromium`, `E2E_BASE_URL=https://app.qoro.dev`, conta E2E de produção, artefatos desligados: exit 0, 1 teste PASS, 26 rotas com HTTP 200 e heading esperado, 34 s | **PASS** da navegação de leitura; não prova mutações, webhook ou provider |
| CI da `main` | Run `38196255815`, SHA `ea1189cf`: exit 0 em 9m36s; auditoria de dependências, typecheck, lint, testes/cobertura, isolamento de tenants, build e E2E público concluídos | **PASS** de CI; não substitui prova externa |

A `_schema_version` tem dez marcadores de 0108–0118 porque o arquivo da 0109
não faz INSERT nela. A aplicação da 0109 foi comprovada por journal e por
readback da coluna `provider_reconcile_checked_at`, dos dois índices e da função
`validate_appointment_commercial_price_snapshot` com `exact_reschedule`.
Nenhum marcador foi fabricado manualmente.

**Ainda não converter em PASS:** health interno autenticado, entrega do
template de sinal via Meta e a jornada completa até o Caixa; upload
externo de foto do perfil; crédito de conversão no Google Ads. A campanha segue
inativa conforme o último relato do usuário. A API do Google Ads listou duas
contas acessíveis, mas recusou consultas a ambas com a condição de que o projeto
Cloud está aprovado apenas para contas de teste; não foi possível ler o estado
atual da ação de conversão por API. A landing passou novamente `npm run comecar`
27/27 e `npm run conversao` 2/2 em 11/10.

### 12/10 — preparação do pagamento de sinal recebido por WhatsApp

O modo `PAYMENTS_META_E2E=ALLOW_SANDBOX_HUMAN_PAYMENT` do runner
`scripts/payments-meta-e2e.ts` prepara **uma** fixture sintética na Clínica A do
DEV, cria somente o sinal de um atendimento de R$ 20, envia o template de link
ao número consentido e preserva o Checkout Sandbox para pagamento humano. O
modo anterior (`ALLOW_REAL_META`) conserva seus dois templates e cleanup. No
modo novo, `.tmp/payments-meta-deposit-handoff.json` guarda apenas IDs técnicos,
valor e estado; não contém URL de pagamento, telefone nem credenciais. Uma falha
após a tentativa de envio não cancela cegamente o Checkout: marca o handoff para
inspeção, porque a Meta pode ter aceito a mensagem antes de a resposta falhar.

Antes de qualquer escrita, o runner exige banco DEV, Asaas Sandbox explícito,
fingerprint assinado de Auth e DB DEV no Preview, clínica/conta/número ativos,
destinatário sem paciente preexistente, fila de sinal livre e janela C14
**08:00–19:59 no fuso da clínica**. Com opt-in separado
`PAYMENTS_META_E2E_MOVE_WEBHOOK=ALLOW_SANDBOX_PREVIEW_WEBHOOK_MOVE`, confere a
rota no Preview, move somente o webhook correspondente no Asaas Sandbox e faz
GET de readback do callback ativo. Não altera webhook de produção.

**Medições desta preparação, antes do pagamento:** a prova assinada do Preview
confirmou DEV; GET da rota de webhook com bypass retornou **405**, que é o
comportamento esperado de uma rota POST; o preflight do runner recusou o callback
antigo e, após preparar a troca guardada, recusou a execução fora da janela C14.
Ambas as tentativas terminaram antes de criar fixture, Checkout ou mensagem;
o arquivo de handoff não existe. **Estado da jornada: BLOCKED pela janela C14 até 08:00
da clínica.** Meta entregue, pagamento, webhook, crédito e Caixa continuam
**NOT RUN** nesta rodada; HTTP 405 não prova entrega de webhook POST.

| Verificação em 12/10, 00:30–00:36 BRT | Resultado |
| --- | --- |
| `node .tmp/probe-payments-preview.mjs` (probe local ignorado pelo Git) | HTTP 405, exit 0; só GET de leitura |
| `node .tmp/run-payments-meta-handoff.mjs` (preflight local ignorado) | Exit 1 deliberado: janela C14 fechada; zero handoff criado |
| `npx vitest run --silent` | 5.470/5.470 em 520 arquivos, exit 0 |
| `npx vitest run` em charge-store, C14 e cliente Asaas | 168/168, exit 0 |
| `npx tsc --noEmit`, ESLint e Prettier do runner | Exit 0 |
| `npx tsx scripts/security/local-build.ts` | Build Next isolado exit 0 |

A [API oficial do Asaas](https://docs.asaas.com/reference/atualizar-webhook-existente)
permite `PUT /webhooks/{id}` somente com os campos alterados; os demais
permanecem. O runner altera apenas a URL no Sandbox e exige GET de confirmação
antes de criar a cobrança.

Para retomar no horário permitido, carregar as credenciais DEV localmente sem
imprimir seus valores, fixar `ASAAS_BASE_URL` e `ASAAS_BASE_URL_DEV` em
`https://api-sandbox.asaas.com/v3` (o alias `_DEV` prevalece no script),
`APP_BASE_URL` no Preview com fingerprint DEV, clínica e destinatário consentido,
os dois opt-ins acima, e executar `npx tsx --conditions=react-server
scripts/payments-meta-e2e.ts`. Conferir o recebimento no aparelho antes de pagar.
Após o pagamento, reler a cobrança no Sandbox e no DEV, o evento real do webhook,
despachar **somente** os eventos da fixture e verificar agendamento, crédito e
Caixa. O Preview não executa cron automaticamente; drenar o outbox global do DEV
processaria eventos de outras clínicas e não serve como prova segura.

**Guarda da janela de envio (12/10):** além do filtro SQL do `claimDue`, o
processor C14 confere novamente o horário local da clínica imediatamente antes
de chamar o sender da Meta. Se a janela [08:00, 20:00) fechou enquanto contato,
estado e link eram resolvidos, o job volta para a próxima abertura às 08:00 sem
consumir tentativa de envio nem trocar a chave de idempotência. O link só será
enviado se a cobrança ainda estiver pagável e dentro do prazo no novo
processamento. Testes de borda cobrem 07:59, 08:00, 19:59, 20:00, a travessia de
19:59 para 20:00 durante o job e os links de sinal/restante. O pagamento humano
no Sandbox, entrega Meta e webhook continuam **NOT RUN** até a janela abrir.

### 12/10, 08:02–08:22 BRT — sinal por WhatsApp pago com cartão no Sandbox

Esta execução substitui o bloqueio por horário descrito acima. Branch
`e2e/meta-sinal-pagamento-20261012`, Preview isolado, banco/Auth DEV e conta Asaas
Sandbox conferidos no preflight. Nenhuma operação foi feita em produção. O runner
criou consulta sintética de R$ 20 com sinal de R$ 10 e enviou um único template
à caixa WhatsApp de teste consentida. A Meta aceitou; o readback de
`outbound_messages` passou a `read`, e o destinatário confirmou o recebimento.

O primeiro Checkout foi aberto em PIX. O Asaas gerou cobrança `PENDING`, mas o
pagamento PIX não pôde ser concluído pelo usuário no Sandbox. Antes da troca,
o readback confirmou cobrança pendente, nenhum crédito e nenhum evento de
pagamento. A cobrança PIX foi removida no Asaas com `deleted=true`, o Checkout
foi cancelado e somente sua fixture sintética foi removida do DEV. A evidência
de leitura da mensagem antiga foi preservada. Não ocorreu estorno: não houve
pagamento PIX.

O runner ganhou a opção explícita `PAYMENTS_META_E2E_METHOD=CREDIT_CARD` no modo
de pagamento humano. Ela chama o Checkout hospedado com apenas `CREDIT_CARD` e
registra `requested_payment_method=credit_card`; o modo anterior sem esta opção
continua oferecendo os meios padrão. A primeira tentativa de fixture de cartão
falhou antes de criar Checkout porque tentou gravar método comercial num
agendamento da política `absorb_fees`; o teste limpou a fixture. Corrigido o
próprio runner: a escolha de cartão é passada à criação da cobrança, sem
falsificar a política de preço do agendamento. `npx tsc --noEmit` voltou a exit 0.

Na segunda execução, a Meta aceitou o novo template às 08:16 BRT; o destinatário
confirmou o recebimento. O Checkout Sandbox criou cobrança de R$ 10 em cartão.
Após o pagamento humano, o readback pelo cliente Asaas encontrou `CONFIRMED`,
`billingType=CREDIT_CARD`, valor R$ 10, vínculo exato ao Checkout e
`deleted=false`. O webhook real registrou `PAYMENT_CONFIRMED` e `CHECKOUT_PAID`
em `patient_webhook_events`; no DEV, `patient_charges` passou de `pending` a
`paid`, com `provider_payment_id` e fatos econômicos conciliados. O HTTP 200
individual das entregas não foi lido nos Logs de Webhooks do painel; a
persistência e a transição no banco comprovam o processamento, mas não
substituem essa medição de transporte.

Como o Preview não executa cron, foram processados **somente** os dois eventos
da cobrança sintética, pelas chaves `charge-paid:<chargeId>` e
`credit-granted:<chargeId>`, após confirmar novamente o pagamento no Sandbox.
Readback final: agendamento `confirmado`, `deposit_status=paid`, um crédito de
R$ 10 `available`, zero evento pendente da cobrança. O evento informativo
`scheduling.appointment.confirmed` da mesma fixture foi passado ao worker
restrito à sua chave e terminou `skipped_no_handler`, conforme o contrato atual.
Nenhuma fila global de outras clínicas foi drenada.

**Limite da prova:** não há `lancamento` da consulta no Caixa ainda. A consulta
sintética está marcada para o futuro; pela ADR-051, o sinal pago é crédito
antecipado e o recebível só nasce após o atendimento. Portanto,
**Meta → Checkout cartão → Asaas → webhook → cobrança → agenda → crédito: PASS
real**. **Alocação do crédito no recebível e visualização final no Caixa:
NOT TESTED nesta fixture**. A opção “Acompanhar pedido” leva à URL do Preview
usada na criação deste Checkout; o callback de produção depende do valor de
`APP_BASE_URL` no deployment de produção, não verificado nesta rodada. O
callback é navegação, não prova de pagamento.

Comandos executados: `node .tmp/run-payments-meta-handoff.mjs` (PIX exit 0;
primeira tentativa de cartão exit 1 pela fixture de preço; repetição corrigida
exit 0), `node .tmp/run-cancel-pix-handoff.mjs` (exit 0),
`node .tmp/run-cleanup-pix-handoff.mjs` (exit 0),
`node .tmp/run-dispatch-payments-meta.mjs` (exit 0),
`node .tmp/run-finish-fixture-outbox.mjs` (exit 0) e
`node .tmp/run-readback-payments-meta.mjs` (readbacks antes/depois, exit 0).
Os launchers locais em `.tmp` são ignorados pelo Git e não imprimem credenciais,
telefone nem URL de pagamento.

Regressão após o ajuste do runner: testes direcionados de Checkout, sinal,
agenda e crédito **57/57**; `npx vitest run --silent` **5.478/5.478 em 520
arquivos**, exit 0; `npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos
alterados e `npx tsx scripts/security/local-build.ts` com exit 0. O build
Next 15.5.24 compilou e gerou 18 páginas estáticas. Estas verificações não
medem a variável `APP_BASE_URL` de produção nem o HTTP individual no painel
do Asaas.

### 12/10 — retorno público do Checkout e crédito antecipado no Financeiro

O Checkout do paciente já produzia `APP_BASE_URL/?payment=success`, mas a raiz
redirecionava para login. O branch atual renderiza uma página pública de
acompanhamento para `success`, `cancelled` e `expired`. Ela informa que o Asaas
está sendo verificado; **não** afirma que o pagamento ocorreu com base na URL.
`/` sem esses valores continua exigindo login. O E2E de navegador local,
sem sessão, atravessou o middleware e recebeu HTTP 200 em `/?payment=success`
(1/1). O commit `9dba5080` foi publicado no Preview do PR #37 e o mesmo
E2E sem sessão passou **1/1** nesse deploy com bypass de automação; a Vercel
marcou o deploy como concluído. Não houve novo clique externo do Asaas nesta
página, e o hostname real de `APP_BASE_URL` em produção continua não verificado.

O `/financeiro` agora consulta `patient_credits` sob `withTenant` e mostra o
saldo não aplicado em quadro separado de recebíveis e fluxo mensal. Inclui
créditos antecipados e excedentes parcialmente alocados, desconta reversões
não alocadas e exclui disputas abertas. O cartão real de R$ 10 foi relido em
DEV/Sandbox às **09:18 BRT**: cobrança `paid`, agenda `confirmado`, crédito de
R$ 10 não aplicado, zero recebíveis da consulta futura. A consulta nova
retornou R$ 95 em três créditos com saldo não aplicado da clínica inteira;
agregação SQL independente deu exatamente o mesmo resultado. A regra aceita
é: pagamento integral antes da consulta = crédito agora; após a conclusão,
lançamento bruto `pago` se o crédito o cobrir. Esta última transição está
coberta pelo teste do handler, mas não foi executada externamente nesta fixture.
Uma conta de teste configurada no ambiente foi ligada à **mesma clínica** da
fixture por consulta read-only em `auth.users`/`profiles` no DEV, sem expor o
endereço nem a senha. Com ela, `e2e/advance-credit-financial-preview.spec.ts`
abriu `/financeiro` no Preview e comprovou em navegador **1/1 PASS**: o quadro
aparece com valor que contém o crédito de R$ 10 e o aviso de que não integra
“A receber”. O teste é somente leitura e não salva screenshot, trace ou vídeo.

Às **13:29 UTC de 12/10**, `node .tmp/run-smoke-advance-credit-completion.mjs`
executou `scripts/smoke-advance-credit-completion.ts` no banco DEV fixado. A
transação clonou somente referências da fixture E2E de cartão já paga, criou
agendamento e crédito sintéticos de R$ 10 e foi revertida ao final. Quatro
assertions funcionais passaram: consulta futura sem recebível; `scheduled_at`
avançado para dois dias atrás ainda em `confirmado`, com crédito `available` e
sem recebível; após **simular o fato clínico `atendido`** e executar o handler
real de `scheduling.appointment.completed`, um recebível bruto de R$ 10 nasceu
`pago`, crédito `allocated` e uma baixa de R$ 10; reentrega não duplicou
recebível nem ledger. Readback fora da transação: zero agendamentos, créditos
ou recebíveis da fixture (exit 0). `npx tsc --noEmit` e ESLint do runner também
terminaram com exit 0. **Limite:** o teste isola o consumidor financeiro; não
executa a ação clínica pela UI nem cria prontuário assinado, e o crédito
sintético desta transação não passou por um novo Checkout. A passagem do
horário, sozinha, não marca consulta como atendida: o encerramento clínico
autorizado é obrigatório. A fixture real de cartão continua futura e intacta.

Validação local desta mudança: teste direcionado de consulta, página e handler
**18/18**; `npx vitest run --silent` **5.492/5.492 em 523 arquivos**;
`npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos alterados,
`git diff --check` e probe SQL/readback DEV com exit 0. O build otimizado
`npx tsx scripts/security/local-build.ts` terminou com exit 0: Next 15.5.24,
18 páginas estáticas e `/`/`/financeiro` dinâmicas. Nenhum desses checks
representa E2E externo do pagamento integral antes da consulta.
