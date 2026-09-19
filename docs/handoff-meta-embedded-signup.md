# Handoff — D78 / Meta WhatsApp Embedded Signup

> Cole o conteúdo abaixo como prompt inicial para a IA que vai diagnosticar e implementar a correção.
> Este handoff separa configuração externa, contrato da Graph API e mudança de código; não pressupõe
> que um teste mockado ou uma tela verde no painel prove a jornada do cliente.

> **Atualização de 06/09/2026:** este arquivo preserva o brief que originou D78, mas as alternativas
> das seções 4, 7 e 9 foram superadas pela implementação. O runtime atual exige `waba_id` do evento,
> valida a allowlist de `debug_token` e `/{waba-id}/phone_numbers`, removeu o fallback
> `/me/businesses` e não usa `business_management` nem `whatsapp_business_manage_events`. O operador
> enviou para análise somente `public_profile`, mantendo na configuração ativa os dois escopos
> WhatsApp já aprovados. O E2E com conta externa continua `NOT TESTED` até a decisão da Meta.

---

Você é o Principal Engineer responsável por resolver o incidente **D78 — Meta WhatsApp Embedded
Signup** no Qoro. Trabalhe no repositório `C:\dev\ClinicaOS_V2` e responda sempre em português do
Brasil.

## 1. Leia antes de agir

1. Leia integralmente o `AGENTS.md` aplicável.
2. Leia `docs/qorov2.md`, principalmente `## Estado da execução — CANÔNICO` e a seção
   `### D78 — Embedded Signup indisponível para conta externa e contrato do token Meta`.
3. Inspecione o código e os testes ao redor destes arquivos antes de propor qualquer alteração:

   - `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx`
   - `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.test.tsx`
   - `src/contexts/messaging/actions.ts`
   - `src/contexts/messaging/connect-tenant.test.ts`
   - `src/contexts/messaging/internal/meta-onboarding.ts`
   - `src/contexts/messaging/internal/meta-onboarding.test.ts`

4. Preserve todo trabalho alheio já existente no worktree. Não faça commit, push, deploy, migration,
   alteração no painel Meta nem chamada externa mutável sem autorização explícita.

## 2. Incidente observado em 05/09/2026

Uma conta externa tentou conectar o WhatsApp no Qoro. O popup abriu corretamente e mostrou o login do
Facebook, mas, depois da autenticação, o próprio OAuth da Meta exibiu:

> Recurso indisponível. Como estamos atualizando detalhes adicionais para esse aplicativo, o Login do
> Facebook está indisponível para ele no momento. Tente novamente mais tarde.

O Qoro permaneceu aberto atrás do popup. A URL observada era um diálogo OAuth legítimo da Meta com:

- app `1935011047156678`;
- `config_id=2444333529395515`;
- `display=popup`, `response_type=code`, SDK `joey`, domínio `app.qoro.dev`;
- fallback para `https://app.qoro.dev/configuracoes/whatsapp`.

Portanto, **não parta da premissa de redirecionamento errado**. A tela de login do Facebook faz parte do
Facebook Login for Business. O erro apareceu dentro da Meta antes de o Qoro receber `code` e o evento
`FINISH` do Embedded Signup. Hoje, um callback sem `code` é mostrado pela UI como `CANCELLED`, mesmo
quando a Meta bloqueia o fluxo; registre isso como lacuna de diagnóstico, não como causa raiz já
demonstrada.

## 3. Estado externo já verificado

- O app está publicado desde 13/08/2026.
- O App Review enviado em 11/08/2026 aprovou:
  `whatsapp_business_management` e `whatsapp_business_messaging`.
- A configuração ativa `2444333529395515` chama-se **Integração com o WhatsApp**, usa Cadastro
  incorporado do WhatsApp, emite **token de acesso de usuário do sistema** e contém apenas os dois
  escopos WhatsApp acima.
- Existem duas configurações fora deste fluxo: `1569537438161678` (parceiro de mensuração) e
  `1619109852915075` (token com expiração em 60 dias).
- No caso de uso, `public_profile` e `whatsapp_business_manage_events` ainda aparecem somente prontos
  para teste. `business_management` exigia uma chamada obrigatória e o operador decidiu solicitar a
  permissão. Abrir “Ações” oferece adicionar uma nova análise do app.
- Não exponha nem solicite access token, App Secret, IDs pessoais, cursores, senha ou código de
  autenticação. Use payloads sanitizados.

## 4. Contrato atual do Qoro

- `whatsapp-connect.tsx` chama `FB.login` com `config_id`, `response_type=code` e
  `override_default_response_type=true`, sem lista explícita de scopes.
- O listener aceita `FINISH` e `FINISH_ONLY_WABA`, guarda `waba_id` e `phone_number_id` quando
  fornecidos e só completa a conexão quando possui o code e o evento.
- `connectMyClinicWhatsapp()` troca code por token, valida escopos, resolve WABA/telefone, registra o
  número, assina `subscribed_apps` e persiste a credencial cifrada.
- `REQUIRED_SCOPES` valida apenas `whatsapp_business_management` e
  `whatsapp_business_messaging`.
- `resolveWabaAndPhone()` valida primeiro o `waba_id` recebido do cliente consultando
  `/{waba-id}/phone_numbers`. Se o hint não for válido, cai em
  `GET /me/businesses → /{business-id}/owned_whatsapp_business_accounts → /{waba-id}/phone_numbers`.
- O repositório não usa `public_profile`, `whatsapp_business_manage_events` nem
  `/{phone-number-id}/whatsapp_business_profile`. Foto, bio, endereço e site continuam manuais porque
  essa feature ainda não existe.

## 5. Evidência real que os mocks não cobrem

No Graph API Explorer, usando a mesma configuração e o token exibido como **usuário do sistema**:

- `GET /me?fields=id,name`: sem resultado útil;
- `GET /me/businesses?fields=id,name`: sem resultado útil;
- `GET /me/business_users`: retornou uma lista de associações entre usuários do sistema e portfólios.

Não copie para logs ou documentação os IDs e cursores retornados. Esse teste demonstra que o fallback
atual não foi provado para o tipo de token configurado. Ele **não demonstra** que
`/me/business_users` seja substituto correto para `/me/businesses`: os objetos e relações são
diferentes.

Os testes focados executados em 05/09 passaram **30/30 em 2 arquivos**:

```powershell
node .\node_modules\vitest\vitest.mjs run `
  'src/contexts/messaging/internal/meta-onboarding.test.ts' `
  'src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.test.tsx' `
  --reporter=verbose
```

Eles são evidência de regressão local, não da Meta: o caso de fallback simula que
`/me/businesses` funciona.

## 6. Fontes oficiais obrigatórias

Use somente documentação oficial/primária para decidir o contrato. Verifique a versão atual antes de
implementar:

- [Meta — Embedded Signup](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup)
- [Meta — WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
- [Meta — Business Profiles](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-2e0565c0-6b03-4ced-ae8e-bf6534ef1125)
- [Meta — Graph API Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- [Meta sample — Business Messaging Tech Provider](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/README.md)

Concilie explicitamente estes pontos:

- a Cloud API declara como núcleo `whatsapp_business_management` e
  `whatsapp_business_messaging`; consultas ao portfólio exigem `business_management` e normalmente são
  desnecessárias;
- a documentação ampla de Embedded Signup descreve Advanced Access a `business_management` e
  `whatsapp_business_management`, token de usuário do sistema e endpoints por `Business-ID`;
- o sample de Tech Provider lista como mínimo de produção os dois escopos WhatsApp, publicação,
  redirects/domínios e App Roles para testes;
- Business Profile usa `whatsapp_business_management`; não confunda perfil do WhatsApp com
  `public_profile` do usuário Facebook.

Se a documentação oficial não confirmar um endpoint/edge para o tipo de token real, marque a decisão
como bloqueada. Não invente contrato a partir do nome do endpoint nem use respostas de comunidade como
autoridade.

## 7. Objetivo técnico

Produza um diagnóstico causal e implemente a menor correção segura para que uma conta externa consiga
concluir o Embedded Signup sem depender de um fallback incompatível com o token emitido.

Primeiro decida, com evidência oficial, entre:

1. **menor privilégio (preferido se o contrato permitir):** tornar `waba_id` do evento oficial
   obrigatório, validá-lo autoritativamente pelo token em `/{waba-id}/phone_numbers` e falhar com erro
   específico/sanitizado se o evento vier incompleto; remover a descoberta global de portfólios e não
   exigir `business_management` no runtime;
2. **descoberta de portfólio:** manter fallback somente se a Meta documentar o caminho correto para o
   token de usuário do sistema. Modele os tipos reais, paginação, deduplicação, ausência de itens e
   múltiplos portfólios/WABAs; valide cada asset antes de persistir. Nesse caso, alinhe
   `REQUIRED_SCOPES`, a configuração ativa e a justificativa do App Review a um uso atual demonstrável
   de `business_management`.

Não troque simplesmente `me/businesses` por `me/business_users`. Não afrouxe a proteção
anti-sequestro, não confie cegamente nos IDs vindos do navegador e não selecione o primeiro asset de
uma lista ambígua sem regra segura.

Também investigue se a resposta do SDK ou o evento `ERROR` oferece informação sanitizável para
distinguir indisponibilidade da Meta de cancelamento humano. Só altere `CANCELLED` se houver contrato
observável e teste correspondente; não tente adivinhar o texto exibido dentro do popup cross-origin.

## 8. Trabalho externo separado do código

Documente os passos exatos no painel para:

1. concluir o Advanced Access necessário ao fluxo realmente implementado, incluindo a situação de
   `public_profile` para usuários externos;
2. incluir na análise apenas permissões com uso atual demonstrável em vídeo e chamadas de teste;
3. atualizar a configuração ativa somente depois da aprovação, se o código final realmente exigir
   `business_management`;
4. retestar com uma conta externa sem App Role.

Não afirme que adicionar uma permissão à análise muda automaticamente a configuração ou o token já
emitido. Se for preciso um desbloqueio temporário do cliente, descreva apenas App Role **Tester** para o
perfil pessoal, aceite do convite e remoção posterior; nunca peça credenciais.

## 9. Testes e Definition of Done

Adicione ou ajuste testes que cubram, conforme a arquitetura escolhida:

- `FINISH` e `FINISH_ONLY_WABA` com IDs válidos;
- evento sem WABA e callback sem code;
- hint inacessível ao token sem aceitar asset de outro tenant;
- zero, um e múltiplos portfólios/WABAs, caso o fallback continue;
- paginação e duplicatas, caso o endpoint retorne coleções;
- escopo ausente coerente com as chamadas realmente mantidas;
- erro seguro para indisponibilidade/cancelamento, se o contrato permitir distingui-los;
- nenhuma persistência, registro ou assinatura após falha.

Descubra os comandos reais em `package.json` e execute, no mínimo:

1. testes focados do onboarding Meta e da UI;
2. typecheck;
3. lint dos arquivos alterados ou lint integral conforme o padrão do projeto;
4. build;
5. `git diff --check` e releitura do diff.

Não use mocks como prova do provider. Se não houver autorização para um E2E Meta externo, registre-o
como `NOT TESTED`, não `PASS`. Não faça deploy nem altere o painel Meta sem autorização.

## 10. Entrega obrigatória

Ao terminar:

1. atualize a seção D78 de `docs/qorov2.md` com a decisão, arquivos alterados, resultados exatos dos
   gates e evidência externa separada;
2. explique a causa raiz confirmada e as hipóteses descartadas;
3. liste claramente o que foi corrigido em código e o que ainda depende da Meta/App Review;
4. entregue ao operador o roteiro de painel e um roteiro de reteste externo;
5. não declare resolvido antes de uma conta sem App Role atravessar
   `popup → login → code → FINISH → WABA/telefone → register → subscribed_apps → persistência`.
