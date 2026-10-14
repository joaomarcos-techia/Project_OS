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

Às **13:49 UTC de 12/10**, `node .tmp/run-smoke-advance-credit-completion.mjs`
executou `scripts/smoke-advance-credit-completion.ts` no banco DEV fixado. A
transação clonou somente referências da fixture E2E de cartão já paga, criou
agendamento e crédito sintéticos de R$ 10 e foi revertida ao final. As
verificações funcionais passaram: consulta futura sem recebível; `scheduled_at`
avançado para dois dias atrás ainda em `confirmado`, com crédito `available` e
sem recebível; após `confirmado → chegou → em_atendimento`, o core recusou
`atendido` sem prontuário; com registro sintético assinado e cifrado, o core
gravou `atendido`, atualizou a fila, registrou três transições e publicou
`scheduling.appointment.completed`; seu handler real criou um recebível bruto de
R$ 10 `pago`, crédito `allocated` e uma baixa de R$ 10; reentrega não duplicou
recebível nem ledger. Readback fora da transação: zero agendamentos, créditos,
recebíveis, prontuários, filas, logs de transição e eventos da fixture (exit 0).
`npx tsc --noEmit` e ESLint do runner também terminaram com exit 0. **Limite:**
a prova atravessa os cores Scheduling e Financial, mas não a Server Action/UI e
seu gate de autorização; o crédito sintético desta transação não passou por um
novo Checkout. A passagem do horário, sozinha, não marca consulta como
atendida: o encerramento clínico autorizado é obrigatório. A fixture real de
cartão continua futura e intacta.

Validação local desta mudança: teste direcionado de consulta, página e handler
**18/18**; `npx vitest run --silent` **5.492/5.492 em 523 arquivos**;
`npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos alterados,
`git diff --check` e probe SQL/readback DEV com exit 0. O build otimizado
`npx tsx scripts/security/local-build.ts` terminou com exit 0: Next 15.5.24,
18 páginas estáticas e `/`/`/financeiro` dinâmicas. Nenhum desses checks
representa E2E externo do pagamento integral antes da consulta.

### 12/10, 19:35 BRT — chave Sandbox, novo Preview e segunda cobrança

**Diagnóstico da rejeição da chave em produção.** O runtime de produção usa
`api.asaas.com`; a chave de teste indicada pelo fundador respondeu HTTP 200 a
`GET /myAccount` no Sandbox e HTTP 401 `invalid_environment` na API real.
`connectPaymentAccount` valida a credencial antes de cifrar/gravar, e o readback
de produção confirmou zero contas recebedoras conectadas. Não houve conexão nem
cobrança de paciente em produção. A mensagem de erro local agora explica a
diferença entre Sandbox e produção quando o código estável do Asaas é
`invalid_environment`; os demais erros mantêm a mensagem anterior. O teste de
regressão prova a mensagem específica e que `upsertPaymentAccount` não é chamado.
No momento destas medições, essa mudança de mensagem ainda não estava
publicada no Preview nem em produção; a validação da cópia é local.

A variável local `teste_final` foi checada sem reproduzir seu valor: HTTP 200 no
Sandbox. Ela lista exatamente os mesmos IDs de webhooks da chave Sandbox já
conectada à Clínica A no DEV, inclusive o webhook ativo cujo `webhook_ref` no
banco é o da Clínica A. O `id` de `/myAccount` diferiu entre as chaves, portanto
esse campo isolado não serviu como prova de separação de contas. A clínica de
teste `teste` permanece **sem** conta Asaas: conectar ali uma segunda chave que
alcança o mesmo conjunto de webhooks misturaria dois tenants recebedores. A
conexão já funcional da Clínica A foi preservada; nenhuma rotação de chave foi
feita.

Após fingerprint assinado comprovar Auth e banco DEV no Preview
`https://project-ptmvs45oh-clinic-os-v2-s-projects.vercel.app`, o callback do
**Asaas Sandbox** da Clínica A foi movido do Preview antigo para esse deploy.
GET da rota de webhook no novo Preview retornou o 405 esperado para uma rota
POST; GET do recurso no Asaas confirmou a URL nova, `enabled=true` e
`interrupted=false`. Isso é prova de configuração, **não** do HTTP de uma entrega
real do Asaas. O WhatsApp da clínica de teste `teste` foi desconectado pelo
Preview e relido como inativo no banco e na Meta; a conexão de coexistência da
Clínica A permaneceu ativa.

Pela UI `/agenda` do Preview, a conta owner de teste da Clínica A criou um
atendimento sintético do paciente E2E já existente, para **20/10/2026 10:00**,
valor bruto R$ 150. O runner de navegador encerrou antes da confirmação visual,
mas o readback SQL encontrou **exatamente um** agendamento novo; não houve
repetição do clique. A política da clínica é sinal de 50% também no retorno.
Com guards de DEV, Sandbox, consentimento, conta, WhatsApp, fila livre e callback,
`createDepositCharge` criou **uma** cobrança de R$ 75; somente seus dois eventos
de outbox foram processados. O job `deposit_link` enviou o template ao número de
teste consentido; a Meta aceitou e o readback local registrou `delivered`.
O handoff técnico fica em `.tmp/payments-meta-deposit-handoff-2.json` (ignorado
pelo Git, sem URL, número ou segredo). Antes do pagamento humano: cobrança
`pending`, agendamento `agendado`, sinal `pending`, zero crédito, zero recebível
e zero webhook de pagamento. O usuário confirmou o recebimento da mensagem;
o Checkout Sandbox foi concluído com cartão. O readback posterior encontrou
pagamento `CONFIRMED` de R$ 75 no Asaas, ligado à sessão exata do Checkout;
eventos reais `PAYMENT_CONFIRMED` e `CHECKOUT_PAID` foram persistidos no DEV,
e a cobrança mudou para `paid` com economia do provedor conciliada. Como o
Preview não roda cron, somente os eventos `charge-paid` e `credit-granted`
desta cobrança foram despachados: agenda `confirmado`, sinal `paid`, um crédito
R$ 75 `available`, zero recebível antes da consulta e zero evento da fixture
pendente. **Pagamento Sandbox → webhook → Qoro → agenda/crédito: PASS funcional.**
O status HTTP individual da entrega original ficou **PASS** no adendo de 13/10
abaixo, pela requisição correlacionada nos Logs da Vercel.

`node .tmp/run-advance-credit-readback.mjs --new` confirmou saldo total de
R$ 170 em quatro créditos não alocados da Clínica A, exatamente igual à soma
SQL independente, dos quais R$ 75 pertencem à nova cobrança. Em seguida,
`node .tmp/run-preview-advance-credit-e2e.mjs` abriu `/financeiro` no novo
Preview e passou **1/1**, mostrando o crédito antecipado fora de “A receber”.
Esse E2E foi somente leitura, sem screenshot, trace ou vídeo. A consulta de
20/10 ainda não foi encerrada; alocação do crédito após conclusão clínica real
na UI permanece **NOT TESTED** para esta fixture.

A cobrança anterior, também sintética, continuou `paid`/`CONFIRMED`, com
`provider_payment_id`, economia conciliada, consulta `confirmado`, um crédito
`available` e zero recebível antes da consulta. Uma reentrega controlada do
evento já processado ao endpoint do Preview retornou HTTP 200 `ignored`, sem
duplicar crédito/evento. A entrega original desta cobrança anterior ainda não
tem seu próprio registro HTTP identificado neste relatório.

Validações locais desta rodada: `npx vitest run --silent` **5.493/5.493 em 523
arquivos**, exit 0; `npx tsc --noEmit`, `npx eslint .`, Prettier dos três arquivos
alterados e `git diff --check` exit 0; `npx tsx scripts/security/local-build.ts`
exit 0 (Next 15.5.24, compilação e typecheck). O `npx eslint .` inicial apontou
dois avisos em helper temporário ignorado pelo Git; foram removidos e a repetição
terminou sem erros nem avisos. Nenhuma migration foi executada nesta rodada.

### 13/10/2026 — HTTP do webhook e prevenção de callback para Preview antigo

O usuário copiou quatro linhas JSONL dos Logs da Vercel do projeto `project-os`,
intervalo 12/10 13:18–13/10 01:18 UTC, filtro `outcome`. O POST do evento real
`PAYMENT_CONFIRMED` às **22:35:44.743 UTC de 12/10** atingiu a rota de webhook
da Clínica A no deployment `dpl_Ac1X53QUvL5UEUdzwZT4p3VPrfkg`, ambiente
`preview`, com **`responseStatusCode: 200`**. Outra linha da mesma rota às
22:35:52.206 UTC registrou `payments.webhook.verify` com `outcome: ok` e também
HTTP 200. Assim, a entrega HTTP do pagamento de R$ 75, antes **NOT TESTED**, é
**PASS** no log da borda/aplicação da Vercel; o corpo de resposta informado pelo
usuário foi `{"received":true,"outcome":"paid"}`. Readback independente em
13/10 01:19 UTC (`node .tmp/run-readback-payments-meta.mjs --new`, exit 0)
confirmou Asaas `CONFIRMED`, R$ 75, cartão, mesmo Checkout; no DEV, cobrança
`paid`, fatos econômicos conciliados, agendamento `confirmado`, sinal `paid`, um
crédito `available` de R$ 75, nenhum recebível antes da consulta e dois eventos
persistidos: `PAYMENT_CONFIRMED` e `CHECKOUT_PAID`.

Para reproduzir uma entrega nova sem tocar produção, a conta `teste_final` foi
guardada como Sandbox e o webhook da Clínica A foi relido como ativo, não
interrompido, com token configurado e eventos de pagamento inscritos. Seu
callback tinha derivado para um Preview antigo após a reconexão da chave; um
`PUT /v3/webhooks/{id}` **somente da URL**, seguido de GET, restaurou o Preview
alvo, preservando token e eventos. Uma cobrança PIX sintética de R$ 10 foi
criada diretamente no Sandbox, com notificações ao cliente desativadas, e
confirmada pelo endpoint oficial de simulação às **01:08:11 UTC de 13/10**.
O log da Vercel às **01:08:15.509 UTC** registrou `PAYMENT_RECEIVED` na rota
esperada com **HTTP 200**. O readback DEV encontrou **zero** cobranças ou
créditos Qoro associados a esse pagamento externo, comportamento esperado:
ele não nasceu no Checkout da Qoro. Esse segundo POST comprova entrega e
resposta da rota, mas não a conciliação de uma cobrança do produto.

A causa do callback derivado estava no uso de `APP_BASE_URL` para registrar
webhooks em Preview; essa variável pode conter o host de outra branch. O mesmo
risco existia nos três retornos do Checkout hospedado. O código passou a usar
`VERCEL_BRANCH_URL` validada (ou `VERCEL_URL` como fallback) nos callbacks
externos de Preview, mantendo `APP_BASE_URL` em produção. URL auto-injetada
ausente ou inválida impede o registro remoto do webhook, com aviso visível, e
impede criar Checkout com retorno incorreto. A regressão direcionada passou
**79/79 em três arquivos**. `npx tsc --noEmit`, ESLint dos seis arquivos de
código tocados, Prettier e `git diff --check` saíram com exit 0. O build Next
15.5.24 local, com variáveis de DEV e sem upload ao Sentry, compilou e terminou
com **exit 0**. A suíte completa `npx vitest run --silent` passou **5.498/5.498
em 523 arquivos**, exit 0. A correção ainda não foi implantada nem revalidada
em um novo Preview; o webhook do Sandbox foi ajustado e relido separadamente.
Como uma Server Action mudou de linha, `npx tsx scripts/security/inventory.ts
--write` foi executado com exit 0 e atualizou somente referências de linha em
`docs/security/acoes.md` (199 actions, 53 métodos de rota, zero pendências).

Os dois JSONs exportados inicialmente (`01-00-27` e `01-09-18`) eram idênticos,
314 linhas entre 00:30 e 00:59 UTC, e não serviam para inferir o HTTP das
entregas de 22:35 ou 01:08. O JSONL posterior, copiado diretamente dos Logs
da Vercel, trouxe as linhas correlacionadas. O painel de logs do próprio Asaas
não foi lido nesta rodada.

### 13/10/2026 — correção publicada e reconexão real no novo Preview

O commit `957b9abc` foi enviado à branch `fix/asaas-environment-copy-20261012`.
O status da Vercel para esse SHA mudou para `success` às **02:05:25 UTC**.
O alvo testado foi
`https://project-os-git-fix-asaas-environ-1b3c1d-clinic-os-v2-s-projects.vercel.app`.
Antes de qualquer escrita, `/api/signup/runtime-fingerprint` comprovou por assinatura
que Auth e banco apontam para o projeto DEV. O E2E de navegador reconectou a
conta Asaas Sandbox da Clínica A em `/configuracoes/pagamentos`, confirmou a
mensagem de conta conectada, campo da chave limpo e estado mantido após reload:
**PASS** (`node .tmp/connect-teste-final-preview.mjs`, exit 0). A chave não foi
incluída em log, screenshot ou artefato versionado.

O GET independente da configuração no Asaas Sandbox encontrou exatamente um
webhook de cobrança de paciente; seu host agora é a URL da branch acima,
`enabled=true`, `interrupted=false`, token configurado, bypass da proteção da
Vercel presente e eventos `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` inscritos:
**PASS** (`node .tmp/inspect-sandbox-webhook.mjs <host-da-branch>`, exit 0).
Esse readback distingue a correção em execução do código anterior, que ao
reconectar gravava `APP_BASE_URL` de outro Preview. O E2E de navegador do retorno
público `/?payment=success` passou **1/1** (`node .tmp/run-preview-return-e2e.mjs`,
exit 0): a página informa verificação sem afirmar quitação antes do webhook.
Os testes direcionados da origem dos callbacks, conexão e Checkout passaram
**79/79** (`npx vitest run src/lib/http/application-url.test.ts
src/contexts/payments/connect-account.test.ts
src/contexts/payments/internal/hosted-checkout.test.ts`, exit 0). A mesma versão
do código já havia passado **5.498/5.498** testes, TypeScript, ESLint, Prettier
e build Next local antes do push; não houve alteração de código depois disso.

Limite da evidência **naquele checkpoint**: a reconexão e o readback provavam
que o novo Preview registrou o webhook correto, mas ainda não havia POST
original do Asaas correlacionado nos logs **desta** URL nem um Checkout novo
criado pelo runtime desta branch com os três callbacks relidos no provedor. A
entrega real de R$ 75 e a sondagem PIX de R$ 10 com HTTP 200 referiam-se ao
Preview anterior. A entrega original no novo Preview foi medida no adendo de
03:09 UTC abaixo; a criação pelo runtime segue sem prova. A conclusão da
consulta e o Google Ads ficam para a etapa final.

### 13/10/2026 — Checkout Sandbox de um novo agendamento da Clínica A

Os exports da Vercel foram conferidos sem reproduzir query strings nem tokens:
`project-os-log-export-2026-10-13T01-09-18.json` repete os 314 registros de
00:30–00:59 UTC, todos de produção. O CSV `02-29-54` contém 9.203 registros
de 12/10 14:30 a 13/10 02:29 UTC (8.676 produção, 527 Preview). O CSV
`02-33-14` é o subconjunto Preview de 527 registros, entre 12/10 22:04 e
13/10 02:28 UTC. Nele, a entrega original do Preview anterior às 22:35 UTC
recebeu HTTP 200, verificação `ok` e processamento `paid`; o POST de 01:08 UTC
recebeu HTTP 200 e `unknown_charge`, como esperado para a sonda PIX externa.
Para a nova branch há 42 registros, mas só um GET do webhook com HTTP 405 às
02:11 UTC: **a entrega original POST no novo Preview ainda não foi medida**.

O usuário informou ter criado pela UI do novo Preview um agendamento sintético
da Clínica A. O banco registra sua criação às **02:41:24 UTC**, com consulta
marcada para **13/10 12:00 UTC** e valor R$ 150; o export da Vercel termina
antes disso e não comprova a origem do POST da Agenda. O readback
guardado encontrou um único agendamento novo, nenhum `patient_charge`, política
de sinal ativa a 50%, conta Sandbox ativa e webhook configurado. Antes da criação
da cobrança, `getPaymentIdentity` confirmou CPF válido e
`/api/signup/runtime-fingerprint` confirmou Auth/DB DEV. A fila geral continha
eventos de várias clínicas; **não** se invocou `/api/cron/outbox` nem
`/api/cron/payments-deposit` globalmente.

`createDepositCharge` foi chamado **localmente** sobre apenas esse agendamento,
com banco DEV, Asaas Sandbox e variáveis de Preview da branch. O Asaas aceitou
o `POST /checkouts` e sua resposta ecoou `successUrl`, `cancelUrl` e
`expiredUrl` no host da nova branch. Readback independente no DEV: exatamente
uma cobrança `pending` de **R$ 75**, Checkout ativo com ID persistido e link
hospedado presente. Um GET externo do link hospedado retornou HTTP 200. O
Checkout vence em **13/10 11:59:21 UTC**, pois o hold não ultrapassa a consulta.
Esses checks comprovam o código real da branch contra Sandbox e DEV, mas
**não equivalem a um Checkout criado pelo runtime implantado no Preview**.

O evento `payments.patient_charge.created` dessa cobrança foi processado com
`runOutboxEventsNow` filtrado por tipo e chave idempotente: **1 processado,
0 falhas, 0 skips**. Readback mostrou `deposit_status=pending` e hold futuro.
O evento `link_ready` não foi processado: o paciente escolhido é sintético, mas
seu telefone não corresponde ao número de teste autorizado. A política do
produto classifica `deposit_link` como mensagem transacional de lembrete:
**não** exige o opt-in de cobrança usado por `remainder_link`/`dunning`.
Nenhuma mensagem foi enviada. Os runners temporários e
o readback ficam sob `.tmp/` (ignorado pelo Git); não contêm chave, senha,
telefone ou link do Checkout em log versionado.

O E2E de navegador autenticado contra a Agenda **implantada** no novo Preview
encontrou exatamente uma linha desse paciente no dia 13/10, badge **“Sinal
pendente”** e prazo visível da vaga; zero erros de página
(`.tmp/check-new-appointment-preview.ts`, exit 0, sem screenshot/trace). O
Checkout hospedado no Asaas Sandbox também abriu em Chromium com HTTP 200,
R$ 75 visíveis e zero erros de página
(`.tmp/check-new-asaas-checkout-ui.mjs`, exit 0). A página inicial ainda não
mostrou seleção PIX/cartão na leitura automática, então esses controles não
foram classificados como PASS de UI. Readback DEV + Asaas às **02:52:05 UTC**:
cobrança `pending`, agendamento `agendado`, sinal `pending`, zero crédito, zero
webhook dessa cobrança e nenhuma `payment` ligada ao Checkout. A regressão da
origem dos callbacks, conexão e Checkout passou **79/79**, `npx tsc --noEmit`
e `git diff --check` terminaram com exit 0; após a publicação da branch, só
este registro de evidência foi alterado em arquivo versionado.

Naquele checkpoint, faltava pagar esse Checkout com cartão de teste no Sandbox
e medir o POST original do Asaas no novo Preview, seguido do readback `paid`,
agenda confirmada e crédito. O estado era **PASS parcial** para criação e
callback ecoado, **NOT TESTED** para pagamento → webhook → estado final. O
pagamento, o readback e o HTTP original foram medidos nos adendos abaixo.

Também passaram **72/72** testes dos handlers de hold, fila de link e política
de envio (`patient-charge-created.test.ts`, `patient-charge-link-ready.test.ts`,
`process.test.ts`, exit 0). A falta de opt-in bloqueia `remainder_link` e
`dunning`, não `deposit_link`; esses testes não substituem a entrega externa
ao paciente autorizado. O readback repetido às **02:57:59 UTC** continuou
`pending` no Qoro e sem
pagamento do Checkout no Asaas. `npx prettier --check` deste documento saiu
com exit 0.

A regra específica foi conferida em `policy.ts` e seus **16/16** testes
(`npx vitest run src/contexts/ai-agent/proactive-jobs/application/policy.test.ts
--silent`, exit 0). O fato de não ter enviado neste teste vem da decisão de
**não processar o evento de link para um telefone não autorizado**, não de uma
suposta recusa por falta de opt-in.

### 13/10/2026, 03:04 UTC — pagamento do novo Checkout e estado no Preview

O fundador concluiu o Checkout Sandbox de R$ 75 com cartão de teste. O readback
guardado (`.tmp/read-new-clinic-a-payment.ts`, exit 0, 02:58–03:01 UTC) encontrou
na API do Asaas `CONFIRMED`, `CREDIT_CARD`, valor R$ 75 e a sessão de Checkout
exata desta cobrança. No DEV, a cobrança passou a `paid`, ganhou
`provider_payment_id`, teve os fatos econômicos conciliados e registrou os
eventos `PAYMENT_CONFIRMED` e `CHECKOUT_PAID`. Na primeira leitura, a agenda
ainda estava `agendado`/sinal `pending` e não havia crédito: o webhook publica
eventos para o outbox, mas o Preview não executa o cron automaticamente.
Os timestamps de persistência no DEV foram 02:58:42.852 UTC (`CHECKOUT_PAID`)
e 02:58:43.838 UTC (`PAYMENT_CONFIRMED`), obtidos por
`.tmp/read-new-event-times.ts` (exit 0); são a janela exata para procurar a
requisição original na Vercel.

Após conferir clínica, agendamento, cobrança, tipo, chave idempotente e status de
cada evento, `.tmp/process-new-clinic-a-paid.ts` despachou **somente**
`charge-paid:<chargeId>` e `credit-granted:<chargeId>`: 2 processados, zero
falhas/skips. O readback final encontrou consulta `confirmado`, sinal `paid`,
hold removido, um crédito antecipado de R$ 75 `available` e nenhum recebível
criado antes do atendimento. O Asaas continuou `CONFIRMED` para o mesmo
Checkout; no DEV, a cobrança permaneceu `paid`, com dois eventos de webhook.
`node .tmp/run-advance-credit-readback.mjs --new` saiu com exit 0 e encontrou
R$ 245 em cinco créditos não alocados da Clínica A, valor igual à soma SQL
independente. Essa soma inclui R$ 75 da nova cobrança e não representa
recebível quitado nem dinheiro liquidado na conta Asaas.

No deployment da branch, `.tmp/check-new-appointment-preview.ts` abriu a
Agenda autenticada, encontrou exatamente a linha da fixture com **“Confirmada”**
e **“Sinal pago”**, sem prazo de hold e sem erros de página: exit 0. O primeiro
ensaio desse runner falhou por uma expectativa textual incorreta do próprio
teste (`Confirmado` em vez do rótulo feminino `Confirmada`); corrigida conforme
o componente real, a repetição passou. A leitura de `/financeiro` via
`e2e/advance-credit-financial-preview.spec.ts` no mesmo Preview passou **1/1**
com saldo mínimo de R$ 245 (`node .tmp/run-new-preview-advance-credit-e2e.mjs`,
exit 0), fora de “A receber”. Ambos são E2E de leitura, sem screenshot/trace.

Um replay controlado do **mesmo** `PAYMENT_CONFIRMED` já persistido, enviado à
rota da nova branch com o token configurado da conta Sandbox, retornou **HTTP
200**, `outcome=ignored`; o readback antes/depois permaneceu cobrança `paid`,
um crédito e dois eventos de webhook (`.tmp/replay-new-paid-webhook.ts`, exit 0).
Isso prova disponibilidade e idempotência da rota implantada para um evento
repetido. O GET independente da configuração Asaas ainda mostrou callback na
branch correta, `enabled=true` e `interrupted=false`.

**Limite da prova:** o status HTTP da entrega original estava **NOT TESTED**
na primeira leitura, pois os exports da Vercel então disponíveis terminavam
antes do pagamento; foi medido no export posterior, registrado abaixo. Ainda
não houve Checkout novo criado pelo runtime do Preview: a criação desta fixture
usou o código da branch localmente contra DEV/Sandbox. A conclusão da consulta de
13/10 12:00 UTC e a alocação do crédito no recebível após atendimento continuam
**NOT TESTED** nesta fixture; não se antecipou o relógio nem se processou a
fila global. O evento `link_ready` continua sem despacho porque o telefone da
fixture não é o número autorizado para envios reais.

As rotas implantadas `/api/cron/payments-deposit` e `/api/cron/outbox` não
recebem filtro por agendamento/evento: ambas processam lotes globais. Como a
fila DEV contém eventos de outras clínicas, chamá-las só para obter um Checkout
originado pelo runtime do Preview provocaria efeitos fora desta fixture. Não
foi adicionado um endpoint administrativo de execução pontual apenas para
forçar um teste verde.

Como prova separada da regra de fechamento, o runner
`.tmp/run-smoke-advance-credit-completion.mjs` repetiu em 13/10 (exit 0) o
cenário transacional em DEV: a consulta futura conserva o crédito disponível;
passar do horário **sozinho** não conclui nem quita; conclusão sem prontuário
assinado é recusada; após a conclusão válida, o crédito é alocado e nasce um
recebível quitado; reentrega não duplica baixa nem recebível. O runner confirmou
rollback sem resíduos. Esta prova usa uma fixture sintética separada, portanto
não transforma a conclusão da consulta paga desta seção em PASS.

### 13/10/2026, 03:09 UTC — entrega original confirmada nos Logs da Vercel

O export `project-os-log-export-2026-10-13T03-09-10.json`, fornecido pelo
fundador, contém 847 linhas Preview até 03:08:50 UTC. Filtrando branch
`fix/asaas-environment-copy-20261012`, método POST, rota de webhook do paciente
e a janela 02:58:35–02:58:50 UTC, restaram dez linhas de **duas requisições**
originais, ambas no deployment `dpl_5k1A2jDVFGhCFaquJF5MGn5SaRA3` e no host
do novo Preview. O request `n5c7z-1791860319362-3e721820c7d8` verificou o
token com `outcome=ok`, processou `CHECKOUT_PAID` com `outcome=paid` e respondeu
**HTTP 200**. O request `4h957-1791860320672-aa9056c2e514` também verificou
com `outcome=ok`, processou `PAYMENT_CONFIRMED` com `outcome=already_paid` e
respondeu **HTTP 200**. A ordem explica por que houve dois eventos persistidos,
mas só uma transição financeira e um crédito. Nenhuma URL com bypass, token ou
payload foi copiada para o relatório.

**PASS funcional nesta branch:** cartão de teste no Asaas Sandbox → dois POSTs
originais HTTP 200 no Preview correto → cobrança `paid` e economia conciliada no
DEV → processamento direcionado do outbox → consulta `confirmado`, sinal `paid`
e crédito antecipado R$ 75 `available` → Agenda e Financeiro renderizados no
Preview. O replay HTTP 200 `ignored` prova a idempotência separadamente. Os
limites restantes são a criação do Checkout **pelo runtime** do Preview e a
conclusão/alocação **desta consulta** após o horário e o fechamento clínico.

A preparação dessa conclusão também foi lida no navegador, sem alterar estado:
`.tmp/check-new-consultorio-preview.ts` entrou em `/consultorio` do mesmo
Preview com a conta de teste, encontrou a fixture na faixa “A chegar hoje” e o
controle “Check-in”, com zero erros de página (exit 0). Esse check comprova que
o caminho manual está disponível; não equivale a check-in, prontuário assinado
ou consulta concluída.

Para fechar a fixture sem manipular o relógio, após **09:00 de 13/10 em
Brasília** entre no Preview da branch em `/consultorio` com uma conta clínica
autorizada, localize o paciente sintético desta consulta e use “Check-in” →
“Chamar”. Uma conta com permissão clínica deve preencher um prontuário
**fictício**, “Assinar consulta” e “Encerrar consulta”. Só então repetir o
readback do crédito/recebível e a leitura de `/financeiro`; não marcar a etapa
como PASS antes dessas ações e da conciliação observada. A assinatura torna o
prontuário imutável, por isso a ação deve usar apenas dados sintéticos.

### 13/10/2026 — encerramento da consulta e apresentação do perfil WhatsApp

O operador concluiu a consulta sintética e a tela mostrou “Faturada”. O readback
independente em DEV (`node .tmp/run-verify-clinic-a-completion.mjs`, exit 0,
13:48:47 UTC) encontrou o agendamento `atendido`, um prontuário assinado e o
crédito de R$ 75 ainda `available`, mas **nenhum recebível**: o evento
`scheduling.appointment.completed` estava `pending` no outbox do Preview. Logo,
o rótulo “Faturada” não provava lançamento financeiro. Corrigimos a lista de
consultas para usar o fato clínico “Concluída”, coberto por dois testes focados.

O dispatcher foi chamado **somente** para o evento pendente desta fixture,
com guardas de clínica/agendamento DEV e prontuário assinado, sem executar o
cron global (`node .tmp/run-verify-clinic-a-completion.mjs --process`, exit 0:
1 processado, 0 falhas). No readback de 13:51:39 UTC, o evento estava
`processed`, o crédito `allocated` em R$ 75, e havia **um** recebível de
R$ 150 em estado `parcial`, com R$ 75 pagos e R$ 75 restantes. **PASS** para
atendimento concluído → evento → lançamento e alocação nesta fixture;
pagamento do saldo restante continua não testado.

Para provar Checkout criado pelo **runtime do Preview**, o primeiro preflight
somente leitura da rota `/api/cron/payments-deposit` achou uma clínica
habilitada, zero candidatos a sinal, exatamente um candidato a saldo não
cobrado (esta fixture), mas também **um hold vencido**. A rota roda em paralelo
`expireDepositHolds`, que cancelaria esse outro agendamento. A execução foi
adiada até identificar o hold e medir seus efeitos; o resultado está abaixo.

Na UI de `/configuracoes/whatsapp`, o número dedicado de teste retornou uma
`profilePictureUrl` da Meta em `pps.whatsapp.net`; o GET da imagem deu HTTP 200,
mas o Playwright do Preview observou `imageLoaded=false` e três violações de
CSP `img-src`. A CSP local passou a permitir **somente essa origem** para
imagens, e o componente substitui por iniciais a foto que falhar no navegador.
O mesmo formulário é somente leitura em coexistência e editável no modo
dedicado, conforme os testes da UI. A conexão ativa atual em DEV é dedicada;
não há conexão ativa de coexistência disponível para um readback externo da
foto nesse modo. A correção visual precisa ser observada de novo no Preview
após o deploy desta branch antes de receber PASS externo.

**Gates locais após a correção:** `npx vitest run --silent` passou 5.501/5.501
em 524 arquivos; `npx tsc --noEmit --incremental false`, `npx eslint .` e
`npx tsx scripts/security/local-build.ts` terminaram com exit 0 (Next 15.5.24,
18 páginas estáticas). O lint havia reportado dois imports não usados apenas
em um helper ignorado `.tmp`, removidos depois; nenhum arquivo versionado teve
erro de lint. O Prettier dos arquivos tocados e `git diff --check` passaram.
Esses gates, sozinhos, não transformam a foto em PASS no Preview nem provam a
criação do Checkout pelo runtime implantado. Ambas as provas foram realizadas
depois, como registrado abaixo.

Após publicar `d62bdca6` somente na branch do PR #39, a Vercel concluiu o
deployment. O mesmo probe autenticado de navegador contra
`project-os-git-fix-asaas-environ-1b3c1d-clinic-os-v2-s-projects.vercel.app`
retornou exit 0: perfil carregado, imagem presente de `pps.whatsapp.net`,
`imageLoaded=true`, **zero** violações de CSP para imagem e edição habilitada
no número dedicado. Outro probe autenticado no mesmo Preview e na mesma
consulta sintética retornou exit 0: linha finalizada única com “Concluída”,
sem “Faturada” e zero erros de página. Isso fecha a correção visual para o
número **dedicado**. Foto em coexistência continua sem prova externa atual,
pois não há conexão ativa desse tipo no DEV; seu fallback está coberto por
teste de componente. Não houve merge em `main` nem escrita em produção.

**Checkout criado no runtime do Preview (13/10):** um segundo preflight
identificou o único hold vencido como outro agendamento da mesma clínica de
teste, criado havia 124 horas, com paciente sintético, horário passado e sem
prontuário. Não havia outros candidatos a sinal, saldo, renovação ou refund.
Com guardas de projeto DEV, host Asaas Sandbox, branch Preview, conta ativa e
IDs exatos da fixture, `node .tmp/run-verify-clinic-a-completion.mjs
--preview-remainder-cron` chamou **uma vez** o cron implantado. Resultado:
exit 0, **HTTP 200**, `remainder.charged=1`, `remainder.failed=0`,
`failures=0` e `expiry.cancelled=1`. Readback separado do banco: uma cobrança
`remainder` de **R$ 75,00** `pending` para a consulta concluída, com
`provider_checkout_id` presente e URL no host `sandbox.asaas.com`. O hold
sintético ficou `cancelado`/`expired`, exatamente o efeito esperado do cron.
**PASS** para criação de Checkout pelo runtime do Preview → Asaas Sandbox →
persistência DEV. Pagamento desse saldo e envio do link por WhatsApp continuam
**NOT TESTED**; o outbox global não foi executado.

Uma primeira leitura autenticada de `/financeiro` encontrou uma linha do
paciente sintético com “A receber”, valor **R$ 150,00** e “**R$ 75,00 em
aberto**”, mas o probe também capturou um `pageerror` em `/consultorio`; duas
repetições tiveram problemas de login/tempo de navegação enquanto a Vercel
fazia novo deployment de documentação. Depois de o status Vercel ficar
`success`, **uma** repetição controlada do probe terminou **PASS, exit 0**:
`/consultorio` mostrou “Concluída”; `/financeiro` mostrou uma linha única do
paciente sintético como “A receber”, R$ 150,00, R$ 75,00 em aberto; **zero
`pageerror`**. O erro intermediário não se repetiu, mas sua causa exata não foi
comprovada; não classificá-lo como bug corrigido nem atribuí-lo definitivamente
ao redeploy. O estado `parcial` e a alocação de R$ 75 também têm readback
independente no banco, registrado acima.

### 14/10/2026 — Clínica A sem assinatura; cadastro Clínica em fixture separada

Readback somente leitura no DEV da Clínica A: clínica `active`, perfis ativos
`owner=1`, `doctor=1`, `gestor=1`, `subscriptions=0` e
`billing_customers=0`. A mensagem “Assinatura em configuração” corresponde ao
estado do banco. Adicionar dois usuários não habilita o plano Clínica: o gate
de preço/repasse lê a assinatura. A troca de plano requer assinatura `active`.

Na mesma leitura, a consulta sintética concluída tinha um recebível `parcial`
de R$ 150, com R$ 75 quitados, e exatamente uma cobrança `remainder` de R$ 75
`pending`, com Checkout Sandbox presente e ainda válido às 14:39 BRT. O
pagamento do restante, seu webhook, a quitação final e o envio do link seguem
**NOT TESTED** nessa fixture.

Para testar sem modificar a Clínica A, `e2e/signup-confirmation.spec.ts` passou
**7/7, exit 0, 5,7 min** no Preview do PR #39. Seu cenário de Checkout
selecionou Clínica e confirmou por leitura SQL `plans.code=clinica` no draft,
além do Checkout pendente no Asaas Sandbox. O runner limpou a fixture; não
houve pagamento nem assinatura provisionada. Em seguida,
`e2e/payments-account-lifecycle.spec.ts` passou **6/6, exit 0, 3,4 min** com
clínica descartável distinta e assinatura sintética `active`: Pro/Clínica
exibiram configurações financeiras e Solo bloqueou UI/action. A limpeza da
clínica, usuários e webhook da fixture fez parte do PASS. As duas provas são
complementares, não uma prova única de pagamento → provisionamento → política.
TypeScript, ESLint do spec, Prettier, `git diff --check`, Vitest integral
(**5.501/5.501**, 524 arquivos) e build Next 15.5.24 (**exit 0**, 18 páginas
estáticas) passaram após a mudança do E2E.

### 14/10/2026 — conta Pro recém-criada: superfície, estados vazios e testes adversariais

Alvo: Preview do PR #39, branch `fix/asaas-environment-copy-20261012`, com
Auth e banco do projeto DEV comprovados pelo probe assinado de runtime. A conta
de teste informada em `2E2_UI_EMAIL`/`2E2_UI_PASSWORD` foi confirmada no DEV
como `owner`, clínica em `trial` e plano `pro`; nenhum valor de credencial foi
registrado em teste ou documento. Os cenários com escrita permaneceram no
Preview e usaram apenas fixture criada e removida pelo próprio teste.

| Prova executada | Resultado desta rodada | Limite da evidência |
| --- | --- | --- |
| `e2e/public-surface.spec.ts` | 8 PASS, 1 SKIP, exit 0 | Superfície pública; não executa a jornada inteira de cadastro. |
| `e2e/signup-session-api.spec.ts`, com modo Turnstile `always-pass` declarado para o Preview | 9 PASS, 1 SKIP, exit 0 | Esse modo não permite provar recusa de token forjado; a secret remota não foi lida do painel. |
| `e2e/tenant-settings-screens.spec.ts` | 3 PASS, exit 0 | CSV de auditoria, fila LGPD e modelo de receita criado, relido, excluído e relido. |
| `e2e/admin-boundary-rbac.spec.ts` | 1 PASS, exit 0 | A sessão Pro não alcança 11 URLs de `/admin` nem conteúdo RSC da plataforma. |
| `e2e/authenticated-readonly-routes.spec.ts`, caso estático | 1 PASS, 28/28 rotas HTTP 200 com título, exit 0 | Abrir página não comprova todas as ações da página; rota dinâmica sem fixture não foi marcada PASS. |
| `e2e/login-and-navigation.spec.ts`, acesso público | 5 PASS, exit 0 | Login exibe controles e alterna visibilidade da senha; quatro rotas negam visitante anônimo. |
| `e2e/login-and-navigation.spec.ts`, navegação autenticada | 1 PASS, exit 0 | Agenda, Caixa, Financeiro, índice de Configurações e Sugestões percorridos com sessão reutilizada. |
| `e2e/advanced-financial-entitlement-preview.spec.ts` | 2 PASS, exit 0 | A conta Pro em trial vê preço por meio e base de repasse; ativação sem preço foi recusada e o modo anterior permaneceu após reload. |
| `e2e/payout-review-preview.spec.ts` | 6 PASS, exit 0, 4,5 min | Duas clínicas e cinco usuários sintéticos no DEV; repasse com estorno parcial, revisão com teto, roles, tenant, idempotência, revogação, Solo e configuração PIX/cartão. Sem Asaas. |
| `scripts/run-signup-confirmation-e2e.ts` → `e2e/signup-confirmation.spec.ts` | 7 PASS, exit 0, 5,8 min | Envio e leitura reais no Resend DEV, confirmação entre aparelhos, código na aba original, Checkout Sandbox, retomada de draft expirado, conta legada, segundo draft e reenvio. Fixture local e lock removidos. |
| `e2e/accounting-export.spec.ts` | 3 PASS após correção do teste; primeira execução 2 PASS, 1 FAIL | CSV vazio com cabeçalho, mês inválido 422 e bloqueio anônimo. Sem lançamentos, esta conta não prova linhas financeiras reais. |
| `e2e/authenticated-readonly-routes.spec.ts`, caso de clínica vazia | 1 PASS, exit 0 | Owner vê ação para cadastrar equipe; agendar e criar encaixe ficam desabilitados sem procedimento. |

A primeira varredura autenticada encontrou `/agenda/ausencias` respondendo 200,
mas exibindo “Sem permissão” ao owner de clínica recém-criada sem profissionais.
Não era falta de permissão: a lista de médicos estava vazia. O commit
`aac87a6e` exibe o estado vazio apropriado com link para `/equipe` aos gestores
e mantém a negativa para quem não administra a equipe. Dois testes de página
cobrem os ramos. Antes do deploy, o E2E agregado registrou 25 rotas sem falha e
essa rota com título ausente; após o deploy, 26/26 passaram no mesmo Preview. O
inventário foi então ampliado para Auditoria e Pagamentos e passou 28/28.
Um caso E2E específico da mesma clínica confirmou o estado vazio de Ausências
com link para `/equipe` e, no drawer da Agenda, o bloqueio de “Agendar” e
“Criar encaixe” quando não há procedimento. Isso exerce a interação do gestor,
além do título da rota; nenhuma gravação foi feita.

O primeiro `login-and-navigation` também revelou duas causas distintas: a
expectativa do teste ainda usava o título antigo “Bem-vindo de volta” e a antiga
rota intermediária “Produto”; já o login autenticado foi recusado com “Muitas
tentativas” após a sequência de auditorias. Os textos e destinos do teste foram
atualizados conforme a interface atual. Os cinco casos públicos passaram na
reexecução. Após a janela do limitador, a navegação autenticada passou com uma
sessão E2E reutilizada, sem novos logins por teste. O arquivo temporário de
cookies foi removido ao final e confirmado ausente. O bloqueio anterior foi o
controle de proteção funcionando, não um bug do produto.

Na conta Pro em `trial`, um novo E2E confirmou a presença do painel “Política
financeira”, incluindo preço por meio e base do repasse. Com a precondição
observada de zero procedimentos na clínica, selecionar preço por meio e salvar
retornou a validação “Cadastre ao menos um preço por método”; após reload,
`absorb_fees` continuou selecionado. Antes dessa tentativa de escrita, o teste
confirmou por assinatura que o Preview usa Auth e banco DEV. Isso prova a
negativa e ausência de mudança de modo nessa conta, não prova criação de preço,
cobrança ou repasse. O ciclo Pro/Clínica/Solo com fixture isolada já está
discriminado no adendo anterior.

A revisão de repasse executou o fluxo real de Caixa do Preview para um
atendimento sintético de R$ 150. O estorno de R$ 50 suspendeu o repasse; o
financeiro registrou uma decisão de R$ 60 dentro do teto original de R$ 75.
Tentativas de atendente, médico, outra clínica, valor acima do teto e sessão
encerrada não criaram versão. Uma correção gerou a versão 2, outro estorno
suspendeu novamente e a versão 3 foi relida. O plano Clínica permitiu revisão,
o Solo a recusou. O teste encerrou com readback de **0 clínicas, 0 usuários e 0
linhas** da fixture. Essa prova não inclui transferência de dinheiro nem refund
do Asaas; os lançamentos de Caixa são internos e sintéticos.
Na mesma fixture Pro, o sexto caso salvou preços brutos PIX (R$ 140) e cartão
1x (R$ 160) pela UI, relendo ambos no banco. Ativou
`payment_method_pricing`, confirmou o modo após reload, restaurou
`absorb_fees` e removeu os preços; o readback final mostrou zero preço ativo.
O teardown eliminou também o histórico da fixture. Isso valida a configuração,
mas não a aplicação do preço escolhido pelo paciente num checkout real.

O runner de confirmação executou as sete provas no mesmo Preview, com guardas de
projeto DEV, origem exata e Asaas Sandbox. O e-mail lido foi a mensagem real
registrada no Resend de teste. No cenário de reenvio, o link anterior deixou de
valer e o novo permitiu concluir em outro aparelho. O Checkout recorrente foi
aberto e persistido, mas **nenhuma mensalidade foi paga** nesta suíte. O teardown
da suíte terminou sem erro; o arquivo de fixture, o lock e o arquivo temporário
de sessão foram confirmados ausentes no filesystem após o runner. A entrega em
uma caixa Gmail externa e o pagamento do checkout continuam provas distintas.

O E2E do CSV contábil inicialmente falhou porque exigia um `CRLF` mesmo quando
o mês não tinha movimentos. O corpo real era só o cabeçalho; a ADR-058 exige
`CRLF` como **separador entre registros**, não uma linha vazia obrigatória.
`renderAccountingCsv` já usa `lines.join('\r\n')` para arquivos com movimentos.
Corrigida a expectativa para recusar `CR` ou `LF` isolados, a suíte passou 3/3
no Preview. Classificação: **bug do teste**, sem alteração no produto. O teste
continua limitado para conteúdo de linhas porque a clínica Pro de teste não
tinha transações no mês; o arquivo temporário de autenticação foi removido e
confirmado ausente.

O caso de Turnstile que inicialmente recebeu HTTP 201 para um token forjado não
prova bypass em produção: o teste deduzia a secret do **servidor remoto** pelo
`.env.local` do runner. O código da rota consulta `siteverify`; uma
sondagem direta com a [secret pública de teste `always-pass` da Cloudflare](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
retornou `success=true` para o mesmo token forjado. Isso é compatível com o
comportamento do Preview, mas não substitui leitura da configuração remota.
`signup-session-api` agora
exige `E2E_TURNSTILE_MODE` explícito para escolher qual caso condicional é
aplicável ao Preview. Rodar com `always-pass` executou o positivo e deixou o
negativo **SKIPPED**, sem convertê-lo em PASS. A confirmação direta da secret
configurada no painel da Vercel e a recusa E2E com secret `reject-invalid`
continuam sem prova nesta rodada.

Validação local do commit de produto: build otimizado Next 15.5.24 exit 0,
`npx vitest run --silent` **5.503/5.503** em 524 arquivos, `npx eslint .` exit 0,
`npx tsc --noEmit --incremental false` exit 0 após os ajustes de E2E,
Prettier e `git diff --check` sem erro. CI do PR #39 concluiu lint, tipos,
testes, build e análise de segurança com sucesso para `aac87a6e`. Nenhum desses
gates substitui os E2E funcionais ainda não executados com essa conta.

Com a conta Pro recém-criada, continuam **NOT TESTED nesta rodada**: criação de
procedimento pela UI e uso dos preços PIX/cartão em cobrança, agendamento e atendimento pela UI,
convite a profissional, emissão de cobrança real no Sandbox, eventos Meta/IA e
rotas dinâmicas que exigem registros próprios. O teste de 28 rotas mede
renderização e título, sem converter ações dessas páginas em PASS. O positivo
do Turnstile em secret de teste também não comprova recusa de token inválido em
uma configuração `reject-invalid`.

### Rodada complementar de 14/10/2026 — Preview, DEV e Sandbox

Os comandos abaixo foram executados contra o Preview do PR #39 com probe assinado
confirmando o projeto Supabase de DEV antes de criar fixtures. Nenhuma fixture desta
rodada foi criada em produção. PASS aqui significa execução funcional e asserção,
não apenas descoberta ou invocação do teste.

| Prova | Execução e resultado | Limite |
| --- | --- | --- |
| Conta de pagamentos da clínica | `e2e/payments-account-lifecycle.spec.ts`: 6/6 PASS, exit 0; conexão, pausa, retomada, webhook remoto habilitado/desabilitado e cleanup no Asaas Sandbox. | Conta e clínica sintéticas em DEV; não valida produção. |
| Política de preços e revisão de repasse | `e2e/payout-review-preview.spec.ts`: 6/6 PASS, exit 0; além de RBAC e revisão, a UI recusou agendamento sem meio de pagamento e criou dois agendamentos com PIX R$ 140 e cartão 1x R$ 160. Readback SQL confirmou valor, meio, parcelas e referência à tabela de preços; cleanup com 0 clínicas, 0 usuários e 0 linhas da fixture. | Agendamento e persistência provados; cobrança real desses dois atendimentos não foi executada. |
| Convite e caixa de teste Resend | `scripts/team-invite-inbox-check.ts`: PASS, exit 0; envio inicial, reenvio, recebimento, link antigo recusado, novo link aceito, replay recusado, vínculo ao tenant e cleanup completo. | Não substitui entrega na caixa pessoal do usuário. |
| Primeira mensalidade após trial | `scripts/asaas-post-trial-preview-e2e.ts`: PASS, exit 0; fatura PIX pendente no Asaas Sandbox, pagamento simulado, webhook entregue ao Preview, assinatura e clínica ativas no DEV, ciclo avançado e replay idempotente. Readback confirmou remoção do webhook, assinatura, cliente e clínica sintéticos. | Não é o primeiro checkout de cadastro da conta Pro do usuário; não envolve dinheiro real. |
| Guardas de banco para preço e checkout | `scripts/smoke-appointment-pricing-guard-db.ts`: PASS, exit 0; `scripts/smoke-patient-checkout-db.ts`: 7/7 PASS, exit 0, ambos com rollback/cleanup. | Provas de banco, não de UI ou provedor externo. |

Os dois runners que criam recursos externos agora verificam o runtime DEV do
Preview antes da primeira escrita. A asserção de que a chave Asaas não aparece
no HTML também deixou de incluir o valor da chave na mensagem de falha do teste.
Não há secrets no relatório ou nas evidências registradas aqui.

Ainda **NOT TESTED** nesta rodada: pagamento real no Checkout Sandbox para os
agendamentos com preços por meio; liquidação e exportação contábil com linhas
financeiras; primeira mensalidade da conta Pro recém-criada; Meta/IA da clínica
nova; recusa Turnstile em Preview configurado como `reject-invalid`; atribuição
final no Google Ads com campanha ativa. Esses pontos não herdam PASS dos testes
de componente, banco ou da clínica sintética.

Gates após esta rodada: Prettier nos seis arquivos alterados exit 0,
`git diff --check` exit 0, `npx tsc --noEmit --incremental false` exit 0,
`npx eslint .` exit 0, `npx vitest run --silent` 5.503/5.503 em 524
arquivos, exit 0. A primeira tentativa de `npx next build` parou antes da
compilação por ausência de `DATABASE_URL` e `NEXT_PUBLIC_SUPABASE_URL` neste
worktree. O runner isolado `npx tsx scripts/security/local-build.ts`, que
fornece fixtures sintéticas sem carregar `.env.local`, concluiu o build
otimizado Next 15.5.24 com exit 0. O bloqueio inicial era de ambiente, não
falha de compilação.

Na primeira execução do CI deste commit, testes e cobertura passaram, mas o
inventário de segurança falhou porque as duas novas importações deslocaram as
linhas de `process.env` registradas em `docs/security/acoes.md`. O inventário
foi regenerado e seu `--check` passou localmente; a nova execução remota deve
ser julgada pelo próprio resultado, sem converter o primeiro FAIL em PASS.
