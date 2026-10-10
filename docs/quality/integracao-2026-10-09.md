# Integração isolada de 09/10/2026

Estado: **validação local e leitura DEV aprovadas; cadastro no Preview 7/7 PASS;
conta de pagamentos no Preview 6/6 PASS após correção; produção não validada**.

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

Em 10/10, o usuário informou que concluiu manualmente o cadastro sem erro. Isso
fecha o roteiro humano **por relato**, não equivale a readback automatizado do
checkout pago, provisionamento, tenant e primeira sessão desta conta específica.

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
- **Migrations de produção:** não foram aplicadas nem tiveram readback neste ciclo.
  A presença dos marcadores no DEV não autoriza inferência sobre produção.
- **Editor de perfil público do WhatsApp (#19):** resolver conflitos depois de
  comparar contratos, testar upload e leitura reais no provedor e rodar regressão.
- **Pagamento do sinal no Sandbox e campanha Google Ads:** gates externos ainda
  abertos. O roteiro humano de `/cadastro` foi relatado como concluído pelo
  usuário em 10/10; falta readback independente do resultado específico.
- **Login automatizado:** investigar a espera longa com trace/console/network
  no Preview atualizado, preservando a distinção da experiência manual.

Esta é uma fotografia de evidência para revisão; **não é aprovação de go-live**.
