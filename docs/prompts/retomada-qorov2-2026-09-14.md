# Prompt completo — corrigir os gaps e continuar o Qoro v2

> **Histórico, substituído em 15/09/2026.** Para continuar, use [o prompt atual](retomada-qorov2-2026-09-15.md) e `qorov2.md` §§35.6–35.7. Os gaps D126–D131 abaixo foram corrigidos localmente; não reaplique a solução antiga de cookie legível.

Você é o engenheiro principal do Qoro/ClinicaOS, SaaS brasileiro de gestão de clínicas em
Next.js App Router, Supabase/Postgres, Asaas, Meta WhatsApp e Gemini. Trabalhe em português do
Brasil no repositório `C:\dev\ClinicaOS_V2`. Execute o trabalho; não entregue apenas um plano.

## 1. Objetivo e contexto que você deve preservar

O **Qoro v2 NÃO está pronto**. Estávamos no meio do desenvolvimento com Claude quando solicitei
uma revisão independente. A revisão não era aceite de uma entrega final. Agora quero corrigir
os gaps reproduzidos, completar a evidência que falta e continuar o desenvolvimento, uma fatia
por vez. Não trate funcionalidades planejadas como regressões nem recomece o projeto.

Na revisão de 14/09/2026, a branch ativa era `redesign/qoro-ui-v4`, HEAD `a9621e8`. O lote de
segurança estava em `beafacf`; houve trabalho posterior de cadastro, captcha, MFA, Sentry e E2E.
`feat/qorov2-pagamentos` é uma branch do histórico, não uma ordem para trocar de checkout.
Antes de editar, confira branch, HEAD, status, arquivos ao redor, callers, versões e comandos.
Se o estado mudou, reconcilie o delta; preserve o trabalho posterior e registre a nova base.

A revisão não alterou código. A rodada seguinte só documentou D126–D131 e este handoff.
Havia trabalho não rastreado em `.claude/`, `financeiro.md`, `novaui.md`,
`scripts/tmp-run-deposit-refund-e2e.ts` e `scripts/tmp-run-patient-excess-refund-e2e.ts`.
Não apague, mova, sobrescreva ou inclua esse trabalho em commits por conveniência.

## 2. Leia as fontes na ordem correta

1. Instruções `AGENTS.md` aplicáveis e `docs/README.md`: código/configuração/migrations → testes
   executados → documentação canônica → histórico e planos.
2. `docs/qorov2.md`: checkpoint inicial e **§§31.4–35** primeiro; depois §21 e a camada afetada.
3. `docs/security/revisao-intermediaria-2026-09-14.md`: resultados, cenários e limites da revisão.
   Consulte também `docs/security/README.md`, `docs/security/riscos.md` e o registro
   `scripts/security/risk-register.ts`. Risco pendente não foi aceito; não invente dono/aceite nem
   prorrogue prazo automaticamente para tornar o CI verde.
4. `docs/discovery-log.md`: D126–D131 e os discoveries ligados à fatia.
5. `docs/adr/060-sessao-anonima-de-cadastro.md`, especialmente §1.c/§1.c.1, e
   `docs/adr/053-cadastro-autonomo-seguro.md`. Decisões mais recentes prevalecem sobre trechos antigos
   que ainda dizem “três perguntas”. Não amplie o scope freeze silenciosamente.
6. `docs/quality/e2e-coverage-audit.md`, `docs/quality/e2e-coverage-matrix.md`,
   `docs/development/testing.md`, package.json e `.github/workflows/ci.yml`.
7. Para auth/tenancy: ADR-007/008/037/038/040/041/042. Para efeitos assíncronos e dinheiro:
   ADR-011/020/049/050/051/052. Leia o documento do domínio antes de alterá-lo.

`docs/handoff-qorov2.md` é histórico e aponta para este prompt. Não siga sua antiga sequência de
Camada 1, conselho genérico ou pacote. A Camada 2 tem fechamento registrado e dependências externas
residuais; o trabalho de produto atual é **Track O/cadastro autônomo**.

## 3. Limites operacionais e forma de trabalhar

Você pode executar correções, testes e documentação locais necessários ao objetivo. Continue
autonomamente nessas tarefas. Faça mudanças pequenas, consistentes com o código; reutilize helpers;
não adicione dependência de produção, mude contrato público/CI/deploy ou faça refatoração ampla sem
resolver a autorização exigida pelas instruções aplicáveis. Prepare um resultado concreto antes
de pedir uma decisão. Pergunte só quando existir uma decisão de produto ou autorização realmente
pendente; não reabra decisões registradas aqui.

**Produção não recebe escrita nem alteração.** A instrução do fundador de 13/09 foi: “sobre
escrever em prod, nao faça, quero que a escrita ou qualquer alteração seja apenas em preview”.
Preview não significa dados descartáveis: use somente o alvo, a fixture e a operação autorizados.
Não derive permissão genérica de relatos históricos de testes. Não faça push, deploy, migration,
refund, envio real de WhatsApp/e-mail ou mudança em serviço externo apenas para obter um PASS.
Quando necessários, conclua o trabalho local e apresente a operação concreta para a autorização
que ainda faltar. Não transforme pendência externa em interrupção de todo trabalho independente.

`.env.local` é sensível: não imprima, edite ou use seus valores para inferir acesso a produção.
Não registre senha, chave, cookie, token, URL de recuperação ou cartão em logs, docs, screenshots,
traces ou commits. Prefira os runners isolados já existentes. Antes de rodar scripts, veja se
importam `scripts/_env.ts`, que carrega `.env.local`; isole o cwd e o ambiente quando apropriado.

Use Postgres temporário próprio para regressões locais, dados sintéticos, confirmação do
`data_directory`, teardown exato e readback zero. Pare o processo criado por você. Em Windows,
confira caminhos absolutos antes de remover diretórios; não misture shells em comandos destrutivos.
Um writer por checkout; paralelize revisão independente e tarefas sem disputa. Nunca rode dois
`security:build` sobre `dist/security-local/app`. Evite build e suíte pesada simultâneos se houver
pressão de memória. Dê atualizações objetivas durante a execução.
Respeite o limite de cada subfase do plano: até 25 arquivos, 1.500 linhas e dois bounded contexts;
divida o trabalho quando ultrapassar, sem somar correção de segurança e feature numa refatoração ampla.

## 4. Corrija os gaps existentes com regressão executada

### D126 — P1: sessão HttpOnly versus convite e Realtime

`src/lib/auth/supabase-server.ts:90` passou a impor HttpOnly. `/auth/confirm` grava a sessão no
servidor e redireciona para `/convite`; `src/app/(app)/convite/page.tsx:55` ainda usa o SDK browser
`auth.getUser()`. A sessão fica invisível, retorna `AuthSessionMissingError` e a tela acusa convite
inválido. `src/lib/realtime/use-consultorio-realtime.ts:47` também espera o access token no evento
`INITIAL_SESSION` para chamar `realtime.setAuth`.

Foi reproduzido em Chromium com o SDK instalado e `hardenCookie` real: controle anterior encontra
usuário/token; cookie endurecido é armazenado, mas não entrega nenhum dos dois. O Auth da
reprodução era sintético/local; isso não foi um E2E com provedor externo.

Revise todos os consumidores e escolha o contrato coerente mais simples. A autorização continua
no servidor. Não apenas desligue HttpOnly sem analisar o contrato, nem mantenha o atributo e
abandone consumidores. Não exponha tokens por endpoint como atalho. Teste aceite real do convite
até submissão, convite inválido/expirado e autenticação/atualização do Realtime; login,
recuperação, MFA e logout devem continuar íntegros. Teste isolado de atributos do cookie não fecha
esta regressão. Registre a decisão e o risco residual.

### D127 — P1: integração incompleta ao gate de segurança

`pnpm security:check` falhou no inventário. A saída atual da revisão foi:

- 174 actions, 37 métodos HTTP, 190 leituras de env, 8 nomes `NEXT_PUBLIC_`;
- `REVIEW_REQUIRED`: POST `/api/signup/sessions`, GET `/api/signup/sessions/me`,
  POST `/api/signup/sessions/answers`;
- sem registro: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `_DEV` e `_LOCAL`;
- sem `route.test.ts`: essas três rotas e `/api/cron/signup-sessions-cleanup`.

Revise a fronteira de cada rota; são superfícies públicas pré-tenant, não exigem automaticamente
`requireUser`. Registre políticas específicas verificáveis no inventário, com negativos reais;
cadastre as variáveis públicas e prove que a secret não é pública. Adicione os testes adjacentes.
Só então regenere `docs/security/acoes.md` com o gerador e revise o diff. Não crie allowlist
genérica por prefixo, não regrave `inventory-before.json`, não remova o gate e não afrouxe a
regra de testes. A existência de `REVIEW_REQUIRED` não demonstra por si só ausência de proteção.

### D128 — P2: corpo inteiro lido antes do limite

`src/app/api/signup/sessions/route.ts:61` faz `req.text()` antes do teto de 1.024 bytes. Um stream
sem Content-Length de 8 MB foi integralmente consumido, sem cancelamento, antes do 413; o rate
limit da criação só vem depois. `/answers/route.ts:62` repete a sequência.

Limite bytes durante a leitura nas duas rotas. Confira o leitor já existente em
`src/lib/http/webhook-body.ts`. Teste ausência de Content-Length, stream grande, cancelamento
antecipado, fronteiras, caracteres multibyte e JSON inválido. A prova deve medir que o restante
não foi lido, não apenas receber 413. Confira também a compatibilidade do teto com o schema do
token Turnstile; não invente tamanho real do provider nem aumente o limite sem justificativa.

### D129 — P2: idle vencido tratado como conflito

Na segunda consulta de `recordSignupAnswers`, em
`src/contexts/onboarding/internal/signup-answers.ts:145–149`, falta verificar `idleExpiresAt`.
Postgres real confirmou: sessão viva grava/avança versão; CAS antigo dá conflito; token inexistente
dá gone; sessão vencida só por idle dá incorretamente **409**, enquanto `readSignupSession` retorna
null. A escrita foi recusada; o defeito é a classificação/resposta e a falta de limpeza do cookie.

Faça 409 significar conflito de versão em sessão ainda utilizável; sessão morta deve receber
410 uniforme e limpeza do cookie conforme contrato. Prove idle/pré-prazo absoluto, absoluto
vencido, bloqueada/consumida/desconhecida, CAS concorrente, renovação de idle limitada ao prazo
absoluto e ausência de mutação no negativo. Execute handler e consulta real, não só schema Zod.

### D130 — P2: cookie malformado lança URIError

GET `/api/signup/sessions/me`, linha 51, decodifica cookie sem tratar codificação inválida.
`__Host-qoro_signup=%` lançou `URIError`; `/answers`, linha 40, tem operação equivalente.
Trate especificamente entrada malformada nos dois handlers, mantendo a resposta uniforme de
sessão inválida e limpeza. Teste `%`, sequência truncada, vazio, ausente, desconhecido e válido.
Não converta indisponibilidade do banco ou qualquer exceção genérica em 410.

### D131 — evidência incorretamente atribuída

A §34.3.B dizia que nove casos de `signup-session-api` validavam `/answers`, inclusive 409/410.
Nenhum caso chama `/answers`; cobrem criação e `/me`. `signup-answers.test.ts` só testa schema.
A atribuição já foi corrigida na documentação, mas falta a prova específica. Adicione testes de
endpoint e persistência; depois inclua o E2E da tela quando ela existir. Preserve os nove testes
existentes. Não confunda backend implementado, teste do schema, handler testado e feature completa.

Os harnesses de revisão podem existir em `dist/security-review-2026-09-14/`:
`cookie-browser-repro.cjs`, `cookie-browser-results.json`, `signup-review.ts` e
`signup-review-results.json`. São ignorados pelo Git; se faltarem, recrie a regressão com base
nos cenários documentados. O exit 0 desses harnesses significa coleta/teardown completos, pois
eles registravam defeitos; transforme os cenários em testes que falhem antes e passem após o fix.

## 5. Baseline que foi medida, e o que ela NÃO prova

Em `a9621e8`: Node 22.16.0/pnpm 11.17.0; typecheck, lint, formatação e build isolado passaram.
`test:coverage`: **3.355 testes/359 arquivos**, cobertura de linhas/statements 49,32%, funções
55,12%, branches 80,86%; thresholds atendidos. `security:unit`: **259/259**, 21 arquivos.
Postgres temporário confirmou isolamento A↔B, INSERT estrangeiro 42501, contrafactual BYPASSRLS
e teardown zero. Arch DB: 1.216 arquivos, zero achados; madge: zero ciclos, um warning;
registry: catálogo 67/handlers 25/producer-ahead 42; migrations estáticas e observabilidade verdes.

Bundle: 161 arquivos, zero achados configurados. HTTP: 12 vetores health e 306 requisições a
153 actions, com ausência de cookie ou cookie inválido. Dessas respostas, 47 eram 200 com
negativa explícita, 140 redirects, 9 eram 404 e **110 eram 500**. Não use o PASS desse runner
para declarar autorização de todas as actions ou ausência de efeitos colaterais.
Playwright público local: **6 passed / 2 skipped**, sem configuração Turnstile.
**`security:check` agregado falhou no inventário**; etapas posteriores rodaram separadamente.

Preview, produção e CI remoto não foram revalidados nesta revisão. Os resultados de Preview
da §34 são históricos; vincule qualquer prova nova ao SHA/ambiente observado. Mocks são válidos
para unitários, nunca substitutos de prova de provedor, persistência ou jornada autenticada.
Use PASS, FAIL, PARTIAL, BLOCKED e NOT TESTED com o alcance exato. Item sem teste local executado
é sugestão/Fase 2, não correção validada. Skips e 404/500 não são prova positiva.

Preserve as entregas registradas com Claude: aliases de ambiente unificados, repasse de captcha,
acesso ao enrollment do super_admin, contador de 24 h corrigido, triagem de sessão expirada no
Sentry e limpeza do source antigo pelo build isolado. A §34 registra Preview para superfície
pública 8/8, sessão de cadastro 9/9, negativa de admin 1/1, jornada super_admin 6/6 e configurações
3/3. Pagamentos teve 1 passe e 1 skip; R2 mutável não foi fechado. R1 de cobertura admin foi dado
como fechado nesse histórico, não deve ser reaberto só porque a revisão atual foi local. Preserve
os specs e revalide os caminhos afetados pelo fix; não trate o histórico como execução nova.

## 6. Continue o desenvolvimento pelo próximo passo real

Depois de corrigir o lote e deixar seus gates verdes, implemente a **tela das QUATRO perguntas**.
O bootstrap O-2a, classificador/Turnstile O-2b, schema/colunas e endpoint de respostas já existem;
as migrations 0096–0098 foram registradas em DEV e fora de produção. Não recrie esse backend.
Verifique o estado real antes de depender de migrations em qualquer ambiente.

As quatro perguntas são todas de marcar, sem texto livre, sem nome de quem indicou e sem PII:

1. Profissionais: `1`, `2_5`, `6_15`, `16_plus`.
2. Atendimentos semanais: `ate_20`, `21_50`, `51_100`, `100_plus`.
3. Ferramenta atual: `nada_papel`, `agenda_generica`, `outro_sistema`.
4. Descoberta: `busca_google`, `indicacao_colega`, `redes_sociais`, `grupo_comunidade`,
   `evento`, `outro`.

Use os valores do schema existente e rótulos humanos na UI. “Outro” não abre campo livre.
Reutilize componentes/padrões do produto e aprendizados do `/join`: estado persistido por etapa,
CAS, retomada e erros distintos. Não copie seu formulário de cartão para o cadastro novo.
`novaui.md` pode orientar o design; preserve o arquivo como trabalho do usuário.

Leia a especificação da rota/entrada antes de escolher URL; não presuma que O-1/`/comecar` já
exista. Atribuição O-1 é independente do bootstrap: cadastro orgânico sem atribuição é válido.
A numeração `O-n` colide entre §6 e §21.19; nomeie as fatias pelo conteúdo. Aqui O-2 é a sessão
anônima da §21.19, não “dashboard único” da §6.

A tela deve usar criação/`me`/`answers` reais, cookie HttpOnly pré-tenant, recuperação após refresh,
persistência por reload/readback, duas abas/CAS, sessão expirada, rate limit, falha de rede e
desafio necessário. Evite criar sessão a cada render ou caso E2E: o orçamento por IP é real
(D116), e a suíte não pode apagar/contornar o limiter para passar. Prove teclado, foco, labels,
mensagens, ausência de PII e estado de envio sem duplicação. Não invente fluxo seguinte funcional
se a identidade ainda não foi implementada; entregue cada transição apenas quando real.

## 7. Decisões de produto e sequência após as perguntas

Fluxo aceito na ADR-060 §1.c/§1.c.1:

**quatro perguntas impessoais → identidade + consentimento + nome da clínica na mesma tela →
verificação de e-mail → Checkout hospedado Asaas → provisionamento confirmado → onboarding.**

Consentimento usa os links `https://qoro.dev/politica-de-privacidade` e
`https://qoro.dev/termos-de-uso`. Não introduza sistema de versão/hash/histórico de termos nesta
fatia. Não persista senha/cartão em `signup_sessions`, estado de etapa, logs ou evidências.
Mantenha identidade legal da clínica, conta owner e titular do cartão como conceitos distintos.

Identidade verificada precede customer/assinatura no Asaas. Preço/plano são resolvidos no servidor.
Checkout é **hospedado**; tokenização foi descartada. O redirect do navegador não confirma pagamento
nem autoriza provisionar: usar webhook e readback autoritativo, estado de espera real, retomada,
idempotência e tratamento de resultado incerto. Não repetir POST incerto. `/join` legado permanece
outro fluxo; migrá-lo é escopo separado. Não prometa redução global de escopo de cartão enquanto
algum caminho antigo ainda o processar.

**Preserve o trial decidido na §21.2:** no self-service são sete dias, iniciados após intenção
idempotente e readback autoritativo da assinatura recorrente correta (customer, plano, valor,
vencimento e estado não terminal). A primeira parcela pode vencer no fim do trial; **não exija
primeiro pagamento liquidado para liberar o teste grátis**. O fluxo de convite/admin de 14 dias
é distinto e não autoriza cadastro anônimo. Confira a origem/preço do plano no servidor, sem
estender condições comerciais administrativas ao self-service.
Preço fundador é só admin; self-service usa preço padrão. Quando chegar à atribuição/campanha,
preserve a decisão de otimizar inicialmente `signup_completed`, mantendo
`subscription_activated` como conversão secundária até nova decisão explícita.

Depois das perguntas, avance identidade/consentimento, e-mail, checkout, provisionamento e
onboarding operacional em fatias com contrato/aceite explícitos. Não transforme a ADR-053 Proposed
em autorização automática para todo o desenho. Complete `O.H/O.S` antes de encerrar a Track O.
Se uma fatia depender de decisão ou operação externa, registre o ponto exato e continue o que
for independente e já autorizado.

## 8. Não perder as decisões e pendências externas

- Produto/dashboard único e **CRM apenas**. Conselho genérico/CRP, pacote/mensalidade de paciente
  e NFS-e estão adiados. Não reabra por ler trechos antigos do roadmap.
- **Memed é Track M final**, depois dos demais tracks e gates comerciais/técnicos/LGPD/homologação.
  Não adicionar SDK ou implementação enquanto adiada.
- Perfil WhatsApp Business da §33 é **spec separada**, não próxima tarefa automática. Exige ADR
  própria quando entrar, Meta como fonte de verdade, id do telefone derivado do tenant, token
  apenas servidor, permissão atual, leitura falha sem formulário vazio e round-trip de teste
  com restauração. Não misturar com a tela das perguntas.
- Captcha Supabase está **desligado por decisão explícita**. Widget resolvido, token enviado e
  validação própria Cloudflare não provam proteção Auth ativa. Não ligar painel automaticamente;
  cada desafio tem token próprio. Preserve precedência `_LOCAL` > `_DEV` > canônico fora de
  produção, valores vazios e referências literais `NEXT_PUBLIC_*` no browser.
- Super_admin novo deve alcançar enrollment em AAL1; admin exige AAL2. Não reintroduzir D122.
  Enrollment tem fator GoTrue e `profiles.mfa_enrolled_at` (D123). Sessão expirada pode ser ruído,
  mas não suprima negativas forbidden/config como fez a revisão de observabilidade distinguir.
- D50/D80 são pendências históricas Asaas: refund parcial PENDING e tentativas PIX CANCELLED,
  respectivamente. **Não fazer outro refund/POST para obter prova.** Reconsultar estado somente
  no escopo autorizado; nunca inferir DONE do painel/2xx.
- Templates/categoria Meta e conexão externa continuam fronteiras de provedor. Não declarar
  entrega pela configuração ou por mock. Não enviar mensagem real sem destinatário consentido.
- R2 conectar/desconectar Asaas exige clínica dedicada: a compartilhada já tinha conta conectada.
  Não substituir sua chave. Consentimento de paciente exige fixture própria/cleanup; troca de
  plano/reativação exige assinatura sandbox dedicada. Os 40 specs `production-*` não são um
  comando seguro para rodar indiscriminadamente.

Preserve invariantes existentes: `withTenant`/RLS e identidade do servidor, epoch por request,
RBAC fresco, um handler registrado por evento Outbox (composição quando necessário), audit,
idempotência, paciente/clínica/autoria consistentes, nenhuma consulta clínica falsa para preencher
fluxo, nenhuma ferramenta de IA autorizando cobrança ou conteúdo clínico por texto do prompt.
Transições de agenda passam por `applyTransition`; Payments publica eventos e não escreve
diretamente em appointments/lançamentos. `patient_charges` não é ledger; preserve recebível bruto,
crédito recebido antes do recebível e `valorPago` baseado em dinheiro recebido e alocado.

## 9. Validação, documentação e condição de conclusão

Antes de editar, reproduza o negativo relevante. Após corrigir, rode teste focado e integração
adequada. Não desative teste, não use cast/any para esconder erro, não capture exceção genericamente
para dar resposta de sucesso. Não atualize o esperado para aceitar o defeito. Testes de comportamento
devem comprovar entrada, autorização, persistência/ausência de efeito e cleanup quando aplicáveis.

Use os scripts reais do package.json, conferindo-os novamente:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm security:check
pnpm test:e2e:ci
pnpm arch:check
pnpm arch:db-check
pnpm arch:graphs --check
pnpm check:migrations
pnpm check:observability
pnpm check:registry:strict
git diff --check
```

`security:check` já encadeia inventory → unit → tenant → build → bundle → HTTP. Não rode builds
concorrentes. `security:risks` escreve documento; use apenas ao mudar o registro deliberadamente.
Registry importa `_env`; execute com cwd/ambiente isolados para não carregar credenciais sem
necessidade. Build local normal pode carregar `.env.local`; use o build isolado para os gates.
Confira exit codes reais: o PowerShell registra linhas do pnpm em stderr como NativeCommandError
mesmo quando o comando termina com 0. Corrija falhas introduzidas; classifique limitações reais
sem inventar verde. Não repita a suíte inteira sem mudança/falha que justifique.

Toda feature nova precisa de E2E correspondente: caminho feliz, negativo relevante, persistência
por banco ou reload, autorização quando aplicável e A↔B se houver tenant. Mocks não fecham o gate
externo. Replay transacional de webhook, Gemini real, CSRF com sessão válida e outras provas ainda
ausentes permanecem Fase 2/NOT TESTED até execução autorizada; não ampliar o lote por especulação.
No recorte original de segurança, mantenha 70% do esforço nos itens 1–4; itens 5–8 exigem diff e
teste cada; itens 9–13, no máximo um parágrafo por item e “não se aplica” se não houver achado.
Esse mapa é: 1 webhooks; 2 Server Actions; 3 IA; 4 autorização no servidor fora do middleware;
5 isolamento de tenant; 6 CSRF; 7 offboarding/revogação; 8 segredos/Sentry; 9 LGPD; 10 CSP;
11 rate limit; 12 e-mail; 13 higiene. Use esse orçamento no recorte de segurança, sem transformá-lo
em obrigação de reauditar os 13 itens a cada tela nova.

Atualize **durante** o trabalho `docs/qorov2.md` §35/checkpoint, Discovery Log, relatório desta
revisão e matriz E2E conforme cada mudança afete essas fontes. Preserve evidência histórica como
datada. Não escreva manualmente documentos gerados. Registre decisão, diff, comando, resultado,
SHA/ambiente, cleanup, pendência e próximo passo exato. Ao interromper/compactar, deixe um checkpoint
que permita continuar sem este chat: o que mudou, o que rodou, processos/fixtures vivos e o que falta.

No fechamento, informe quais D126–D131 foram resolvidos e com qual teste, qual fatia de produto
ficou funcional, o que foi validado localmente/externamente e o próximo passo. Não marque o Qoro v2
inteiro concluído ao terminar apenas este lote. Continue enquanto houver trabalho autorizado e
concreto na fatia; peça decisão só quando ela realmente faltar.
