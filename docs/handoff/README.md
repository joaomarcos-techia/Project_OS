# Handoff do PR #56 (ciclos 7 a 10, 19–22/11/2026)

Para os responsáveis pelo cadastro e pelo domínio financeiro (#53), por quem integra na `main`, e
para o fundador. Nada aqui foi aplicado fora do PR #56: não houve push na `main`, nem alteração no
#53 ou no #55, nem merge.

| Item | Arquivo | Estado em 20/11 | Decisão de quem |
| --- | --- | --- | --- |
| P-28: senha inicial preservada na confirmação por código | `p28-signup-email-confirmation.patch` | **já no #53** (`a7931315`); falta a `main` | integração na `main` |
| P-29: conta confirmada sem senha volta pelo "Esqueci a senha" | `p29-recuperacao-conta-pendente.patch` | no #56 (`26cb73ff`); aplica limpo no #53 `e3cf8bbd` e na `main` | dono do cadastro (#53) |
| Origem dos links de Auth no Preview (ciclo 9) | `p29b-origem-links-auth-preview.patch` | no #56 (`fef8ec30`); aplica limpo no #53 e na `main` | dono do cadastro (#53) |
| Link de redefinição já usado não reabre o formulário (ciclo 9) | `p29c-link-usado-nao-reabre-formulario-MAIN.patch` | no #56 (`2b6d72b7`); versão para a página da `main`/#53 | dono do cadastro (#53) |
| Resolução dos conflitos #53, #55 e da ordem real | seções C9.4 e C10.3; branches `integracao/c9-*`; `c10-reproduzir-composicao.sh` | reproduzível nos heads de 22/11; tripla bloqueada pela `0159` e pelos testes de journal do #55 | #53 e #55 |
| Página do piloto com um só título principal | `p53-piloto-um-titulo-principal.patch` | pronta; aplica limpo no #53 `bc955f4e` | dono do cadastro (#53) |
| P-29: premissas do spec oficial | aplicado no #56 (`947426b1`), com autorização do fundador | spec oficial verde no Preview | — |
| P-19: contrato de concorrência do Caixa | seções C8.4 e 3 | UI pronta; servidor pendente | domínio financeiro |
| P-27: conta compartilhada `2E2_UI` | seções C8.3 e 4 | recuperação coordenada pelo #53 | #53 |
| Cartão incorporado na assinatura AbacatePay | seção 5 | decisão: página hospedada | fundador |

## Ciclo 10 (22/11/2026): encerramento da frente UI, leia primeiro

### C10.1 Heads de 22/11 e o que mudou

| Frente | Head | Mudança desde o ciclo 9 |
| --- | --- | --- |
| `main` | `5620a098` | nenhuma |
| #53 | `bc955f4e` | só documentação: registro do C3 |
| #55 | `c3f8f775` | R61-B do outbox (`85d37eb9`, `a2805c3b`, `5161c88e`, `c3f8f775`) |
| #56 | `34950478` | nenhuma; CI 44899120756 verde |
| #57 | `93a79601` | nenhuma |

**C3 em Production (registro do próprio #53):** o head `e3cf8bbd` do #53 foi publicado em
Production em 21/11 (Gate A), sem migrations e com o P-28. **O P-29 não está nele.**
- Se a titular do piloto confirmar o e-mail pelo link e sair antes de criar a senha, ou se o
  e-mail dela já tiver uma conta legada não confirmada, o "Esqueci a senha" responde "Link
  inválido" em Production.
- O `p29` resolve. Aplicar e publicar é decisão do dono do #53, com autorização própria, de
  preferência antes da interação da titular no Gate B.

### C10.2 Migration `0159`: diagnóstico e procedimento para os donos

1. **Erro exato:** a CI para no gate de migrations do #53 (`scripts/check-migration-safety.ts:96`):

   ```
   Migration journal order invalid at index 159; preserve applied history and fix only unapplied entries
   ```

2. **Heads e composição:**
   - frentes: `main` `5620a098`, #53 `bc955f4e`, #56 `34950478` (código igual ao `2b6d72b7`),
     #55 `c3f8f775`;
   - composição: `integracao/c9-53-56-55` `4bfaaad9`.
3. **Arquivo esperado:** `drizzle/migrations/0159_saas_period_snapshot.sql`.
   - Os bytes são os do SQL congelado do #53,
     `docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql`, com
     sha256 `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74`.
   - A linha do journal vem do `release-manifest.json` do #53: `idx` 159, `version` 7, `when`
     1795036973858, `breakpoints` true. O manifesto tem `productionAuthorized: false`.
4. **Estado dos journals:**

   | Journal | Conteúdo |
   | --- | --- |
   | #53 | `0000–0142` (143 entradas) |
   | #55 | `0000–0135` + `0143–0158` + `0160–0166` (159 entradas) |
   | Composição | `0000–0158` + `0160–0166` (166 entradas), lacuna em 159 |
   | DEV | `0159` aplicada pelo migrador do #53, segundo a documentação dele |
   | Production | não consultado (sem autorização). A evidência do C3 registra 0 migrations aplicadas |

5. **Causa comprovada:** por desenho, a `0159` só pode entrar depois da cauda `0143–0158` do #55,
   e nenhuma branch a carrega. Com a `0159` congelada do dono no journal, **o gate do #53 passa**:
   `check:migrations OK`, journal contíguo com 167 entradas e `when` crescente.

   A falha é ausência real, não composição desatualizada. Ela continua igual nos heads de 22/11.
6. **Procedimento seguro, pelo dono do #53, na integração do #55** (a última da ordem):
   - acrescentar o arquivo, com os bytes conferidos pelo sha256, e a linha do manifesto, no
     mesmo commit que traz a cauda do #55;
   - não renumerar nada;
   - a `0159` precisa ser aplicada antes da `0160` em qualquer banco. Uma `0160` aplicada antes
     faria o Drizzle pular a `0159` em silêncio, e o teste do próprio #55 recusa esse caso;
   - aplicar em Production exige autorização própria.

   **Segundo bloqueio, até agora invisível:** com a `0159` no journal, 8 testes de formato do
   journal do #55 reprovam **por construção**. Eles supõem o journal da branch sozinha:
   - `src/contexts/health-insurance/migration-ledger.test.ts` (4 testes);
   - `src/lib/db/migration-composition.test.ts` (3 testes);
   - `src/contexts/payments/external-refund-migration.test.ts` (1 teste).

   Precisam de um modo "composto", que aceite as faixas do #53 dentro do journal quando forem
   iguais às fixadas. O #53 já esboçou isso para o primeiro arquivo
   (`docs/decoupling/asaas-to-abacatepay/migrations/tiss-ledger-integration.patch`), mas o esboço
   **não aplica mais** no #55 `c3f8f775` (falha na linha 54). **Dono: #55, com o #53.**
7. **Testes depois do ajuste:**
   - `npx tsx scripts/check-migration-safety.ts`;
   - os 3 arquivos acima e `src/lib/db/migration-journal.test.ts`;
   - CI completa num PR descartável, incluindo o isolamento entre clínicas e o de Convênios com
     Postgres temporário, que aplicam as 167 migrations.
8. **Reprodução:**
   - `bash docs/handoff/c10-reproduzir-composicao.sh <pasta>` mostra o erro;
   - com `--prova-0159`, mostra o gate passando e os 8 testes do #55.

   O script não publica nada e só copia o SQL depois de conferir o sha256.

**Nada da `0159` entrou em branch nenhuma.** A prova roda só num worktree descartável.

### C10.3 Composições nos heads de 22/11

| Composição | Branch | Head | O que entrou |
| --- | --- | --- | --- |
| #53 → #56 | `integracao/c9-53-56` | `94dd8789` | #53 `bc955f4e` sem conflito; página do piloto com um só `h1` |
| #56 + #55 | `integracao/c9-56-55` | `f56fa5d6` | #55 `c3f8f775`; só o inventário gerado conflitou e foi regenerado |
| Ordem real | `integracao/c9-53-56-55` | `4bfaaad9` | #53 `bc955f4e` e #55 `c3f8f775`; só o inventário conflitou e foi regenerado |

- Todas as resoluções anteriores continuam no lugar (conferido por busca no código):
  - título e um só `h1` no piloto;
  - sem `timeZone` duplicado;
  - "Plano salvo" só depois de salvar;
  - ícone `insurance`;
  - degrau de 1040 px;
  - link de ajuda;
  - fórmula `l.valor - l.valorPago - l.valorGlosado`;
  - regra da página de redefinição.
- **Testes na tripla:** `tsc` 0; outbox, cron, cadastro, trilho, Convênios, redefinição e
  contratos de design 529/529; cadastro e títulos 194/194 depois da correção do piloto.
- **#57:** 0 conflito com o #56; 1 conflito com a tripla, em `docs/adr/README.md`.

### C10.4 Pacote final para o #53 (validado no head `bc955f4e`)

| Ordem | Patch | O que faz |
| --- | --- | --- |
| 1 | `p29-recuperacao-conta-pendente.patch` | conta confirmada sem senha recupera pelo link de redefinição |
| 2 | `p29b-origem-links-auth-preview.patch` | links de Auth no Preview pelo alias da branch |
| 3 | `p29c-link-usado-nao-reabre-formulario-MAIN.patch` | link já usado não reabre o formulário |
| 4 | `p53-piloto-um-titulo-principal.patch` | a página do convite fica com um só `h1`; a abertura vira parágrafo. Teste novo; mutação 1/1 |

- **Os 4 juntos no `bc955f4e`:** `tsc` 0; onboarding, identity, reset, login, auth, http,
  `lib/auth`, signup, cadastro e email: **1927/1927 (128 arquivos)**. Nada financeiro.
- **Na integração com o #56,** a página do piloto fica com a versão da composição: o texto entra
  na etapa 1 pelo `intro` do `SignupQuestions`, em vez do parágrafo do patch 4. Ela substitui o
  patch 4 naquele arquivo.

### C10.5 P-19 e P-27 (22/11)

- **P-19:** `valorPagoEsperado` não existe fora de teste em `main`, #53 nem #55. **UI PASS /
  ponta a ponta PARTIAL**; dono: domínio financeiro (C8.4).
- **P-27:** a `2E2_UI` continua sem senha, sem atividade desde 18/11 23:18 UTC (sonda só de
  leitura). Segue com o #53; nenhum teste ou sonda do #56 depende dela.

## Ciclo 9 (20–21/11/2026)

### C9.1 Origem dos links de Auth no Preview: resolvido em código (`fef8ec30`)

- **Causa:** a entrada geral de `APP_BASE_URL` do Preview na Vercel aponta para outro deploy. O
  cadastro, o Checkout e a troca de plano já usavam o alias da branch injetado pela Vercel
  (`resolvePreviewCallbackOrigin`), mas a redefinição de senha, o convite da equipe e o convite
  de clínica montavam o link só com `APP_BASE_URL`. O link de redefinição abria o código de outra
  branch.
- **Correção:** `resolveAuthLinkOrigin()` em `src/lib/http/application-url.ts`.
  - Em Preview usa `VERCEL_BRANCH_URL`, depois `VERCEL_URL`. Só aceita host `*.vercel.app` em
    HTTPS, sem porta, caminho ou credencial.
  - Fora do Preview usa só `APP_BASE_URL`. Production não muda: `VERCEL_ENV=production` nunca
    passa pela Vercel.
  - Nada vem de `Host`, `Origin` ou de parâmetro do cliente, e o link passa pelas travas de
    `buildApplicationUrl`.
  - Os templates de redefinição e de convite comparam a origem com a mesma função
    (`expectedOrigin`).
  - O callback da Meta não muda.
- **Configuração:** nada a mudar na Vercel nem no Supabase.
  - A Vercel injeta o alias da branch sozinha.
  - O link é `/auth/confirm#token_hash=…` do próprio app (`generateLink` sem `redirectTo`), então
    a lista de "Redirect URLs" do Supabase não participa.
  - DEV, Preview e Production continuam separados: o Preview usa o Auth DEV e só gera links
    `*.vercel.app`.
- **Provas:**
  - unidade: Preview, alias inválido, fora do Preview, sem `APP_BASE_URL`;
  - mutação 3/3: desfazer a origem ou qualquer uma das duas travas `expectedOrigin` reprova um
    teste;
  - spec oficial no Preview `2b6d72b7`: o link é aberto **como chegou**, e a sua origem serve o
    mesmo build do deploy sob teste (mesmos assets do Next em `/login`).

### C9.2 P-29: revisão final de segurança

| Caso | Resultado | Prova |
| --- | --- | --- |
| Conta confirmada `pending` (abandono depois do link, conta legada) | recupera pelo link de redefinição e instala a primeira senha | unidade (`signup-auth-admin`, `reset-password/actions`) e spec oficial no Preview |
| Conta não confirmada, convidada, banida, outra referência, `reserved` | recusada (`obfuscated`) | unidade, `it.each`; mutação 5/5 (ciclo 8) |
| Token adulterado | `/auth/auth-error`, sem formulário | spec oficial no Preview |
| Token substituído por pedido mais novo | `/auth/auth-error`; o mais novo abre | spec oficial no Preview |
| Link reutilizado (consumo único) | `/auth/auth-error` | spec oficial no Preview |
| Sessão de recuperação depois da troca | revogada (logout global); cookies antigos vão a `/login` | spec oficial no Preview |
| **Replay do grant depois da troca** | **achado neste ciclo:** a página mostrava o formulário; o envio já era recusado. Corrigido (`2b6d72b7`) | página: 4 testes, mutação 2/2; action: replay de grant de perfil e órfão sem sessão ou com sessão de outra conta não instala senha nem consome epoch |
| Logout depois do login | cookies anteriores não entram mais | spec oficial no Preview |
| Novo login com a senha redefinida | entra (`/cadastro/continuar`) | spec oficial no Preview |
| Senha legada (Auth v2.198.0) | nunca deu acesso (`email_not_confirmed`) e não volta | spec oficial |
| Cadastro concorrente e link de outro draft | não confirma nem toca o outro draft | spec oficial ("link adulterado, de outro cadastro ou já usado") |
| Existência de conta | resposta uniforme; o aviso vai só ao dono, por e-mail | spec oficial e `signup-existing-account-notice` |
| Abuso | limites existentes: 3 pedidos de redefinição por e-mail e 10 por IP por hora; conclusão limitada; o spec usa exatamente 3 | `rate-limit.ts` |
| Token expirado | **não executado ao vivo**: exige esperar o prazo do Auth DEV, e mudar o prazo não foi autorizado. O caminho do app é o mesmo `fail('invalid_token')` dos tokens consumido e substituído, provados acima | `auth/confirm/route.ts` |

Resultado: **14 casos provados, 1 achado corrigido, 1 não executado ao vivo** (expiração).

### C9.2.1 Spec oficial do cadastro no Preview final do #56 (`2b6d72b7`)

O spec tem 17 testes. Os 4 de oferta com pagamento manual (`@prepare`, `@inspect`, `@retire`,
`@verify`-offer-checkout) exigem flags explícitas e pagamento real e não foram executados. **Os 13
executáveis passaram**, em lotes espaçados por causa dos limitadores:

| Lote | Testes | Resultado |
| --- | --- | --- |
| 1 | link confirma no telefone; destinatário confirma e cria a senha; conta legada não confirmada | 3/3 |
| 2 | link adulterado, de outro cadastro ou já usado; código do link vivo; reenvio | 3/3 |
| 3 | `@code-checkout` (com o "Plano salvo" no salvamento real); `@code-flow`; `@recovery-flow` × 2 | 4/4 |
| 4 | não afirma confirmação sem sessão; cadastro expirado retoma | 2/2 |
| à parte | conta legada abandonada + redefinição estendida | PASS (1,8 min) |

**Repetição da conta legada no lote 4:** estourou o tempo.
- O e-mail da terceira redefinição não saiu (o Resend DEV registra o aviso e 2 das 3).
- O limitador de redefinição por IP (10 por hora) fica num Redis compartilhado pelos Previews e
  pelos agentes desta máquina. A resposta da tela é uniforme, então o teste espera até o fim.
- O mesmo teste passou nesse Preview e na tripla. O resíduo foi limpo pelo `beforeAll` seguinte;
  a sonda `residuo-cadastro.ts` deu 0 contas e 0 rascunhos.

### C9.3 Pacote para o #53 (C3), validado no head `e3cf8bbd`

O P-28 continua no #53 (`a7931315`). Os três patches abaixo **não** estão no #53. Aplique na ordem:

```
git fetch origin ui/otimizacao-ui-final-20261114
for p in p29-recuperacao-conta-pendente p29b-origem-links-auth-preview p29c-link-usado-nao-reabre-formulario-MAIN; do
  git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/$p.patch | git apply --check &&
  git show origin/ui/otimizacao-ui-final-20261114:docs/handoff/$p.patch | git apply
done
```

| Base | Patches | Testes (onboarding, identity, reset, login, auth, http, `lib/auth`, signup, cadastro, email) | `tsc` |
| --- | --- | --- | --- |
| #53 `e3cf8bbd` | p29 + p29b | 126 arquivos, 1918/1918 | 0 |
| #53 `e3cf8bbd` | + p29c | reset-password 43/43 | 0 |
| `main` `5620a098` | p28 + p29 + p29b + p29c | 121 arquivos, 1812/1812 | 0 |

- **Nenhum arquivo financeiro, de preço, webhook, ledger ou migration.**
- O aviso de conta existente (`b46ea769`) só existe na linhagem do #56. No #53 e na `main`, a
  recuperação self-service é o "Esqueci a senha", e é ele que o `p29` destrava.
- Três testes do #53 falham **nesta máquina Windows** também no #53 puro
  (`checkout-operator-session` `--preview` e `release-archive` com `tar --options`). Não têm relação
  com os patches. A CI Linux do #53 passa.
- **Critério para o C3 (atualizado):**
  1. P-28 presente (está);
  2. os três patches acima aplicados;
  3. no Preview do #53, o teste oficial "conta legada que abandona depois do link recupera o
     acesso…", que agora cobre a origem do link e os casos negativos. Ele chega com o spec do #56
     na integração, ou pode ser copiado.

  O piloto (Consultório, 1 médico) segue o fluxo `trial_first` do #53. A tela dele foi preservada
  na resolução da C9.4.

### C9.4 Integração: resolução reproduzível (heads de 20–21/11)

Heads usados:

| Frente | Head | Observação |
| --- | --- | --- |
| `main` | `5620a098` | — |
| #53 | `e3cf8bbd` | — |
| #56 | `fef8ec30` | — |
| #55 | `acbfff24` | head do PR; o worktree do #55 tem um commit local não publicado (`85d37eb9`, outbox) que não cria conflito novo |
| #57 | `93a79601` | — |

Composições descartáveis (branches no repositório; os PRs servem só para a CI e nunca devem ser
mergeados):

| Composição | Commit | Branch | CI |
| --- | --- | --- | --- |
| #53 → #56 | `402cdf6e` → `41a11bac` (o `60c149e8` é vazio, só para refazer o deploy) | `integracao/c9-53-56` | PR #61: **todos os gates verdes** (auditoria, typecheck, lint, arquitetura, migrations, testes com cobertura, inventário, isolamento entre clínicas com Postgres temporário, build, segredos no bundle, E2E público). O deploy da Vercel do `402cdf6e` falhou sem log acessível |
| #56 + #55 | `3c99d2d4` → `b0e5417c` | `integracao/c9-56-55` | PR #62: verde até os testes, que reprovaram só em 5 testes de forma do journal do próprio #55 (`migration-ledger`, `migration-composition`). Eles supõem a base `main` ou `main` + #53 completo, e o par só tem a `0136`, que o #56 carrega do #53. Esse estado não existe na ordem real |
| #53 → #56 → #55 (ordem real) | `248a7ff1` → `da1b4111` | `integracao/c9-53-56-55` | PR #60, fechado: parou no gate de migrations (abaixo). O build foi provado pela Vercel, que publicou o Preview |

**#53 → #56 (9 conflitos, todos resolvidos):**

| Arquivo | Escolha |
| --- | --- |
| `signup-frame.tsx` / `.test.tsx` | versão do #53: é a do #56 com a prop `trialFirst` ("Plano e avaliação") e o teste dela |
| `signup-frame.module.css` | versão do #56 (P-24). Os aliases provisórios do #53 saem, porque o #56 define `--text-body`/`--border-soft` na camada app-v5 |
| `plano.module.css` | versão do #56. A do #53 são as 31 primeiras linhas dela |
| `plano/page.tsx` | imports e `trialFirst` do #53. No `trial_first`, título "Escolha seu plano" com o texto da avaliação (#53); com cartão, "Confirme o plano e o pagamento" (desenho aprovado). `showLogin` do #56 |
| `plan-selection-form.tsx` | versão do #56 com o do #53: `signupFlow`/`pilot` no estado, rota `/api/signup/pilot/provision`, 409 `trial_used`. Com cartão, o checkout aprovado. No `trial_first` (sem cartão nesta etapa), o ramo de lista de planos da mesma moldura, com "Começar avaliação gratuita" e "Mensalidade do plano": é o que os specs do #53 homologaram (rádio por plano, resumo). O aviso "Plano salvo" só aparece depois de salvar, pela regra da prancha (corrigido no `39b47f1c`; a primeira resolução o mostrava no carregamento). A frase do #53 "Nenhum cartão ou pagamento é necessário para iniciar a avaliação." fica como nota fixa abaixo do botão, e o teste do #53 passa sem mudança |
| `plan-selection-form.test.tsx` | união das duas asserções |
| `signup-identity.tsx` | layout do #56 + `pilotIdentity` do #53 (nome, clínica e e-mail do convite, somente leitura) |
| `docs/security/acoes.md` | regenerado (`inventory --write`; `--check` sem regressão) |
| `cadastro/piloto/page.tsx` (#53, sem conflito) | ganhou título de página, exigido pelo contrato UX-008 do #56 (o teste `page-titles` reprovava na composição) |

**Prova visual da etapa do piloto C3** (`trial_first`, Consultório, 1 médico): a página real,
renderizada na bancada (componente real, CSS do projeto, `fetch` simulado) com o código da
composição, a 1440, 390 e 320 px. Sem rolagem lateral; etapa 3 "Plano e avaliação"; resumo com
"Mensalidade do plano R$ 197,00/mês"; nenhum texto de cartão (evidência em
`.tmp/ui-audit/evidence/2026-11-20/ciclo9/bancada-composicao-53-56-v2/`). O spec de UI do plano do
#53 usa um harness local próprio (`/cadastro/qoro-billing-harness`, fora do repositório) e não foi
executado aqui; os testes de unidade do #53 para o `trial_first` passam na composição.

Testes na composição: cadastro e moldura 238/238; contratos de design 119/119; onboarding,
billing, signup, pagamentos, auth, http e admin 2746/2749, com as 3 falhas de ambiente acima.
`tsc` 0.

**#56 + #55 (9 conflitos, todos resolvidos):**

| Arquivo | Escolha |
| --- | --- |
| `_journal.json` | união por `idx`. A `0136` do #56 é a migration do #53, idêntica; nada é renumerado |
| `caixa-view.tsx`, `cash-item-card.tsx`, `waitlist-manager.tsx` | fuso da clínica do #56 (`useClinicTimeZone`, `todayYmd(timeZone)`). Saem os auxiliares do R51 que ficaram redundantes, e também a **chave `timeZone` duplicada** que o merge automático deixou no `Intl.DateTimeFormat` do `cash-item-card` sem acusar conflito |
| `consultorio/format.ts` | fuso da clínica com Brasília como padrão (R51 do #55 e o teste dele) |
| `waiting-card.tsx` | `now` nulo até montar (R51) + `timeZone` da clínica (#56) |
| `financeiro/page.tsx` | **fórmula do #55 `l.valor - l.valorPago - l.valorGlosado`**, badge do #56 |
| `new-appointment-drawer.tsx` | UX-005/UX-006 do #56 + cobrança por convênio do #55. A falta de operadora aparece no erro do formulário, e a carteirinha zera ao trocar ou cadastrar o paciente |
| `docs/security/acoes.md` | regenerado |

Testes: agenda, caixa, consultório, financeiro, `lib/format` e contratos de design 406/406;
Convênios e documentação 89/89. `tsc` 0 (com 6 GB de heap; a composição estoura os 2 GB padrão).

**Ordem real #53 → #56 → #55 (11 conflitos):**
- 7 de UI × TISS: a mesma resolução acima, porque nesses arquivos o lado #53 + #56 é igual ao #56.
- `_journal.json` (`0136–0142` do #53 + `0143–0166` do #55) e `acoes.md`, como acima.
- **2 novos entre #53 e #55, sem o #56:** `scripts/arch-db-check.ts` e
  `scripts/security/local-build.ts`, que são listas de permissão. Resolução: união das entradas.

Testes afetados 1465/1465 (141 arquivos), `tsc` 0. **Na CI (PR #60), a tripla para no gate de
migrations:**

```
Migration journal order invalid at index 159
```

- O gate de contiguidade do journal vem do #53; a `main` e o #55 não o têm.
- O #55 deixa a `0159` vaga para uma migration candidata do #53 (`52de7ada`, ver
  `docs/convenios/aplicacao-0153.md`), que ainda não está no head do #53.

**Ação de #53 e #55, não do #56:** entregar a `0159` antes da integração do #55, ou combinar outra
saída. Nenhuma migration foi inventada e o gate não foi afrouxado.

**Correção de um erro meu na tripla:** o `248a7ff1` levou o `acoes.md` do #55, porque o `git add`
veio antes do `inventory --write`. O `78709377` traz o regenerado, com `--check` sem regressão.
Nas composições em par a ordem estava certa: o #61 passou no gate do inventário.

**Menu "Convênios" (proposta pronta do #55, `docs/convenios/menu-convenios.md`)**, aplicado na
resolução, porque o item só faz sentido com a rota do #55: no #56 sozinho, a `main` teria um link
quebrado entre os dois merges.
- **Posição e permissão:** grupo Gestão, depois de Financeiro. `requires: VIEW_CONVENIOS`, o gate
  atual da página pela matriz I.2, e não o `VIEW_FINANCIAL` do documento de 12/11. O
  `modules.test` confere essa correspondência.
- **Ícone:** `insurance` (lucide `IdCard`, a carteirinha). O `shield` proposto já era o de Equipe
  & Permissões, e o trilho recolhido mostrava dois escudos iguais.
- **Ritmo, medido item a item contra o #56** (`c9-trilho.ts`, conta `ui-fixture`, 9 viewports):
  - alturas 40/36 px, folgas de 4 px entre itens e 48/42/38 px entre grupos, rodapé 36/32 px:
    **idênticos**;
  - item ativo "Convênios" em `/convenios`; menu móvel abre e fecha com Escape; 0 rolagem
    lateral e 0 erro.
- **Telas baixas:** o #56 sozinho já rola o trilho em notebooks comuns. Em 1536×864 a lista
  esconde "Ajuda" abaixo da dobra; em 1366×768, também Equipe e Configurações. É o desenho de
  18/11: a lista rola, um esmaecido avisa que há mais, e o destino atual é rolado para a vista.
  - Com o 13º item, o mesmo vale a partir de 1440×900, com 36 px a mais (um item).
  - Entre 961 e 1024 px de altura, o degrau de 40 px transbordava 4 px e esmaecia "Ajuda" numa
    tela alta. **Ajuste:** o degrau aprovado de 36 px passa a valer até 1040 px de altura. Os
    valores dos tokens não mudam.
  - Os três ajustes estão na composição (`78709377`) e vão como proposta da UI para o momento da
    integração do #55.

**Código final do #56 nas composições:** elas foram montadas com o #56 em `fef8ec30`; depois
receberam o `2b6d72b7` (página de redefinição), sem conflito (`41a11bac`, `b0e5417c`, `da1b4111`).

**E2E integrado na tripla (spec oficial do #56, Preview da ordem real):**

| Teste | Deploy | Resultado |
| --- | --- | --- |
| `@code-flow` (senha inicial, código, F5, plano preservado) | `78709377` | PASS |
| Link adulterado, de outro cadastro ou já usado | `78709377` | PASS |
| Conta legada abandonada + redefinição estendida (origem do link, reuso, adulterado, substituído, sessão revogada, logout, novo login) | `da1b4111` | PASS |

Duas tentativas antes falharam, e as duas estão explicadas:
- **limitador de sessões do cadastro:** o lote rodou logo depois de outro;
- **depois, o próprio teste acertou:**
  - no `78709377`, a trava "a origem do link serve o build sob teste" recusou o alias da branch,
    que já apontava para um deploy mais novo;
  - no `c93a03e8`, montado antes do `2b6d72b7`, o link já usado reabria o formulário.

  Com o código final, passou.

**#57:** 0 conflito com o #56. Com a tripla, 1 conflito em `docs/adr/README.md` (índice de
ADRs), de quem integrar o #57.

**Achado para o #53, fora do conflito:** em `cadastro/piloto/page.tsx`, o `PublicHeading` fica
fora do `SignupStage` que o `SignupQuestions` monta. Na tela do convite do piloto, um `h1` aparece
acima do logo e antes do `h1` da etapa. Proposta: passar título e texto do piloto para dentro da
etapa 1 (`SignupQuestions`) e remover o heading externo.

### C9.4.1 Auditoria visual da composição tripla (Preview `248a7ff1`)

`.tmp/ui-audit/c9-integrada.ts`, conta sintética `ui-fixture`, só leitura. 93 telas, em 7 larguras
(320, 375, 390, 768, 1024, 1440, 1920), mais duas alturas baixas:
- telas logadas: Dashboard, Agenda, Caixa, Financeiro, Consultório, Convênios, Ajuda, tópico de
  Convênios, Configurações;
- telas públicas: login, cadastro, redefinição, retomar.

- **0 rolagem lateral, 0 erro de JS, 1 `h1` por tela.**
  - Os dois registros são 410 de rede no `/cadastro` anônimo, reaproveitado entre larguras pela
    sonda. É o retorno esperado da sessão anônima expirada, com a tela se recriando.
- **Temas:** claro e escuro aplicados (`.dark`), sem rolagem nem erro, em Dashboard, Convênios,
  tópico de Convênios e Financeiro, a 1440 e 390 px.
- **Link "Ajuda de Convênios":** presente nas 7 larguras.
- **Teclado:** Tab com foco visível em todos os 8 primeiros alvos. A gaveta de novo atendimento
  abre e fecha com Escape. Sem convênio configurado na clínica sintética, os campos de cobrança
  por convênio ficam ocultos, como manda o #55.
- **Trilho:** sem item ativo em `/convenios` até a entrada do menu. Depois dela, "Convênios" fica
  ativo (ver acima).

### C9.5 Central de ajuda de Convênios

- Não existe central nova. O #55 pôs os 5 tópicos no `content.ts` existente (categoria
  Financeiro), e o índice do #56 os lista sozinho.
  - Os tópicos ficam em `/documentacao/<slug>`.
  - O índice continua em `/documentação`: pasta própria e middleware desde o #52, não é defeito.
- **Link "Ajuda"** no cabeçalho de Convênios (proposta do handoff-ui §17 do #55), implementado na
  composição em `convenios/_lib/access.tsx`:
  - leva a `/documentacao/convenios`;
  - nome acessível "Ajuda de Convênios", que contém o texto visível;
  - usa primitivas do design system;
  - teste em `convenios/page.test.tsx`.

  O arquivo é do #55, e a mudança vai como proposta de 17 linhas no commit `3c99d2d4`.

### C9.6 P-19 e P-27

- **P-19:** `valorPagoEsperado` não existe fora de teste em nenhum head (`main`, #53, #55 publicado
  e local). O servidor não foi implementado. **UI PASS / ponta a ponta PARTIAL.** A matriz da C8.4
  continua válida.
- **P-27:** sonda só de leitura em 21/11: a `2E2_UI` continua sem senha (hash vazio), sem atividade
  desde 18/11 23:18 UTC. Segue com o #53. Nenhum teste do #56 depende dela: o spec oficial usa
  contas descartáveis, e as sondas usam a `ui-fixture`.

### C9.7 `main`: proposta final de integração da autenticação

**Caminho recomendado:** sem patch separado na `main`. A autenticação chega com a integração.
- Primeiro o #53, que traz o P-28.
- Depois o #56, que traz P-28 (idêntico; o merge não conflita), P-29, `p29b` e `p29c`.
- O merge do #56 sobre a `main` + #53 conflita só nos 9 arquivos da C9.4, todos com resolução
  reproduzível.

**Caminho de hotfix**, se a aquisição reabrir antes da integração. Provado no commit descartável
`1a2dcad2`, que não foi publicado.

| Ordem | Patch | Arquivos | Depende de |
| --- | --- | --- | --- |
| 1 | `p28-signup-email-confirmation.patch` | `signup-email-code.ts` + teste | — |
| 2 | `p29-recuperacao-conta-pendente.patch` | `signup-auth-admin.ts`, `reset-password/actions.ts` + testes | — |
| 3 | `p29b-origem-links-auth-preview.patch` | `application-url.ts`, `password-reset-email.ts`, `team-invite-email.ts` + testes | — |
| 4 | `p29c-link-usado-nao-reabre-formulario-MAIN.patch` | `reset-password/page.tsx` (versão da `main`), `page.test.tsx` novo, teste da action | 2 (contexto do teste da action) |

Resultado:
- `tsc` 0;
- 1812/1812 testes (121 arquivos);
- conflito com o #53: 0;
- conflito com o #56: só `reset-password/page.tsx`. Fica a versão do #56, que tem a mesma regra.

**Gate de segurança antes de integrar:**
1. CI completa;
2. spec oficial do cadastro num Preview, incluindo o teste da conta legada e o de links
   adulterados;
3. revisão do dono do cadastro, porque a mudança altera o contrato de recovery da conta
   `pending`.

**Não faça cherry-pick do P-28 se o #53 já tiver entrado.**

## Ciclo 8 (20/11/2026)

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
