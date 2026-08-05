# Auditoria de prontidao para producao

**Data:** 2026-08-04
**Escopo auditado:** arvore de trabalho em `C:\dev\ClinicaOS_V2`
**Commit versionado:** `5c9e421e17a41e60de6246af12ad7356d2b5d7d2` (igual a `origin/main`)
**Conclusao:** **NAO APTO PARA GO-LIVE.**

Esta e uma auditoria de codigo e de testes executados localmente. Nenhuma migration,
chamada real ao Asaas/Meta/Gemini, envio de WhatsApp ou alteracao de banco foi feita.
Portanto, tudo que depende de ambiente, credenciais, provider, Vercel ou Supabase em
execucao esta marcado como **NAO VALIDADO**.

## 1. Base auditada e limites

- Antes da criacao deste relatorio, o worktree possuia **31 entradas pendentes**
  (arquivos modificados e nao rastreados); este arquivo adiciona a 32a entrada.
  Entre elas estao a migration `0072_plan_changes_and_feedback.sql`, telas de
  assinatura e o dominio de trocas de plano. Elas nao pertencem a `origin/main`.
- `HEAD` e `origin/main` apontam para o mesmo commit, logo essas alteracoes locais nao
  podem ser tratadas como publicadas ou aplicadas em producao.
- A verificacao de diff nao encontrou whitespace error (`git diff --check` sem saida).
- O build e os testes abaixo validam o estado local, inclusive as alteracoes pendentes;
  eles nao comprovam o estado do banco, do deploy ou dos provedores externos.

## 2. Evidencias executadas

| Validacao | Resultado | Evidencia |
|---|---|---|
| Type-check | PASSOU | `tsc --noEmit` |
| Lint do produto | PASSOU | `eslint src e2e scripts`, sem avisos ou erros |
| Lint do repositorio inteiro | PASSOU com ruido | `eslint .`: 0 erros e 118 warnings, predominantemente em worktrees internos `.claude/worktrees` |
| Formatacao | FALHOU | `prettier --check .` apontou 2.125 arquivos; recorte de produto apontou 561 arquivos |
| Dependencias circulares | PASSOU | Madge analisou 733 arquivos, sem ciclo |
| Arquitetura de banco | PASSOU | `arch-db-check`: 782 arquivos, 0 achados |
| Seguranca de migrations | PASSOU | nenhum DROP/TRUNCATE nao aprovado |
| Observabilidade estatica | PASSOU | 13 crons coerentes entre manifesto, rotas e docs; 15 eventos de saved-search presentes |
| Registro de eventos | PASSOU | catalogo 56 e registry 13 coerentes; 43 eventos producer-ahead allowlisted |
| Testes unitarios/componentes/API | PASSOU | Vitest: **141 arquivos, 1.117 testes** |
| Build de producao | PASSOU | Next 15.5.21 compilou; etapa de compilacao levou 107 s |
| E2E nao mutavel | PASSOU PARCIALMENTE | Playwright: 5 passaram; 2 foram pulados por falta de conta descartavel |

Nao ha configuracao de cobertura no Vitest nem artefato de cobertura gerado. Uma
porcentagem de cobertura e, portanto, **NAO VALIDADA**.

## 3. Mapa da arquitetura observada

```text
Browser
  -> Next.js App Router
       -> rotas publicas: login, convite, join/[token], reset
       -> shell da clinica: dashboard, agenda, pacientes, conversas,
          consultorio, caixa, financeiro, relatorios e configuracoes
       -> admin: clinicas, auditoria, billing, saude, metricas
       -> Server Actions com permissao/idempotencia/auditoria
       -> APIs: health, 13 crons, webhook Asaas e webhook Meta

Contexts de dominio
  -> onboarding, identity, tenancy, scheduling, patient, clinical,
     financial, messaging, ai-agent, billing, feedback

Persistencia
  -> Drizzle + PostgreSQL/Supabase Auth/Storage
  -> RLS + FORCE RLS, `withTenant`, auditoria, idempotency keys
  -> outbox transacional, worker, retries/circuit breaker e cron

Integracoes
  -> Asaas (cliente, assinatura, pagamento e webhook)
  -> Meta Cloud API (conexao, inbound/outbound e status)
  -> Gemini (agente, ferramentas e handoff)
  -> Upstash Redis (rate limit)
  -> Sentry/metricas/healthchecks
```

Foram encontrados 48 `page.tsx`, 18 route handlers de API e 12 contexts de
dominio. O historico de migrations contem 73 arquivos SQL, com 161 declaracoes de
policy, 204 de indice e 65 de trigger. Esses numeros descrevem o codigo de migration;
o schema efetivamente aplicado em producao e **NAO VALIDADO**.

## 4. Fluxos reconstruidos pelo codigo

| Fluxo | Implementacao encontrada | Estado |
|---|---|---|
| Convite de clinica | `/admin/clinicas` chama `createClinicInviteAction`; o token cru e devolvido uma vez como `/join/[token]`, enquanto o banco guarda HMAC e expira em 24 h. Ha cancelamento administrativo e cron de limpeza. | Parcial: a entrega do link e manual; nao ha despacho de e-mail nesse fluxo. |
| Ativacao/onboarding | `/join/[token]` valida/rate-limita o token, persiste passos com controle de versao, resolve o plano no servidor e chama `runCheckout`. | Parcial: fluxo externo Asaas/Supabase nao executado. |
| Checkout | Cria customer e assinatura Asaas, cria owner no Supabase e provisiona clinica, assinatura e configuracao em saga; ha compensacao para a assinatura se o provisionamento falhar. | NAO VALIDADO contra Asaas/Supabase reais. Ha risco critico de seguranca abaixo. |
| Login e shell | Login/MFA e middleware protegem rotas; layout e Server Actions carregam identidade, tenant e permissoes. | Rotas anonimas foram validadas por E2E; login real e navegacao autenticada sao NAO VALIDADOS. |
| Checklist | Dashboard consulta medico, horarios, paciente e WhatsApp. | Falho: nao exige procedimento, embora Agenda o exija. |
| Equipe/profissionais | Convite de membro usa `inviteUserByEmail` do Supabase, valida quota e controles de permissao. | Caminho de codigo e testes de dominio existem; entrega real do e-mail e NAO VALIDADA. |
| Agenda/pacientes/caixa | Contextos de scheduling, patient e financial, com outbox e validacoes de tenant. | Unitarios passam; E2E mutavel de paciente -> agenda -> recebimento foi pulado. |
| WhatsApp/IA | Webhook Meta limita tamanho, verifica HMAC antes de parsear, persiste inbound/status no outbox; worker chama agente, aplica janela de 24 h, retries e handoff. | Codigo parcialmente validado por unitarios. Webhook real, templates, entrega e observabilidade do provider sao NAO VALIDADOS. |
| Assinatura | A tela local permite upgrade e downgrade; upgrade usa cobranca proporcional e o downgrade revalida exatamente um usuario ativo no fim do ciclo. | Nao publicado; cancelamento e reativacao nao estao completos. |
| LGPD | Acoes criam solicitacao; outbox gera JSON/PDF, envia ao bucket privado e persiste URL assinada de 24 h. | Export e exclusao reais sao NAO VALIDADOS; envio automatico do export e stub. |

## 5. Achados priorizados

### Criticos

#### P0-1 — A interface afirma envio de e-mail que o fluxo nao realiza

- **Evidencia:** `join-wizard.tsx:835` mostra “Enviamos os detalhes de acesso para
  {email}”. O provisionamento cria o usuario com `admin.auth.admin.createUser` e
  `email_confirm: true` em `onboarding/internal/saga.ts:52-56`; nao ha emissor de
  e-mail no fluxo.
- **Impacto:** o responsavel pode ficar sem as instrucoes que a interface garante ter
  recebido. E uma afirmacao falsa em uma etapa de ativacao e pagamento.
- **Probabilidade:** alta, em toda ativacao que exiba e-mail.
- **Como reproduzir:** concluir `/join/[token]` com e-mail; a tela final mostra a
  mensagem, mas o fluxo executado apenas cria o usuario e faz login best-effort.
- **Correcao proposta:** remover a afirmacao ate existir entrega verificavel, ou
  implementar envio transacional rastreavel e testar sucesso/falha/retry.

#### P0-2 — Cancelamento de assinatura e reativacao nao estao entregues

- **Evidencia:** a UI e a Server Action de `/configuracoes/assinatura` so aceitam
  upgrade/downgrade. A migration local introduz `cancellation`, mas nao ha acao que
  a solicite. `billing-reconcile/route.ts:170-211` seleciona somente
  `kind = 'downgrade'`; portanto nunca aplica uma cancellation, nem chama
  `asaasProvider.cancelSubscription` nesse caminho.
- **Impacto:** uma clinica nao tem fluxo funcional de cancelamento/reativacao e uma
  cancellation inserida no banco nao chega ao provedor.
- **Probabilidade:** certa quando o cancelamento for requisitado.
- **Como reproduzir:** inspecionar a tela e a action; tentar localizar uma acao de
  cancellation/reativacao; inserir uma request de cancellation em ambiente de teste
  e executar o reconcile — ela nao entra na query de pendencias.
- **Correcao proposta:** desenhar a maquina de estados ponta a ponta (pedido,
  revogacao, cancelamento Asaas, aplicacao local, reativacao e auditoria), cobri-la
  com integracao e E2E e publicar a migration junto do codigo.

### Altos

#### P1-1 — PAN e CVV passam pelo servidor da aplicacao

- **Evidencia:** `join/[token]/actions.ts:154-205` recebe `cardNumber` e
  `cardCvv` em Server Action; `onboarding/internal/saga.ts` os encaminha em
  `creditCard` para `POST /subscriptions` no Asaas.
- **Impacto:** o servidor entra no caminho de dados de cartao, ampliando
  significativamente a superficie de seguranca e de conformidade de pagamento.
- **Probabilidade:** alta para todo checkout por cartao.
- **Correcao proposta:** usar tokenizacao/hosted checkout do Asaas antes de o PAN/CVV
  cruzar a aplicacao. Validar tambem redacao de erros e traces nesse caminho.

#### P1-2 — Trial exibido como 7 dias, mas provisionado por 14 dias

- **Evidencia:** `onboarding/trial.ts:2` define `QORO_TRIAL_DAYS = 14` e
  `join/[token]/actions.ts` repassa essa constante ao provisionamento. A tela final
  em `join/[token]/join-wizard.tsx:762` informa `Teste gratis (7 dias)`.
- **Impacto:** a expectativa comercial e o periodo efetivamente provisionado divergem;
  isto pode gerar contestacao de cobranca e suporte desnecessario.
- **Correcao necessaria:** escolher o periodo contratual unico, reutilizar a mesma
  constante no texto da tela e cobrir a consistencia UI-servidor com teste.

#### P1-3 — Checklist pode declarar clinica pronta sem procedimento

- **Evidencia:** `dashboard/data.ts:124-146` so exige medico, horarios, paciente e
  WhatsApp. `configuracoes/procedimentos/page.tsx:2-5` declara que procedimento
  desbloqueia a Agenda; a ferramenta de agendamento tambem falha sem procedimentos.
- **Impacto:** a clinica conclui onboarding visualmente, mas nao consegue criar uma
  consulta normal.
- **Probabilidade:** alta para clinica que segue somente o checklist.
- **Correcao proposta:** adicionar procedimento ativo ao criterio e ao teste de
  checklist; criar E2E de clinica que tenta operar apos concluir os passos.

#### P1-4 — Exportacao LGPD nao envia o resultado por e-mail

- **Evidencia:** `patient/internal/handlers/lgpd-export-requested.ts:108-116`
  registra explicitamente `email send stubbed`; so gera URL assinada e metricas.
- **Impacto:** solicitacao de titular pode depender de intervencao manual, sem
  entrega automatica ou comprovante de notificacao.
- **Probabilidade:** certa quando o canal esperado for e-mail.
- **Correcao proposta:** prover entrega transacional, registrar entrega/falha e
  testar o ciclo completo de solicitacao, exportacao, notificacao e expiracao.

#### P1-5 — Funcionalidades de assinatura/feedback existem somente no worktree

- **Evidencia:** antes deste relatorio, 31 entradas pendentes incluiam telas de assinatura, dominio de troca
  de plano e migration `0072`; `HEAD == origin/main`, portanto nada disso esta no
  commit remoto atual.
- **Impacto:** o build local pode aparentar suportar fluxos que o deploy nao possui;
  schema e codigo podem divergir.
- **Probabilidade:** alta enquanto nao houver commit, revisao, migration e deploy.
- **Correcao proposta:** separar e revisar a mudanca, obter aprovacao para migration,
  aplicar primeiro em ambiente descartavel e so entao promover com verificacao real.

#### P1-6 — Fluxos criticos nao possuem teste de integracao/E2E executado

- **Evidencia:** ha apenas dois specs E2E. A execucao validou cinco cenarios
  anonimos e pulou navegacao autenticada e o fluxo mutavel paciente -> agenda ->
  caixa por falta de credenciais descartaveis. Nao foram encontrados testes de rota
  para o webhook Meta, nem testes de checkout/onboarding completos.
- **Impacto:** regressao em autenticacao, banco, permissao, pagamento, webhook e IA
  pode chegar ao deploy apesar dos 1.117 testes isolados passarem.
- **Correcao proposta:** criar ambiente de teste isolado, dados descartaveis e E2E
  para os cinco fluxos solicitados, com estado final e limpeza verificavel.

#### P1-7 — Isolamento RLS de producao nao foi comprovado

- **Evidencia:** o codigo usa `SET LOCAL ROLE authenticated` e RLS/`FORCE RLS`, mas
  documenta que a protecao fail-closed adicional depende de
  `DATABASE_URL_RUNTIME` com role sem `BYPASSRLS`. A configuracao local nao define
  essa variavel; a configuracao de producao nao foi acessada.
- **Impacto:** um caminho que burle `withTenant` depende do role efetivo do banco.
- **Correcao proposta:** provisionar e verificar o role de runtime em ambiente de
  producao supervisionado e executar testes RLS A/B contra o banco aplicado.

### Medios

#### P2-1 — Formatacao nao esta verde

- `prettier --check` falha tambem no recorte do produto (561 arquivos). O lint do
  produto passa, mas o Definition of Done de formatacao nao e atendido.
- Corrigir em mudanca mecanica separada, configurando ignores para worktrees internos
  antes de formatar para nao misturar reforma ampla com correcao funcional.

#### P2-2 — Sem cobertura percentual e sem budget de performance

- Nao ha configuracao/relatorio de cobertura. O build mostra First Load JS comum de
  189 kB e `/consultorio` com 300 kB, mas nao ha limite aceito, teste de carga ou
  metrica de latencia para aprovar ou reprovar esses valores.
- Criar cobertura em CI e limites de bundle/latencia acordados; executar carga contra
  ambiente isolado.

#### P2-3 — Validacao externa de WhatsApp, IA, Asaas e observabilidade e ausente

- O codigo possui HMAC, limite de payload, outbox, retries, janela de 24 h, handoff,
  healthchecks e metricas. Isso nao prova configuracao de webhook, templates
  aprovados, segredos, alertas ou entrega ao paciente.
- A evidencia manual mencionada para WhatsApp e contextual; ela nao substitui uma
  execucao registrada de webhook -> outbox -> Meta -> status.

## 6. Seguranca e pontos positivos validados estaticamente

- O middleware protege rotas internas, e testes E2E confirmaram redirecionamento de
  `/agenda`, `/caixa`, `/financeiro` e `/configuracoes` para `/login` sem sessao.
- O codigo usa rate limit, validacao Zod, permissoes, idempotencia e auditoria para
  mutacoes sensiveis; o teste AST de acoes criticas passou.
- O webhook Meta aplica limite de corpo e validacao HMAC antes de parsear; o webhook
  Asaas segue verify-then-act e tem teste de rota.
- RLS, migrations, encryption, redacao e acesso a tenant possuem testes unitarios e
  verificacoes estruturais aprovadas.
- A busca encontrou um unico `dangerouslySetInnerHTML`: o script constante de tema
  em `app/layout.tsx`, sem entrada de usuario. Nao foram encontrados `eval`,
  `new Function`, `document.write` ou `innerHTML` atribuivel em `src`.

Essas defesas sao evidencias positivas de codigo, mas nao substituem teste de banco aplicado, configuracao de provider e revisao de seguranca do checkout de cartao.

## 7. Matriz de go-live

| Item | Status | Justificativa |
|---|---|---|
| Arquitetura | ⚠ | Limpa estaticamente, mas ambiente/RLS real nao validado |
| Backend | ❌ | Bloqueadores de assinatura e e-mail |
| Frontend | ❌ | Mensagem falsa de e-mail e checklist inconsistente |
| Banco | ⚠ | Estrutura auditada; migrations e RLS de producao nao validados |
| Seguranca | ❌ | Checkout carrega dados de cartao pelo servidor |
| Convites | ❌ | Fluxo de clinica afirma envio de e-mail inexistente |
| Checkout | ❌ | Dados de cartao no servidor e provider real nao validado |
| Assinatura | ❌ | Cancelamento/reativacao incompletos e mudanca local |
| Dashboard | ⚠ | Renderiza, mas checklist permite estado nao operacional |
| Agenda | ⚠ | Dominio testado; E2E mutavel nao executado |
| Pacientes | ⚠ | Dominio testado; E2E mutavel nao executado |
| Financeiro | ⚠ | Dominio testado; E2E mutavel nao executado |
| WhatsApp | ⚠ | Codigo robusto, entrega/provider nao validados |
| IA | ⚠ | Unitarios e guards passam; provider real nao validado |
| LGPD | ❌ | Notificacao por e-mail esta em stub |
| Permissoes | ⚠ | Testes estruturais passam; banco aplicado nao validado |
| Observabilidade | ⚠ | Checks estaticos passam; alertas/dashboards externos nao validados |
| Performance | ⚠ | Build passa, sem carga nem budget |
| Testes automatizados | ⚠ | 1.117 passam, mas nao cobrem jornadas criticas completas |
| Testes E2E | ❌ | Apenas 5 cenarios anonimos passaram; 2 obrigatorios foram pulados |

## 8. Plano de correcao antes de receber clientes

1. Corrigir os P0: e-mail de onboarding e ciclo de cancelamento/reativacao Asaas.
2. Retirar PAN/CVV do servidor por tokenizacao ou checkout hospedado.
3. Exigir procedimento no checklist e criar o teste de operacao posterior.
4. Implementar entrega LGPD verificavel ou remover qualquer promessa de entrega
   automatica ate ela existir.
5. Versionar, revisar e aplicar em ambiente descartavel a migration e o codigo local
   de assinatura antes de considera-los parte do produto.
6. Configurar conta descartavel e banco isolado para executar E2E autenticado e
   mutavel; nao usar producao nem conta real.
7. Sob autorizacao explicita, executar smoke tests que escrevem/apagam dados de
   teste e as validacoes externas autorizadas de Asaas, Meta, Supabase Storage,
   RLS e alertas.
8. Tornar formatacao e cobertura mensuravel no CI, sem incluir worktrees internos.

## Parecer tecnico final

**Nao, o sistema nao esta apto para receber clientes reais neste estado.**

O codigo possui uma base arquitetural madura e as validacoes locais principais passam,
mas ha bloqueadores comprovados em comunicacao de e-mail, assinatura/cancelamento,
checkout de cartao, checklist operacional e entrega LGPD. Alem disso, os fluxos que
dependem de banco aplicado e integracoes externas permanecem **NAO VALIDADOS**.
