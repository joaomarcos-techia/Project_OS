# Gates finais da oferta mensal — 29/10/2026

Esta é a leitura do candidato, não da oferta atualmente publicada. Não houve merge, deploy Production, alteração de variável Production, migration remota ou cobrança nesta rodada.

## Contrato comercial e implementação

| Regra aprovada | Fonte e funcionamento candidato | Conferência / limite |
| --- | --- | --- |
| Consultório R$ 197, 1 médico; Clínica R$ 397, 2 médicos | `src/contexts/billing/proposed-offer.ts`; catálogo versionado na 0122; cadastro só oferece os dois planos de entrada | Landing `src/data/planos.ts` usa os mesmos valores. Não contratar 3–5 diretamente no cadastro; são ampliações da Clínica existente. |
| Médico extra R$ 147/mês, até 5 no total | Variantes `_3/_4/_5`: R$ 544/691/838; saga de upgrade, Checkout proporcional e confirmação antes da liberação | Prova hospedada/webhook/cota anterior preservada; não criado novo pagamento. |
| Até 3 membros de equipe em ambos os planos | `consultorioIncludedStaffLogins` e `clinicaIncludedStaffLogins` = 3; gatilho SQL limita profiles | Recepção/financeiro são equipe; médico ou owner/gestor com CRM usa cota médica. Não prometer equipe ilimitada nem quarto login automático. |
| Trial 14 dias desde usuário Auth | `signup-trial.ts`, `signup-billing.ts` e 0124 | Checkout atrasado não reinicia prazo; já expirado exige pagamento confirmado para liberar. A primeira data de cobrança não antecipa as 14×24h. |
| Novas contratações somente mensais | `OFFER_2026_ANNUAL_NEW_SALES_ENABLED=false` por padrão, aplicado em catálogo, mutação e criação de Checkout; mensal→anual bloqueado nessa fase | Anual existente e sua reconciliação/cancelamento continuam preservados; preço anual no catálogo não equivale a oferta ativa. |
| Cancelamento sem estorno automático | Cessa renovação; anual pré-pago mantém acesso até o período pago; cobranças não pagas são limpas conforme saga existente | Revisão jurídica final permanece humana. Não confundir cancelamento SaaS com devolução de pagamento do paciente. |
| 500 conversas/médico como referência, sem bloquear serviço | Ledger por paciente/janela de 24h após aceite Meta; alertas 80/100%, sem excedente automático | Proteção técnica de custo/indisponibilidade é distinta da referência comercial. Aceite Meta não significa entrega final. |
| Contrato legado e desconto vitalício preservados | Família versionada, `price_id` e limites históricos preservados; mudança entre família legada e 2026 recusada | Clone real com 14 migrations preservou campos antigos. Não reprecificar ou migrar clientes automaticamente. Três órfãos DEV ficam em saneamento histórico; não se inventou owner. |
| Aquisição Preview não deve ir a Production | Landing `montarDestinoDaPonte` escolhe somente destinos constantes por host: `qoro.dev/www` → app público; Preview do time/localhost → app Preview imutável | UTM não altera host; desconhecido fica bloqueado; fallback sem JS volta à home. Não foi alterado o destino público de produção. |

O catálogo anual e as funções de cálculo continuam no código para contratos existentes/fase futura. A documentação histórica de outubro contém fotografias “não implementado”; a atualização atual e os relatórios datados prevalecem, sem converter resultado local em prova Production.

## Turnstile: gate técnico preparado e gate real da janela

Código: `src/contexts/onboarding/internal/turnstile.ts`, `e2e/signup-session-api.spec.ts` e `scripts/turnstile-production-gate.ts`. O Siteverify é server-side e falha fechado em configuração/rede/resposta inválida **quando o risco é moderado**. Baixo risco dispensa o desafio por desenho; alto risco é recusado. Testes unitários cobrem token vazio, ausência de secret, retorno inválido, falha HTTP/rede/JSON, timeout e nova verificação no replay. Não há cache local que transforme o segundo uso em sucesso.

Os positivos/negativos reais com chaves de teste em Previews separados já passaram e não foram repetidos. Os dois SKIPs da CI isolada por ausência de chaves permanecem SKIP. A [Cloudflare](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) documenta validade de 300 segundos e uso único, com `timeout-or-duplicate` na repetição.

**Ajuste do procedimento:** com `SIGNUP_ENABLED=false`, o POST do cadastro deve responder 503; não é possível exigir 201 nesse endpoint fechado para provar Turnstile. Não reabrir o cadastro só para resolver esse conflito de teste. Na janela autorizada:

1. Conferência humana no Cloudflare: widget ativo, domínio `app.qoro.dev`, par de chaves correspondente. A presença das variáveis e a ausência de chave dummy no bundle Production já foram verificadas; não repetir leitura de valores.
2. Engenharia obtém um token fresco do widget real no domínio correto por interação legítima do navegador, sem gravá-lo em trace/log/artifact. Se o formulário fechado não renderizar o widget, preparar execução controlada do widget no navegador desse domínio, sem expor um endpoint público de diagnóstico ou enfraquecer a aplicação.
3. `scripts/turnstile-production-gate.ts` recebe token por stdin e secret real por ambiente de processo protegido, com `TURNSTILE_PRODUCTION_GATE=approved`. Confere sucesso e `hostname=app.qoro.dev`, repete o mesmo token e exige `timeout-or-duplicate`, depois exige recusa de token falso. Não cria usuário/sessão Qoro nem altera o cadastro. O script foi preparado/typechecked; **não executado com chaves reais nesta rodada**. Quem executar registra somente PASS/FAIL e horário, sem conteúdo de token.
4. Após PASS, autorizar reabertura/deployment e smoke do fluxo moderado da aplicação, com fixture sintética e cleanup. Não considerar o Siteverify isolado prova da jornada inteira de cadastro.

## Gemini: resultado técnico e o que falta no painel

`src/lib/env.ts` e `src/lib/ai/gemini.ts` usam por padrão **`gemini-3.6-flash`**, selecionável por `GEMINI_MODEL`. Este é o default do código; o modelo efetivo de Production depende da variável do deployment. Não foi feita chamada com dados de paciente nem troca de credencial/modelo nesta rodada.

O provider tem timeout (15s por padrão), não devolve corpo de erro e emite `ai.provider.error` com classe/status sanitizados. O consumidor repete resposta vazia e 5xx até três tentativas com backoff; 402/429 são preservados como erros 4xx e **não** repetidos em loop curto. Foram adicionadas regressões explícitas para ambos. Após falha, o consumidor usa fallback operacional e pode escalar a humano. Isso mantém uma resposta operacional, mas não comprova a entrega dessa resposta nem que exista recepção humana disponível.

Há métricas, rollups e saved-search documentados; não foi confirmado um destino humano ativo de alertas da conta Google nem configurado aviso externo. Não confundir emissão de métrica com alerta recebido. O controle por clínica/custo não é substituto de limites RPM/TPM/RPD do projeto Google. Sem chave, o runtime nega a chamada antes de fetch; **não foi identificada uma chave geral de produto que isole toda a IA com UX contratual apropriada**. Remover a API key não é plano de desativação seguro. Se o tier não cumprir privacidade/capacidade, o recurso conversacional deve continuar NO-GO até regularização ou decisão explícita de um modo operacional com handoff, que precisa de implementação e prova próprias.

Somente no painel Google falta comprovar: ID do projeto da chave efetivamente usada em Production, modelo disponível, tier, billing, saldo/estado, limites RPM/TPM/RPD e alertas/orçamento. As condições dependem da conta: [billing](https://ai.google.dev/gemini-api/docs/billing), [limites](https://ai.google.dev/gemini-api/docs/rate-limits) e [privacidade/preços](https://ai.google.dev/gemini-api/docs/pricing). Não foi contratado crédito nem alterado faturamento. A landing afirma API paga e condições correspondentes; essa afirmação **exige a conferência do tier antes de tráfego de pacientes**.

## Revisão comercial/jurídica humana remanescente

- Aprovar a versão mensal final: 197/397, adicional 147, limite 5, equipe 3 e trial desde Auth; sem contratação anual nova.
- Aprovar cancelamento/renovação e comunicação para legados, sem tocar no desconto vitalício.
- Confirmar termos de uso de mensagens no tier Google efetivo e custos próprios Meta/Asaas, sem prometer isenção ou preço de terceiro não contratado.
- Conferir comunicação de devolução de sinal: regras comerciais da clínica e registro de devolução não são promessa de refund automático pelo Qoro. A engenharia não deve reativar refund automático só para harmonizar uma frase.
- A landing pública ainda possui a oferta anterior de limites/trial. Essa divergência só será eliminada no rollout conjunto; Preview aprovado não é correção já publicada.

Não há decisão comercial nova tomada neste documento. Redações e termos vigentes precisam de aprovação competente; testes não substituem análise jurídica.


## Atualização do titular e clareza da oferta — 29/10/2026

O titular não autorizou contratação adicional. Informou que entende e considera aceitável neste momento a perda potencial entre backups; registrou-se esse aceite limitado, sem estendê-lo ao RTO desconhecido, custódia fora da máquina, falha da rotina ou autorização de Production. O destino independente continua sem definição.

O screenshot Turnstile mostra `app.qoro.dev (Spin)`, Managed, três hostnames; a lista não comprova quais domínios estão autorizados nem o par de chaves. A ação humana foi reduzida a abrir Settings/Hostname Management do widget e informar somente os hostnames. O gate real positivo/replay/negativo permanece pendente.

Gemini pré-pago ativo e saldo de R$ 23 foram informados pelo titular, não por readback administrativo. Não solicitar compra adicional; faltam correlação do projeto da chave de Production, capacidade e alertas. Não converter relato de faturamento em prova E2E do provider.

A apresentação da oferta foi alinhada para dizer **médicos** e **equipe administrativa**, com cotas separadas: Consultório 1 médico + até 3 acessos administrativos; Clínica 2 médicos + até 3 acessos administrativos, R$ 147 por médico adicional até 5 médicos. O backend não foi alterado: papel `doctor` conta mesmo antes do CRM; owner/gestor com CRM não vazio conta como médico, sem duplicar a cota administrativa; sem CRM conta como administrativo. Recepção/financeiro não ganham capacidade médica por CRM residual. Esse dado não é validação do conselho profissional. Preços, cotas, planos legados e desconto vitalício permanecem inalterados.


### Verificação da clareza de médicos e equipe

Alterações de apresentação: pergunta e resumo do cadastro, rótulo da triagem no admin, seleção de plano e resultado da calculadora. Identificadores da API, preços, regras de cobrança, CRM e limites no banco não mudaram. A seleção mostra as cotas apenas para a família 2026; não aplica as cotas novas aos planos legados.

- **PASS local:** 91/91 testes em seis arquivos, incluindo 15 do predicado médico, 42 do questionário, 14 da seleção (com nova regressão de cotas), 10 da continuação, 6 do admin e 4 da calculadora.
- **PASS local:** ESLint e Prettier dos arquivos alterados; inventário AST sem superfícies novas sem guard, variáveis públicas divergentes ou rotas regredidas.
- **PASS navegador local:** Chromium em home e `/precos`, desktop 1440px e celular 375px, 4/4. Confere preços, médico extra, duas cotas administrativas, regra de dono/gestor com CRM, exemplo 2 médicos + 3 administrativos por R$ 397, CTAs e ausência de overflow. Foram inspecionadas capturas da seção pública, sem sessão ou PII.
- **PASS landing local:** TypeScript, ESLint e build completo; bridge 28/28, FAQ visível/JSON-LD (261 perguntas), llms, links, HTML, conversão 2/2 e segurança 20 checks. Há 17 avisos anteriores de FAQPage no blog; não são novos nem foram suprimidos.
- **FAIL de ambiente no TypeScript global local do app:** três diagnósticos em `ai-agent/tools/registry.ts` e `messaging/business-profile-contract.ts`, ambos intocados nesta alteração. O `node_modules` deste worktree é uma junction para o principal com Zod 3.25.76; o manifesto desta branch exige Zod ^4.6.6. Não foi alterada a junction nem instalado pacote no ambiente compartilhado. O build/typecheck global do candidato deve ser confirmado na CI com o lockfile correto; os 91 testes direcionados não o substituem.
- **CI/Preview do novo commit:** conferir o SHA final nos checks dos PRs #42 e #3; não atribuir o PASS anterior ao novo código sem execução. Nenhum Checkout, cobrança ou restore foi repetido por uma mudança de copy.


### Esclarecimento de vagas e total de logins — 29/10

| Contratação | Médicos | Administrativos incluídos | Máximo de pessoas/logins | Mensalidade |
| --- | --- | --- | --- | --- |
| Consultório | 1 | Até 3 | 4 | R$ 197 |
| Clínica base | 2 | Até 3 | 5 | R$ 397 |
| Clínica com 3 médicos | 3 | Até 3 | 6 | R$ 544 |
| Clínica com 4 médicos | 4 | Até 3 | 7 | R$ 691 |
| Clínica com 5 médicos | 5 | Até 3 | 8 | R$ 838 |

“Até 5 médicos” não significa cinco médicos incluídos no preço base nem cinco logins totais. O adicional compra **vaga médica**, não acesso de atendente. Os três administrativos já estão incluídos; o quarto não é contratável online nesta oferta. A hipótese antiga de R$ 79 por login administrativo foi revogada e não deve aparecer como compra disponível. Dono/gestor com CRM ocupa uma única vaga médica; sem CRM, ocupa um dos três administrativos. O papel Médico reserva vaga médica mesmo antes do CRM. Cadastro de CRM não equivale a validação automática do conselho. Nenhuma regra comercial, preço ou limite foi alterado por este esclarecimento.


### Complemento solicitado: 5 logins base versus 5 médicos

Após a dúvida do titular, os cards e o cadastro passaram a mostrar também o **total de pessoas**: Consultório 1+3=4; Clínica base 2+3=5; Clínica ampliada até 5+3=8. “Até 5 médicos” é o teto após comprar vagas médicas, não o número incluído nos R$ 397. Os três administrativos estão incluídos e não precisam ser comprados; não há compra online de um quarto administrativo. O código calcula os totais a partir da cota de médicos e da cota administrativa, sem mudar os limites.

Reteste das partes afetadas: **34/34 PASS** (15 predicado, 14 seleção e 5 calculadora), incluindo novo caso 2 médicos + 3 administrativos por R$ 397 e 5 + 3 por R$ 838, com recusa de quarto administrativo. Typecheck/lint/build da landing passaram novamente. O navegador contra o build atualizado passou **4/4** (home/preços × desktop/mobile), exigindo os totais 4/5/8 e a inclusão dos administrativos. O ambiente de controle da sessão Cloudflare do usuário retornou `browser access host unavailable` e `native pipe unavailable`; não foi possível abrir os hostnames pela interface, nenhuma configuração foi alterada. A ação humana continua restrita à conferência de Hostname Management, sem repetir lista de widgets, compras ou login Supabase.


Redação final escolhida pelo titular: **R$ 397/mês: 2 médicos + até 3 pessoas da equipe administrativa = até 5 logins**, com os itens **Médicos extras: R$ 147/mês por médico, até chegar a 5 médicos + 3 administrativos = até 8 logins** e **Atendente: já está incluído nos 3 acessos administrativos. Hoje não há compra online de um quarto acesso administrativo**. Aplicada na explicação da landing e nos esclarecimentos do app, sem mudar valores ou limites.

Reteste final dessa redação: **92/92 testes direcionados PASS**, lint/formatação e inventário sem divergências; landing typecheck/lint/build PASS e Chromium local **4/4 PASS**, com assertions para as duas frases numéricas e o atendente incluído. Checks e navegadores do SHA final serão registrados no PR, sem inferir PASS de um commit anterior.

## Atualização — exclusividade da nova Clínica (29/10/2026)

Decisão aprovada: ajustes de permissões por pessoa, relatório por médico e repasse por procedimento pertencem somente à **Clínica da nova oferta** (2–5 médicos). O Consultório mantém permissões padrão por função, relatórios gerais e financeiro. **Clínica e Pro legados conservam seus direitos**, inclusive sem mudar preço ou contrato vitalício. A landing usa “Ajuste de permissões por pessoa” para não sugerir que segurança por função seja um adicional.

A proteção inclui actions, consultas, relatório mensal, PDF e resolução de claims no banco. Foi necessária a migration **0133**: o candidato passa a ter **134** entradas; produção continua sem aplicação autorizada, com baseline histórica até 0118. A prova real anterior 0119–0132 não deve ser rebatizada como 0119–0133. Resultados atuais, limites e execução do Preview estão no [registro de entitlements](../quality/entitlements-clinica-2026-10-29.md). Não é necessário novo pagamento Sandbox para esse gate.

**Evidência fechada em 30/10:** cenário 13 do E2E passou 1/1 em Preview/DEV, cobrindo quatro estados de plano e limpeza sem resíduos. CI de código `09e78f09`: 5.723/5.723, build/typecheck/lint e segurança PASS. Landing `ca12a68`: 4/4 no Preview. Migração 0133 aplicada somente no DEV, com hash e journal 134 conferidos. Evidência detalhada no registro de entitlements acima. Isso não é GO de produção.

## Consolidação corrente — 30/10/2026

A nova [auditoria de fechamento](../quality/fechamento-definitivo-oferta-2026-10-30.md) encerrou a lacuna da 0133 no backup real: **15/15 migrations**, campos legados preservados e rollback/concorrência comprovados. O Auth real sintético passou 14 verificações com **134 migrations**. O E2E passou também com a sessão anterior ao downgrade, sem refresh e sem gravação. A configuração da IA tem fallback operacional já existente; corrigiu-se a leitura para que erro/corrupção não reative Gemini. As fotografias anteriores de 14 migrations e ausência de mecanismo identificado de fallback são históricas, não o estado corrente. Produção não foi alterada.

Cofre/cópia independente, configuração externa Auth, desafio real Turnstile, painel Gemini, RTO/contingência e aprovações seguem no [guia humano simplificado](../runbooks/acoes-manuais-pendentes-pricing-2026-10.md). A ausência de PITR e o aceite limitado do intervalo entre backups não encerram esses gates.
