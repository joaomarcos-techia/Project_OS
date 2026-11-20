# Handoff do PR #56 (ciclos 7 e 8, 19–20/11/2026)

Para os responsáveis pelo cadastro e pelo domínio financeiro (#53), por quem integra na `main`, e
para o fundador. Nada aqui foi aplicado fora do PR #56: não houve push na `main`, nem alteração no
#53 ou no #55, nem merge.

| Item | Arquivo | Estado em 20/11 | Decisão de quem |
| --- | --- | --- | --- |
| P-28: senha inicial preservada na confirmação por código | `p28-signup-email-confirmation.patch` | **já no #53** (`a7931315`); falta a `main` | integração na `main` |
| P-29: conta confirmada sem senha volta pelo "Esqueci a senha" | `p29-recuperacao-conta-pendente.patch` | no #56 (`26cb73ff`); aplica limpo no #53 e na `main` | dono do cadastro (#53) |
| P-29: premissas do spec oficial | aplicado no #56 (`947426b1`), com autorização do fundador | spec oficial verde no Preview | — |
| P-19: contrato de concorrência do Caixa | seções C8.4 e 3 | UI pronta; servidor pendente | domínio financeiro |
| P-27: conta compartilhada `2E2_UI` | seções C8.3 e 4 | recuperação coordenada pelo #53 | #53 |
| Cartão incorporado na assinatura AbacatePay | seção 5 | decisão: página hospedada | fundador |

## Ciclo 8 (20/11/2026): leia primeiro

### C8.1 Prioridade para o #53 antes do C3

- **P-28:** o #53 `fad3d5d3` já tem a correção (`a7931315`, idêntica à do #56). Nada a fazer no
  #53. Na `main` ela ainda falta e precisa entrar antes de reabrir a aquisição.
- **P-29, recuperação da conta confirmada sem senha** (defeito real, achado no Preview neste ciclo):
  uma conta que confirmou pelo link e saiu antes de criar a senha ficava sem saída self-service.
  - "Esqueci a senha" caía em "Link inválido": o portão do recovery recusava todo marker `pending`
    fora de `uncertain`.
  - Recomeçar o cadastro com o mesmo e-mail era mudo, porque o aviso de conta existente só ia para
    quem já entrava. **Esse aviso só existe na linhagem do #56; no #53 e na `main` o recomeço
    continua mudo para todos.**

  Atinge a conta legada não confirmada (o Auth v2.198.0 apaga a senha dela na confirmação) e
  qualquer conta v1 sem senha que confirmou pelo link e não criou a senha.

  A correção para o #53 e a `main` (`p29-recuperacao-conta-pendente.patch`, 4 arquivos, sem nada
  financeiro):
  - `ensureReadyOwnedSignupAuthBinding` dá o grant curto de recovery à conta **confirmada** com
    marker `pending`, para a mesma referência do draft possuído em `completed`/`uncertain` (nunca
    `reserved`), ou o grant órfão de uso único quando o draft expirou;
  - a ação órfã de `reset-password` aceita `pending` além de `set`.

  Continuam recusadas: conta não confirmada, convidada, banida, com perfil (outro ramo) ou de
  outra referência. O link de recovery prova a posse do e-mail como o link de confirmação, que já
  leva a "Crie sua senha". Mutação: remover cada salvaguarda reprova um teste.
- **Aplicar no #53:**

  ```
  git fetch origin ui/otimizacao-ui-final-20261114
  git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/p29-recuperacao-conta-pendente.patch | git apply --check
  git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/p29-recuperacao-conta-pendente.patch | git apply
  ```

- **Composições descartáveis de 20/11** (heads atuais; fora do Git):

  | Base | Patches | Onboarding, cadastro, auth, login, reset, `lib/auth` | `tsc` |
  | --- | --- | --- | --- |
  | `main` `5620a098` | P-28 + P-29 | 93 arquivos, 1554/1554 | 0 erros |
  | #53 `3210d141` | P-29 (P-28 já presente) | 98 arquivos, 1663/1663 | 0 erros |

  Os arquivos-base do patch do P-29 não mudaram entre o `3210d141` e o `fad3d5d3` (só documentação).
- **Critério para considerar o cadastro pronto para o C3:**
  1. P-28 presente (já está);
  2. `@code-flow` e `@code-checkout` oficiais verdes num Preview do #53;
  3. se a clínica piloto puder usar um e-mail já cadastrado e não confirmado na Qoro, aplicar
     também o patch do P-29 e rodar no Preview do #53 o teste oficial "conta legada que abandona
     depois do link recupera o acesso…". Ele já está no spec do #56 e entra com a integração.

  Pelo fluxo atual (código, senha inicial), uma clínica nova não depende do P-29.
- **O que falta executar** (dono do #53): os itens 2 e 3 num Preview do #53.

### C8.2 Spec oficial do cadastro (P-29)

O fundador autorizou a correção cirúrgica das premissas comprovadamente obsoletas (20/11).

- **Premissas corrigidas** (só 5 linhas removidas, cada uma trocada por uma asserção mais forte):
  - aba recarregada pede o e-mail, vazio (#47);
  - `/cadastro/confirmado` pronto redireciona ao plano (#47);
  - "Plano salvo" só logo depois de salvar (prancha aprovada);
  - senha legada não sobrevive à confirmação do dono (Auth v2.198.0) e nunca deu acesso
    (`email_not_confirmed`).
- **Regressões novas:**
  - salvamento real com o aviso "Plano salvo" no `@code-checkout`;
  - conta legada abandonada recupera o acesso pelo aviso e pela redefinição;
  - link adulterado, link apontado para outro draft e link já consumido não confirmam, não abrem
    sessão e não tocam o outro draft.
- **Resultado no Preview `947426b1`:** **14 de 14 PASS** no spec oficial corrigido (Preview `947426b1`; o `@code-checkout` final com o spec do `49c432bd`): link no telefone, destinatário, conta legada, conta legada que abandona (novo), links negativos (novo), link vivo, reenvio, `@code-checkout` (com o aviso do salvamento real), `@code-flow`, `@recovery-flow` ×2, confirmado sem sessão e cadastro expirado; resíduo 0. Duas tentativas anteriores do `@code-checkout` falharam por causas identificadas: o limitador de criação de sessão (10/IP/15 min) e um 401 causado pela retenção da requisição no próprio teste (técnica trocada no `49c432bd`). Os fluxos de oferta com pagamento manual não foram executados (exigem flags manuais).

### C8.3 P-27: recuperação coordenada pelo #53

Decisão do fundador (20/11): a recuperação da `2E2_UI` é coordenada pelo agente do #53.

- **Conta:** a identificada pelas variáveis `2E2_UI_EMAIL`/`2E2_UI_PASSWORD` dos `.env.local`. Não
  repita o endereço em documento.
- **Estado (DEV, leitura de 19/11):**
  - recriada pelo cadastro self-service em 18/11 às 01:13:37 UTC;
  - confirmada às 01:14:23 pela prova de recovery sem a correção do P-28, quando o hash ficou vazio;
  - tem perfil e duas sessões abertas sem senha.
- **Dependências:** `e2e/offer-legacy-account-preview.spec.ts` (aceita
  `E2E_LEGACY_EMAIL`/`E2E_LEGACY_PASSWORD`) e `scripts/probe-pricing-preview-browser.ts`. O #56 não
  depende dela.
- **Procedimento legítimo:** "Esqueci a senha" na tela de entrada, até a caixa da conta.
  - A conta tem perfil, então segue o ramo `profile`.
  - No Preview, o link usa o `APP_BASE_URL` do ambiente (hoje outro deploy). Abra o mesmo caminho e
    fragmento no deploy desejado, ou faça pelo app local.
  - Não use a Admin API para inventar senha sem a autorização do fundador.
- **Cuidados:** a senha nova entra só nos `.env.local` de quem usa a conta; nunca em commit,
  documento ou chat. Não peça a senha antiga.
- **Testes depois da recuperação:** login por senha; o spec que depende dela; uma sonda logada
  simples.
- **Recomendação:** contas sintéticas dedicadas por fluxo, criadas e removidas pelo próprio
  teste, como a `ui-fixture` do #56, em vez de uma credencial compartilhada.

### C8.4 P-19: matriz de testes de integração (domínio financeiro)

O servidor é a autoridade sobre o pagamento efetivo. O valor esperado vindo da tela é só condição
de concorrência.

| # | Cenário | O que a UI do #56 já garante | O que o servidor precisa provar |
| --- | --- | --- | --- |
| 1 | Duas abas | cada aba tem sua chave; recusa de situação recarrega e descarta a chave | só uma confirmação aplica; a outra recebe conflito sem gravar |
| 2 | Dois dispositivos | idem | idem, com sessões diferentes |
| 3 | Dois operadores autorizados | idem | idem; a auditoria registra quem aplicou |
| 4 | Valor alterado entre leitura e confirmação | — | `valorPagoEsperado` velho dá conflito, e o estado não muda |
| 5 | Clique duplo | botão desabilitado durante a resposta | a mesma chave devolve o resultado gravado |
| 6 | Timeout | mensagem de resultado desconhecido; mesma chave na repetição | a repetição com a chave não aplica duas vezes |
| 7 | Resposta perdida | idem (`8f73258a`) | idem |
| 8 | Requisição repetida | a chave sobrevive ao reload por 30 min | idempotência por chave |
| 9 | Conflito resolvido após reload | lista atualizada; nova operação com chave nova (`430ea8ca`) | aceita a nova operação sobre o estado atual |

Concorrência real (duas transações em paralelo) e o total pago nunca passando do valor do
lançamento ficam no teste do servidor. **P-19 continua PARTIAL até o servidor implementar e
homologar.**

### C8.5 P-26 e P-23

- **P-26 fechado** com prova isolada, sem aviso global:
  - a página real `admin/config` renderizada com uma fonte de avisos simulada, exibida dentro da
    página e do CSS reais do Preview (JavaScript desligado), nos dois temas, em 1440 e 390 px;
  - ponto cinza 3,30:1 / 3,86:1;
  - o âmbar tinha 2,26:1 no tema claro e passou para `warning-600` (`a1a128fb`): 6,33:1 no claro e
    10,51:1 no escuro.
- **P-23 delimitado:**
  - o #418 exige alteração externa do DOM (um `<div>` estranho no topo do `<body>` antes da
    hidratação);
  - sem ela, 0 em 60 cargas;
  - depois do erro a página funciona (painel, sidebar e navegação).
  - Uma marca no Sentry não distingue a causa: no instante da captura o React já refez o `<body>`
    e o elemento estranho sumiu. Por isso não foi implementada.
  - **Reabrir se:** #418 em navegador limpo (CI ou perfil sem extensões), mensagem diferente de
    `args[]=HTML`, ou rota que reproduza sem DOM alterado por fora.

### C8.6 Integração (heads de 20/11)

| Frente | Head | Conflitos |
| --- | --- | --- |
| #53 | `fad3d5d3` | **9 arquivos**: os 8 de antes + `cadastro/signup-identity.tsx` |
| #55 | `ed2fd056` | 9 arquivos, a mesma lista; prevalece `l.valor - l.valorPago - l.valorGlosado` em `financeiro/page.tsx` |
| #57 | `93a79601` | 0 |

Ordem proposta, que não é autorização de merge: #53 → #56 → #55.

### C8.7 Cartão na assinatura AbacatePay

Decisão do fundador (20/11): o checkout personalizado do Qoro cobre toda a jornada que
controlamos, e a etapa do cartão fica na página hospedada do provedor. A pergunta da seção 5
fica como consulta de evolução, para o fundador enviar quando quiser. A integração atual não
depende dela.

As provas são separadas:
- E2E Asaas Sandbox prova o checkout Asaas;
- E2E da UI prova a interface;
- a homologação AbacatePay SaaS pertence ao #53.

## 1. P-28: propagar para o #53 e a `main`

**Defeito.** O Supabase Auth v2.198.0 (DEV hoje; commit `a7e97d66`, "clear existing password on
recover") apaga a senha de um usuário **ainda não confirmado** quando um token de recovery ou magic
link é verificado (`recoverVerify` → `ClearUnconfirmedPassword`). O cadastro por código cria o
usuário com a senha inicial, sem confirmar, e confirma pela prova de recovery: a senha some e o
login por senha falha logo depois do código.

**Confirmado nas heads de 19/11:** `signup-email-code.ts` da `main` (`5620a098`) e do #53
(`837709ff`) é idêntico à versão anterior à correção. Não há chamada `email_confirm`.

**Correção** (o patch junta `6e157eaa` e `122b6286`; toca só dois arquivos):

- `src/contexts/onboarding/internal/signup-email-code.ts`: antes da prova de recovery, e só quando
  a senha inicial foi criada por esta mesma sessão (`hasInitialSignupPassword`, ou seja,
  `initial_password_ref` igual ao `signupRef` da reserva) e a conta ainda não está confirmada, o
  e-mail é confirmado pela Admin API (`updateUserById({ email_confirm: true })`). O retorno precisa
  trazer o mesmo id, o **mesmo e-mail provado**, a confirmação e o vínculo intacto; senão o fluxo
  falha fechado. A confirmação administrativa só grava `email_confirmed_at` (GoTrue `user.Confirm`)
  e não toca na senha.
- `signup-email-code.test.ts`: 42 testes, 14 deles adversariais.

**Revisão de segurança** (o e2e passar não é a prova):

| Exigência | Como o código garante | Prova |
| --- | --- | --- |
| Código validado antes da ação privilegiada | `reserveSignupEmailCode` sob `FOR UPDATE`: hash do cookie, hash do e-mail, versão do fluxo, prazo absoluto, HMAC do código com `signupRef` e época, tentativas | unit (repositório rejeitado = nenhuma ação); e2e: outra conta 422, terceiro 410, expirado 422 |
| Código da conta e da operação certas | o vínculo `qoro_self_service_signup` é `app_metadata` (só a Admin API escreve) e precisa apontar para esta reserva | unit: rebind, sessão abandonada, terceiro pronto |
| E-mail não trocado entre validar e confirmar | o retorno do admin precisa ter o mesmo e-mail provado (`122b6286`) | unit, com mutação |
| Senha definida pelo fluxo legítimo | `initial_password_ref` é gravado na criação, na mesma requisição que recebeu a senha e emitiu o cookie; um rebind preserva a referência antiga e não herda confiança | unit |
| Código expirado ou consumido recusado | política (prazo, consumo, 5 tentativas) + estado `reserved`/`verified` sob trava de linha | unit da política; e2e expirado 422; replay 200 sem nova mutação ou recusa 410/429 |
| Concorrência não confirma outra conta | a trava de linha serializa; a segunda requisição vê `reserved` | e2e: duas submissões simultâneas = [200, 409], uma confirmação (2 de 2 execuções) |
| Sem confirmação de usuário arbitrário | sem reserva válida e sem vínculo desta sessão não há chamada | 10 casos unitários |
| Service Role fora do navegador | `import 'server-only'`; teste de arquitetura `no-browser-supabase` | já no CI |
| Sem account takeover | quem cria a senha e quem prova o e-mail são a mesma sessão (cookie + código do e-mail). Na conta pré-criada por terceiro, a sessão do dono não é a dele: sem confirmação administrativa, a prova de recovery apaga a senha alheia (proteção do Auth mantida) | unit "cadastro abandonado" |
| Logs sem segredo | só `stage`; erros com e-mail, código ou token não vazam | unit |

Mutação: sem a checagem de e-mail reprovam 1 teste; sem exigir a senha desta sessão, 6; com a
confirmação depois da prova, 5. **Alternativas oficiais avaliadas:** `generateLink` do tipo
`signup` exige a senha em texto (o servidor não a guarda); `invite` desvirtua o fluxo.
`email_confirm` pela Admin API é o caminho documentado para quando o app prova a posse do e-mail
por conta própria.

**Composição descartável testada** (patch aplicado sobre as heads de 19/11, fora do Git):

| Base | `git apply` | Testes de onboarding, cadastro, auth e login | `tsc` |
| --- | --- | --- | --- |
| `main` `5620a098` | limpo | 91 arquivos, 1513/1513 | 0 erros |
| #53 `837709ff` | limpo | 93 arquivos, 1581/1581 | não rodado (dependências do #53) |

Com o código **sem** a correção e os testes novos, 9 testes reprovam: as regressões pegam o defeito.

**Sequência segura:**

1. O dono do #53 aplica o patch a partir da branch do #56, sem trazer outros arquivos:
   `git fetch origin ui/otimizacao-ui-final-20261114 && git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/p28-signup-email-confirmation.patch | git apply --check && git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/p28-signup-email-confirmation.patch | git apply`.
2. Roda os testes acima e o `@code-flow` oficial num Preview do #53. No #56 ele passou sem
   alterar o spec, nos Previews `6e157eaa` e `d9770192`.
3. Na `main`, entra junto com o #53 (ordem de integração #53 → #56 → #55) ou, se o fundador
   preferir, num PR isolado `fix(signup): P-28` com os mesmos dois arquivos.

**Urgência.** Em Production, a aquisição está fechada, então nenhum usuário real passa pelo
cadastro por código hoje. Convites de equipe criam a conta sem senha, e o dono da clínica nasce
confirmado: nenhum dos dois é afetado. A versão do Auth de Production não foi consultada (exigiria
chave de Production). **A correção precisa estar na `main` antes de reabrir a aquisição.** Por
isso não proponho hotfix imediato; se o fundador quiser antecipar, o PR isolado do passo 3 serve.

## 2. P-29: fluxos de confirmação pelo link

**Causa raiz** (nenhuma das duas é defeito do app):

| Testes do spec oficial | Onde falham | Causa |
| --- | --- | --- |
| o link confirma no telefone; o destinatário confirma e cria a senha; o código do link vivo; reenvio | `waitForOriginalHandoff`, que exige que a aba original **não** peça o e-mail; o reenvio estoura 420 s porque a aba pede o e-mail antes de enviar | O PR #47 (`7b9a7805`, na `main` desde 04/11) trocou o início v1 pela UI por uma emulação via API seguida de `page.reload()`. O e-mail vive só na memória da aba (`continuationCredentials`, preenchida só pelo formulário v1, que não existe mais), então a aba recarregada sempre pede o e-mail. A premissa é inalcançável desde o #47 |
| conta legada não confirmada | "o callback sobrescreveu a senha legada" | Auth v2.198.0: a prova de recovery apaga a senha de origem desconhecida de uma conta não confirmada. Hash medido no DEV: bcrypt de 60 caracteres antes do callback e vazio depois, com a senha nova também recusada (o app não escreveu senha). O teste exige o comportamento que o Auth passou a recusar por segurança |

**Proposta** (`p29-spec-premissas-PROPOSTA.patch`, 25 linhas, **não aplicada**: o spec é do
cadastro, e mudar asserções de um teste que falha exige a decisão do dono):

- a aba recarregada pede o e-mail, com o campo vazio, e os testes preenchem o e-mail junto com a
  senha e o código (link vivo, reenvio);
- no reenvio, o primeiro clique revela o campo de e-mail;
- na conta legada, a asserção é **invertida e endurecida**: a senha legada não pode mais
  autenticar depois que o dono do e-mail confirmou.

Nenhuma verificação de segurança sai: o código continua obrigatório, o link sozinho continua sem
autorizar a aba, e a aba anônima continua com 401.

A proposta tem mais duas trocas, achadas quando as primeiras premissas saíram do caminho:

- **`/cadastro/confirmado` com a conta pronta** redireciona para a continuação desde o #47, em vez
  de mostrar o link "Escolher plano". A proposta confere o redirecionamento e a ausência do campo
  de senha.
- **"Plano salvo"** (do #56, não do #47): na prancha aprovada do checkout, o aviso só aparece logo
  depois de salvar nesta visita. Depois do reload o plano salvo está no resumo. A proposta confere
  o botão "Continuar para o checkout", a mesma asserção do `@code-flow`.

**Resultado no Preview `122b6286`** (cópia proposta em `.tmp/e2e-diag/p29-proposta.spec.ts`,
**não oficial**, mesmas travas do runner, resíduo 0):

| Teste | Spec oficial intacto | Cópia proposta |
| --- | --- | --- |
| O link confirma no telefone, mas só o código libera a aba original | FAIL (premissa do #47) | **PASS** |
| O destinatário confirma e cria a senha uma única vez no telefone | FAIL (premissa do #47) | **PASS** |
| Conta legada não confirmada | FAIL (Auth v2.198.0) | **PASS** |
| O código do link vivo recupera o segundo draft | FAIL (premissa do #47) | **PASS** |
| Reenvio entrega um link novo e invalida o anterior | FAIL (estouro de 420 s, premissa do #47) | **PASS** |

Ou seja, os fluxos funcionam no Preview, e o que falha são as premissas do spec. **O P-29 só vira
PASS oficial quando o dono do cadastro aprovar e aplicar a proposta.**

## 3. P-19: contrato de concorrência do Caixa (domínio financeiro)

**Lado da UI pronto no #56:**

- mesma aba: a chave por operação sobrevive ao reload por 30 min (`8f73258a`);
- resposta perdida: a mesma chave é reaproveitada, e o servidor devolve o que gravou;
- duplo clique: o botão fica desabilitado enquanto o servidor responde;
- recusa por mudança de situação ou conflito: fecha o painel, recarrega a lista e descarta a chave
  (`430ea8ca`).

**Falta no servidor:** outra aba ou outro aparelho tem outra chave e pode registrar de novo.

**Contrato proposto para `confirmPayment`:**

1. A entrada ganha `valorPagoEsperado` (ou a versão do lançamento), lido pela tela quando abre o
   painel. É condição de concorrência, **não** fonte do valor pago.
2. A aplicação faz uma comparação atômica no estado persistido:
   `UPDATE lancamentos SET valor_pago = valor_pago + $valor … WHERE id = $id AND valor_pago = $esperado`.
   Zero linhas significa conflito.
3. No conflito, a resposta lança `LancamentoStateError` (a UI já trata `code: 'state'`) ou um
   erro novo mapeado para `state`/`conflict` em `caixa-types.ts`.
4. A idempotência por chave continua valendo: a mesma chave devolve o resultado gravado, mesmo
   que o valor pago já tenha mudado por causa dela.

**Testes de integração a escrever no domínio financeiro:**

- duas confirmações com chaves diferentes e o mesmo `valorPagoEsperado`: só uma aplica, e a outra
  recebe conflito sem gravar;
- repetição com a mesma chave depois do sucesso: devolve o resultado, sem segunda aplicação;
- `valorPagoEsperado` velho: conflito, e o estado atual não muda;
- concorrência real (duas transações em paralelo): o total pago nunca passa do valor do lançamento;
- consumidores do #53 e o ledger: nenhuma mudança de saldo além da aplicação única.

**P-19 não recebe PASS sem a proteção de servidor.**

## 4. P-27: conta compartilhada `2E2_UI`

**Estado** (lido no DEV em transação somente leitura, sem imprimir e-mail, senha ou hash):

- recriada pelo **cadastro self-service** em 18/11, às 01:13:37 UTC (tem o vínculo do cadastro);
- confirmada às 01:14:23 pela prova de recovery do cadastro por código, sem a correção do P-28.
  Foi aí que o hash ficou vazio, pelo mesmo mecanismo do P-28;
- tem 2 sessões (17:00 e 23:18) abertas sem senha e 1 perfil.

No ciclo 6 registrei o horário errado (23:18): esse foi um login posterior.

**Quem depende dela:** `e2e/offer-legacy-account-preview.spec.ts`, que aceita `E2E_LEGACY_EMAIL`
e `E2E_LEGACY_PASSWORD` como alternativa, e `scripts/probe-pricing-preview-browser.ts`. Os dois
arquivos são idênticos na `main`, no #53 e no #55. O #56 não depende mais dela: as sondas logadas
usam uma conta sintética própria, com limpeza e conferência de resíduo.

**Recuperação coordenada:**

1. O fundador define quem executa (sugestão: o agente do #53, principal usuário da conta).
2. Caminho legítimo: o fluxo "Esqueci minha senha" do app até a caixa de entrada da conta, ou a
   redefinição pela Admin API pelo agente designado.
3. A nova senha entra só nos `.env.local` de quem usa a conta, nunca em commit ou documento.
4. Alternativa sem recuperar: o #53 usa `E2E_LEGACY_EMAIL` com uma conta legada sintética própria
   e deixa a `2E2_UI` para uso manual.

## 5. Cartão incorporado na assinatura AbacatePay

**Conclusão: B, checkout incorporado não suportado para assinaturas** (documentação oficial de
19/11):

- `POST /subscriptions/create` tem corpo fechado (`additionalProperties: false`) e nenhum campo de
  token. A assinatura (`subs_…`) só passa a existir "depois que o cliente paga na `url` da
  resposta" ([criar assinatura](https://docs.abacatepay.com/pages/subscriptions/create));
- o checkout transparente diz que "checkouts, links de pagamento e assinaturas ficam nas rotas
  deles" ([checkout transparente](https://docs.abacatepay.com/pages/cobrar/checkout-transparente));
- o token `ctok_` do `abacatepay.js` serve à "Criar cobrança Cartão", vale 60 s, é de uso único e
  faz o 3DS quando o banco exige
  ([abacatepay.js](https://docs.abacatepay.com/pages/transparents/abacatepay-js));
- o `cardToken` do one click deixa "quem decide quando cobrar" com o lojista: seria recorrência
  própria, não autorizada ([one click](https://docs.abacatepay.com/pages/pagamentos/one-click-buy)).

A documentação não traz declaração de PCI.

**Mantém-se:** a interface do Qoro na prancha "Cadastro · 3. Checkout", com a etapa do cartão na
página segura do provedor. O Qoro não recebe PAN nem CVV.

**Cobertura separada:** o `@code-checkout` do #56 abre o checkout **Asaas** no sandbox, que é a
base atual da `main`. A assinatura SaaS **AbacatePay** só é provada pelos testes do #53.

**Pergunta formal para o suporte da AbacatePay** (para o fundador enviar):

> Usamos `POST /v2/subscriptions/create` com `methods: ["CARD"]` e teste grátis. Hoje o cliente
> digita o cartão na `url` hospedada. Queremos manter o formulário de cartão dentro da nossa página
> com o campo seguro do `abacatepay.js`.
> 1. O token `ctok_` gerado pelo `abacatepay.js` pode ser usado oficialmente para criar ou pagar
>    uma assinatura recorrente, sem redirecionar o cliente para a página hospedada? Por qual rota e
>    campo?
> 2. Se não, existe previsão de suporte a assinatura com cartão no checkout transparente?
> 3. Nesse fluxo, como ficam o 3DS na primeira cobrança, as falhas de renovação
>    (`subscription.renewed`/retentativas) e a troca de cartão pelo portal do cliente?
> 4. Qual a responsabilidade PCI do lojista quando o campo seguro do `abacatepay.js` é usado?

## 6. P-23 (#418): mecanismo reproduzido

**Reproduzido no Preview `122b6286`.** Um `<div>` estranho inserido **no topo do `<body>` antes da
hidratação**, como fazem algumas extensões, gera `Minified React error #418 … args[]=HTML` em 6 de
6 cargas, com rede normal, lenta e muito lenta, em `/dashboard` e `/agenda`.

Não reproduzem:

- controle sem alteração;
- atributo novo no `<body>`;
- `<span>` ou elemento customizado no topo;
- `<div>` no fim do `<body>`;
- `<div>` inserido depois da carga;
- `<font>` de tradutor;
- 6 fusos, 2 idiomas, rede e CPU lentas e navegação concorrente (60 cargas em 10 cenários).

O primeiro filho do `<body>` em todas as rotas é o `<div hidden>` do metadata em streaming do Next
15.5. O React 19.2.6 pula tags estranhas de **outro tipo**, mas hidrata um `<div>` estranho no
lugar desse `<div hidden>`, diverge (#418) e refaz a raiz no cliente. O `$RS` do Sentry
7730223576 é o segmento em streaming chegando depois e não achando o placeholder removido. Esse
último elo não foi reproduzido localmente, porque a clínica sintética não tem segmento pendente.

**O app não tem como evitar** essa colisão, já que o `<div hidden>` é interno do Next. Não houve
supressão nem mudança global no React.

**Critérios objetivos para reabrir:**

- um #418 em navegador limpo (CI, perfil sem extensões);
- um #418 cuja mensagem não seja `args[]=HTML`;
- uma rota que reproduza o erro sem DOM alterado por fora.

**Melhoria opcional, não implementada:** uma etiqueta no `beforeSend` do Sentry marcando se o
primeiro filho do `<body>` não era o `<div hidden>` do Next. Ela toca a observabilidade
compartilhada, e a heurística precisa ser provada, porque o React pode remover o elemento antes de
o evento ser montado.
