# ClinicaOS — Pentest E2E Completo

> Registro vivo da auditoria iniciada em 2026-08-14. Credenciais, tokens, magic links, dados
> clínicos e outros segredos não são registrados neste arquivo nem nos artefatos.

## 1. Informações da Execução

- Ambiente-alvo: produção (`https://app.qoro.dev`).
- Repositório: `C:\dev\ClinicaOS_V2`.
- Branch/commit inicial: `main` / `ebd047e` (`origin/main` no mesmo commit).
- Executor: agente Codex, sob autorização do prompt `PENTEST MASTER — CLINICAOS`.
- Status desta execução: `CONCLUÍDA COM BLOQUEIOS EXTERNOS — NO-GO`.
- Regra de resultado: somente `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED` ou `PARTIAL`.
- Regra de segurança: mutações e exclusões limitadas a fixtures de teste identificáveis; sem DoS,
  spam, alteração de infraestrutura global ou criação de recursos em provedores externos.

## 2. Ambiente Testado

| Camada | Alvo | Evidência atual | Status |
| --- | --- | --- | --- |
| Código | checkout local em `ebd047e` | `git status`, `git log -1` | `PASS` |
| Git remoto | `main == origin/main` no início; remoto avançou depois | `ls-remote`, diffs dos commits | `PASS` |
| CI | GitHub Actions run `31821822759`, SHA completo de `ebd047e` | consulta autenticada via `gh` | `PASS` |
| Documentação | 156 arquivos, 27.935 linhas, 2.254.028 bytes percorridos | inventário local | `PASS` |
| Produção web | `https://app.qoro.dev/login` | HTTP 200, servidor Vercel, HSTS/nosniff/DENY | `PASS` |
| Banco PROD | projeto Supabase de produção | inventário, mutações controladas e RLS A↔B | `PARTIAL` |
| Storage PROD | bucket clínico privado | probe próprio/cross-tenant/expiração/cleanup | `PASS` |
| Provedores externos | Meta, Gemini, Resend, Sentry, Better Stack, Asaas | health profundo + Gemini real; demais provas ainda incompletas | `PARTIAL` |

### Baseline documental reconciliado

O runbook local em `ebd047e` (`docs/runbooks/go-live-2026-08-11.md`) permanece com status global
`BLOQUEADO`. Durante a execução, o remoto avançou até `640bad85` por dois commits somente de
documentação e houve deployment Vercel bem-sucedido desse SHA; o código de aplicação implantado
continua equivalente a `ebd047e`. Nenhum resultado histórico é promovido a `PASS` desta execução
sem nova prova, salvo quando explicitamente identificado como baseline documental ou evidência
controlada do operador.

O alvo respondeu com CSP apenas em `Content-Security-Policy-Report-Only`; isso é inventariado como
hardening pendente e não como bypass comprovado. A CLI da Vercel não está instalada, portanto o
deployment foi correlacionado ao SHA atual pela CI e ainda requer uma prova direta do deployment.

## 3. Contas e Tenants Utilizados

| Referência segura | Tenant esperado | Papel declarado | Papel/permissões observados | Sessão | Uso |
| --- | --- | --- | --- | --- | --- |
| Clínica A / owner mascarado | A (`801a132224ef`) | Dono/Gestor | `owner`, 28 permissions, sem override | `PASS` | administração e A→B |
| Clínica A / médico mascarado | A (`801a132224ef`) | Médico | `doctor`, 13 permissions, sem override | `PASS` | RBAC |
| Clínica A / atendente mascarado | A (`801a132224ef`) | Atendente | `attendant`, 10 permissions, sem override | `PASS` | RBAC |
| Clínica A / financeiro mascarado | A (`801a132224ef`) | Financeiro | `financial`, 7 permissions, sem override | `PASS` | RBAC |
| Clínica B / owner mascarado | B (`28edcce0d634`) | a descobrir | `owner`, 28 permissions, sem override | `PASS` | B→A e fixture de equipe |
| Clínica C descartável | C | substituída pelo adendo | não criada | n/a | mutações destrutivas transferidas à Clínica A |

Nenhum endereço completo ou senha será incluído no relatório. A associação real entre conta,
tenant, role, status, MFA e capacidade será confirmada dinamicamente antes das mutações.

### AUTH-002 — Inventário autoritativo de contas, claims e capacidade

- Procedimento: consulta read-only em PROD com `RESET ROLE`, limitada aos cinco e-mails fornecidos,
  por `scripts/pentest-account-inventory.ts`; saída mascara e-mail, user ID e clinic ID com referência
  opaca.
- Resultado observado: 5/5 profiles encontrados, ativos, convites aceitos, sem MFA e sem overrides;
  quatro contas compartilham a referência da Clínica A e a quinta pertence à referência distinta da
  Clínica B.
- Plano: ambas `clinica`, billing `trial`, limite de cinco usuários.
- Capacidade: Clínica A 4/5 (uma vaga); Clínica B 1/5 (quatro vagas).
- Status: `PASS` para inventário e pré-condição; o lifecycle mutável continua separado.

### AUTH-001 — Login e navegação autenticada do owner A

- Data/hora: 2026-08-14, durante esta execução.
- Usuário: Clínica A / owner mascarado / papel declarado Dono-Gestor.
- Objetivo: comprovar login real, manutenção da sessão e ausência de respostas 5xx nas rotas
  estáticas e nas primeiras rotas dinâmicas existentes.
- Procedimento: Playwright Chromium contra `https://app.qoro.dev`; login pelo formulário real;
  visita sequencial das 25 rotas de `authenticated-readonly-routes.spec.ts`; acesso ao primeiro
  paciente e à primeira conversa expostos ao tenant.
- Resultado esperado: login leva a `/dashboard`; todas as rotas respondem abaixo de 500 e preservam
  a sessão; rotas dinâmicas existentes renderizam.
- Resultado observado: 25/25 rotas estáticas HTTP 200; paciente dinâmico `visited`; conversa
  dinâmica `visited`; 2/2 testes Playwright passaram em 82 s.
- Status: `PASS`.
- Limite da evidência: o teste comprova renderização e sessão do owner, não o comportamento dos
  botões, a autorização de outras roles nem isolamento A↔B.

## 4. Escopo

Aplicação web, rotas e ações; autenticação e sessão; RBAC e permissões granulares; isolamento
A↔B; IDOR; banco/RLS; Storage; LGPD; dashboard; agenda; consultório; pacientes; documentos;
financeiro; caixa; conversas/IA; relatórios; equipe; configurações; concorrência; idempotência;
outbox/jobs/crons; auditoria; erros; edge cases; integrações externas e prontidão de go-live.

Adendo operacional de 15/08/2026: o operador autorizou usar a Clínica A, em vez de criar uma
Clínica C, para testes destrutivos, equipe, permissões, exclusões, cancelamentos, convites, troca de
roles, concorrência, recuperação e dados inválidos. Permanecem obrigatórios dados sintéticos,
guardas exatas e cleanup verificável; o adendo não autoriza mutações externas no Asaas/Meta,
deploy, migrations ou ações fora da Clínica A.

## 5. Metodologia

1. Reconciliar documentação, código, migrations, configuração observável e testes existentes.
2. Inventariar rotas, Server Actions, permissões, entidades e superfícies mutáveis.
3. Autenticar contas de teste reais e confirmar tenant/role/permissões/capacidade.
4. Exercitar UI, backend e persistência; tentar bypass direto e troca de identificadores.
5. Usar fixtures sintéticas marcadas e cleanup exato em `finally`.
6. Preservar vídeo/screenshot/request/response somente quando não contiver bearer credentials ou PII.
7. Reproduzir cada falha, reduzir o caso e procurar variantes antes de classificá-la.

## 6. Inventário da Aplicação

### 6.1 Baseline conhecido do E2E de equipe

O teste `e2e/production-team-lifecycle.spec.ts` inventaria 25 rotas autenticadas e cobre owner,
gestor, médico, atendente e financeiro, convite/aceite, desativação/reativação, troca de função,
sessão antiga e cleanup exato. A execução atual passou na Clínica B (`TEAM-001`).

### 6.2 Cobertura a contabilizar

| Área | Página | Ação | Role | Permissão | Tenant | Testado | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inventário | todas | descobrir rotas/botões/forms/APIs | todas | todas | A/B/C | em andamento | `PARTIAL` |
| Shell estático | 25 rotas | renderizar e contar controles | owner A | efetiva a confirmar | A | sim | `PASS` |
| Shell estático | 25 rotas | renderizar sem 5xx | doctor/attendant/financial A e owner B | efetivas inventariadas | A/B | sim | `PASS` |
| Paciente dinâmico | primeiro disponível | detalhe read-only | owner A | efetiva a confirmar | A | sim | `PASS` |
| Conversa dinâmica | primeira disponível | detalhe read-only | owner A | efetiva a confirmar | A | sim | `PASS` |
| Paciente sintético | busca/detalhe/CRUD | IDOR e `clinic_id` adulterado | owners A/B | owner | A↔B | sim | `PASS` |

## 7. Matriz de Permissões

Foram encontradas 28 permissões canônicas e nenhum override inicial nas cinco contas.

| Role | Permissões efetivas observadas | Quantidade |
| --- | --- | ---: |
| `owner` | todas as 28 permissões canônicas | 28 |
| `doctor` | `create:patient`, `create:prescription`, `create:prontuario`, `edit:agenda`, `edit:patient`, `manage:availability`, `sign:prontuario`, `view:agenda`, `view:consultorio`, `view:conversations`, `view:patient`, `view:prescription`, `view:prontuario` | 13 |
| `attendant` | `create:patient`, `edit:agenda`, `edit:patient`, `manage:conversations`, `operate:caixa`, `view:agenda`, `view:consultorio`, `view:conversations`, `view:financial`, `view:patient` | 10 |
| `financial` | `export:audit`, `manage:financial`, `operate:caixa`, `view:agenda`, `view:audit`, `view:financial`, `view:patient` | 7 |

O inventário autoritativo é `PASS`. `PERM-002 PASS` comprovou `deny → grant → default`, persistência
e `claims_version` para as 28 permissões. O uso real da ação associada a cada uma ainda tem
cobertura parcial; `PERM-001` já provou ações representativas e encontrou os gaps de leitura.

O inventário estático de enforcement encontrou cinco codes sem consumidor em produção:
`view:agenda`, `view:prontuario`, `view:prescription`, `export:audit` e `manage:agent`. Os três
primeiros têm falha dinâmica em `AUTHZ-002/003`. Os dois últimos são exibidos e persistidos na UI
de equipe, mas não correspondem a uma ação tenant atual (`RBAC-001`).

## 8. Teste Multi-Tenant A↔B

| Recurso | A→B | B→A | CRUD | API | RLS | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Pacientes | bloqueado corretamente | bloqueado corretamente | create/read/update/delete | Server Actions | SELECT/INSERT/UPDATE/DELETE | `PASS` |
| Agenda/consultas | SELECT RLS bloqueado | SELECT RLS bloqueado | leitura | banco | fixtures reais | `PARTIAL` |
| Documentos/Storage | SELECT RLS + Storage bloqueados | SELECT RLS + Storage bloqueados | leitura/download | banco/Storage | fixtures reais | `PARTIAL` |
| Financeiro/Caixa | SELECT RLS bloqueado | SELECT RLS bloqueado | leitura | banco | fixtures reais | `PARTIAL` |
| Conversas/IA | SELECT RLS bloqueado | SELECT RLS bloqueado | leitura | banco | fixtures reais | `PARTIAL` |
| Equipe/permissões | SELECT RLS bloqueado | SELECT RLS bloqueado | leitura | banco | `profiles` com fixtures | `PARTIAL` |
| Configurações/relatórios | SELECT RLS bloqueado onde havia fixture | SELECT RLS bloqueado onde havia fixture | leitura | banco | fixtures parciais | `PARTIAL` |

### MT-001 — Isolamento A↔B de pacientes e IDOR

- Fixture: quatro pacientes sintéticos marcados, dois por tenant; dois cadastros incluíram um
  campo oculto `clinic_id` adulterado apontando para o outro tenant.
- UI/backend nas duas direções: a busca omitiu o outro tenant; a URL conhecida renderizou “Página
  não encontrada” sem qualquer dado do alvo; update e delete com UUID estrangeiro retornaram
  `patient not found`; o cadastro ignorou o `clinic_id` do cliente e persistiu no tenant da sessão.
- Observação HTTP: a página `notFound()` respondeu 200 por streaming do App Router, mas o DOM
  exibiu exclusivamente a tela de não encontrado. O teste não usa o status 200 como prova; exige o
  estado visual e ausência do nome/dados estrangeiros.
- Banco/RLS: sob `ROLE authenticated` e claims reais de cada owner, `SELECT` próprio=1 e cruzado=0;
  UPDATE/DELETE cruzados retornaram zero linhas; INSERT no `clinic_id` estrangeiro foi negado com
  PostgreSQL `42501`.
- Cleanup: a execução válida marcou exatamente 4/4 fixtures como excluídas e encontrou zero ativas.
  Contraprova global após todas as tentativas: zero `[E2E-MT-*]` ativas e dez soft-deleted.
- Resultado: 1/1 Playwright `PASS` em 1m12s; `MT-001 PASS`.

### MT-002 — Matriz read-only de RLS A↔B

- Procedimento: descoberta autoritativa das tabelas públicas com `clinic_id`; contagem
  administrativa A/B; repetição sob `ROLE authenticated` com `sub`, `clinic_id`, role e permissions
  efetivos de cada owner; comparação de total/próprio/cruzado nas duas direções.
- Cobertura: 99 tabelas/partições descobertas; 44 com registros reais de A ou B e 55 sem fixture.
  As fixtures cobriram, entre outras, agenda, prontuários, prescrições, documentos médicos,
  pacientes, perfis, financeiro, billing, IA/conversas, auditoria, LGPD, outbox e métricas.
- Resultado: todas as contagens A→B e B→A foram zero. Nas tabelas consultáveis, o total visível foi
  igual ao total próprio; `clinic_whatsapp_numbers` negou SELECT para `authenticated`.
- Estrutura: todas as 73 tabelas-raiz tenant-scoped tinham `RLS` e `FORCE RLS`. As 26 partições
  físicas de `ai_messages` e `audit_events` não têm flags próprias; a consulta direta às partições
  com dados retornou zero para ambos os owners, enquanto as tabelas-pai retornaram apenas as linhas
  próprias.
- Status: `PASS` em 54,9 s para isolamento de leitura/RLS nas 44 tabelas com fixture. UPDATE,
  DELETE, INSERT, Server Actions e UI/IDOR continuam gates separados, salvo `patients` em `MT-001`.

### MT-003 — IDOR clínico em rotas diretas

- Procedimento: usar IDs reais previamente existentes, confirmar primeiro que cada owner abre seu
  próprio objeto e então trocar pelo ID do outro tenant na rota; exigir not-found e ausência de
  iframe/URL assinada. Nenhum conteúdo, nome de paciente ou signed URL foi anexado.
- Cobertura bidirecional A→B/B→A: prescrição/PDF, documento médico/PDF e prontuário. Conversa foi
  coberta em B→A porque apenas A tinha uma conversa disponível.
- Resultado: 7/7 controles próprios renderizaram; 7/7 tentativas estrangeiras renderizaram “Página
  não encontrada”; PDFs estrangeiros não produziram iframe nem nome do paciente.
- Status: `PASS` em 35,3 s para os objetos/direções cobertos. Conversa A→B e mutações adulteradas
  dos domínios clínicos permanecem sem fixture/teste dinâmico.

### MT-004 — Matriz transacional de mutações RLS A↔B

- Procedimento: descoberta das tabelas-raiz tenant-scoped com fixture A/B; para cada linha-alvo,
  executar `UPDATE` sem alteração de valor e `DELETE` sob claims reais do tenant oposto, nas duas
  direções. Cada operação ficou isolada em savepoint e foi sempre revertida; nenhum dado persistente
  foi alterado.
- Cobertura: 42 tabelas-raiz com fixture, 142 probes cruzados e 72 controles próprios que afetaram
  uma linha. A matriz incluiu agenda, clinical, documentos, pacientes, financeiro/billing,
  IA/conversas, auditoria, LGPD, outbox, perfis e configurações.
- Resultado: 142/142 mutações cross-tenant afetaram zero linhas ou foram negadas pela policy; zero
  vazamentos. 1/1 Playwright `PASS`; teste em 2,0 min, execução total em 2,6 min.
- Limite: a matriz não executou `INSERT` sistemático nem Server Actions/UI; `patients` já cobre
  `INSERT` cruzado em `MT-001`.

## 9. Teste RBAC

| Área | Gestor | Médico | Atendente | Financeiro | Granular |
| --- | --- | --- | --- | --- | --- |
| Shell/rotas sem 5xx | `PASS` | `PASS` | `PASS` | `PASS` | não aplicável |
| Bundles efetivos | inventariado | inventariado | inventariado | inventariado | 28/28 lifecycle `PASS` |
| Ação de negócio por permission | parcial | parcial | parcial | parcial | `PARTIAL` |

Contraprova adicional de least privilege: o médico sem `manage:settings` foi corretamente bloqueado
em Perfil e Assinatura, mas acessou o estado e os controles da conexão WhatsApp (`AUTHZ-006 FAIL`).
Nenhuma action de conexão/desconexão foi executada; os gates fresh dessas mutações permanecem
confirmados por código e testes unitários, não por mutação externa durante este pentest.

## 10. Teste de Permissões Granulares

### PERM-001 — Lifecycle representativo e tentativas de autoelevação

- Conta alvo: atendente de teste da Clínica A, inicialmente sem overrides.
- `manage:procedures`: `NEGADO → CONCEDIDO → SESSÃO ANTIGA REVOGADA → FUNCIONA → REMOVIDO →
  SESSÃO REVOGADA → NEGADO` comprovado por UI, JWT e `effective_permissions_v`.
- Replay direto: o POST real da Server Action de concessão foi repetido com a sessão do atendente;
  `requireFreshPermission('manage:permissions')` negou, a resposta foi HTTP 500 e nenhum override
  foi persistido.
- Autoelevação no banco: INSERT próprio em `user_permission_overrides` e UPDATE do próprio role
  para `owner`, sob `ROLE authenticated` e claims reais, foram negados (`42501`/zero linhas).
- `view:patient`: o owner aplicou override `deny`; a sessão antiga morreu; uma nova autenticação
  produziu JWT sem a permissão e a view efetiva também não a continha. Mesmo assim, `/pacientes`
  exibiu um paciente ativo e `/pacientes/[id]` revelou CPF descriptografado.
- Matriz de leitura: com `view:agenda`, `view:consultorio`, `view:conversations`, `view:financial` e
  `view:patient` simultaneamente negadas no JWT/view efetiva, Agenda exibiu o paciente de uma
  consulta (`FAIL`), enquanto Consultório, Conversas e Financeiro mostraram o estado “Sem acesso”
  (`PASS`).
- Clínica/documentos: o atendente nunca possuiu `view:prescription` nem `view:prontuario`, mas
  `/documentos` exibiu documento/paciente e uma rota direta de PDF emitiu URL assinada cujo arquivo
  foi baixado com HTTP 200/`application/pdf` (`FAIL`). `/modelos-receita` exibiu “Novo modelo” sem
  `create:prescription` (`FAIL` de UI/rota; as actions permanecem gateadas). A variante posterior
  `AUTHZ-003-V1` criou um prontuário sintético na Clínica A e confirmou que atendente e financeiro,
  sem permissões clínicas, veem hub, deep-link e SOAP decifrado; o autosave continuou negado.
- Cleanup: a execução final removeu 5/5 overrides e encontrou zero restantes; uma consulta
  independente pós-teste confirmou `remaining=0`. Uma interrupção
  anterior deixou cinco denies; a recuperação usou guardas exatas de conta/role/códigos/valor,
  removeu exatamente cinco e também confirmou zero restantes.
- Resultado: `FAIL` por `AUTHZ-001`, `AUTHZ-002`, `AUTHZ-003` e `AUTHZ-004`. Os subtestes de
  concessão/revogação de `manage:procedures`, replay, autoelevação e as negativas de
  Consultório/Conversas/Financeiro foram `PASS`.

### PERM-002 — Lifecycle das 28 permissões canônicas

- Conta alvo: atendente de teste da Clínica A, começando sem qualquer override.
- Procedimento: para cada permission code, o owner aplicou `deny`, `grant` e `default` pela UI real;
  após cada Server Action, o teste conferiu override, presença/ausência em
  `effective_permissions_v` e incremento de `claims_version` antes de prosseguir.
- Resultado: 28 denies, 28 grants e 28 restaurações; 84/84 transições persistidas; delta final de
  `claims_version=84`; permissions finais idênticas ao bundle inicial; zero overrides finais.
- Cleanup: `removed=0, remaining=0`, pois todas as 28 permissões já estavam em `default` ao fim do
  fluxo normal.
- Status: `PASS` em 3,9 min para criação, alteração, revogação, persistência e restauração dos
  overrides. O teste não aprova por si só a enforcement point de cada ação de negócio; essa matriz
  permanece `PARTIAL` e já tem falhas reproduzidas em `AUTHZ-001/002/003/004`.

## 11. Teste de Alteração e Revogação de Permissões

`PERM-001 PARTIAL`: a alteração persistiu, incrementou `claims_version` e invalidou a sessão antiga
imediatamente tanto na concessão quanto na revogação. O acesso a procedimentos acompanhou a claim.
As negações de leitura foram aplicadas corretamente por Consultório, Conversas e Financeiro, mas
Pacientes e Agenda continuaram retornando dados (`AUTHZ-001/002 FAIL`). Documentos também retornou
dado clínico a uma role sem as permissões clínicas (`AUTHZ-003 FAIL`).

`PERM-002 PASS`: todas as 28 permissions completaram `deny/grant/default`, cada transição bumpou a
versão e o estado final voltou exatamente ao bundle do atendente, sem override residual.

### TEAM-001 — Lifecycle mutável de equipe na Clínica B

- Pré-condição: owner B ativo, plano `clinica`, 1/5 usuários, quatro vagas livres.
- Procedimento executado: criar/aceitar Gestor, Médico, Atendente e Financeiro; validar role e
  tenant nos JWTs; visitar 25 rotas como cada role; comprovar que somente gestor vê administração
  de equipe; desativar Atendente mantendo sua sessão aberta; tentar `/dashboard`; reativar;
  autenticar novamente; logout e tentativa direta de `/equipe`; trocar Financeiro→Atendente,
  recarregar e restaurar Atendente→Financeiro.
- Backend/banco: Auth users e profiles temporários criados pelo fluxo real; claims conferidos;
  persistência da role validada após reload; cleanup administrativo exato no `finally`.
- Resultado observado: 1/1 Playwright `PASS` em 2m24s. Sessão do usuário desativado foi enviada a
  `/login` sem 500; usuário reativado voltou a autenticar; logout bloqueou acesso direto; trocas de
  role persistiram.
- Cleanup: Auth users temporários removidos; query pós-teste encontrou somente o owner B, 1/5
  usuários e quatro vagas novamente.
- Status: `PASS` para lifecycle de equipe/roles/desativação. Overrides granulares por permissão,
  tentativa de autoelevação e A↔B ainda são gates separados.

### TEAM-002 — Matriz exaustiva de transições de role na Clínica A

- Adendo aplicado: foi usada a única vaga livre da Clínica A (4/5), sem criar Clínica C nem alterar
  as quatro contas permanentes.
- Fixture: convite real pela UI para um colaborador sintético `attendant`; aceite por link de
  recovery administrativo limitado à conta recém-criada, sem depender de inbox.
- Matriz: nove transições exigidas (`attendant→doctor/financial/gestor`,
  `doctor→attendant/financial/gestor`, `financial→attendant/doctor/gestor`) e três pontes para formar
  uma sequência única; role final restaurada para `attendant`.
- Provas por transição: 12/12 sessões antigas redirecionadas a login sem 5xx; 12/12 novos JWTs com
  `app_role` correto; 12/12 incrementos unitários de `claims_version`; 12/12 bundles efetivos iguais
  a `role_permissions`; zero overrides; 12/12 auditorias `internal.user.role_changed`; UI de Equipe
  disponível somente quando a role era `gestor`.
- Resultado: 1/1 Playwright `PASS` em 1,3 min. Cleanup removeu Auth user/profile sintético, 13
  auditorias e a idempotência do convite; contraprova externa encontrou zero Auth user, profile,
  outbox ou auditoria residual e a Clínica A voltou a 4 usuários ativos.

### TEAM-003 — Convite e cancelamento concorrentes no limite da Clínica A

- Pré-condição autoritativa: owner com `manage:employees`, exatamente 4/5 usuários ativos, zero
  convite pendente e zero conta prévia para os dois e-mails sintéticos `example.test`.
- Convite: dois browsers autenticados como owner dispararam Server Actions simultâneas para ocupar a
  única vaga. Ambas responderam HTTP 200; uma retornou sucesso e a outra o estado controlado de
  upgrade. O pico foi 5/5, com um profile pendente, um Auth user, uma auditoria e uma idempotência; o
  Auth user criado externamente pelo perdedor foi compensado.
- Cancelamento: os dois browsers abriram a mesma linha pendente e confirmaram o cancelamento ao mesmo
  tempo. Uma operação venceu e a outra foi rejeitada de forma controlada, ambas HTTP 200; houve uma
  única auditoria `invite_cancelled` e o Auth user/profile desapareceram.
- Resultado: 1/1 Playwright `PASS` em 17,2 s. Cleanup removeu as duas auditorias e a idempotência;
  contraprova final em zero e Clínica A novamente em 4/5. O teste exerceu Supabase Auth somente com
  endereços sintéticos; não dependeu de inbox e não tocou Asaas ou Meta.

## 12. Teste de Autenticação e Sessões

`AUTH-001 PASS`: login real do owner A, navegação por 25 rotas, paciente e conversa dinâmica com
sessão preservada. `AUTH-003 PASS`: na conta owner B, o fluxo real ativou TOTP, confirmou código,
elevou o JWT a `aal2`, persistiu `mfa_enrolled_at`, sobreviveu a reload e removeu o fator. O teste
terminou com zero fatores e a contraprova de inventário confirmou `mfaEnrolled=false`. `TEAM-002`
acrescentou 12 revogações imediatas de sessões por troca de role, sempre seguidas de nova
autenticação coerente. `AUTH-005 FAIL` aprofundou o logout: o browser que clicou em Sair foi limpo e
o refresh token foi revogado, mas o cookie pré-logout e uma segunda sessão continuaram autorizados.
`RECOVERY-001` comprovou o link real de uso único e a política de senha do provedor, mas revelou que
uma sessão comum redefine senha e que access tokens antigos sobrevivem à troca. Expiração temporal
natural continua pendente.

O Sentry confirmou a revogação de `PERM-001` como `AuthError/CLAIMS_OUTDATED` em `/pacientes`.
Também confirmou o replay não autorizado como `AuthError/PERMISSION_DENIED` em
`setMemberOverrideAction`. O primeiro é uma negativa esperada que foi capturada como exceção; o
segundo chegou ao cliente como HTTP 500 apesar de carregar semântica interna 403. Ver `OBS-001`.

### AUTH-004 — Boundary sem sessão

- Procedimento: requests sem cookies e sem follow de redirect contra 28 rotas estáticas protegidas
  e seis rotas com IDs reais (paciente, prontuário, prescrição/PDF, documento/PDF, conversa e
  clínica no admin).
- Resultado: 34/34 responderam HTTP 307 com `Location: /login`, inclusive `/account/security`, que
  é exceção do matcher e depende do guard da própria página; zero 5xx.
- Headers do login: HSTS presente, `X-Content-Type-Options: nosniff` e `X-Frame-Options: DENY`.
  `Content-Security-Policy` não está enforced; existe apenas
  `Content-Security-Policy-Report-Only`, mantido como hardening pendente.
- Status: `PASS` em 6,6 s para as rotas testadas.

### AUTH-005 — access token continua válido após logout global

- Fixture: um atendente sintético temporário ocupou a quinta vaga da Clínica A, sem envio de e-mail;
  duas sessões reais abriram o Dashboard antes do teste.
- Ação: `POST /logout` respondeu 303, removeu a sessão do contexto que clicou em Sair e revogou o
  refresh token. Uma cópia mantida somente em memória dos cookies anteriores foi reapresentada, e a
  segunda sessão também fez novo request após o logout.
- Resultado observado: os dois contexts antigos continuaram acessando `/dashboard`. Depois da
  exclusão do Auth user/profile, o mesmo cookie foi negado, confirmando que o gate autoritativo reage
  a mudança de profile, mas que o logout isoladamente não altera o epoch.
- Cleanup: Auth user e profile removidos, Clínica A novamente em 4 membros e zero auditoria/
  idempotência sintética. Status: `FAIL`, P1 de revogação; nenhum token/cookie foi persistido.

### RECOVERY-001 — redefinição, política, revogação e uso único

- Uma sessão normal do atendente sintético navegou diretamente para `/reset-password`; o formulário
  ficou disponível sem link de recovery ou senha atual e aceitou uma nova senha forte.
- A senha fraca de oito caracteres iguais foi rejeitada sem alterar a credencial. Depois da troca
  direta, a senha original falhou e a nova autenticou, comprovando a mutação efetiva.
- A segunda sessão teve o refresh token revogado, mas continuou acessando o Dashboard com seu access
  token anterior. O mesmo ocorreu depois de um recovery legítimo subsequente.
- O link sintético legítimo passou por `/auth/confirm`, definiu a senha final e foi negado na segunda
  utilização. Senha intermediária falhou e senha final autenticou.
- Exclusão do usuário bloqueou o token antigo. Cleanup retornou a Clínica A a 4 membros e zerou
  Auth/profile/auditoria/idempotência sintéticos. Status da execução: `PASS`; achados `AUTH-006/007`.

## 13. Dashboard

Renderização autenticada `PASS` para as cinco contas. `DASHBOARD-001 PASS`: no baseline atual,
timezone, quatro KPIs operacionais, “Próximos”, checklist 5/5 oculto, cinco atividades do owner e a
negativa de atividade ao médico coincidiram com o banco/permissões; Atualizar preservou o estado. A
contraprova sintética não-zero inseriu cinco consultas retroativas (`agendado`, `confirmado`,
`chegou`, `em_atendimento`, `atendido`): a UI e o banco coincidiram em 5 consultas, 1 aguardando,
1 em atendimento, 1 finalizada e três próximos Walk-ins; cleanup por IDs restaurou o baseline zero
sem fila, state log, reserva, outbox, auditoria ou idempotência residual. `AUTHZ-005 FAIL`: o médico sem
`view:financial` viu saldo “A receber” exatamente igual ao banco e o gráfico real não zero dos
últimos sete dias; `/financeiro` o bloqueou e Relatórios omitiu o card financeiro, confirmando que o
Dashboard é a exceção insegura.

## 14. Agenda

`FLOW-001 PASS`: agendamento futuro persistido; encaixe criado e corrigido para cancelamento
excepcional; segundo encaixe chamado, atendido e encerrado. Banco pós-teste: três appointments da
fixture nos estados `cancelado`, `cancelado`, `atendido`. `CONC-002 PASS`: duas criações simultâneas
para o mesmo profissional/horário tiveram um único vencedor e conflito controlado. `RECOV-001 PASS`:
na Clínica A, duas fixtures sintéticas cobriram transferência, interrupção, cancelamento
excepcional e reabertura; transferência para o mesmo médico e reabertura a partir de `agendado`
foram rejeitadas sem persistência. Dois submits com a mesma key de interrupção devolveram sucesso,
mas produziram exatamente uma correção/auditoria/outbox/idempotência. Quatro correções válidas
produziram quatro linhas em cada trilha, e o ciclo terminou em `agendado`. Reagendamento real via IA,
e mutações A↔B pela aplicação permanecem pendentes. O algoritmo de timezone da recorrência foi
testado separadamente e falhou em transição DST (`DATA-008`). `AUTHZ-002 FAIL`: após negar
`view:agenda` e renovar a sessão, a rota direta ainda exibiu o paciente de uma consulta. A
transferência também revelou `DATA-001`: a Agenda mostrou o novo médico, mas o snapshot persistido
continuou com o anterior.

`CONC-006 PASS`: owner e atendente abriram o mesmo agendamento na Clínica A e enviaram duas
transferências para o owner com motivos e chaves idempotentes distintos, separadas por 121 ms. Os
dois envelopes da Server Action responderam HTTP 200, mas somente uma UI fechou como sucesso e a
outra permaneceu aberta com o conflito de estado obsoleto. A serialização no banco confirmou um
único vencedor: profissional final alterado, uma correção `transfer`, uma auditoria, um evento e uma
idempotência. Cleanup removeu as duas fixtures e deixou oito classes relacionadas em zero.

`JOURNEY-ROLE-A PASS`: a primeira tentativa de encaixe às 02:25 foi corretamente rejeitada por
ausência de capacidade operacional. O médico configurou pela UI uma janela sintética temporária
para sábado; depois o atendente criou um paciente e um único encaixe atribuído ao médico. A janela e
todos os dados associados foram removidos, com contraprova independente de zero resíduos.

`RECURRENCE-001 PARTIAL/FAIL`: o atendente criou pela UI uma consulta isolada e depois uma série de
três ocorrências semanais. As três persistiram com `occurrence=1/2/3`, sobreviveram ao refresh e a
entrada `105` foi rejeitada em HTTP 200 sem série. Porém, a segunda ocorrência foi aceita no mesmo
dia em que o mesmo paciente já tinha outra consulta ativa com o mesmo médico (`DATA-007`), totalizando
duas; a guarda diária avaliou apenas a primeira data. A Agenda também não mostrou que os itens eram
recorrentes nem ofereceu cancelamento da série (`UX-003`), embora `cancelRecurringSeries()` exista no
domínio sem caller implantado. Como controle positivo, um conflito exato na segunda ocorrência
reverteu atomicamente série e primeira ocorrência. Intervalo, quantidade e observações não tinham nome
acessível (`A11Y-002`). Cleanup integral terminou com sete classes de resíduos em zero.

`WAITLIST-001 PARTIAL/FAIL`: atendente criou entradas normal e urgente com período preferencial. Um
intervalo invertido persistiu zero, mas respondeu HTTP 500 (`OBS-002`). Depois, um atendimento
sintético `em_atendimento` foi cancelado pelo fluxo humano real de correção: a consulta ficou
`cancelado`, porém as duas entradas continuaram `waiting`, sem evento `waitlist.offered` e sem
mensagem (`WAIT-001`). O evento de oferta está em `PRODUCER_AHEAD` sem handler; mesmo se produzido,
`markWaitlistEntryBooked()` também não possui caller/UI. Os sete controles do formulário não tinham
nome acessível (`A11Y-003`). As entradas foram encerradas pela UI e o cleanup ficou integralmente zero.

`APPOINTMENT-IMPORT-001 PARTIAL/FAIL`: owner importou pela UI um lote histórico com três consultas
(`atendido`, `cancelado`, `faltou`), proveniência, state logs, auditoria e eventos coerentes; o lote
sobreviveu ao refresh. Data futura e um identificador de profissional da Clínica B foram rejeitados
em HTTP 200 com rollback total, e o atendente foi bloqueado tanto na rota quanto na Server Action
reapresentada. O replay idêntico não duplicou nada. Porém, o worker contabilizou os três appointments
de 2001 no uso de agosto/2026 (`37→40`, `DATA-009`), e um segundo lote diferente na mesma página foi
rejeitado porque o formulário reutilizou a chave idempotente do primeiro (`UX-004`). O cleanup
removeu as oito classes sintéticas e decrementou exatamente as três unidades pelo ledger.

## 15. Consultório

`FLOW-001 PASS`: dois encaixes apareceram no consultório, foram chamados e abriram o atendimento;
um foi corrigido/cancelado e o outro recebeu prontuário, prescrição, documento, assinatura e
encerramento. Banco: dois prontuários, um assinado. `MT-003 PASS`: a rota direta de prontuário
bloqueou o ID do outro tenant nas duas direções.

`Jornada 2 PASS`: o atendente visualizou a fila do encaixe que criou. `Jornada 3 PASS`: o médico
atribuído abriu paciente e agenda, chamou o encaixe no Consultório, salvou conteúdo clínico
sintético, assinou o prontuário e encerrou a consulta; Perfil e Equipe permaneceram negados.

`CONSULTORIO-INTEGRITY-001 FAIL`: a jornada adversarial na Clínica A comprovou que o atendente, com
`edit:agenda`/`view:consultorio` e sem `create/sign:prontuario`, recebe “Chamar” e “Encerrar consulta”.
Ele levou um encaixe de `chegou→em_atendimento→atendido` antes de existir prontuário. O médico abriu a
consulta já finalizada e recebeu “somente leitura” sem registro; o worker criou depois um rascunho
vazio, não assinado e atribuído ao médico. Após o worker, a mesma tela dizia “somente leitura”, mas
expunha textarea editável sem opção de assinatura. Em paralelo, o evento de conclusão foi processado
e criou lançamento automático pendente de valor positivo (`AUTHZ-008`).

`CONSULTORIO-NOSHOW-001 FAIL`: o agendamento pré-check-in mostrou somente “Check-in”; depois de
`chegou`, o único “Marcar ausente” apareceu, mas a action respondeu HTTP 200 com erro de etapa e
preservou `chegou`/fila `waiting`. Banco: zero transição para `faltou`, state log, evento, auditoria ou
idempotência. A UI e a máquina de estados não oferecem qualquer caminho humano funcional para falta
(`STATE-001`). A mesma execução consolidada também comprovou a corrida Agenda A×B descrita em
`CONC-006`, sem duplicação ou resíduos.

## 16. Pacientes

`FLOW-001 PASS`: validação nativa de campo obrigatório; CPF sintético inválido rejeitado preservando
os demais campos; paciente sintético criado, persistido e editado. O encerramento criou solicitação
LGPD e marcou o paciente como excluído. `MT-001 PASS`: busca, detalhe e CRUD adulterado foram
bloqueados nas duas direções A↔B. `AUTHZ-001 FAIL`: com `view:patient` efetivamente negada, a lista
exibiu paciente e o detalhe revelou CPF descriptografado.

`PATIENT-FLOW-001 PARTIAL`: na Clínica A, nome Unicode/emoji/HTML-like foi buscado e renderizado como
texto, sem XSS; busca SQL-like não ampliou resultados; nome com 121 caracteres foi rejeitado pelo
backend sem persistência; IDs malformado e inexistente não produziram 5xx. Auto-relacionamento e
merge para o próprio cadastro/UUID inexistente foram rejeitados, e o vínculo válido, repetido quatro
vezes com a mesma chave, persistiu uma única linha/auditoria/outbox/idempotência. Data de óbito futura
foi rejeitada; o registro válido com quatro replays ficou exactly-once e criou três supressões. O
backend recusou agendamento do falecido, embora a UI ainda o ofereça (`UX-001`). Duas edições
simultâneas por owner/atendente foram aceitas sem conflito (`DATA-002`). Duas exclusões simultâneas
resultaram em um único delete/evento (`PASS`), mas não há recuperação operacional (`PAT-001`).
Também não existe entrada implantável para conceder/revogar consentimento (`LGPD-005`). Merge válido
continua `NOT TESTED`: seu histórico é append-only e não há cleanup suportado para uma fixture na
Clínica A.

## 17. Documentos

`FLOW-001 PASS`: uma prescrição e um documento médico emitidos; ambos abriram PDF pela rota do
servidor e persistiram `pdf_storage_path`. Download cross-tenant e expiração de URL foram tratados
no gate de Storage. `AUTHZ-003 FAIL`: o atendente, sem `view:prescription` e sem
`view:prontuario`, acessou `/documentos`, viu documento/paciente e baixou por URL assinada o PDF de
uma rota direta (`HTTP 200`, `application/pdf`). `AUTHZ-004 FAIL`: a mesma role, sem
`create:prescription`, viu o controle “Novo modelo”; as actions de template têm gate próprio.
`MT-003 PASS`: owners não abriram prescrições ou documentos/PDFs do outro tenant nas duas direções.
O inventário confirmou que não existe upload/alteração/exclusão de arquivo de paciente no produto
implantado: “documento” é prescrição/documento médico gerado pelo servidor. Logo, esses três itens do
prompt não foram marcados como falha de uma feature inexistente; geração, associação, PDF, rota
direta, bucket privado, signed URL, expiração, objeto inexistente e troca A↔B são os contratos reais.

## 18. Financeiro

`FLOW-001 PASS`: lançamento manual de R$ 12,34 criado, recebido e reembolsado; estado final
`estornado`. Banco: exatamente duas transações imutáveis (`payment` e `refund`) de R$ 12,34, com o
refund ligado ao pagamento original.

`Jornada 4 PASS`: o perfil Financeiro criou um recebível manual sintético de R$ 10,01, confirmou o
pagamento no Caixa e viu o card financeiro em Relatórios; o Consultório foi corretamente negado.
O lançamento e sua transação foram removidos no cleanup exato.

`CONC-003 PASS`: Financeiro e Atendente tentaram receber simultaneamente o mesmo lançamento
sintético. Um único pagamento venceu; o outro recebeu rejeição de saldo controlada, sem 5xx. O
ledger terminou com uma transação e o valor pago exatamente igual ao lançamento.

`FINANCIAL-LIFECYCLE-001 PARTIAL/FAIL`: quatro valores inválidos (`-1`, zero, acima do limite e
não numérico) foram rejeitados com alerta e zero persistência; `10,005` foi arredondado de forma
consistente para R$ 10,01; uma despesa pendente foi cancelada com uma única auditoria. O ciclo
multipartes revelou `DATA-003`: após receber R$ 3,33 + R$ 6,67 e reembolsar integralmente as duas
transações, o ledger líquido ficou correto, mas o lançamento original e as duas compensações
continuaram `pago`. O original permaneceu no filtro “Pago”, não apareceu em “Estornado” e já não
oferecia novo reembolso.

`SUPPLIER-LIFECYCLE-001 PARTIAL/FAIL`: owner criou um fornecedor, o Financeiro editou, a Clínica B
não viu a fixture e a desativação removeu corretamente o fornecedor do formulário de despesa; a
reativação o restaurou. Nome HTML-like foi renderizado como texto. O fluxo revelou `DATA-004` (duas
edições concorrentes aceitas sem conflito) e `VAL-001` (CNPJ `1` aceito e persistido).

`COLLECTION-001 PASS/PARTIAL`: inventário read-only inicial encontrou zero candidatos, casos ou jobs
de cobrança na Clínica A; heartbeats `billing-dunning`/`proactive-dunning` estavam `success` com zero
processado. Em fixture manual sem vencimento — portanto fora do scanner e incapaz de enviar mensagem
— a guarda A→B rejeitou o vínculo, dois upserts idênticos produziram um caso/uma auditoria, a
quitação resolveu exatamente uma vez e o replay retornou zero. D+3/D+7 com entrega externa continua
`NOT TESTED/BLOCKED`.

### ASAAS-001 — Produção, webhooks e primeira cobrança

- Probe Production repetido em 15/08/2026 com `ASAAS_BASE_URL_PROD=https://api.asaas.com/v3` e chave
  `$aact_prod_...`: `GET /myAccount` respondeu HTTP 200. A URL recebida inicialmente apontava para
  Sandbox e foi corrigida localmente antes de qualquer mutação.
- Inventário PROD read-only: 2 billing customers com customer ID, 2 subscriptions `trial` com
  subscription ID e 2 invoices `open` com payment ID. O heartbeat `billing-reconcile` está
  `success`; o detalhe contém os contadores esperados de pagamentos/subscriptions.
- Histórico: 4 `PAYMENT_CREATED` (2 ainda correlacionados a clínica ativa) e 1
  `PAYMENT_REFUNDED` sem clínica atual; a FK é `SET NULL` no offboarding, então os três órfãos são
  compatíveis com clínicas de teste já removidas e não foram classificados como bug.
- Clínica A pré-mudança: referência `801a132224ef`, plano `clinica/monthly`, R$ 349, uma assinatura
  Asaas `ACTIVE`, uma única cobrança `PENDING` em cartão, invoice local `open`, zero tentativas,
  vencimento/trial em 24/08/2026 e próxima recorrência em 24/09/2026. Customer, subscription e
  payment foram cruzados por igualdade de IDs sem imprimi-los.
- A tentativa autorizada de simular o fim dos 14 dias não chegou ao cartão. O Asaas rejeitou, sem
  mutação financeira, três estratégias sobre os mesmos objetos: adiantar a próxima recorrência
  (`invalid_nextDueDate`), adiantar diretamente a cobrança (`invalid_dueDate`) e aplicar
  `nextDueDate=hoje` com `updatePendingPayments=true` (`invalid_nextDueDate`). Após cada 400, o relógio
  local foi restaurado do snapshot e uma nova leitura confirmou o baseline original.
- O operador confirmou no painel a causa de negócio da recusa: “Não é possível antecipar cobranças
  em que o CPF do pagador pertence ao quadro societário da empresa”. Isso explica os HTTP 400 da
  antecipação, mas não seria causa para pular a tentativa automática no vencimento normal.
- Auditoria read-only de webhook em 15/08: `GET /webhooks` Production respondeu 200, provando
  permissão da chave; há um único destino `https://app.qoro.dev/api/webhooks/asaas`, `enabled=true`,
  `interrupted=false`, API v3. Ele assina `PAYMENT_CREATED`, `CONFIRMED`, `RECEIVED`, `OVERDUE` e
  `REFUNDED`. O `PAYMENT_CREATED` da Clínica A foi aceito pelo endpoint e gravado no banco em 10/08,
  portanto URL, token e lookup autoritativo do payment funcionaram nesse fluxo.
- Inventário completo da conta Asaas encontrou quatro cobranças: duas de cartão ainda futuras
  (`PENDING`, 24/08 e 28/08), uma cobrança recorrente de cartão de R$ 349 vencida em 29/07 que foi
  `CONFIRMED` no próprio dia 29/07 e depois `REFUNDED`, e um PIX recebido. Não existe hoje cobrança
  com vencimento anterior a 15/08 ainda pendente/overdue. A API consultada não informa se a captura
  de 29/07 foi automática ou acionada no painel, mas prova que ela foi efetivamente confirmada antes
  do estorno.
- Detalhe financeiro da cobrança de 29/07: valor bruto R$ 349, líquido previsto R$ 341,57,
  `estimatedCreditDate/creditDate=31/08/2026`, sem antecipação. O estorno integral de R$ 349 ficou
  `DONE` em 14/08, antes da liberação, e a consulta ao extrato do período retornou zero lançamento
  relacionado. Portanto, “confirmada no cartão” não significava saldo já disponível; o valor nunca
  seria recebido após o estorno.
- Busca em `src/` e `scripts/` encontrou somente consumo de `PAYMENT_REFUNDED`; não existe chamada
  outbound do ClinicaOS ao endpoint de estorno do Asaas. A origem do estorno de 14/08 deve ser
  confirmada no histórico/auditoria do painel Asaas ou em outra integração com acesso à conta.
- A configuração local foi normalizada sem expor valores: `ASAAS_API_KEY`, `ASAAS_BASE_URL` e
  `ASAAS_WEBHOOK_TOKEN` agora coincidem com os equivalentes `_PROD`; antes, somente
  `ASAAS_BASE_URL` ainda apontava para Sandbox. O código de runtime usa os nomes sem sufixo.
- A API de consulta expõe somente bandeira e últimos dígitos; não devolve `creditCardToken`. O
  ClinicaOS também não persiste esse token. O endpoint `/payments/{id}/payWithCreditCard` exigiria
  token ou os dados completos do cartão e representa captura manual imediata, não o scheduler da
  assinatura. Não foram solicitados, persistidos ou registrados PAN/CVV/titular.
- Contraprova final: uma cobrança, `PENDING`, due date 24/08, subscription `ACTIVE`, next due 24/09;
  local `clinic=trial`, `subscription=trial`, invoice `open`, `paid_at=null`, zero attempts e um único
  `PAYMENT_CREATED`. Nenhum customer, subscription ou payment novo foi criado e nenhum valor foi
  debitado do cartão nesta execução.
- Status: `PARTIAL/BLOCKED` para o ciclo financeiro Asaas. Credencial/reachability e estado local
  estão saudáveis; o teste automático real só pode ser concluído no vencimento 24/08/2026. Como
  alternativa operacional, o titular pode acionar uma captura/reprocessamento no painel ou fornecer
  um token por variável local segura; isso prova cartão+webhook, mas não prova o disparo automático
  do scheduler e deve ser relatado separadamente.

## 19. Caixa

`FLOW-001 PASS`: card do lançamento apareceu no Caixa, recebeu valor, confirmou pagamento, solicitou
motivo e confirmou reembolso; saiu da fila ativa e reapareceu como `Estornado` no Financeiro.
`CONC-003 PASS`: dois operadores abriram o mesmo card antes da baixa e enviaram a confirmação com 10
ms de diferença; a UI preservou um único `Pago` e exibiu erro seguro ao perdedor.
`FINANCIAL-LIFECYCLE-001 FAIL`: duas baixas parciais somaram exatamente R$ 10,00; dois reembolsos
somaram exatamente R$ 10,00 e criaram duas compensações, mas o estado terminal não foi aplicado
(`DATA-003`). Não existe entidade, action ou controle de sessão de caixa para abertura/fechamento no
produto implantado: o Caixa atual é uma visão operacional do ledger de `lancamentos` e
`payment_transactions`. Abertura duplicada, fechamento duplo e alteração pós-fechamento ficam
`NOT TESTED`, não `PASS`, até existir contrato/implementação desse conceito.
`COLLECTION-001 PASS`: o Caixa exibiu a fila humana com D+40 e saldo R$ 12,34; após a quitação e
resolução do caso, o alerta desapareceu. Replay do upsert e da resolução não duplicou estado ou
auditoria; isolamento A↔B permaneceu fechado.

## 20. Conversas IA

`MT-002 PASS` para SELECT RLS: o owner B não viu a conversa existente em A. `MT-003 PASS` para a
rota direta B→A: o ID conhecido renderizou not-found. A→B ficou sem fixture. O lifecycle interno de
handoff e a negativa de resposta manual fora da janela foram executados em `HANDOFF-001`; retomada
por inbound e entrega real permanecem pendentes porque exigem transporte Meta.

### HANDOFF-001 — lifecycle humano sem transporte externo

- Uma conversa sintética sem paciente e sem mensagens foi criada na Clínica A; owner e atendente
  usaram sessões reais e tinham `manage:conversations` no estado autoritativo.
- O owner assumiu e marcou prioridade urgente; o backend rejeitou a resposta manual forçada fora da
  janela de 24 h, sem criar `ai_messages` nem `outbox`.
- O atendente reatribuiu para si. Em seguida, a tentativa do owner antigo de devolver a conversa foi
  rejeitada por ownership atual, e o atendente responsável devolveu ao agente com sucesso.
- Estado observado antes do cleanup: `status=active`, 1 handoff resolvido, prioridade urgente,
  assignee final correspondente ao atendente, 0 mensagens, 0 outbox, 4 auditorias e 4 idempotências.
- Cleanup: conversa, handoff em cascade, 4 auditorias e 4 idempotências removidos; seis contadores
  finais em zero. Status: `PASS`; nenhuma chamada ou mutação Meta/WhatsApp.

### AI-001 — Gemini real e guardrails clínicos

- `pnpm ai:live-check`: `PASS`; as 15 tools declaradas coincidiram com a whitelist de produção. O
  Gemini real chamou `provide_clinic_info`, aceitou o `functionResponse` e produziu resposta final.
- No cenário de contato não cadastrado, chamou `prepare_appointment`; após receber
  `patient_registration_required`, pediu o nome completo para iniciar o cadastro e preservar a
  intenção de agendamento. O roundtrip total custou aproximadamente US$ 0,003234.
- `pnpm ai:adversarial`: `PASS`; 50 mensagens de sintomas, diagnóstico, medicamento, exames,
  tratamento, prompt injection e casos mistos; 52 chamadas reais, custo aproximado US$ 0,041905.
  Resultado: zero resposta final insegura. O pré-filtro reteve 44/50; a avaliação com bypass do
  pré-filtro confirmou que o pós-guard interceptou 50/50 respostas cruas.
- Limite: os checks não executaram handlers mutáveis nem transporte WhatsApp. Handoff, agendamento
  real completo, webhook inbound e entrega outbound continuam separados desta prova do modelo.

### META-001 — WABA ativa sem app inscrito para webhooks — P1

- Banco: uma conexão Meta ativa da Clínica A está `connected`, possui `verified_at` e token
  cifrado. O token descriptografado apenas em memória acessou o phone ID em HTTP 200.
- Permissões reais do token: `whatsapp_business_management=granted` e
  `whatsapp_business_messaging=granted` (HTTP 200 em `/me/permissions`).
- Falha reproduzida: `GET /{waba}/subscribed_apps?fields=id` retornou HTTP 200 com `appCount=0` em
  três leituras, inclusive duas tentativas consecutivas. Não há qualquer app inscrito na WABA.
- Impacto: o banco/UI pode afirmar “conectado”, mas a Meta não entrega eventos inbound dessa WABA
  a nenhum callback. Isso bloqueia a jornada paciente → webhook → IA. O histórico prova que o
  transporte já funcionou: 85 inbounds processados e 78 outbounds em `delivered/read`, com callbacks
  `sent/delivered/read`; os últimos eventos são de 13/08/2026.
- Callback: handshake correto retornou challenge em HTTP 200 e token errado foi 403; POST sem
  assinatura e com assinatura errada foram 401. A chave local do app não coincide com a implantada,
  portanto o caminho POST com assinatura válida ficou `NOT TESTED` — o 401 local não é promovido a
  falha de produção.
- Causa confirmada: divergência entre `clinic_whatsapp_numbers.active/connected` e a assinatura
  externa atual. A origem da remoção (manual, troca de app ou fluxo legado) requer confirmação; o
  sistema não reconciliou nem tornou essa divergência visível no health.
- Status: `FAIL`, P1 operacional. Nenhuma mensagem real foi enviada e nenhuma configuração externa
  foi modificada durante o teste.

## 21. Relatórios

`REPORT-001 PASS` para o único módulo de relatório atualmente descoberto. Owner, médico, atendente e
financeiro percorreram `7d`, `30d` e `90d`: 12/12 páginas tiveram totais de appointments iguais ao
banco, no-show calculado corretamente e ocupação finita/igual entre roles; período inválido caiu em
`30d`. Foram gerados e analisados 12 PDFs da Clínica A e um da Clínica B: 13/13 válidos, texto
extraído, mesmos KPIs da tela e 12 agrupamentos por profissional conferidos contra o banco. Owner,
atendente e financeiro, que possuem `view:financial`, exibiram totais financeiros iguais ao banco;
o médico não recebeu card, coluna ou conteúdo financeiro na tela/PDF. Como ataque multi-tenant, o
owner B enviou `clinicId` da A na query da página e do PDF; ambos permaneceram vinculados à B,
inclusive título e totais. Nenhuma mutação foi executada. Não existe permissão dedicada de leitura
de relatórios; a capacidade financeira é o gate granular observado neste módulo.

## 22. Equipe & Permissões

`TEAM-001 PASS`: lifecycle completo executado na Clínica B e cleanup confirmado; a Clínica B voltou
a 1/5. Após o adendo do operador, `TEAM-002 PASS` usou a única vaga livre da Clínica A para uma
conta sintética, percorreu todas as nove transições obrigatórias de role e três pontes, invalidou e
renovou a sessão em cada etapa e devolveu a clínica a 4/5 sem resíduos.

## 23. Configurações

`PARTIAL`: Perfil, Assinatura, Horários, Recursos, Procedimentos e LGPD possuem gates próprios no
servidor; Sugestões é deliberadamente privada por autor e acessível a qualquer usuário. O hub e as
tabs exibem todas as subrotas a qualquer sessão. `AUTHZ-006 FAIL`: o médico sem `manage:settings`,
embora corretamente bloqueado em Perfil e Assinatura, abriu `/configuracoes/whatsapp`, viu o estado
ativo da integração, o número mascarado, a data de conexão e o botão “Desconectar”. A action exige
`requireFreshPermission(MANAGE_SETTINGS)` e não foi chamada, portanto não há bypass de mutação
comprovado. `MANAGE_AVAILABILITY PASS`: o mesmo médico criou pela UI uma janela temporária própria,
usada no encaixe sintético e removida pelo ID exato ao fim.

`SCHEDULING-CONFIG-001 PARTIAL/FAIL`: owner criou procedimento e recurso, ambos ficaram isolados de
B, foram ocultados da Agenda ao desativar e restaurados ao reativar; código de 41 caracteres e código
duplicado não persistiram, valor `10,005` virou R$ 10,01 e HTML-like ficou texto. `AUTHZ-007 FAIL`:
o médico sem `manage:procedures` foi corretamente negado no catálogo, mas o seu
`manage:availability` permitiu desativar um recurso compartilhado e registrar uma ausência do owner.
O período 01/01/2099 10h–11h tinha zero consultas, logo nenhum atendimento real foi reorganizado;
`createDoctorAbsence()` não limita `doctorId` ao ator e cancelaria/transferiria todos os encontrados.
`OBS-002 FAIL`: as negativas esperadas de código longo e duplicado responderam HTTP 500, embora o
banco tenha permanecido íntegro. `HOURS-001 FAIL` acrescentou o expediente com pausa: manhã HTTP
200 seguida de tarde conflitante HTTP 500 deixou a manhã persistida (`DATA-006`); conflito e feriado
duplicado exibiram alertas vazios, e os campos Data/Motivo não tinham nome acessível (`A11Y-001`).
Criação e remoção normais de janela/feriado passaram com trilhas 6/6 e cleanup integral.

`FEEDBACK-001 PASS`: owner e médico enviaram sugestões sintéticas e cada autor viu somente o próprio
histórico; a Clínica B viu zero. Título longo foi rejeitado em HTTP 200 sem persistência, HTML-like
foi renderizado como texto, duas submissões simultâneas com a mesma chave produziram uma única linha
e o replay da chave com payload diferente foi rejeitado. Sob `ROLE authenticated`, owner viu somente
1 sugestão/1 histórico próprios, médico somente os seus e B zero; tentativas de inserir usando o
`user_id` do médico ou `clinic_id` de B receberam RLS `42501`. Duas sugestões, dois históricos, duas
auditorias e duas idempotências coerentes; cleanup final zerou todos os marcadores. Anexos
permaneceram `[]`, conforme o contrato atual sem upload.

`PROFILE-001 PARTIAL/FAIL`: owner salvou CNPJ `1` e CNES sintético; a Server Action respondeu HTTP
200, o hash fiscal mudou e o valor inválido reapareceu após reload (`VAL-002`). Em seguida, duas abas
do owner partiram do mesmo perfil e gravaram CNES diferentes ao mesmo tempo: ambas receberam sucesso,
duas auditorias persistiram e nenhum conflito foi apresentado; o último commit venceu (`DATA-005`).
O médico sem `manage:settings` permaneceu negado, `slug/status/timezone` não mudaram e a linha da
Clínica B ficou byte a byte igual. O registro completo da Clínica A, inclusive ciphertext/hash e
timestamp com microssegundos, foi restaurado; três auditorias sintéticas foram removidas e o contador
final ficou zero. Evidência visual foi desabilitada para não capturar os dados fiscais reais.

`SUBSCRIPTION-TRIAL-001 PARTIAL/FAIL`: A e B estão em `trial`, com período presente, sem alteração
pendente e `cancel_at_period_end=false`; portanto o ciclo ativo agendar→revogar não foi falsificado.
Na Clínica A, porém, a UI exibiu “Cancelar assinatura ao fim do ciclo” habilitado. Duas tentativas
HTTP 200 receberam corretamente “O cancelamento exige uma assinatura ativa.”, mas o botão impossível
continuou oferecido (`UX-002`). Rollback comprovado: zero change request, billing event, auditoria e
idempotência; flag/status intactos e nenhuma chamada Asaas.

## 24. LGPD

`FLOW-001 PARTIAL` havia parado em `processing`. `JOURNEY-LGPD-A PASS` fechou o fluxo sobre novas
fixtures autorizadas da Clínica A: criação e acesso pela UI, exportação real, soft delete, retenção,
hard delete físico, anonimização por prontuário, acesso posterior e cleanup exato. A janela de 30
dias foi acelerada somente nos dois UUIDs sintéticos depois de provar que eram exatamente os dois
primeiros candidatos do cron; a passagem natural de 30 dias não foi aguardada.

### LGPD-001 — Exportação, Storage e e-mail transacional

- Fluxo real na Clínica B: owner criou paciente inteiramente sintético, clicou em “Exportar dados
  (LGPD)” e aguardou o cron de produção; a outbox terminou `processed` em uma tentativa, sem erro.
- O pedido chegou a `completed`, `status_reason=export_ready_email_sent`, canal `email` e timestamp de
  notificação. Pelo contrato do handler, esse estado só é persistido após o Resend devolver um
  provider message ID; portanto a aceitação do provedor está `PASS`.
- Storage: PDF e JSON existiram no bucket privado; signed URL com TTL de 24 h respondeu HTTP 200,
  `application/pdf` e magic bytes `%PDF`; JSON continha os IDs da fixture e as seções exportadas.
- Cleanup do run verde: 2 outbox, 2 auditorias, 2 idempotências, 1 pedido, 1 paciente e os dois
  objetos foram tratados; contraprova final `patients=0`, `requests=0`, `outbox=0`. O primeiro run
  funcional também concluiu e enviou e-mail, mas falhou no cleanup por um cast UUID incorreto do
  teste; a transação foi revertida e o cleanup manual exato removeu os mesmos tipos de registro antes
  da repetição. Total: dois e-mails sintéticos para o mesmo alias Gmail controlado.
- Entrega: o operador confirmou o recebimento dos dois e-mails na inbox; o egresso real por Resend
  passa a `PASS`.
- Os dois links informados pelo operador retornaram `NoSuchKey` porque o cleanup do pentest removeu
  deliberadamente os respectivos objetos PDF/JSON depois da validação pré-cleanup. Isso é efeito do
  ciclo de vida da fixture sintética, não falha do produto. Os tokens/URLs não foram reproduzidos no
  relatório.
- Limite: persistência e expiração natural após 24 h permanecem `NOT TESTED`, pois a limpeza imediata
  invalidou intencionalmente os links antes do TTL. O hard-delete/retention funcional foi coberto
  separadamente por `JOURNEY-LGPD-A`.
- Status: `PASS` para aplicação → worker → Storage → Resend → inbox; LGPD global segue `PARTIAL` pela
  expiração/persistência pendente e pelo `LGPD-002 FAIL` na eliminação de cópias do outbox.

### LGPD-002 — Eliminação não remove PII do outbox — P1

- Produção: 31 eventos `patient.core.created`, todos terminalmente `skipped` porque o tipo está na
  allowlist `PRODUCER_AHEAD` sem consumidor. Todos continham nome e hash de CPF; 28 continham e-mail
  e 20 hash de telefone. Os hashes tinham 64 caracteres e são pseudônimos estáveis, não dados
  anônimos.
- Contraprova de eliminação: 7 patient IDs desses eventos já não existem em `patients`, mas seus 7
  nomes/hashes de CPF, 5 e-mails e 7 hashes de telefone continuam no payload. Há 16 eventos ligados
  a pedidos LGPD `completed` e 1 a pedido `processing`.
- Causa confirmada: `anonymizePatientAuditTrail()` remove PII somente de `audit_events` e anula a
  resposta de `idempotency_keys`; a rota `patient-hard-delete` chama esse helper e depois
  remove/anonimiza o paciente, sem limpar o payload do outbox. A política genérica conserva eventos
  `processed/skipped` por até 30 dias.
- Impacto: o titular recebe estado de eliminação concluída enquanto outra cópia de nome/e-mail e
  identificadores pseudonimizados permanece armazenada. Não há evidência de exposição cross-tenant,
  mas o contrato de eliminação/minimização está incompleto.
- Status: `FAIL`, P1 por LGPD quebrada. Nenhum payload ou identificador foi anexado à evidência.

### JOURNEY-LGPD-A — ciclo completo sobre a mesma fixture

- Clínica A, dados sintéticos: owner criou dois pacientes; o médico criou um prontuário vazio pelo
  fluxo real em um deles. O paciente clínico foi acessado e exportado antes da exclusão; PDF/JSON e
  aceitação de e-mail foram validados sem registrar URL, destinatário ou conteúdo.
- Soft delete: ambos sumiram da UI, exibindo “Página não encontrada”; PII permaneceu no cadastro
  durante a janela legal e as duas solicitações avançaram para `processing`, como esperado.
- Retenção controlada: somente depois dessas provas, `deleted_at` foi envelhecido para 1900 nos dois
  UUIDs. A consulta global ordenada mostrou esses dois IDs, ambos da Clínica A, exatamente nas duas
  posições consumidas por `limit=2`.
- Cron real: `/api/cron/patient-hard-delete?limit=2` autenticou e retornou `deleted=1`,
  `anonymized=1`, `failed=0`, `clinics=1`. O paciente sem registro clínico foi fisicamente removido;
  o que tinha prontuário preservou uma linha clínica e ficou com os placeholders, hashes nulos e
  `anonymized_at` esperados. Os dois pedidos ficaram `completed`; a auditoria reteve zero das chaves
  PII conhecidas.
- Acesso posterior: as duas URLs da aplicação continuaram no estado visual de não encontrado. Isso
  é `PASS` funcional para a Jornada 8 e para os dois ramos do executor, sem alegar que 30 dias
  transcorreram naturalmente.
- Harness: a primeira tentativa parou antes do cron porque esperava HTTP 404 onde o App Router
  renderiza corretamente o DOM de 404 com HTTP 200; cleanup zero. A segunda atravessou todas as
  asserções funcionais e falhou somente no `finally`, quando o trigger rejeitou chaves de
  idempotência que o próprio scrub havia transformado em `response=NULL`. O cleanup diagnóstico
  exato normalizou duas chaves concluídas, removeu 6 idempotências, 8 outbox, 5 auditorias, 1
  prontuário, 3 pedidos, 2 supressões e a única linha de paciente retida; todas as sete contraprovas
  finais ficaram zero. O spec foi corrigido e passou em Prettier, ESLint e TypeScript; não houve
  terceiro envio de e-mail apenas para obter exit code verde.

### LGPD-003 — exportação permanece acessível após eliminação concluída — P1

- Reprodução na mesma fixture: depois de o cron marcar a exclusão `completed` e anonimizar o
  cadastro com prontuário, a signed URL previamente emitida ainda devolveu PDF válido em HTTP 200 e
  o JSON completo continuou baixável administrativamente no bucket privado.
- Causa confirmada: o hard-delete trata banco, auditoria e idempotência, mas não remove os objetos
  `${clinicId}/${patientId}/${requestId}.{pdf,json}` nem invalida/zera
  `lgpd_requests.export_signed_url`; não foi encontrado job de lifecycle para `lgpd-exports`.
- Impacto: a cópia mais completa dos dados do titular permanece indefinidamente no Storage e o
  bearer link continua utilizável até o TTL original de 24 h mesmo após o cumprimento declarado da
  eliminação. O bucket privado reduz exposição casual, mas não satisfaz minimização/eliminação.
- Cleanup do pentest removeu os dois objetos; por isso os dois novos links controlados também passam
  a responder `NoSuchKey` depois da prova. Status: `FAIL`, P1.

### LGPD-004 — scrub converte idempotência concluída em “in-flight” — P2

- Reprodução: as duas chaves `patient:create` estavam concluídas com `status_code=200`; após
  `anonymizePatientAuditTrail()`, ficaram com `response=NULL`. O trigger bloqueou o DELETE como
  “in-flight” com menos de uma hora.
- Causa confirmada: `response=NULL` tem dois significados incompatíveis — reserva em andamento no
  protocolo de idempotência e conteúdo apagado pelo hard-delete. `idempotentMutation()` interpreta
  qualquer linha assim como concorrência e o health também a conta como `in_flight`.
- Impacto: replay da mesma key retorna conflito falso, o monitor registra operação em andamento que
  já terminou e o cleanup seguro não a remove até outro job vencer a retenção. Não houve exposição
  de PII nem duplicação de mutação; severidade P2 de consistência/observabilidade.
- A operação diagnóstica de cleanup usou o sentinel já previsto nos smokes apenas nas duas chaves
  sintéticas comprovadamente concluídas. Status: `FAIL`, P2.

## 25. API / Backend

### API-001 — Supabase Data API em produção

- Procedimento: sessão B `authenticated/aal1`; tentativa direta de `SELECT clinics`, `INSERT`,
  `PATCH` e `DELETE patients` por `scripts/prod-data-api-authorization-check.ts`.
- Observado: todos retornaram HTTP 503 / `PGRST002`; nenhum fixture foi criado (`cleanupRows=0`).
- Status: `PARTIAL`. As mutações não foram aceitas, mas o probe fail-closed não aceita
  indisponibilidade 5xx como prova suficiente de que a Data API está configurada como desligada.
- Próxima prova: confirmar `Enable Data API = off` no dashboard/controle externo e conservar a
  evidência; a resposta 503 isolada não vira `PASS`.

## 26. Database / RLS

`MT-001 PASS` para a tabela `patients`: claims reais dos dois owners sob `authenticated`, SELECT
próprio/cross, INSERT cross e UPDATE/DELETE cross validados dinamicamente nas duas direções.
`MT-002 PASS` ampliou a leitura: 99 tabelas/partições tenant-scoped inventariadas, 44 com fixtures
reais A/B e zero linha cruzada visível em qualquer direção. Todas as 73 raízes tinham
`RLS + FORCE RLS`; o acesso direto às partições físicas com dados também retornou zero. `MT-004`
ampliou as mutações: 142 probes cruzados de `UPDATE/DELETE` em 42 tabelas-raiz com fixture, todos
bloqueados e sempre revertidos. `INSERT`, Server Actions e UI permanecem parciais fora de
`patients`.

## 27. Storage

### STOR-001 — Boundary dinâmico do bucket clínico em PROD

- Fixture: dois PDFs sintéticos, um no prefixo da Clínica B e um sob UUID de outro tenant.
- Observado: bucket privado; download direto próprio `denied`; download cross-tenant `denied`;
  criação direta de signed URL própria/cross-tenant `denied`; URL pública HTTP 400; signed URL
  curta emitida pelo servidor HTTP 200; após expiração HTTP 400.
- Cleanup: 2/2 objetos removidos.
- Status: `PASS` para o contrato testado.

## 28. Concorrência

### CONC-001 — Criação concorrente do mesmo paciente

- Fixture: um paciente sintético marcado na Clínica B, sem endereço ou integração externa.
- Procedimento: iniciar a Server Action real pelo browser e, enquanto a request original estava em
  voo, repetir o mesmo corpo/chave cinco vezes pelo contexto autenticado.
- Resultado: seis requests concorrentes produziram exatamente uma linha; os cinco replays
  responderam 303, e a UI original chegou ao mesmo paciente.
- Persistência: um audit event, um outbox event e uma idempotency row, todos correlacionados ao único
  patient ID.
- Cleanup: uma linha marcada encontrada e soft-deleted; zero fixture ativa.
- Status: `PASS` em 14 s para este caso. Corridas de pagamento, atendimento, assinatura e demais
  mutações permanecem separadas.

### CONC-002 — Double booking de agenda

- Fixture: dois pacientes e um procedimento inteiramente sintéticos na Clínica B, usando o único
  profissional apto e um horário futuro antes vazio.
- Corrida: duas Server Actions reais, com pacientes diferentes, foram disparadas com 2 ms de
  diferença para o mesmo profissional/data/hora. Pacientes distintos evitam que a guarda de
  duplicidade diária mascare a constraint de slot do médico.
- Resultado UI/backend: duas respostas HTTP 200 controladas; uma criação e um alerta “Já existe um
  atendimento nesse horário para este profissional”. O banco persistiu exatamente 1 appointment
  ativo, 1 state log, 1 audit event, 1 outbox event e 1 idempotency row.
- Cleanup: 3 outbox, 4 auditorias, 4 idempotências, 1 appointment, 1 procedimento e 2 pacientes
  removidos no run verde. Nenhuma fixture, evento ou ledger relacionado permaneceu. Em uma execução
  anterior o worker chegou a materializar 1 uso; o cleanup removeu o ledger e compensou exatamente
  uma unidade do agregado.
- Status: 1/1 Playwright `PASS` em 18,3 s; proteção de double booking `PASS`.

### CONC-003 — Recebimento financeiro simultâneo

- Fixture: lançamento manual sintético de R$ 17,03 na Clínica A, criado pelo Financeiro; o Atendente
  também possuía `view:financial` e `operate:caixa` efetivos.
- Corrida: os dois perfis abriram o mesmo card pendente no Caixa e dispararam Server Actions com
  chaves distintas e 10 ms de diferença. Ambos os envelopes HTTP foram 200; um venceu e o outro
  recebeu “Valor pago excede o valor do lancamento.” como erro de domínio controlado.
- Persistência: lançamento `pago`, `valor_pago=valor`, `paid_at` presente, exatamente uma transação
  `payment` com soma igual ao valor, um audit `financial.lancamento.paid`, um outbox do pagamento e
  duas idempotências totais ligadas ao lançamento (criação + baixa vencedora). A transação perdedora
  foi revertida integralmente.
- Cleanup: 2 outbox, 2 auditorias, 2 idempotências, 1 transação e 1 lançamento removidos; zero
  lançamento/outbox/auditoria com o marcador na contraprova externa.
- Status: 1/1 Playwright `PASS` em 13,1 s; double payment/segunda baixa bloqueados.

### CONC-004 — edição e exclusão simultâneas do mesmo paciente

- Edição: owner e atendente abriram o mesmo estado e enviaram nomes diferentes enquanto uma trava
  externa fazia as duas gravações sobreporem a mesma linha. As duas Server Actions retornaram sem
  5xx, persistiram duas auditorias/outbox/idempotências por dois atores e nenhum conflito foi
  apresentado; o último commit sobrescreveu o primeiro (`DATA-002 FAIL`).
- Exclusão: owner e atendente enviaram soft-delete simultâneo sob a mesma técnica. Produção aceitou
  exatamente uma mutação: um ator, uma auditoria, um outbox, uma idempotência e três supressões;
  nenhuma duplicação de evento foi observada (`PASS`).
- Cleanup final: 3 pacientes, 6 supressões, 9 outbox, 9 auditorias e 9 idempotências removidos; sete
  contadores de contraprova em zero. Nenhum provedor externo foi chamado.
- Status: `PARTIAL`: delete concorrente passou; edição concorrente falhou por lost update.

### CONC-005 — convite e cancelamento de equipe concorrentes

- Duas ações de convite competiram por uma única vaga: exatamente uma persistiu e a compensação do
  perdedor removeu seu Auth user; nunca houve 6/5 usuários.
- Duas ações de cancelamento competiram pelo mesmo convite pendente: exatamente uma removeu e
  auditou; a outra recebeu erro de domínio controlado, sem 5xx ou duplicação.
- Status: `PASS`; detalhes e cleanup em `TEAM-003`.

### CONC-006 — dois usuários corrigindo o mesmo agendamento

- Fixture: um agendamento sintético `agendado` da Clínica A, aberto simultaneamente por owner e
  atendente em contextos autenticados independentes.
- Corrida: ambos selecionaram transferência para o owner, com motivos e UUIDs idempotentes distintos;
  as Server Actions foram despachadas com 121 ms de diferença e responderam HTTP 200/200.
- Resultado: uma dialog fechou como sucesso e a perdedora permaneceu aberta; o primeiro commit mudou
  o profissional e o segundo foi rejeitado pela precondição de profissional já atualizada.
- Persistência: exatamente uma correção `transfer`, uma auditoria, um outbox, uma idempotência e um
  profissional final coerente. Cleanup removeu 2 pacientes, 2 appointments, 3 outbox, 3 auditorias e
  3 idempotências; appointments/corrections/fila/outbox/ledger/auditoria/idempotência/pacientes
  terminaram em zero.
- Status: 1/1 Playwright `PASS` em 18,2 s; atualização simultânea do mesmo recurso serializada.

## 29. Idempotência

### IDEM-001 — Repetição e conflito de payload na criação de paciente

- Mesmo payload/chave: deduplicado sob concorrência; resposta idempotente apontou ao mesmo ID.
- Mesma chave/payload diferente: o nome foi alterado no corpo capturado mantendo o tamanho; a
  Server Action respondeu erro de conflito controlado em HTTP 200, preservou o payload original e
  não criou uma segunda linha.
- Evidência sanitizada: `patientCount=1`, `auditCount=1`, `outboxCount=1`,
  `idempotencyRows=1`, `responseIdMatches=true`, `conflictPayloadCreated=false`.
- Extensão em `PATIENT-FLOW-001`: `relationship_link` e `record_death` receberam quatro requests
  cada e persistiram uma única mutação; delete concorrente com chaves distintas aceitou apenas uma.
- Extensão em `FEEDBACK-001`: dois browsers enviaram simultaneamente a mesma chave/payload e
  receberam HTTP 200, produzindo uma sugestão, um histórico, uma auditoria e uma idempotência; a
  mesma chave com título diferente foi rejeitada sem nova linha.
- Status: `PASS` para `patient:create`, `patient:relationship_link` e `patient:record_death` nos
  cenários executados e para `feedback:submit` no caso acima. A matriz completa das demais chaves
  permanece `PARTIAL`.

## 30. Outbox / Jobs / Cron

### OPS-001 — Health profundo, filas e Auth Hook

- Autenticação: os três endpoints (`/api/health?strict=1`, `/api/health/outbox?strict=1` e
  `/api/health/auth-hook`) retornaram HTTP 401 sem credencial e não expuseram diagnóstico interno.
- Health profundo autenticado: HTTP 200, `status=ok`; DB, Gemini, Meta, Asaas, Redis e outbox
  responderam `ok` no probe real implícito por `strict=1`.
- Outbox autenticado: HTTP 200, `degraded=false`, zero alarmes; `pending=0`, `processing=0`,
  `failed=0`, `skipped=293`. O código trata `skipped` como produtor à frente do consumidor e não o
  usa isoladamente como alarme; a lista por tipo ainda não foi obtida neste nível de acesso.
- Idempotência/partições/pool: zero chaves `in_flight`, zero órfãs acima de 1 h, 33 expiradas;
  nenhuma partição default/contiguidade em alarme; pool com 1 conexão ativa, 13 idle, zero waiting,
  máximo 60 e saturação reportada de 25%.
- Auth Hook: HTTP 200, `ok=true`, self-test `ok=true`, `claims_keys=[]`, `elapsed_ms=0`, exatamente o
  contrato esperado pelo runbook.
- Heartbeats: 11 linhas existentes, todas `last_status=success`. Outbox tinha idade arredondada de
  0 min; reconcile financeiro 2 min; os jobs diários e proativos estavam dentro das janelas do
  painel. Os jobs mensais esperados `audit-partitions` e `data-retention` não possuem heartbeat.
- Limite seguro: não foi feito disparo manual desses dois crons porque um cria/ajusta partições e o
  outro executa retenção destrutiva. É necessário comprovar a execução agendada no próximo ciclo ou
  por operação controlada, especialmente para a política de retenção.
- Status: `PARTIAL`. Health/filas/Auth Hook estão `PASS`; presença/execução dos dois jobs mensais
  permanece `NOT TESTED` e impede afirmar cobertura completa de crons.

## 31. Auditoria

### AUD-001 — Integridade, correlação e conteúdo sensível

- Escopo dinâmico: 498 `audit_events`, 603 outbox e 353 respostas de idempotência das duas clínicas
  de teste; 33 tipos de ação na auditoria.
- Correlação: 494 eventos tinham ator usuário; todos os 494 tinham `request_id` e `correlation_id`.
  Não havia ator atual fora da própria clínica. Doze referências históricas ficaram sem perfil/Auth
  atual e pertenciam exclusivamente a `internal.user.created`/`invite_resent` de usuários
  temporários removidos; o UUID forense foi preservado.
- Conteúdo: zero JWT, bearer, DSN, chave secreta ou conteúdo clínico legível nos três repositórios.
  As 35 respostas idempotentes com chave `content` eram projeções vazias de criação/assinatura de
  prontuário (24/11), conforme o contrato de sanitização.
- Status: `PASS` para integridade/correlação e ausência de credenciais/conteúdo clínico no universo
  consultado. A retenção de PII cadastral no outbox é falha separada em `LGPD-002`.

O Sentry fornecido pelo operador correlacionou os dois eventos esperados de segurança de
`PERM-001`: epoch mismatch da sessão antiga e negativa fresh de `manage:permissions`. Nenhum dos
dois representou bypass; o ruído/HTTP 500 é tratado separadamente em `OBS-001`.

## 32. Bugs e Vulnerabilidades Encontrados

### AUTHZ-001 — `view:patient` negada não protege lista/detalhe/CPF — P1

- Status: `FAIL`, reproduzido dinamicamente em produção.
- Pré-condição: atendente com override `deny` para `view:patient`; JWT renovado e
  `effective_permissions_v` sem essa permissão.
- Reprodução: owner nega “Ver pacientes”; request seguinte da sessão antiga redireciona para login;
  atendente renova a sessão; acessa diretamente `/pacientes` e `/pacientes/[id]`; a lista renderiza
  paciente e o detalhe revela CPF descriptografado.
- Impacto: uma clínica que revoga leitura de dados pessoais acredita ter restringido o colaborador,
  mas ele continua vendo nomes/e-mails e pode abrir URLs de paciente. É falha grave de permissão e
  risco LGPD intra-tenant. O teste A↔B continua bloqueando o outro tenant, portanto não há evidência
  de vazamento cross-tenant neste achado.
- Causa confirmada: `src/app/(app)/(shell)/pacientes/page.tsx` chama `requireUser()` e
  `requireClinicId()`, mas não verifica `PERMISSIONS.VIEW_PATIENT`; `listPatients()` aplica escopo de
  tenant/RLS, não RBAC. A página de detalhe segue o mesmo padrão e deve entrar na revisão de
  variantes.
- Evidência: `patientVisibleWithoutPermission=true` e
  `decryptedCpfVisibleWithoutPermission=true`; JWT/view efetiva sem `view:patient`; cleanup final
  `removed=5, remaining=0`.

### AUTHZ-002 — `view:agenda` negada não protege a agenda — P1

- Status: `FAIL`, reproduzido dinamicamente em produção.
- Reprodução: aplicar deny, comprovar claim/view efetiva sem `view:agenda`, invalidar a sessão antiga,
  renovar e abrir o dia de uma consulta conhecida. O nome do paciente foi renderizado.
- Impacto: colaborador revogado continua vendo agenda, paciente, médico, horários e estados
  operacionais; risco de privacidade e quebra grave de permissão intra-tenant.
- Causa confirmada: `AgendaPage/getAgendaData()` chama `requireUser()` e consulta appointments,
  patient cards, profissionais, procedimentos e recursos sem exigir `VIEW_AGENDA`; apenas os botões
  de edição/disponibilidade consultam permissions.
- Evidência sanitizada: `agendaRouteVisibleWithoutPermission=true` e
  `agendaPatientVisibleWithoutPermission=true`.

### AUTHZ-003 — feed, PDF e prontuário ignoram permissões de leitura — P1

- Status: `FAIL`, reproduzido dinamicamente em produção.
- Pré-condição: role atendente sem `view:prescription` e sem `view:prontuario` no bundle/JWT.
- Reprodução: abrir `/documentos`; a rota retornou documento clínico associado a paciente. Em
  seguida, abrir diretamente uma rota de PDF existente; o servidor criou uma URL assinada e a
  sessão sem permissão baixou o arquivo com HTTP 200 e MIME `application/pdf`.
- Impacto: acesso indevido não apenas a metadados, mas ao documento clínico completo, com risco
  grave de sigilo médico e LGPD intra-tenant.
- Causa confirmada: `DocumentosPage` exige apenas usuário/clínica e chama
  `listClinicalDocumentFeed()` sem gate RBAC. O feed combina prescrições e documentos médicos.
  `DocumentPdfPage` e `PrescriptionPdfPage` também exigem apenas usuário/clínica antes de decifrar
  o registro e chamar `createClinicalSignedUrl()`.
- Evidência sanitizada: `clinicalDocumentVisibleWithoutPermission=true` e
  `clinicalPdfReadableWithoutPermission=true`; nenhuma URL, conteúdo ou dado clínico foi gravado.
- Variante `AUTHZ-003-V1` confirmada na Clínica A: médico criou prontuário sintético com SOAP; o
  atendente e o financeiro, ambos sem `view/create/sign:prontuario`, viram status e links
  Editar/Assinar no hub, abriram o deep-link e receberam o conteúdo decifrado no textarea.
- Controle de escrita: o atendente tentou um único autosave também sintético; a UI mostrou erro e o
  `row_version`/ciphertext permaneceram byte a byte iguais. Portanto o bypass é de leitura e de
  controles oferecidos indevidamente, não de mutação. As actions continuam aplicando os gates.
- Causa ampliada: o hub chama `listProntuariosByPatient()` e a página direta chama
  `getProntuarioById()` após apenas usuário/clínica; nenhuma delas exige `VIEW_PRONTUARIO` antes da
  query e da decifragem.

### AUTHZ-004 — modelos de receita exibem gestão sem `create:prescription` — P2

- Status: `FAIL` de rota/UI; nenhuma mutação sem permissão foi comprovada.
- Reprodução: atendente sem `create:prescription` acessa `/modelos-receita` e vê “Novo modelo”.
- Impacto: interface promete ação proibida e gera erro operacional; eventual template do próprio
  usuário também seria listado sem gate de página. As quatro actions de template aplicam
  `CREATE_PRESCRIPTION`, reduzindo o impacto atual.
- Causa confirmada: `ModelosReceitaPage` não verifica a permissão antes de listar/renderizar;
  somente as actions verificam.
- Evidência sanitizada: `templatesCreateVisibleWithoutPermission=true`.

### AUTHZ-005 — Dashboard expõe dados financeiros sem `view:financial` — P1

- Status: `FAIL`, reproduzido dinamicamente em produção com o médico da Clínica A.
- Pré-condição: `effective_permissions_v` sem `view:financial`; saldo a receber e rollup financeiro
  de sete dias autoritativos ambos não zero.
- Reprodução: abrir `/dashboard`; os cards “A receber”/“Faturado hoje” e o painel “Faturamento ·
  últimos 7 dias” são renderizados. O valor de “A receber” coincidiu exatamente com o agregado do
  banco e o gráfico não mostrou estado vazio. Como controles, `/financeiro` exibiu “Sem acesso” e
  `/relatorios?periodo=30d` ocultou corretamente “Faturamento (recebido)”.
- Impacto: médico sem delegação financeira acessa saldo operacional e histórico de recebimentos da
  clínica; é bypass de autorização de dado financeiro intra-tenant.
- Causa confirmada: `DashboardPage` calcula `canAudit`, mas chama incondicionalmente
  `getCashFlowToday()`/`listCashFlowDaily()` e sempre serializa/renderiza os três componentes
  financeiros; não há gate `VIEW_FINANCIAL` no loader nem na UI.
- Evidência sanitizada: nenhum valor monetário foi impresso; apenas igualdade e não-zero foram
  registrados.

### AUTHZ-006 — Configuração WhatsApp expõe metadados e controle sem `manage:settings` — P2

- Status: `FAIL` de rota/UI, reproduzido dinamicamente em produção; nenhuma mutação foi tentada.
- Pré-condição: médico da Clínica A sem `manage:settings` na `effective_permissions_v`; conexão
  WhatsApp ativa e `connected` existente no próprio tenant.
- Reprodução: Perfil e Assinatura retornaram “Sem acesso”; a rota direta
  `/configuracoes/whatsapp` exibiu “WhatsApp conectado”, estado ativo, número mascarado, data de
  conexão e botão “Desconectar”.
- Impacto: colaborador sem gestão de configurações conhece metadados da integração e recebe um
  controle administrativo que não pode usar. O impacto é intra-tenant e limitado porque o número é
  mascarado e as actions de conectar/desconectar exigem `requireFreshPermission(MANAGE_SETTINGS)`.
- Causa confirmada: `WhatsappSettingsPage` chama `loadWhatsappStatus()`, que exige somente
  `requireClinicId()`, e `WhatsappConnect` sempre renderiza os controles. O hub/layout também não
  filtram o link; outras páginas administrativas comparáveis verificam `MANAGE_SETTINGS` antes da
  query/renderização.
- Evidência sanitizada: presença do sufixo mascarado foi validada sem imprimi-lo; o teste registrou
  apenas os booleanos de exposição e `mutationAttempted=false`.

### AUTHZ-007 — médico pode reorganizar agenda de outros e recursos globais — P1

- Status: `FAIL` de autorização/integridade intra-tenant, reproduzido dinamicamente em produção na
  Clínica A sem afetar atendimento real.
- Pré-condição: o médico possui `manage:availability`, concedido ao papel para gerir a própria
  agenda, e não possui `manage:procedures`. O owner também é profissional por possuir CRM.
- Reprodução segura: owner criou uma sala sintética; médico abriu a configuração compartilhada e a
  desativou/reativou. Em seguida, o médico abriu “Ausências médicas”, selecionou o owner e registrou
  estratégia `cancel` em 01/01/2099 10h–11h. SQL prévio comprovou zero consultas do owner na janela;
  a ausência persistiu com `created_by=médico`, `doctor_id=owner` e `affected_appointments=0`.
- Impacto: o mesmo fluxo, em período ocupado, percorre todas as consultas agendadas/confirmadas do
  profissional alvo e as cancela ou transfere atomicamente, publicando eventos. Um médico pode,
  portanto, indisponibilizar salas/equipamentos compartilhados e reorganizar a agenda de outro
  profissional/owner sem delegação administrativa. A tela também não oferece desfazer/remover a
  ausência registrada.
- Causa confirmada: a permissão ampla `manage:availability` protege disponibilidade própria,
  recursos globais e ausências de toda a equipe. `createDoctorAbsence()` valida apenas que
  `doctorId` pertence à clínica; não restringe médico comum a `doctorId === user.userId`. As páginas
  listam todos os profissionais e recursos para qualquer portador da mesma permissão.
- Controles: catálogo de procedimentos negou corretamente o médico; período-alvo estava vazio;
  isolamento A↔B passou; cleanup removeu ausência/recurso/procedimento e todas as trilhas.

### AUTHZ-008 — atendente encerra consulta sem permissão clínica e dispara faturamento — P1

- Status: `FAIL` de autorização e integridade clínica/financeira intra-tenant, reproduzido
  dinamicamente em produção na Clínica A.
- Pré-condição: atendente com `edit:agenda` e `view:consultorio`, mas sem
  `create:prontuario`/`sign:prontuario`; médico atribuído possui as permissões clínicas; financeiro
  não possui `view:consultorio` e foi corretamente negado.
- Reprodução: atendente criou paciente/encaixe sintéticos, chamou e encerrou a consulta pela UI. O
  banco confirmou `chegou→em_atendimento→atendido`, fila `completed` e zero prontuários no instante
  do encerramento. O médico abriu a finalizada e recebeu “somente leitura” com aviso de prontuário
  inexistente.
- Corrida assíncrona: o worker processou `scheduling.appointment.started` depois do encerramento e
  criou um prontuário `rascunho`, versão inicial, não assinado e `created_by` igual ao médico que não
  executou o atendimento. Depois disso, a finalizada continuou rotulada “somente leitura”, mas o
  textarea ficou editável e não havia controle de assinatura no Consultório.
- Efeito financeiro: `scheduling.appointment.completed` foi publicado/processado e criou um
  lançamento automático `pendente` de valor positivo, embora não houvesse registro clínico válido
  no fechamento. Nenhum provider externo foi chamado.
- Impacto: um perfil não clínico pode declarar a consulta concluída, produzir cobrança e deixar uma
  trilha clínica tardia, vazia e atribuída ao médico. Isso quebra segregação de funções, autoria,
  ordem causal e confiabilidade médico-legal do prontuário.
- Causa confirmada: `completeConsulta()` delega a `completeAppointment()`, e a factory de transições
  exige somente `EDIT_AGENDA` para check-in, início e conclusão. O board renderiza “Encerrar consulta”
  para todo usuário da página. Os consumers de prontuário e faturamento processam `started` e
  `completed` independentemente, sem precondição clínica/assinatura nem proteção contra inversão de
  ordem entre os eventos.
- Evidência/cleanup: 1/1 Playwright `PASS` como reprodução em 39,4 s; foram removidos 1 paciente,
  1 appointment, 1 prontuário tardio, 1 lançamento, 6 outbox, 5 idempotências, 3 auditorias, 1 ledger
  e 1 disponibilidade; onze classes finais ficaram em zero.

### STATE-001 — “Marcar ausente” não pode produzir o estado `faltou` — P2

- Status: `FAIL` funcional/de consistência de estado, reproduzido dinamicamente em produção na
  Clínica A com atendente autorizado e duas fixtures sintéticas.
- Reprodução: um appointment `agendado` apareceu em “A chegar” com apenas “Check-in”, sem ação de
  falta. Um appointment `chegou`/fila `waiting` apareceu na Sala de espera com “Marcar ausente”; o
  clique fez POST HTTP 200 e exibiu “Esta ação não é mais possível — o paciente já mudou de etapa.”
- Persistência: o segundo appointment permaneceu `chegou`, a fila permaneceu `waiting` e houve zero
  state log para `faltou`, `scheduling.appointment.no_show`, auditoria e idempotência de sucesso.
- Impacto: a clínica não consegue registrar no-show pela interface humana. Relatórios de faltas,
  taxa de no-show e automações que dependem do evento ficam incompletos; operadores recebem um botão
  semanticamente impossível justamente depois de registrar que o paciente chegou.
- Causa confirmada: `CheckinStrip` não renderiza ausência para `agendado/confirmado`; `WaitingCard`
  sempre a renderiza para a Sala de espera (`chegou`). `markAbsent()` chama `markNoShow()`, mas a
  máquina aceita `agendado/confirmado→faltou` e proíbe `chegou→faltou`.
- Evidência/cleanup: 1/1 Playwright `PASS` como reprodução em 15,8 s. Cleanup removeu 2 pacientes,
  2 appointments, 2 outbox, 2 auditorias e 2 idempotências; sete classes finais ficaram em zero e
  nenhum efeito externo ocorreu.

### RBAC-001 — permissões órfãs são administráveis, mas não controlam ação tenant — P2

- Status: `FAIL` de consistência funcional/RBAC; nenhum vazamento foi atribuído a este achado.
- Escopo: `export:audit` e `manage:agent` existem no catálogo, aparecem no diálogo de permissões e
  completaram grant/deny/default em `PERM-002`, mas não são consumidas por qualquer página/action
  tenant do código de produção.
- Impacto: o owner pode delegar/revogar uma capacidade que não tem efeito observável, tornando a
  matriz de least privilege enganosa e dificultando auditoria de acesso. O export de auditoria
  existente é exclusivo do super-admin; WhatsApp usa `manage:settings`; conversas usam as
  permissões mais novas `view/manage:conversations`.
- Causa confirmada: drift do catálogo inicial após a evolução das features, sem remoção/deprecação
  ou remapeamento explícito dos codes antigos.
- Evidência: busca completa por referências de `PERMISSIONS.EXPORT_AUDIT` e
  `PERMISSIONS.MANAGE_AGENT` fora do catálogo/UI retornou zero enforcement points; `PERM-002`
  comprovou que os overrides ainda são plenamente administráveis.

### OBS-001 — negativas esperadas viram exceção Sentry/HTTP 500 — P2

- Status: `FAIL` de semântica/observabilidade; a autorização em si foi `PASS`.
- Evidência 1: `AuthError/CLAIMS_OUTDATED` em `PacientesPage` durante revogação normal. O layout
  redirecionou para login, mas o segmento concorrente chamou `requireUser()` e o Sentry capturou a
  exceção esperada.
- Evidência 2: replay de `setMemberOverrideAction` como atendente produziu
  `AuthError/PERMISSION_DENIED`, razão interna 403, porém a Server Action respondeu HTTP 500 e o
  Sentry registrou nível error.
- Impacto: ruído de monitoramento, falso positivo operacional e contrato HTTP incorreto em abuso
  esperado; não houve persistência nem escalada.
- Causa confirmada: `PacientesPage` usa `requireUser()` enquanto páginas já corrigidas como
  Dashboard/Equipe usam `getCurrentUser()+redirect` para evitar a corrida. Em
  `setMemberOverrideAction`, `requireFreshPermission()` ocorre antes do bloco `try/catch`, portanto
  `mapIdentityError()` não converte a negativa em resultado controlado.

### AUTH-005 — logout não invalida access tokens já emitidos — P1

- Status: `FAIL` de revogação de sessão. O acesso persiste durante a validade criptográfica do JWT,
  apesar do logout global ter sido concluído e o refresh token correspondente estar revogado.
- Impacto: um cookie copiado antes do logout ou uma sessão aberta em outro dispositivo continua com
  acesso tenant até o JWT expirar ou até o profile sofrer uma alteração que incremente o epoch. Isso
  frustra logout de incidente/roubo de sessão e mantém capacidade de ler ou agir com os privilégios
  anteriores dentro da janela residual.
- Reprodução: autenticar o mesmo usuário em dois contexts; salvar em memória o cookie do primeiro;
  clicar Sair; comprovar refresh revogado; reapresentar o cookie e navegar novamente pelo segundo
  context. Ambos acessaram o Dashboard; após excluir o usuário, o replay foi bloqueado.
- Causa confirmada: `/logout` chama apenas `signOut({ scope: 'global' })`. O próprio contrato do
  Supabase usado no código reconhece que isso revoga refresh tokens, não o access token; entretanto a
  rota não incrementa `profiles.claims_version`, então o epoch-check compara valores ainda iguais.

### AUTH-006 — sessão comum redefine senha sem prova de recovery — P1

- Status: `FAIL` de proteção de conta. Uma sessão autenticada por senha abriu diretamente o form de
  recovery e substituiu a credencial sem fornecer senha atual ou token/nonce de recuperação.
- Impacto: quem obtém uma sessão roubada pode transformar acesso temporário em takeover persistente,
  trocar a senha e revogar refresh tokens de outros dispositivos, bloqueando o usuário legítimo.
- Reprodução: autenticar normalmente, navegar direto a `/reset-password`, enviar senha forte e
  confirmar que a antiga falha e a nova autentica. Nenhum link de recovery foi usado nessa etapa.
- Causa confirmada: a página considera qualquer `getUser()` como recovery válido e
  `resetPasswordAction()` repete apenas esse mesmo check. Não existe prova one-time vinculada ao
  `verifyOtp(type=recovery)` nem exigência alternativa da senha atual/reautenticação.

### AUTH-007 — access token antigo sobrevive à troca de senha/recovery — P1

- Status: `FAIL` de revogação pós-recuperação. O refresh token da segunda sessão foi revogado, mas o
  access token continuou aceito depois da troca direta e do recovery legítimo.
- Impacto: a vítima pode recuperar a conta e mudar a senha, porém uma sessão já comprometida mantém
  acesso tenant até expiração do JWT ou alteração posterior do profile; o objetivo de expulsar um
  atacante não é alcançado imediatamente.
- Reprodução: abrir duas sessões; redefinir a senha na primeira; comprovar refresh da segunda
  revogado e, mesmo assim, navegar no Dashboard; repetir após o recovery válido. Excluir o usuário
  bloqueou o mesmo token, isolando a falta de mudança de epoch na troca de senha.
- Causa confirmada: a action usa `signOut({ scope: 'others' })` em best effort, mas não incrementa
  `claims_version`; logo o gate por request continua vendo o JWT antigo como atual.

### OBS-002 — validações e conflitos de configuração respondem HTTP 500 — P2

- Status: `FAIL` de contrato/observabilidade, com integridade do banco preservada.
- Reprodução: remover o `maxlength` do input e submeter código com 41 caracteres; depois tentar criar
  outro procedimento com o mesmo código do primeiro. As duas Server Actions responderam HTTP 500.
  O primeiro caso persistiu zero linhas e o segundo manteve exatamente uma, portanto validação Zod e
  índice único funcionaram como barreiras de dados.
- Impacto: entrada adulterada e conflito de negócio esperado parecem falha interna, geram ruído 5xx e
  podem acionar alertas/Sentry; a UI não recebe contrato controlado para orientar o operador.
- Causa confirmada: `ProceduresManager` importa as Server Actions de catálogo diretamente e apenas
  captura a exceção no cliente. `createProcedure()` deixa `ZodError` escapar e converte unique
  violation em `SchedulingConflictError`, mas não há wrapper server-side que transforme ambos em
  resultado discriminado antes da fronteira RSC/Server Action.
- Evidência adicional: em Horários, a segunda janela sobreposta e o feriado duplicado também
  responderam HTTP 500. O helper cliente capturou a exceção já mascarada pelo runtime de produção e
  renderizou um alert sem texto, embora a integridade isolada de cada action tenha sido preservada.
- Variante em Lista de espera: `preferredFrom > preferredUntil` respondeu HTTP 500 pela Server Action,
  com zero persistência. É validação de domínio esperada e deve usar o mesmo boundary controlado.

### META-001 — WABA ativa sem app inscrito para webhooks — P1

- Status: `FAIL`, reproduzido por leitura da Graph API real.
- Área: Configurações → WhatsApp; Meta WABA; `/api/webhooks/meta`; pipeline IA/outbox.
- Reprodução: carregar a única conexão Meta ativa; validar que o token lê o phone ID e possui os
  dois scopes obrigatórios; consultar `/{waba}/subscribed_apps?fields=id`; observar HTTP 200 e lista
  vazia em três leituras. Comparar com banco `active=true`, `connection_status=connected`.
- Impacto: mensagens novas de pacientes não chegam ao ClinicaOS; cadastro, agendamento, handoff e
  respostas da IA via WhatsApp ficam indisponíveis apesar do estado “conectado”.
- Causa confirmada: drift entre o estado externo da WABA e o estado persistido. A causa de origem
  (desinscrição manual/troca de app/fluxo legado) ainda não foi determinada; o health atual só testa
  a raiz da Graph API e não detecta token ou assinatura da WABA.
- Evidência: Graph HTTP 200, `management=granted`, `messaging=granted`, phone ID acessível e
  `appCount=0` em três probes; histórico do banco com entregas/callbacks até 13/08/2026.

### DATA-001 — transferência mantém nome do médico anterior no snapshot — P2

- Status: `FAIL` de consistência, reproduzido dinamicamente em produção na Clínica A.
- Reprodução: criar atendimento futuro com o médico original; rejeitar corretamente uma tentativa
  de transferência para o mesmo profissional; transferir pela UI para outro profissional ativo. A
  Agenda passou a mostrar o novo profissional, `appointments.doctor_id` e
  `appointment_corrections.new_doctor_id` ficaram corretos, mas `snapshot_doctor_nome` continuou com
  o nome anterior (`transferSnapshotMatchesCurrentDoctor=false`).
- Impacto confirmado por rastreamento dos consumidores: `list_my_appointments` entrega o snapshot à
  IA/WhatsApp; lembretes usam o mesmo campo; a conclusão publica esse nome no evento consumido pelo
  Financeiro/Caixa; estatísticas agrupam pelo novo `doctor_id`, mas rotulam pelo snapshot antigo. O
  paciente pode receber o médico errado e relatórios/lançamentos podem atribuir o atendimento ao
  profissional anterior. Nenhuma mensagem externa foi enviada neste teste.
- Causa confirmada: `recoverAppointment()` valida o novo profissional com `buildSnapshot()`, descarta
  o retorno e atualiza somente `doctorId`; o contrato de snapshot imutável impede que a projeção
  congelada acompanhe a nova atribuição. A trilha old/new da correção está íntegra, portanto o
  problema é a leitura do estado atual por consumidores que reutilizam o snapshot de criação.
- Controles que passaram: a UI refletiu o novo médico; quatro correções válidas geraram quatro
  corrections/audits/outbox/idempotências; replay produziu uma única mutação; duas entradas
  inválidas não alteraram o banco; cleanup final zerou todos os marcadores.

### LGPD-005 — consentimentos não têm fluxo implantável de concessão/revogação — P1

- Status: `FAIL` funcional/LGPD, confirmado por interface de produção e rastreamento completo de
  chamadas.
- Reprodução: abrir o hub de um paciente como owner; não há estado, botão ou formulário para
  conceder/revogar consentimento. A busca no código encontrou `recordConsent()` e
  `revokeConsent()` somente nas próprias definições de domínio; não existe página, Server Action,
  rota API ou ferramenta do agente que as invoque.
- Impacto: a clínica não consegue operar pelo produto o ciclo conceder → consultar → revogar, nem
  demonstrar a decisão atual ao operador. As tabelas append-only e as regras de suppression existem,
  mas estão inacessíveis no sistema implantado, bloqueando a validação operacional de consentimento.
- Limite: nenhuma decisão foi inserida diretamente no banco, pois isso não provaria o produto real.

### DATA-002 — edições concorrentes de paciente sofrem lost update — P2

- Status: `FAIL` de concorrência, reproduzido dinamicamente em produção na Clínica A.
- Reprodução: owner e atendente abriram o mesmo paciente, partiram do mesmo estado e submeteram
  nomes distintos em paralelo, com uma trava de linha externa garantindo sobreposição. As duas
  Server Actions foram aceitas, geraram duas auditorias, dois outbox e duas idempotências por dois
  atores; nenhuma recebeu conflito. O valor final foi simplesmente um dos dois envios.
- Impacto: dois colaboradores podem sobrescrever silenciosamente alterações cadastrais, de contato
  ou endereço; a auditoria registra ambos, mas o usuário perdedor acredita que sua edição permaneceu.
- Causa confirmada: o formulário não envia versão/`updatedAt`, e `updatePatient()` faz `UPDATE` por
  `id + clinic_id + deleted_at IS NULL`, sem compare-and-swap, `row_version` ou bloqueio otimista.

### DATA-003 — estorno integral multipartes não terminaliza o lançamento — P2

- Status: `FAIL` de consistência financeira, reproduzido dinamicamente em produção na Clínica A.
- Reprodução: criar recebível manual de R$ 10,00; baixar R$ 3,33 e depois R$ 6,67; reembolsar
  integralmente cada uma das duas transações. Banco final antes do cleanup: duas `payment` somando
  R$ 10,00, duas `refund` somando R$ 10,00 e duas compensações somando R$ 10,00, ambas `pago`.
  Apesar do estorno total, o original permaneceu `pago`, apareceu no filtro “Pago”, não apareceu em
  “Estornado” e o botão “Reembolsar” desapareceu porque cada parcela já tinha saldo zero.
- Impacto: o razão líquido permanece matematicamente zerado, mas o estado operacional e a
  classificação do histórico mentem sobre um recebimento completamente estornado. O usuário não
  possui ação restante para terminalizar o lançamento, o que prejudica conciliação, auditoria e
  filtros por status e pode induzir decisões financeiras incorretas.
- Causa confirmada: `createEstorno()` soma refunds somente de `originalPaymentId = payment.id` e
  passa esse subtotal por parcela a `isEstornoIntegral(orig.valorPago, valorEstornado)`. Com mais de
  uma transação de pagamento, nenhum subtotal individual alcança o total do lançamento; logo o ramo
  que marca original e compensações como `estornado` nunca é executado.
- Controles aprovados: valores inválidos não persistiram; arredondamento de três casas foi coerente;
  cancelamento pendente gerou uma única trilha; nenhuma chamada ao Asaas/provedor externo ocorreu;
  cleanup removeu 2 originais, 2 compensações, 4 transações, 7 outbox, 7 auditorias e 7 chaves, com
  todos os contadores finais em zero.

### DATA-004 — edições concorrentes de fornecedor sofrem lost update — P2

- Status: `FAIL` de concorrência financeira, reproduzido dinamicamente na Clínica A com owner e
  perfil Financeiro.
- Reprodução: ambos abriram a mesma versão do fornecedor e preencheram razões sociais distintas. Uma
  trava externa de linha garantiu que os dois requests ficassem sobrepostos; após a liberação, ambos
  retornaram sem 5xx e produziram duas auditorias/duas idempotências por dois atores. O valor final
  foi somente um dos envios, sem conflito ou instrução de reload.
- Impacto: dados de pagamento, contato, CNPJ ou razão social de fornecedor podem ser sobrescritos
  silenciosamente por colaboradores, afetando contas a pagar e identificação do favorecido. A
  auditoria preserva as duas intenções, mas ambos os usuários recebem sucesso.
- Causa confirmada: `updateSupplier()` atualiza por `id + clinic_id`, sem versão/`updatedAt` esperado,
  compare-and-swap ou outra detecção de estado obsoleto; o formulário também não carrega token de
  versão.

### VAL-001 — fornecedor aceita CNPJ estruturalmente inválido — P3

- Status: `FAIL` de validação/dados. O formulário mascarou e enviou `1`; o backend aceitou e o banco
  persistiu exatamente `cnpj='1'`.
- Impacto: cadastro financeiro admite identificador fiscal incompleto, prejudicando busca,
  conciliação, deduplicação e eventual integração/relatório fiscal. Não houve execução de cobrança.
- Causa confirmada: `CreateSupplierSchema` aplica apenas `trim().max(18)` ao CNPJ; não exige 14
  dígitos nem valida dígitos verificadores. A máscara limita caracteres no cliente, mas não valida o
  valor submetido nem protege callers diretos.
- Controles aprovados: nome HTML-like não executou script; tenant B não viu a fixture; inativo foi
  removido do seletor de despesas e reativado corretamente; cleanup zerou supplier/audit/idempotency.

### DATA-005 — edições concorrentes do perfil da clínica sofrem lost update — P2

- Status: `FAIL` de concorrência em configuração administrativa, reproduzido dinamicamente na
  Clínica A com duas abas do owner.
- Reprodução: ambas carregaram o mesmo perfil e salvaram valores CNES diferentes simultaneamente.
  As duas Server Actions responderam HTTP 200, mostraram “Perfil salvo.” e geraram duas auditorias;
  nenhuma informou estado obsoleto e somente um dos valores permaneceu.
- Impacto: alterações fiscais, de endereço, telefone, nome ou logo feitas por dois administradores/
  abas podem se sobrescrever silenciosamente. A trilha preserva as duas intenções, mas o editor
  perdedor recebe confirmação falsa de que seu valor continua vigente nos documentos.
- Causa confirmada: `updateClinicProfileCore()` lê `before` e atualiza apenas por `clinicId`, sem
  `updatedAt` esperado, `row_version` ou compare-and-swap; o formulário não transporta versão.

### DATA-006 — expediente com pausa persiste parcialmente — P2

- Status: `FAIL` de atomicidade funcional. A UI promete criar manhã+tarde “de uma vez”, mas executa
  duas Server Actions/transactions independentes.
- Reprodução: para um médico sintético, criar 14h–15h; depois pedir expediente 08h–09h e
  14h30–15h30. A manhã respondeu 200, a tarde conflitante 500 e o banco ficou com 08h–09h mais a
  janela anterior, apesar do alerta de erro e sem refresh de sucesso.
- Impacto: o operador acredita que a operação falhou, mas uma disponibilidade parcial altera slots e
  pode permitir agendamentos inesperados. Retry pode então conflitar também na manhã já gravada.
- Causa confirmada: `addExpediente()` aguarda duas chamadas sequenciais a `setDoctorAvailability()`;
  não existe transaction/idempotency única para o par nem compensação da primeira em falha da segunda.

### DATA-007 — recorrência ignora duplicidade diária nas ocorrências posteriores — P2

- Status: `FAIL` de regra de negócio, reproduzido dinamicamente em produção na Clínica A.
- Reprodução: criar pela UI uma consulta isolada para paciente/médico no segundo dia da futura série;
  em seguida criar três ocorrências semanais do mesmo paciente/médico, em outro horário, começando
  sete dias antes. A série foi aceita e o segundo dia terminou com duas consultas ativas do mesmo par.
- Impacto: a recorrência contorna a regra explícita usada pelo formulário comum, podendo duplicar
  agenda, lembretes e contabilização operacional para o mesmo paciente/profissional no mesmo dia.
- Causa confirmada: `findDuplicadoNoDia()` recebe somente `input.date` da primeira ocorrência antes de
  chamar `createRecurringAppointments()`. O core percorre as demais datas sem repetir a guarda, e as
  constraints do banco protegem conflito de horário, não duplicidade diária em horários distintos.
- Controle aprovado: um blocker no horário exato da segunda ocorrência produziu erro controlado em
  HTTP 200 e rollback atômico; nenhuma série nem primeira ocorrência parcial persistiu.

### DATA-008 — recorrência semanal muda o horário local ao atravessar DST — P2

- Status: `FAIL` algorítmico reproduzível, sem mutação de produção. A Clínica A usa
  `America/Sao_Paulo` e não foi afetada pela prova; o defeito atinge clínicas configuradas em fusos
  IANA com mudança de offset, contrato permitido pela coluna textual de timezone.
- Reprodução: converter 07/03/2027 09:00 de `America/New_York` pelo helper real e gerar três
  ocorrências semanais. A implementação devolveu 09:00, 10:00 e 10:00 locais, sempre separadas por
  168 horas UTC, ao atravessar o início do DST em 14/03.
- Impacto: consultas, lembretes e disponibilidade de uma série passam a ocorrer uma hora antes/depois
  do horário de parede escolhido pelo operador durante parte do ano.
- Causa confirmada: `buildWeeklyOccurrences()` soma `index * intervalWeeks * WEEK_MS` ao instante UTC
  inicial e não recebe o timezone da clínica. Recorrência de calendário deve avançar a data local e
  reconverter cada ocorrência para UTC com as regras IANA daquela data.

### DATA-009 — importação histórica contabiliza consultas no mês corrente — P2

- Status: `FAIL` de integridade de métricas, reproduzido dinamicamente em produção na Clínica A.
- Reprodução: importar três appointments de 2001 e aguardar apenas o worker normal do outbox. Foram
  criadas três linhas de `usage_counter_ledger` no período `2026-08`, e `usage_metrics` passou de 37
  para 40. O cleanup removeu as três linhas e decrementou exatamente três unidades.
- Impacto: uma carga histórica de até 500 itens por lote infla uso, dashboards e indicadores
  comerciais do mês da importação. Agendamentos hoje são métrica, não hard quota, mas o dado deixa de
  representar a operação corrente e pode contaminar decisões/relatórios futuros.
- Causa confirmada: cada item importado usa `insertScheduledAppointment()` e publica
  `scheduling.appointment.created`; o handler de billing chama `recordUsage(..., currentPeriod())`
  sem considerar `createdVia='import'` nem o `scheduledAt` histórico do payload.

### UX-003 — série recorrente não tem identificação ou cancelamento operacional — P2

- Status: `FAIL` funcional. A UI cria até 104 consultas recorrentes, mas Agenda/detalhe renderizam cada
  appointment como isolado, sem indicador, agrupamento ou ação de cancelamento da série.
- Impacto: o operador não reconhece a origem recorrente nem consegue interromper as ocorrências futuras
  de uma vez; resta corrigir itens individualmente, com risco de omissão e série ainda marcada ativa.
- Causa confirmada: a projeção `AgendaAppt` não transporta `recurrenceSeriesId/occurrence`. O domínio
  exporta `cancelRecurringSeries()`, mas a busca completa encontrou zero página, Server Action, rota ou
  componente que o invoque.

### UX-004 — segundo lote histórico na mesma página reutiliza chave idempotente — P2

- Status: `FAIL` funcional com controle exactly-once aprovado. O replay do mesmo JSON retornou o lote
  original sem duplicar batch, appointments, auditoria ou chave; ao selecionar outro JSON na mesma
  montagem da página, a UI respondeu `Idempotency key ... reused with a different payload` e criou zero.
- Impacto: uma importação legítima dividida em vários arquivos exige reload não documentado; a mensagem
  interna em inglês expõe a chave técnica e não orienta o operador.
- Causa confirmada: `HistoryImporter` cria a chave uma única vez com `useMemo(() => uuidv4(), [])` e
  não a rotaciona nem limpa o formulário depois de um lote concluído.

### A11Y-002 — recorrência e observações da Agenda não têm nome acessível — P3

- Status: `FAIL` de acessibilidade. Os labels visuais “Intervalo (semanas)”, “Quantidade de consultas”
  e “Observações (opcional)” não possuem `htmlFor`, e os inputs/textarea correspondentes não têm `id`,
  `aria-label` ou wrapping label; `getByLabel()` encontrou zero nos três casos.
- Impacto: leitores de tela não identificam com segurança os parâmetros que podem gerar até 104
  consultas nem o campo de observação. Os campos Data/Hora/Procedimento/Profissional do mesmo drawer
  têm associação correta, isolando o defeito aos `Field` sem vínculo semântico.

### WAIT-001 — lifecycle humano da lista de espera não oferta nem conclui reserva — P2

- Status: `FAIL` funcional reproduzido na Clínica A, sem mensagem externa.
- Reprodução: criar duas entradas compatíveis e cancelar um atendimento pelo cancelamento humano da
  Agenda (`exceptional_cancel`). O appointment ficou `cancelado`, mas ambas as entradas permaneceram
  `waiting`; zero evento de oferta e zero mensagem foram criados.
- Impacto: a página promete que o primeiro candidato elegível “recebe uma oferta”, mas cancelamentos
  humanos não iniciam o fluxo; a clínica pode perder o horário e acreditar que a automação opera.
- Causa confirmada: `offerWaitlistForCancelledAppointment()` é chamado somente por
  `transitionCore(... target=cancelado)`. `recoverAppointment(exceptional_cancel)` e cancelamento por
  ausência médica possuem implementações próprias e não o chamam; `cancelAppointment()` não possui
  controle humano na Agenda.
- Lacunas seguintes: `scheduling.waitlist.offered` está em `PRODUCER_AHEAD`, sem handler de
  WhatsApp/e-mail, enquanto a UI rotula o estado como “Oferta enviada”. `markWaitlistEntryBooked()`
  existe no domínio, mas não tem página, Server Action, rota ou caller.
- Controle aprovado: criação normal/urgente, cancelamento das duas entradas e regra pura de prioridade
  passaram; cleanup removeu todas as linhas e trilhas sintéticas.

### A11Y-003 — formulário da lista de espera não associa nenhum label — P3

- Status: `FAIL` de acessibilidade. Paciente, Procedimento, Profissional, Preferência inicial/final,
  Prioridade e Observações são labels visuais em `Field` sem `htmlFor`; os sete controles não têm IDs
  correspondentes e `getByLabel()` retornou zero para todos.
- Impacto: leitores de tela não conseguem operar criteriosamente a fila, inclusive prioridade e
  período de elegibilidade. O checkbox “Mostrar encerrados”, implementado com wrapping label, foi
  reconhecido corretamente e serviu como controle positivo.

### A11Y-001 — campos de feriado não têm nome acessível — P3

- Status: `FAIL` de acessibilidade. “Data” e “Motivo (opcional)” são texto visual, mas os respectivos
  inputs não têm `id/htmlFor`, `aria-label` ou wrapping label; a árvore acessível expôs dois textboxes
  sem nome e `getByLabel()` encontrou zero elementos.
- Impacto: usuários de leitor de tela não conseguem identificar com segurança os campos do feriado;
  automação por semântica também falha. Os quatro inputs de disponibilidade usam IDs corretamente,
  isolando o problema aos dois `Field` de feriado.

### VAL-002 — perfil da clínica aceita CNPJ estruturalmente inválido — P2

- Status: `FAIL` de integridade fiscal/documental. A UI mascarou e enviou `1`; backend respondeu HTTP
  200, persistiu ciphertext/hash do valor e o formulário exibiu `1` após reload.
- Impacto: o identificador legal exibido em prescrições/documentos pode ficar inválido; hash e futura
  deduplicação também passam a representar entrada não canônica. Isso não alterou owner, contato de
  cobrança ou titular do cartão, que são identidades distintas.
- Causa confirmada: `ClinicProfileSchema` aceita qualquer string com até 20 caracteres e
  `updateClinicProfileCore()` cifra/hasheia o valor sem normalizar 14 dígitos ou validar checksum; o
  próprio comentário do schema registra essa lacuna. A máscara cliente não é validação de domínio.
- Controles aprovados: `slug/status/timezone` ficaram intactos, médico sem permissão foi negado,
  Clínica B não mudou, não houve provedor e toda a linha A foi restaurada exatamente.

### PAT-001 — soft-delete não oferece recuperação operacional — P2

- Status: `FAIL` funcional. O delete real ocultou o paciente da lista, da busca e da rota direta,
  mas nenhum controle, rota ou action de restauração existe.
- Impacto: apesar da UI informar “soft delete agora; remoção definitiva em 30 dias”, um erro
  operacional não pode ser revertido pelo produto durante essa janela. A única alternativa seria
  intervenção direta no banco, sem workflow/auditoria de recuperação.
- Evidência estática complementar: `includeDeleted` existe apenas em queries internas e não é
  exposto por páginas/actions; não há `restorePatient`/undelete equivalente.

### UX-001 — paciente falecido continua selecionável na Agenda — P3

- Status: `FAIL` de UX com controle de backend `PASS`.
- Reprodução: após registrar óbito, a busca do drawer “Novo atendimento” retornou o paciente e
  permitiu selecioná-lo; somente no submit o core respondeu “paciente inválido para esta clínica”.
- Impacto: retrabalho e experiência inadequada em contexto sensível. Não houve consulta criada,
  pois `assertPatientInClinic()` exige `obito_em IS NULL` antes do insert.
- Causa confirmada: `buscarPacientes()` reutiliza `listPatients()`, que filtra apenas `deleted_at` e
  não exclui óbito; a proteção existe somente no core de agendamento.

### UX-002 — trial oferece cancelamento que o backend sempre rejeita — P3

- Status: `FAIL` de coerência UI/regra de negócio, com backend fail-closed aprovado.
- Reprodução: assinatura `trial`, período válido e nenhuma pendência; botão de cancelamento visível e
  habilitado. Duas submissões retornaram HTTP 200 controlado com “O cancelamento exige uma assinatura
  ativa.” e nenhum efeito persistente.
- Impacto: o owner recebe uma ação administrativa que nunca pode concluir no estado atual, gerando
  falsa expectativa de cancelamento do trial e tentativas repetidas. O teste não conclui se trial
  deveria ser cancelável; confirma apenas que UI e backend discordam.
- Causa confirmada: os botões de planos verificam `current.billingStatus !== 'active'`, mas o ramo do
  botão de cancelamento testa somente `!pending`; `requestSubscriptionCancellation()` exige
  explicitamente `billingStatus === 'active'`.

### HTTP-001 — paciente ausente/deletado responde soft-404 HTTP 200 — P3

- Status: `FAIL` de semântica HTTP. ID malformado, UUID inexistente e paciente soft-deleted
  renderizaram o estado de página não encontrada, mas a navegação documental respondeu HTTP 200.
- Impacto: monitoramento, caches e clientes automatizados não conseguem distinguir recurso ausente
  de sucesso apenas pelo status. Não houve stack trace nem 5xx e nenhum dado de paciente foi exposto.
- Causa provável: `notFound()` é disparado dentro do Server Component dinâmico após o streaming do
  shell; requer confirmação na correção para preservar a UX e devolver 404 antes de commit de headers.

## 33. Correções Recomendadas

1. `AUTHZ-001`: aplicar `VIEW_PATIENT` no servidor antes de qualquer query de lista/detalhe. Para
   páginas, obter a identidade de forma segura e renderizar estado “Sem acesso” ou usar o gate
   central sem gerar Sentry. Para Server Actions/exports, manter `requireFreshPermission` conforme a
   sensibilidade. Revisar todas as páginas e queries de pacientes para variantes do mesmo gap.
2. `AUTHZ-002`: aplicar `VIEW_AGENDA` antes de `getAgendaData()` fazer qualquer query. O deny deve
   retornar estado seguro sem appointments/patient cards/profissionais/procedimentos/recursos.
3. `AUTHZ-003`: definir o contrato do feed misto e exigir no servidor a permissão clínica adequada
   antes da query; recomendação mínima é `requireAnyPermission(VIEW_PRESCRIPTION,
   VIEW_PRONTUARIO)` apenas se o produto aceitar que qualquer uma veja todo o feed. Caso contrário,
   filtrar cada tipo por sua permission e não retornar metadado do tipo negado. Aplicar o gate
   correspondente também nas rotas diretas de prescrição/documento/prontuário e na aba do paciente,
   sempre antes de consultar/decifrar o registro ou emitir a signed URL. Ocultar Novo/Editar/Assinar
   quando a role não tiver a capacidade correspondente, sem depender do gate posterior da action.
4. `AUTHZ-004`: gatear a página por `CREATE_PRESCRIPTION` (ou introduzir permissão de leitura de
   templates somente se houver requisito real), mantendo os gates das actions.
5. `RBAC-001`: decidir o contrato de produto para `export:audit` e `manage:agent`. Se não houver
   feature tenant, removê-las/deprecá-las do catálogo e da UI com migração compatível; se houver,
   ligar cada code a um gate e teste de ação específico. Não aliasar silenciosamente
   `manage:agent` para `manage:settings` sem decisão de produto.
6. `OBS-001`: tratar sessão revogada como navegação esperada em páginas concorrentes, seguindo o
   padrão já usado em Dashboard/Equipe. Mover gates de `setMemberOverrideAction` para dentro do
   tratamento controlado ou criar um wrapper de action que preserve `AuthError` como 401/403 sem
   capturá-lo como falha inesperada. Não reduzir nem remover a verificação fresh.
7. `META-001`: em operação controlada na Meta, reinscrever o app correto na WABA e conferir por GET
   que o app de produção aparece em `subscribed_apps`. Depois enviar uma única mensagem de um número
   de teste autorizado e comprovar inbound, outbox/IA, outbound e callback `sent/delivered`. Como
   prevenção, reconciliar periodicamente token/scopes/phone/subscription e não mostrar `connected`
   quando a assinatura externa estiver ausente; o health deve distinguir alcance da Graph de saúde
   da conexão tenant.
8. `LGPD-002`: reduzir `patient.core.created` ao mínimo necessário enquanto não houver consumidor
   (preferencialmente apenas IDs), ou não publicá-lo antes de existir consumo real. No hard-delete/
   anonimização, remover ou sanear de forma atômica todos os payloads do outbox associados ao
   paciente, inclusive eventos já `skipped`, mantendo apenas metadados não pessoais necessários à
   prova forense.
9. `LGPD-003`: no hard-delete/anonimização, remover todos os artefatos de exportação do paciente no
   bucket `lgpd-exports`, zerar URL/expiração persistidas e registrar o resultado; adicionar lifecycle
   defensivo para objetos órfãos/expirados. A remoção deve ocorrer antes de declarar o pedido
   concluído ou produzir estado de falha/retry claramente observável.
10. `LGPD-004`: não usar `response=NULL` para indicar conteúdo idempotente apagado. Introduzir estado
    explícito compatível com replay (por exemplo, coluna/status de resposta eliminada) e manter
    distinguíveis reserva em andamento, execução concluída e resposta expurgada; alinhar trigger,
    health e cleanup à mesma máquina de estados.
11. `AUTHZ-005`: condicionar as queries e toda renderização financeira do Dashboard a
    `VIEW_FINANCIAL`, usando `Promise.resolve`/DTO neutro apenas para evitar a consulta quando negado.
    Não ocultar somente por CSS/client: saldo, série e links financeiros não podem ser serializados no
    RSC sem permissão.
12. `AUTHZ-006`: exigir `MANAGE_SETTINGS` no Server Component antes de carregar o status WhatsApp e
     renderizar um estado seguro para quem não possui a permissão. Filtrar também o card/tab do hub
     para não oferecer um controle inacessível; preservar os gates fresh já existentes nas actions.
13. `DATA-001`: preservar o snapshot de criação como histórico, mas não usá-lo como nome atual após
    transferência. Resolver o profissional corrente por `doctorId` nos lembretes, ferramentas da IA,
    estatísticas e evento de conclusão, ou introduzir uma projeção explícita de profissional
    atribuído atualizada atomicamente com a correção. Não sobrescrever silenciosamente a evidência
    histórica old/new nem enfraquecer o trigger de imutabilidade sem decisão de contrato.
14. `LGPD-005`: expor o estado atual e ações de conceder/revogar consentimento no hub do paciente,
    usando exclusivamente `recordConsent()`/`revokeConsent()` e suas trilhas append-only. Definir
    permissões, finalidade/canal, confirmação e texto jurídico antes de alterar contrato público.
15. `DATA-002`: adicionar concorrência otimista à edição de paciente (`row_version` ou `updatedAt`
    esperado no formulário e no `WHERE`); retorno zero deve produzir conflito claro e preservar o
    valor vencedor, não sucesso silencioso. Uma nova coluna exigiria autorização de migration.
16. `PAT-001`: implementar restauração auditada durante a janela de retenção, revalidando
    unicidade/estado, removendo apenas suppressions criadas pelo delete operacional e proibindo
    restauração depois de hard-delete/anonimização ou merge.
17. `UX-001`: excluir pacientes com `obito_em` da busca de Agenda/lista de espera e manter a guarda
    do core como defesa em profundidade.
18. `HTTP-001`: fazer IDs inválidos/ausentes/deletados alcançarem o boundary de 404 antes do
    streaming de headers, preservando nenhuma enumeração cross-tenant e a página amigável.
19. `DATA-003`: calcular o total reembolsado sobre todas as transações de pagamento do lançamento,
    não apenas sobre a parcela selecionada. Manter a guarda por parcela para impedir over-refund,
    mas terminalizar original e todas as compensações atomicamente quando o somatório global atingir
    `valorPago`; preservar ledger append-only e a serialização pelo lock do lançamento original.
20. `DATA-004`: adicionar concorrência otimista a `updateSupplier`, enviando versão/`updatedAt` lido
    pelo formulário e incluindo-o no `WHERE`; update com zero linhas deve retornar conflito seguro,
    sem auditoria/idempotência de sucesso para o perdedor.
21. `VAL-001`: normalizar CNPJ para dígitos no boundary, exigir 14 dígitos e validar os dois dígitos
    verificadores quando o campo opcional for preenchido. A mesma validação deve valer no backend;
    máscara cliente não é mecanismo de integridade.
22. `AUTHZ-007`: separar `manage:own_availability` de `manage:team_availability`/gestão de recursos
    globais. Médico comum deve poder alterar somente sua disponibilidade; ausência de outro
    profissional, feriados, salas e equipamentos exigem permissão administrativa fresh. Manter
    validação tenant como defesa adicional, não como substituto de ownership.
23. `OBS-002`: envolver as actions de procedimento, disponibilidade e feriado em boundary que
    converta `ZodError`, unicidade, overlap e erros de domínio em resultado controlado/4xx sem expor
    stack; exceções realmente inesperadas continuam 5xx/Sentry. A UI deve exibir a mensagem mapeada,
    não `err.message` bruto nem alert vazio.
24. `DATA-005`: adicionar versão/`updatedAt` esperado ao formulário e ao `UPDATE` do perfil; zero
    linhas deve produzir conflito acionável e não auditoria/sucesso. Preservar a allowlist de colunas,
    o binding do `clinicId` da sessão e a cifra fiscal existentes.
25. `VAL-002`: reutilizar uma validação canônica de CNPJ no backend antes de cifrar/hashear: vazio
    continua opcional; preenchido deve normalizar para 14 dígitos e passar checksum. Não misturar o
    CNPJ legal da clínica com identidade do owner, contato de cobrança ou titular do cartão.
26. `UX-002`: alinhar a UI ao contrato decidido para trial. Se trial não puder ser cancelado, ocultar/
    desabilitar a ação com explicação; se puder, alterar o domínio e os efeitos de encerramento em uma
    decisão separada, sem improvisar chamada ao Asaas nem reutilizar cancelamento de assinatura ativa.
27. `AUTH-005`: no logout autenticado, incremente de forma autoritativa o epoch de sessão do usuário
    antes de concluir a resposta e mantenha `signOut(global)` para revogar refresh tokens. A mudança
    precisa invalidar o cookie atual e todas as sessões já emitidas no request seguinte, sem depender
    de blacklist em memória serverless e sem remover o epoch-check existente.
28. `AUTH-006`: após `verifyOtp(type=recovery)`, emita uma prova curta, one-time e vinculada ao
    usuário/sessão; exija e consuma essa prova atomicamente em `resetPasswordAction`. Uma sessão
    comum deve usar um fluxo separado que exija senha atual ou reautenticação, não o form de recovery.
29. `AUTH-007`: após atualizar a senha, incremente o mesmo epoch autoritativo e revogue todas as
    sessões/refresh tokens, inclusive a recovery session que será redirecionada ao login. Não trate
    `signOut(others)` como invalidação de JWT já emitido.
30. `DATA-006`: substituir as duas chamadas do expediente por uma única action que receba/valide as
    duas janelas e as insira na mesma transaction/idempotency key. Qualquer conflito deve reverter o
    par inteiro; manter a action unitária para o modo “Adicionar janela”.
31. `A11Y-001`: fornecer IDs estáveis aos inputs de data/motivo e passá-los em `htmlFor` aos `Field`;
    adicionar regressão por nome acessível, não apenas por posição no DOM.
32. `DATA-007`: validar a regra paciente+médico+dia para cada data calculada dentro da mesma
    transaction da recorrência, sob lock/constraint que também feche concorrência; qualquer colisão
    deve rejeitar a série inteira com indicação da ocorrência conflitante.
33. `UX-003`: expor `recurrenceSeriesId/occurrence` na projeção da Agenda, identificar/agrupar a série e
    criar uma Server Action/UI autorizada para `cancelRecurringSeries()`, com confirmação, motivo,
    idempotência e contagem das ocorrências futuras afetadas.
34. `A11Y-002`: adicionar IDs únicos e `htmlFor` aos dois números da recorrência e ao textarea de
    observações; manter o checkbox de repetição como controle nomeado e testar a árvore acessível.
35. `DATA-008`: calcular recorrência no calendário local da clínica: avançar semanas na data/hora de
    parede e chamar a conversão IANA para cada ocorrência. Definir política explícita para horário
    inexistente/ambíguo em saltos DST e preservar o instante original como primeira ocorrência.
36. `WAIT-001`: centralizar todos os caminhos de cancelamento na mesma operação que libera recursos e
    seleciona a waitlist; implementar handler real de oferta e somente então usar “Oferta enviada”.
    Expor aceitar/agendar/recusar/expirar com `markWaitlistEntryBooked()` ou remover o código morto.
37. `A11Y-003`: fornecer IDs únicos e `htmlFor` aos sete controles da Lista de espera; o Combobox deve
    receber nome acessível sem depender do placeholder.
38. `DATA-009`: não publicar `appointment.created` metrável para itens históricos ou fazer o handler
    ignorar explicitamente `createdVia='import'`. Preservar o evento/lote de proveniência e testar que
    importação não muda `usage_metrics`, sem alterar a métrica de agendamentos correntes.
39. `UX-004`: após sucesso, limpar arquivo/payload e gerar nova chave idempotente para o próximo lote;
    manter a chave anterior somente durante replay/retry do lote em curso. Traduzir conflitos para
    mensagem acionável sem expor a chave interna.
40. `AUTHZ-008`: separar operação de fila (`check-in`/chamar/ausência) de conclusão clínica. Exigir no
    backend uma permissão fresh de conclusão e vínculo ao profissional atribuído ou delegação clínica
    explícita; não usar `EDIT_AGENDA` como autorização suficiente. Para paciente cadastrado, impedir
    `atendido` e o evento financeiro até existir prontuário válido no estado exigido pelo contrato
    (preferencialmente assinado). Serializar início/conclusão/consumers por appointment ou fazer os
    handlers rejeitarem ordem terminal incompatível. A UI deve ocultar “Encerrar consulta” de perfil
    não clínico e não combinar “somente leitura” com editor habilitado.
41. `STATE-001`: oferecer “Marcar ausente” enquanto o appointment ainda está `agendado` ou
    `confirmado`, estados em que a transição é válida, e removê-lo da Sala de espera depois de
    `chegou`. Se o negócio realmente precisar corrigir um check-in indevido, criar uma ação de
    correção explícita e auditada, sem ampliar silenciosamente `chegou→faltou`. O erro esperado deve
    manter resultado controlado, mas o botão inválido não deve ser renderizado.

## 34. Plano de Implementação das Correções

### AUTHZ-001

- Mudança mínima: gate de `VIEW_PATIENT` nas rotas de lista e detalhe antes de chamar queries.
- Não mudar: RLS/tenant scope, criptografia/descriptografia, permissões de create/edit/delete e
  fluxo A↔B já aprovado.
- Regressão obrigatória: owner/doctor/attendant/financial com permissão continuam lendo; override
  deny bloqueia; grant restaura; sessão antiga morre; A↔B continua bloqueado; CRUD autorizado passa.

### AUTHZ-002/003/004

- Mudanças focadas nas páginas/dados de Agenda, Documentos e Modelos; não alterar bundles, RLS nem
  regras de mutação já protegidas.
- Regressão: permissão presente renderiza os dados; ausente/deny não executa a query nem serializa
  dados; sessão velha é revogada; rotas diretas e Server Actions permanecem fail-closed.
- Em Documentos, testar separadamente `view:prescription` somente, `view:prontuario` somente, ambas
  e nenhuma para evitar ampliar acesso ao corrigir o feed combinado.
- Em Prontuários, repetir hub e deep-link como doctor autorizado, attendant/financial sem leitura e
  override deny/grant; conteúdo clínico não pode chegar ao RSC/DOM quando negado, enquanto autosave e
  assinatura continuam com seus gates de mutação próprios.

### RBAC-001

- Mudança depende de decisão de produto: remover/deprecar os dois codes órfãos ou implementar as
  capacidades tenant correspondentes com gates próprios.
- Regressão obrigatória: catálogo, bundles, UI, claims e enforcement points permanecem alinhados;
  nenhuma permissão sem consumidor pode ser delegada como se tivesse efeito.

### OBS-001

- Preservar `claims_version` e `requireFreshPermission`; alterar apenas a tradução da negativa para
  redirect/resultado 401-403 e a classificação no Sentry.
- Regressão obrigatória: replay continua sem persistência; erro inesperado continua chegando ao
  Sentry; AuthError esperado não vira 500/error.

### AUTH-005

- Mudança mínima: criar uma operação server-side que obtenha o usuário atual, incremente
  `claims_version` no profile e então revogue os refresh tokens/limpe os cookies. Se a atualização do
  epoch falhar, não declarar logout global concluído silenciosamente.
- Não mudar: verificação de `claims_version` em cada request, triggers de role/permissão, duração do
  JWT e revogação Supabase de refresh tokens.
- Regressão obrigatória: cookie copiado, aba antiga e segundo dispositivo são negados no request
  seguinte; refresh antigo falha; novo login recebe o novo epoch; usuário removido permanece negado.

### AUTH-006/007

- Mudança mínima: separar recovery comprovado de sessão autenticada comum; consumir uma autorização
  one-time no reset e, após sucesso, incrementar o epoch antes de revogar sessões e redirecionar.
- Não mudar: anti-open-redirect de `/auth/confirm`, mensagem genérica, rate limit, política de senha
  do provedor e link de recovery de uso único, todos aprovados.
- Regressão obrigatória: acesso direto com sessão comum é negado; recovery válido altera a senha uma
  vez; link reutilizado falha; senha fraca continua rejeitada; todos os cookies/access/refresh tokens
  anteriores falham no request seguinte; novo login com a senha final funciona.

### META-001

- Correção operacional imediata: usar o app/token corretos para executar a inscrição externa da
  WABA; não alterar o token cifrado nem o tenant antes de confirmar o app correto.
- Mudança preventiva mínima: adicionar uma verificação autenticada read-only da conexão (token,
  scopes, phone ID e `subscribed_apps`) ao status/reconcile do WhatsApp; estado divergente deve ser
  `failed`/degradado com instrução de reconexão, sem expor IDs ou tokens.
- Regressão: assinatura válida do webhook aceita payload; inválida continua 401; mensagem de teste
  gera exatamente um inbound, processamento idempotente, um outbound e callbacks correlacionados;
  nenhum tenant diferente vê os registros.

### LGPD-002

- Estender a fonte única de anonimização para `outbox`, escopada por `clinic_id` e `patientId`, sem
  apagar eventos de outros pacientes/tenants nem alterar filas `pending/processing` de forma
  incompatível com consumidores reais.
- Regressão: criar paciente sintético, publicar/processar o evento, pedir eliminação, executar o job
  controlado e comprovar que `patients`, `audit_events`, `idempotency_keys` e todos os payloads do
  outbox não preservam nome, e-mail, CPF/telefone ou hashes do titular. Reentrega/retention e A↔B
  devem continuar corretos.

### LGPD-003/004

- `LGPD-003`: adicionar uma operação Storage idempotente e escopada por `clinicId/patientId`, com
  retry observável. Regressão deve criar/exportar/excluir a mesma fixture, comprovar `NoSuchKey` nos
  dois formatos depois da conclusão e garantir que objeto/URL de outro paciente/tenant permanece.
- `LGPD-004`: modelar resposta expurgada sem colidir com `in-flight`; replay não pode reexecutar a
  mutação nem devolver DTO inválido. Regressão deve validar cache hit/estado terminal, trigger,
  contadores do health e cleanup vencido antes/depois do hard-delete.

### AUTHZ-005

- Gatear no Server Component tanto `getCashFlowToday` quanto `listCashFlowDaily`; renderizar estado
  não financeiro para médico/qualquer role sem a permissão.
- Regressão: com `view:financial`, valores e gráfico coincidem com o banco; com deny/role sem bundle,
  nenhuma query/valor/link financeiro aparece no HTML/RSC. `/financeiro`, Relatórios e PDF mantêm o
  comportamento já correto.

### AUTHZ-006

- Gatear a página/status do WhatsApp com `MANAGE_SETTINGS` antes da query e não serializar metadados
  da conexão para usuários negados; esconder o link administrativo no hub/tabs quando apropriado.
- Regressão: owner/gestor autorizado continua vendo e operando; médico/atendente/financeiro sem a
  permissão recebem estado seguro, não veem status/número/data/botões e continuam incapazes de
  invocar as actions. O teste de negativa não deve chamar a Meta nem desconectar o número.

### AUTHZ-007 / OBS-002

- `AUTHZ-007`: dividir a capacidade de administrar a própria disponibilidade daquela que permite
  administrar a equipe e recursos globais. No backend, médico comum deve ficar limitado ao seu
  próprio `doctorId`; ausência de outro profissional, feriados, salas e equipamentos exigem
  permissão administrativa fresh. A UI deve filtrar os profissionais e controles pelo mesmo
  contrato, sem usar apenas o vínculo ao tenant como autorização.
- Regressão de autorização: médico continua alterando a própria disponibilidade, mas não enxerga nem
  altera recurso/feriado global e não cria ausência para outro médico; owner/gestor autorizado
  continua operando todos. Repetir com deny/grant, sessão antiga e IDs A↔B. O teste destrutivo de
  ausência deve usar período comprovadamente vazio antes de qualquer mutação.
- `OBS-002`: retornar resultados controlados para `ZodError`, código/feriado duplicado, overlap e
  conflitos de domínio nas actions de configuração, preservando 5xx/Sentry apenas para erro
  inesperado e sem propagar mensagem/stack bruta nem renderizar alerta vazio.
- Regressão de erro: inputs longos/duplicados/overlap retornam validação/conflito sem HTTP 500 e sem
  trilha de sucesso; procedimento, janela e feriado válidos continuam funcionando.

### AUTHZ-008

- Introduzir uma autorização específica para conclusão clínica, aplicada com fresh check na action e
  no core. Preservar para o atendente apenas os atos operacionais deliberadamente permitidos; exigir
  médico atribuído ou delegação clínica explícita para concluir. Ocultar o controle pela mesma regra,
  sem tratá-la como defesa única.
- Fazer a conclusão de paciente cadastrado validar o prontuário e o estado clínico definido pelo
  produto antes de publicar `scheduling.appointment.completed`. O lançamento automático não pode ser
  produzido enquanto a consulta estiver clinicamente incompleta. O consumer de `started` não deve
  criar rascunho atribuído a médico após um estado terminal sem uma política explícita de recuperação.
- Regressão obrigatória: atendente chama e o médico assume/edita/assina/conclui; atendente tenta
  concluir e é negado sem state log/outbox/audit/idempotência financeira; médico errado e sessão
  revogada são negados; worker atrasado/invertido não deixa finalizada sem registro nem rascunho vazio
  atribuído; replay/duplo clique continuam exactly-once; financeiro só nasce depois do fechamento
  clínico válido. Repetir com walk-in sem paciente conforme contrato e IDs A↔B.

### STATE-001

- Mover a ação de no-show para os cards `agendado/confirmado` de “A chegar” e derivar sua exibição de
  `allowedTransitions(status)`, em vez de duplicar regras no layout. Não renderizar a ação na Sala de
  espera (`chegou`).
- Regressão: `agendado→faltou` e `confirmado→faltou` devem gerar exatamente um state log, evento,
  auditoria e resposta idempotente; `chegou` mantém apenas início/cancelamento conforme contrato;
  replay/duplo clique não duplica, role sem `EDIT_AGENDA` é negada, A↔B não altera e Relatórios passa
  a contabilizar a falta. Incluir controle de erro/reload para corrida entre check-in e no-show.

### DATA-001

- Manter separados “snapshot no momento da criação” e “profissional atualmente atribuído”. A
  mudança mínima deve centralizar a projeção do nome atual sem fazer cada consumidor reler ou
  reinterpretar o histórico de forma diferente.
- Atualizar conjuntamente `list_my_appointments`, candidatos de lembrete, evento de conclusão,
  handler financeiro/Caixa e estatísticas. Se a solução exigir nova coluna/projeção persistida, ela
  depende de autorização de migration.
- Regressão obrigatória: transferir atendimento agendado e em espera; Agenda, fila, IA, lembrete,
  conclusão e Financeiro devem identificar o novo médico, enquanto `appointment_corrections`
  preserva old/new e o replay continua exactly-once. Repetir com médico desativado após a
  transferência para validar o fallback sem reintroduzir o nome anterior como estado atual.

### LGPD-005

- Reusar as ações de domínio existentes por wrappers autenticados e com `EDIT_PATIENT`; não criar
  escrita paralela nem atualizar decisões antigas. Mostrar finalidade, canal, versão, ator e instante
  da decisão atual sem expor histórico de outro tenant.
- Regressão: conceder → usar contato permitido → revogar → bloquear contato/suppression → conceder
  novamente; cada passo exactly-once, auditável e isolado A↔B, inclusive sob requests concorrentes.

### DATA-002

- Adicionar ao formulário um token de versão obtido na leitura e fazê-lo participar atomicamente do
  `UPDATE`; zero linhas afetadas retorna conflito com instrução de recarregar, sem audit/outbox de
  sucesso. Aplicar o mesmo contrato ao upsert de endereço.
- Regressão: dois atores editam campos iguais e distintos a partir da mesma versão; apenas um vence,
  o outro recebe conflito, e retry após reload preserva ambas as alterações intencionais.

### DATA-003

- Separar as duas invariantes: (1) saldo reembolsável da parcela escolhida, usado por
  `assertRefundFitsPayment`; (2) total global reembolsado do lançamento, usado exclusivamente para
  decidir `estornoIntegral`. A consulta global deve incluir todas as `refund` ligadas a qualquer
  `payment` do original, dentro da mesma transação já serializada pelo `FOR UPDATE` do lançamento.
- Regressão obrigatória: pagamento único/estorno total; pagamento único/estorno parcial; duas ou
  mais parcelas estornadas em ordens diferentes; estorno parcial de cada parcela; concorrência em
  parcelas distintas; replay da mesma chave e over-refund. Somente o total global deve terminalizar
  original e todas as compensações, exatamente uma vez, sem alterar transações append-only.

### DATA-004 / VAL-001

- `DATA-004`: carregar versão/`updatedAt` no draft de fornecedor e fazer update condicional. Em
  conflito, manter o diálogo aberto, mostrar mensagem acionável e permitir reload/reaplicação, sem
  transformar o perdedor em sucesso auditado. Se exigir nova coluna, migration depende de aprovação.
- `VAL-001`: centralizar normalização/validação de CNPJ no schema de domínio usado por create/update;
  persistir formato canônico decidido pelo produto e formatar apenas para exibição. Campos vazios
  continuam opcionais, mas valor presente não pode ser parcial ou ter checksum inválido.
- Regressão: dois atores editando simultaneamente campos iguais/distintos; retry após reload;
  CNPJs válido, vazio, curto, longo, repetido, alfanumérico e com checksum inválido; UI e chamada
  direta devem produzir o mesmo resultado, preservando isolamento A↔B e desativação/reativação.

### DATA-005 / VAL-002

- `DATA-005`: carregar `updatedAt`/versão no Perfil e condicionar a escrita; em conflito, manter os
  valores do formulário, informar que o registro mudou e oferecer reload/reaplicação. Se exigir nova
  coluna, a migration depende de aprovação; não ampliar as colunas tenant-editáveis.
- `VAL-002`: centralizar normalização/checksum de CNPJ em utilitário de domínio compartilhável com o
  onboarding, mas manter os contratos de identidade separados. Persistir uma representação canônica
  antes de `encryptForTenant()`/`hashForLookup()` e formatar apenas na apresentação.
- Regressão: vazio e CNPJs válido/curto/longo/repetido/checksum inválido na UI e caller direto;
  duas abas e dois gestores editando campos iguais/distintos; conflito não audita sucesso; reload e
  retry preservam intenção; slug/status/timezone, cifra, PDFs, owner/billing/cardholder e A↔B ficam
  inalterados.

### DATA-006 / A11Y-001

- Mudança mínima: action transacional para expediente com pausa; `id/htmlFor` nos dois campos de
  feriado. Não mudar a semântica das janelas unitárias, EXCLUDE anti-overlap, timezone ou RLS.
- Regressão: par válido cria exatamente duas janelas/uma trilha lógica; conflito em qualquer metade
  cria zero; replay não duplica; single-window continua funcionando; feriado duplicado retorna erro
  controlado; Data/Motivo têm nomes acessíveis; A↔B e médico sem delegação continuam bloqueados.

### DATA-007/008 / UX-003 / A11Y-002

- `DATA-007`: calcular todas as ocorrências e validar duplicidade diária dentro da mesma transaction;
  conflito em qualquer posição cria zero série/appointment/audit/outbox/idempotência. Repetir sob duas
  sessões concorrentes e manter o EXCLUDE de horário como defesa independente.
- `UX-003`: carregar identidade/posição da série na Agenda e envolver `cancelRecurringSeries()` em
  action real com `EDIT_AGENDA`, motivo e confirmação. Cancelar somente futuras ativas, preservar
  histórico e tornar replay/segundo cancelamento controlados.
- `A11Y-002`: regressão por `getByLabel` para intervalo, quantidade e observações, com IDs únicos quando
  dois drawers/abas existirem; teclado, submit por Enter e mensagens de erro continuam funcionais.
- `DATA-008`: matriz `America/New_York` spring-forward/fall-back e fuso sem DST; todas as ocorrências
  preservam a hora local escolhida, intervalos de calendário e ordem, inclusive horários
  inexistentes/ambíguos tratados pela política definida.

### WAIT-001 / A11Y-003

- Unificar cancelamento comum, correção excepcional e ausência médica em um helper transacional que
  execute a seleção exactly-once. Regressão: normal/urgente, médico específico/qualquer, período fora/
  dentro, duas liberações concorrentes e nenhum candidato; somente um fica `offered`.
- Implementar entrega observável antes do label “Oferta enviada”: handler, retry, falha, expiração e
  consentimento. Aceite cria appointment correspondente e marca `booked`; recusa/timeout permite o
  próximo candidato sem duplicar mensagem. Manter A↔B, `EDIT_AGENDA`, idempotência e auditoria.
- Os sete campos devem funcionar por nome acessível, teclado e leitor de tela; intervalo invertido
  retorna erro controlado sem 500/persistência e preserva os valores para correção.

### DATA-009 / UX-004

- Separar evento de proveniência de evento de uso corrente: importação mantém batch, snapshots, state
  logs e `scheduling.import.completed`, mas não incrementa a métrica mensal de appointments. Regressão
  deve processar o outbox real e reconciliar ledger/métrica antes e depois.
- Modelar a chave por lote: replay idêntico antes da conclusão continua exactly-once; após sucesso, o
  formulário gera outra chave e aceita um segundo arquivo sem reload. Payload diferente com chave
  antiga continua negado no backend, mas recebe mensagem localizada e sem identificador técnico.
- Repetir owner/gestor permitidos, attendant/doctor/financial negados, data futura, UUID de B, falha no
  segundo item e limite 500/501; toda negativa deve deixar batch/appointments/trilhas em zero.

### PAT-001 / UX-001/002 / HTTP-001

- `PAT-001`: restauração explícita, idempotente e auditada somente de delete operacional ainda na
  retenção; revalidar suppressions e impedir resurrection de óbito, merge ou eliminação LGPD.
- `UX-001`: consulta específica de candidatos de agenda deve exigir ativo e não falecido; manter o
  filtro equivalente no core para payload adulterado.
- `UX-002`: derivar a disponibilidade da ação do mesmo estado aceito pelo backend. Regressão deve
  cobrir trial, active, past_due, cancelled e alteração pendente; somente o caminho permitido escreve,
  e negativas não deixam change/event/audit/idempotência nem chamam Asaas.
- `HTTP-001`: mover validação/existência para boundary capaz de emitir status 404 antes do stream.
  Regressão deve cobrir UUID malformado, ausente, deletado e ID de B, sem diferenciar enumeração.

Nenhuma migration, dependência, mudança de CI/CD, contrato público ou refatoração ampla será feita
sem confirmação adicional.

## 35. Testes de Regressão

`FLOW-001` executou uma regressão integrada sobre paciente, agenda, consultório, clinical,
financeiro, Caixa e LGPD no candidato de produção. `JOURNEY-LGPD-A` acrescentou os ramos reais de
exclusão física e anonimização após retenção controlada. `MT-001` acrescentou regressão dinâmica de
IDOR, binding de tenant no backend e RLS de pacientes. `CONC-002` comprovou o vencedor único da
agenda sob corrida real. `RECOV-001` acrescentou quatro correções excepcionais, duas negativas e
replay idempotente em produção, além de revelar `DATA-001`. `PATIENT-FLOW-001` cobriu validação,
busca/XSS, vínculos, merges inválidos, edição/delete concorrentes, óbito e bloqueio de agenda,
revelando `LGPD-005`, `DATA-002`, `PAT-001`, `UX-001` e `HTTP-001`.
`FINANCIAL-LIFECYCLE-001` cobriu quatro valores inválidos, arredondamento, cancelamento, duas baixas,
dois reembolsos, filtros e reconciliação do ledger, revelando `DATA-003`.
`SUPPLIER-LIFECYCLE-001` cobriu criação, XSS, isolamento A↔B, duas edições concorrentes,
desativação/reativação e integração com o seletor de despesa, revelando `DATA-004` e `VAL-001`. A
fila humana `COLLECTION-001` cobriu guarda tenant, replay, exibição no Caixa, quitação e resolução
idempotente sem executar cron ou provider. `SCHEDULING-CONFIG-001` cobriu procedimento, recurso,
isolamento A↔B, inativação/reativação e ausência em período vazio; revelou `AUTHZ-007` e `OBS-002`
sem afetar consultas existentes nem chamar provedor. `TEAM-003/CONC-005` comprovou a trava de quota,
a compensação de Auth e o vencedor único do cancelamento sob duas sessões simultâneas. A suíte local
completa continua pendente desta execução. `FEEDBACK-001` acrescentou validação, XSS seguro,
idempotência concorrente e privacidade autor/A↔B tanto na UI quanto no RLS, com cleanup integral.
`PROFILE-001` cobriu validação fiscal, gate do médico, lifecycle imutável, concorrência em duas abas,
isolamento de B e restauração exata, revelando `DATA-005` e `VAL-002`.
`SUBSCRIPTION-TRIAL-001` repetiu a negativa de cancelamento em trial, comprovou rollback integral e
revelou `UX-002`; agendar/revogar em assinatura ativa permanece não executado. `HANDOFF-001`
acrescentou assumir/priorizar/reatribuir/devolver, negação do ator antigo e bloqueio de resposta fora
da janela, com 0 mensagens/outbox e cleanup integral. `RECOVERY-001` acrescentou reset direto,
recovery legítimo, política de senha, uso único, duas sessões e revogação de refresh/access token;
revelou `AUTH-006/007` e terminou sem fixture.
`HOURS-001` cobriu janela unitária, expediente com pausa/conflito, reload, feriado/XSS textual,
duplicação e remoções; revelou `DATA-006`, ampliou `OBS-002` e encontrou `A11Y-001`, com trilhas 6/6
e cleanup integral.
`DASHBOARD-001` reconciliou o baseline operacional, checklist e feed por permissão e acrescentou uma
contraprova não-zero com os cinco status operacionais. Os KPIs e três itens “Próximos” coincidiram
com o banco, e o cleanup restaurou integralmente o baseline sem efeitos externos.
`RECURRENCE-001` cobriu limites 1/105, criação semanal, persistência/refresh, duplicidade diária e
conflito na segunda ocorrência; revelou `DATA-007`, `UX-003` e `A11Y-002`, enquanto o rollback de
conflito permaneceu atômico e o cleanup terminou integralmente em zero. `RECURRENCE-DST-001` aplicou
o algoritmo real a um fuso IANA com DST e revelou `DATA-008`, sem mutação de produção.
`WAITLIST-001` cobriu criação normal/urgente, intervalo invertido, cancelamento humano, encerramento e
cleanup; revelou `WAIT-001`, ampliou `OBS-002` e encontrou `A11Y-003`. O cancelamento persistiu, mas
não selecionou candidato, publicou oferta nem criou mensagem.
`APPOINTMENT-IMPORT-001` cobriu owner/atendente, rota e ação direta, data futura, UUID de B, rollback
no segundo item, três estados terminais, proveniência, refresh, replay e segundo lote. Revelou
`DATA-009/UX-004`; o worker real criou três ledgers no mês corrente e o cleanup reverteu a métrica
pela contagem exata, com oito classes finais em zero.
`CONSULTORIO-INTEGRITY-001` cobriu segregação atendente/médico/financeiro, associação agenda-paciente,
transições da fila, atraso real dos consumers clínico/financeiro e visão antes/depois do worker.
Revelou `AUTHZ-008`: atendente concluiu antes do prontuário; o worker criou rascunho vazio e atribuído
ao médico após o estado terminal, enquanto o financeiro gerou lançamento positivo. Cleanup terminou
com onze classes em zero e nenhum provider externo.
`CONSULTORIO-NOSHOW-001` cobriu o único controle humano de falta antes/depois do check-in. Revelou
`STATE-001`: a etapa válida não oferece o botão e a etapa que o oferece rejeita a transição, com zero
persistência. `CONC-006`, na mesma execução consolidada, colocou owner e atendente sobre o mesmo
agendamento com chaves distintas e confirmou vencedor único para a transferência concorrente:
1 correção/auditoria/evento/idempotência e conflito controlado do estado obsoleto. Cleanup terminou
com oito classes em zero e nenhum efeito externo.

### Jornadas completas do prompt mestre

| Jornada | Evidência desta execução | Resultado |
| --- | --- | --- |
| 1 — Nova clínica | onboarding/criação de um novo tenant não executado; o adendo operacional direciona os testes mutáveis à Clínica A | `NOT TESTED` |
| 2 — Atendente | login → paciente criado → agenda/encaixe → fila do Consultório → Equipe negada | `PASS` |
| 3 — Médico | login → paciente → agenda → Consultório → prontuário salvo/assinado → atendimento encerrado → Perfil/Equipe negados | `PASS` |
| 4 — Financeiro | login → Financeiro → recebível manual → Caixa/pagamento → Relatórios → Consultório negado | `PASS` |
| 5 — Gestor | `FLOW-001`: paciente → agenda → clinical → financeiro/Caixa → LGPD | `PASS` |
| 6 — Multi-tenant | `MT-001`: A e B criaram/leram dados próprios e falharam ao cruzar IDs | `PASS` |
| 7 — Revogação | `PERM-001`: acesso → deny → sessão antiga revogada → nova sessão sem acesso → cleanup | `PASS` |
| 8 — LGPD | mesma fixture: criar/acessar/exportar → soft delete/retenção controlada → anonimização → acesso posterior negado; segunda fixture cobriu hard delete físico | `PASS` |

`JOURNEY-ROLE-A`: 4/4 testes Playwright `PASS` em 45,3 s, incluindo a preparação autorizada da
disponibilidade. Uma tentativa anterior foi corretamente bloqueada pela capacidade operacional;
seu cleanup também terminou em zero. A contraprova SQL externa encontrou zero paciente, lançamento,
outbox, auditoria ou janela temporária com os marcadores das execuções.

`AUTH-003`: 1/1 Playwright `PASS` em 21,2 s; sem vídeo/trace/screenshot por desenho, para impedir
captura do segredo TOTP. Estado final confirmado sem MFA no profile e sem fator no Supabase Auth.

## 36. Testes Não Executados / Bloqueados

| ID | Funcionalidade | Motivo atual | Pré-requisito | Bloqueia go-live? | Status |
| --- | --- | --- | --- | --- | --- |
| EXT-001 | Meta/Resend/Sentry/Better Stack/Asaas fim a fim | apenas health profundo e evidência parcial por provedor | fixture/destinatário e acesso externo seguro por provedor | sim | `PARTIAL` |
| API-001 | Data API | HTTP 503/PGRST002 é deliberadamente inconclusivo | confirmação externa de configuração | sim | `PARTIAL` |
| AUTHZ-001 | leitura sem `view:patient` | reproduzido; correção não implementada | correção + deploy + reteste | sim | `FAIL` |
| AUTHZ-002 | agenda sem `view:agenda` | reproduzido; correção não implementada | correção + deploy + reteste | sim | `FAIL` |
| AUTHZ-003 | documentos/prontuários sem permissões clínicas | reproduzido em feed, PDF, hub e SOAP decifrado; correção não implementada | contrato RBAC + correção + reteste | sim | `FAIL` |
| AUTH-005 | access token após logout global | cookie pré-logout e segunda sessão continuaram no Dashboard, embora refresh estivesse revogado | bump autoritativo do epoch no logout + reteste multi-context | sim | `FAIL` |
| AUTH-006 | reset sem prova de recovery | sessão normal substituiu a senha sem link ou senha atual | grant one-time vinculado ao recovery/reautenticação + reteste | sim | `FAIL` |
| AUTH-007 | access token após troca de senha | segunda sessão continuou após reset direto e recovery, embora refresh estivesse revogado | bump do epoch + revogação global pós-reset | sim | `FAIL` |
| AUTHZ-005 | Dashboard financeiro sem `view:financial` | reproduzido com valor real não zero | correção + reteste por role/deny | sim | `FAIL` |
| AUTHZ-006 | metadados/controle WhatsApp sem `manage:settings` | reproduzido sem executar a action | correção + reteste read-only por role/deny | não isoladamente | `FAIL` |
| AUTHZ-007 | médico altera recurso global e cria ausência para outro profissional | reproduzido em período sem atendimentos | separar permissões própria/equipe/global + reteste por role/deny | sim | `FAIL` |
| AUTHZ-008 | atendente conclui consulta sem permissão/prontuário e dispara cobrança | reproduzido com zero prontuário no fechamento, rascunho tardio atribuído ao médico e lançamento automático | permissão clínica fresh + precondição de prontuário/assinatura + reteste com worker atrasado | sim | `FAIL` |
| STATE-001 | no-show humano não é persistível | `agendado` não oferece a ação; `chegou` oferece, mas a máquina rejeita e mantém a fila | alinhar controles a `allowedTransitions` + reteste de falta/replay/corrida | não isoladamente | `FAIL` |
| LGPD-002 | PII permanece no outbox após eliminação concluída | reproduzido no banco e confirmado no fluxo de hard-delete | correção + job controlado + reteste | sim | `FAIL` |
| LGPD-003 | PDF/JSON exportados permanecem após eliminação concluída | signed PDF 200 e JSON privado legível pós-cron | correção Storage + reteste de revogação/isolamento | sim | `FAIL` |
| LGPD-004 | idempotência concluída vira `in-flight` após scrub | duas chaves `status_code=200/response=NULL`; trigger e health conflitam | estado explícito + replay/health/cleanup | não isoladamente | `FAIL` |
| DATA-001 | nome atual diverge do snapshot após transferência | reproduzido; correção não implementada | contrato de projeção atual + correção + reteste dos consumidores | não isoladamente | `FAIL` |
| LGPD-005 | concessão/revogação operacional de consentimento | domínio existe, mas não há página/action/rota/tool implantável | fluxo de produto + wrappers autorizados + reteste | sim | `FAIL` |
| DATA-002 | edição concorrente de paciente | duas sessões gravaram sem conflito | concorrência otimista + reteste por dois atores | não isoladamente | `FAIL` |
| DATA-003 | estorno integral de pagamento multipartes | duas parcelas foram totalmente reembolsadas, mas original/compensações ficaram `pago` | agregação global dos refunds + regressão por parcela/ordem/concorrência | não isoladamente | `FAIL` |
| DATA-004 | edição concorrente de fornecedor | owner/Financeiro gravaram sem conflito e um valor foi perdido | concorrência otimista + reteste por dois atores | não isoladamente | `FAIL` |
| DATA-005 | edição concorrente do perfil da clínica | duas abas do owner gravaram sem conflito e um CNES foi perdido | concorrência otimista + reteste por duas abas/atores | não isoladamente | `FAIL` |
| DATA-006 | expediente com pausa parcialmente aplicado | manhã 200 persistiu antes da tarde conflitante 500 | action/transaction única para o par + replay | não isoladamente | `FAIL` |
| DATA-007 | recorrência duplica paciente/médico no mesmo dia | segunda ocorrência foi aceita ao lado de consulta ativa do mesmo par | validar todas as datas atomicamente + reteste concorrente | não isoladamente | `FAIL` |
| DATA-008 | recorrência deriva horário local ao atravessar DST | série 09:00 virou 10:00 após mudança de offset | cálculo por calendário local + matriz DST | não isoladamente | `FAIL` |
| DATA-009 | histórico entra no uso do mês corrente | três consultas de 2001 elevaram agosto/2026 de 37 para 40 | separar import de evento metrável + reteste do worker | não isoladamente | `FAIL` |
| UX-003 | série sem identificação/cancelamento | Agenda mostra itens isolados e não há caller de `cancelRecurringSeries()` | projeção + action/UI de gestão da série | não isoladamente | `FAIL` |
| UX-004 | segundo lote histórico exige reload | JSON diferente reutilizou chave do lote concluído e foi negado | rotacionar chave após sucesso + mensagem localizada | não isoladamente | `FAIL` |
| WAIT-001 | waitlist não reage ao cancelamento humano nem conclui booking | correção cancelou appointment; duas entradas ficaram waiting, zero oferta/mensagem | unificar cancelamentos + handler + action/UI de aceite | sim para a automação prometida | `FAIL` |
| VAL-001 | CNPJ inválido de fornecedor | `1` foi aceito e persistido | normalização/checksum no backend + matriz negativa | não isoladamente | `FAIL` |
| VAL-002 | CNPJ inválido no perfil fiscal da clínica | `1` foi cifrado/hasheado e reapareceu após reload | normalização/checksum antes da cifra + matriz negativa | não isoladamente | `FAIL` |
| PAT-001 | recuperação de soft-delete operacional | paciente foi ocultado, mas não existe restore | action/UI auditada + reteste dentro/fora da retenção | não isoladamente | `FAIL` |
| UX-001 | falecido no seletor da Agenda | reproduzido; backend bloqueou o submit | filtro de candidatos + regressão do core | não isoladamente | `FAIL` |
| UX-002 | botão de cancelamento durante trial | duas tentativas controladas sem persistência | alinhar estado habilitado ao contrato do backend + matriz de status | não isoladamente | `FAIL` |
| HTTP-001 | soft-404 de paciente | malformado/ausente/deletado responderam HTTP 200 | boundary 404 antes do stream + reteste A↔B | não isoladamente | `FAIL` |
| A11Y-001 | Data/Motivo de feriado sem nome acessível | árvore acessível exibiu inputs sem label | `id/htmlFor` + teste semântico | não isoladamente | `FAIL` |
| A11Y-002 | recorrência/observações sem nome acessível | três controles retornaram `getByLabel=0` | `id/htmlFor` + teste semântico | não isoladamente | `FAIL` |
| A11Y-003 | sete campos da waitlist sem nome acessível | todos os `getByLabel` retornaram zero | `id/htmlFor`/nome no Combobox + teste semântico | não isoladamente | `FAIL` |
| RBAC-001 | `export:audit`/`manage:agent` sem ação tenant | contrato de produto ausente | decisão remover/deprecar ou implementar | não isoladamente | `FAIL` |
| OBS-002 | validação/conflito esperado de configuração vira HTTP 500 | procedimento longo/duplicado, overlap e feriado duplicado reproduzidos; Horários mostrou alert vazio | boundary de erro controlado + reteste UI/action | não isoladamente | `FAIL` |
| PATIENT-001-V1 | merge válido e transferência de filhos | histórico append-only prenderia fixture na Clínica A; não foi burlado | clínica integralmente descartável ou cleanup oficialmente suportado | sim para cobertura completa de paciente | `NOT TESTED` |
| CAIXA-OPEN-CLOSE-V1 | abertura/fechamento, duplicidade e alteração pós-fechamento | nenhuma sessão de caixa/action/controle foi descoberta; Caixa implantado é visão do ledger | contrato de produto e implementação de sessão de caixa, se requisito confirmado | não isoladamente | `NOT TESTED` |
| DUNNING-AUTO-V1 | D+3/D+7 → consentimento → WhatsApp/e-mail real | cron pode enviar mensagem; baseline A não possui candidato e WABA está sem app inscrito | contato controlado, consentimento operacional e Meta reinscrita | sim para cobrança proativa E2E | `BLOCKED` |
| AGENDA-001-V1 | reagendamento real confirmado via IA/WhatsApp | a correção/transferência concorrente entre dois usuários passou em `CONC-006`, mas não há controle de reagendamento na Agenda humana; executar a IA criaria fluxo externo ainda não autorizado; timezone recorrente foi testado separadamente e falhou | contato controlado + Meta reinscrita ou harness autenticado equivalente | sim para cobertura E2E completa | `NOT TESTED` |
| OPS-001-V1 | `audit-partitions` e `data-retention` sem heartbeat | disparo manual mutável/destrutivo não é seguro no pentest | evidência do scheduler ou execução operacional controlada | sim para cobertura operacional completa | `NOT TESTED` |
| META-001-V1 | entrega real inbound → IA → outbound | WABA sem app inscrito e nenhum número destinatário autorizado | reinscrição externa + número de teste controlado | sim | `BLOCKED` |
| LGPD-001-V1 | persistência e expiração natural em 24 h | objetos sintéticos foram deliberadamente removidos após validação; inbox confirmada | execução dedicada que preserve a fixture até o TTL e faça cleanup posterior | sim para prova completa do link | `NOT TESTED` |
| ASAAS-001-V1 | primeira cobrança Production da Clínica A → webhook → invoice paid → assinatura/clinic active | webhook está habilitado e já processou `PAYMENT_CREATED`; a conta possui cobrança recorrente anterior confirmada no vencimento e depois estornada, mas o Asaas bloqueia antecipação do payment atual por regra societária | observar o mesmo payment no vencimento real em 24/08/2026; não repetir antecipação nem confundir captura anterior com prova desta assinatura | sim | `BLOCKED` apenas para o ciclo exato da Clínica A |
| BILLING-CANCEL-ACTIVE-V1 | assinatura ativa → agendar cancelamento → revogar | A/B estão em trial; mudar status direto falsificaria o fluxo e o Asaas | assinatura de teste realmente ativa e autorização operacional | sim para lifecycle completo de assinatura | `BLOCKED` |

## 37. Cobertura

| Item | Descoberto | Executado | PASS | FAIL | BLOCKED | NOT TESTED/PARTIAL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Páginas/rotas | 34 protegidas sem sessão; 25 estáticas por role | 227 visitas baseline + 14 controles/ataques IDOR + 34 requests anônimos | baseline sem 5xx + 7 IDOR e 34 anônimos bloqueados | achados RBAC separados | 0 | autorização fina parcial |
| Botões/formulários | em inventário | `FLOW-001`, `TEAM-001/002/003`, `MT-001`, `RECOV-001`, `CONC-006`, `REPORT-001`, `PATIENT-FLOW-001`, `FEEDBACK-001`, `PROFILE-001`, `HANDOFF-001`, `RECOVERY-001`, `DASHBOARD-001`, `CONSULTORIO-INTEGRITY-001`, `CONSULTORIO-NOSHOW-001` | parcial | consentimento/restore ausentes, recovery inseguro, Agenda oferece falecido, perfil perde update e Consultório permite encerramento não clínico/no-show impossível | 0 | em inventário |
| APIs/Server Actions | em inventário | CRUD integrado + IDOR + idempotência/replay + corridas de agenda/pagamento/paciente + corrida de correção por dois atores + quatro correções + recorrência/waitlist/importação histórica + consumers clínico/financeiro atrasados | parcial | `AUTHZ-008`, `STATE-001`, `DATA-001/002/007/009`, `UX-004`, `WAIT-001` e achados de autorização/semântica separados | 0 | em inventário |
| Entidades | em inventário | paciente/relacionamento/óbito, agenda/correções/fila/waitlist/recorrência/importação/configuração, perfil/feedback, clinical, documentos, financeiro/fornecedores, relatórios, equipe | parcial | `AUTHZ-007/008`, `STATE-001`, `OBS-002`, `DATA-001/002/003/004/005/006/007/008/009`, `VAL-001/002`, `LGPD-005`, `PAT-001`, `UX-003/004`, `WAIT-001` | 0 | merge válido e sessão de caixa parciais |
| Tabelas/RLS | 99 raízes/partições com `clinic_id` | 44 com leitura e 42 raízes com mutação A/B | 44 sem leitura cruzada; 142/142 `UPDATE/DELETE` cruzados bloqueados | 0 | 0 | 55 sem fixture; `INSERT` parcial |
| Roles/permissões | 5 roles / 28 permissões | 5 roles + 84 transições de permission + 12 de role | bundles + lifecycle 28/28 + 9/9 arestas de role | enforcement por ação com falhas | 0 | matriz ação-permission parcial |
| Jornadas | 8 mínimas | 7 | 7 | 0 | 0 | 1 `NOT TESTED` |

Percentual real ainda não calculável enquanto o denominador está sendo inventariado.

## 38. Evidências

- Registro oficial: `C:\dev\ClinicaOS_V2\teste2e2.md`.
- Owner A / rotas estáticas: `evidence/pentest-2026-08-14/readonly-owner-a/` — vídeo, screenshot e
  inventário; o trace potencialmente portador de cookies foi zerado imediatamente e não é evidência.
- Owner A / rotas dinâmicas: mesmo diretório, segundo vídeo/screenshot e inventário.
- Inventário seguro de contas: saída de `scripts/pentest-account-inventory.ts` nesta execução;
  referências opacas A=`801a132224ef`, B=`28edcce0d634`.
- Lifecycle mutável de equipe: `evidence/pentest-2026-08-14/team-lifecycle-b/production-team-lifecycle--9ebac-a-função-e-desativa-reativa-chromium/video.webm`.
- Jornada mutável integrada `FLOW-001`: `evidence/pentest-2026-08-14/authorized-mutations-b/production-authorized-muta-3ab83-da-financeiro-manual-e-LGPD-chromium/video.webm`.
- PDFs de `FLOW-001`: dois vídeos auxiliares no mesmo diretório; screenshot final sintética.
- O `trace.zip` de `FLOW-001` foi zerado (0 byte) imediatamente porque poderia conter cookies.
- `STOR-001`: saída JSON do probe no transcript desta execução; dois objetos sintéticos removidos.
- `API-001`: saída JSON 503/PGRST002 no transcript; nenhum fixture criado.
- `MT-001`: `evidence/pentest-2026-08-14/cross-tenant-patients/`; os vídeos da execução válida são
  `tenant-a/page@d1166562cc4ff61ee3493778596854d8.webm` e
  `tenant-b/page@aad413ef1510405b4f59d03212e0da1f.webm`.
- `MT-001`: saída Playwright `blocked-correctly`, cleanup 4/4 e contraprova SQL global com zero
  fixtures ativas.
- `MT-002`: transcript sanitizado da matriz read-only — 99 descobertas, 44 com fixture, zero leaks,
  zero raiz sem `RLS + FORCE RLS`; 1/1 Playwright `PASS` em 54,9 s.
- `MT-003`: transcript sanitizado do IDOR clínico — 7 controles próprios, 7 IDs estrangeiros
  bloqueados, nenhum iframe cross-tenant; 1/1 Playwright `PASS` em 35,3 s.
- `MT-004`: `e2e/production-cross-tenant-rls-mutations.spec.ts`; transcript sanitizado com 42
  tabelas-raiz, 142 probes cruzados bloqueados, 72 controles próprios e zero vazamento; todas as
  operações foram revertidas por savepoint; 1/1 Playwright `PASS` em 2,6 min totais.
- `AUTH-003`: transcript do Playwright (1/1 `PASS`) e inventário seguro pós-teste com
  `mfaEnrolled=false`; artefatos visuais deliberadamente desabilitados para não gravar o TOTP.
- `PERM-001`: transcript sanitizado com concessão/revogação, replay HTTP 500 sem persistência,
  autoelevação SQL negada, os booleanos de bypass de Pacientes/Agenda/Documentos/PDF/Modelos e os
  controles negativos aprovados de Consultório/Conversas/Financeiro. O download do PDF foi
  validado apenas por status/MIME; URL e corpo não foram anexados.
- `PERM-002`: transcript sanitizado com 28 permissions, 84 transições, delta de versão 84 e zero
  overrides finais; 1/1 Playwright `PASS` em 3,9 min.
- `TEAM-002`: `e2e/production-role-transition-matrix-a.spec.ts` e vídeos em
  `evidence/pentest-2026-08-15/role-transition-matrix-a-023500/`; nove arestas obrigatórias, três
  pontes, 12 sessões revogadas/renovadas, 12 bundles/JWTs/auditorias coerentes e cleanup externo em
  zero; 1/1 Playwright `PASS` em 1,3 min.
- `TEAM-003/CONC-005`: `e2e/production-invite-concurrency-a.spec.ts`; resultado, cleanup e dois vídeos
  em `evidence/pentest-2026-08-15/invite-concurrency-a-050004/`. Convites simultâneos produziram
  sucesso+upgrade, pico 5/5, um profile/Auth/audit/idempotência e compensação do perdedor;
  cancelamentos simultâneos produziram sucesso+rejeição controlada e uma única auditoria. Cleanup
  final zerou profiles, Auth users, auditorias e idempotência sintéticos e restaurou 4/5; 1/1
  Playwright `PASS` em 17,2 s, sem Asaas/Meta e sem depender de inbox.
- `FEEDBACK-001`: `e2e/production-feedback-privacy-a.spec.ts`; resultado, cleanup e quatro vídeos em
  `evidence/pentest-2026-08-15/feedback-privacy-a-050529/`. Validação longa, replay concorrente,
  conflito de payload, XSS como texto, separação owner↔médico, isolamento A↔B e duas negativas RLS de
  spoof foram comprovados. Cleanup removeu 2 sugestões (e históricos em cascade), 2 auditorias e 2
  idempotências, com quatro contadores finais zero; 1/1 Playwright `PASS` em 21,3 s, sem provedor.
- `PROFILE-001/DATA-005/VAL-002`: `e2e/production-clinic-profile-a.spec.ts`; resultado e cleanup
  sanitizados em `evidence/pentest-2026-08-15/clinic-profile-a-051608/`. CNPJ inválido persistido,
  duas edições concorrentes aceitas, gate do médico, invariantes de lifecycle, B inalterada e
  restauração integral comprovados; 1/1 Playwright `PASS` em 16,4 s. Vídeo/trace/screenshot foram
  desabilitados para não capturar dados fiscais. Uma tentativa anterior revelou que o trigger de
  `updated_at` interferia no rollback do harness: o timestamp original foi restaurado por transação
  guardada com microssegundos, 1 audit truncado foi removido, a contraprova ficou 0/0 e os artefatos
  visuais foram enviados à Lixeira.
- `SUBSCRIPTION-TRIAL-001/UX-002`:
  `e2e/production-subscription-cancellation-trial-a.spec.ts`; resultado e cleanup sanitizados em
  `evidence/pentest-2026-08-15/subscription-trial-negative-a-052150/`. Duas negativas HTTP 200 em
  trial, erro de domínio consistente e zero flag/change/event/audit/idempotência; 1/1 Playwright
  `PASS` em 7,8 s como evidência do achado, sem mídia fiscal e sem chamada Asaas.
- `HANDOFF-001`: `e2e/production-conversation-handoff-a.spec.ts`; resultado e cleanup sanitizados em
  `evidence/pentest-2026-08-15/conversation-handoff-a-052947/`. Seis actions HTTP 200 cobriram
  assumir, prioridade urgente, negativa de resposta fora da janela, reatribuição, negativa do owner
  antigo e devolução pelo atendente; estado final com um handoff resolvido, 0 mensagens/outbox e
  trilhas 4/4. Cleanup removeu conversa/auditorias/idempotências e deixou seis contadores em zero;
  1/1 Playwright `PASS` em 13,1 s, sem mídia e sem Meta. A tentativa anterior `...-052822/` comprovou
  o primeiro handoff, mas parou numa asserção transitória de toast; o cleanup também ficou em zero.
- `AUTH-005`: `e2e/production-session-logout-replay-a.spec.ts`; resultado e cleanup sanitizados em
  `evidence/pentest-2026-08-15/session-logout-replay-a-053719/`. Logout 303, contexto limpo e refresh
  revogado, porém replay do cookie e segundo dispositivo ainda autorizados; exclusão posterior negou
  o mesmo cookie. Usuário temporário removido, Clínica A 4/5 e zero trilhas; 1/1 Playwright `PASS` em
  10,9 s como evidência do achado, sem mídia, e-mail ou provedor. Duas tentativas anteriores pararam
  antes da criação da fixture por configuração do loader/chave e não tocaram produção.
- `RECOVERY-001/AUTH-006/007`: `e2e/production-password-recovery-a.spec.ts`; resultado e cleanup em
  `evidence/pentest-2026-08-15/password-recovery-a-054232/`. Sessão normal trocou senha forte sem
  recovery, senha fraca foi rejeitada, refresh antigo foi revogado mas o access token continuou,
  link legítimo funcionou uma vez e credenciais old/intermediária/final tiveram os resultados
  esperados. Usuário removido, Clínica A 4/5 e zero trilhas; 1/1 Playwright `PASS` em 26,8 s como
  evidência dos achados, sem mídia, e-mail ou provider de negócio.
- `HOURS-001/DATA-006/A11Y-001`: `e2e/production-hours-atomicity-a.spec.ts`; resultado e cleanup em
  `evidence/pentest-2026-08-15/hours-atomicity-a-055227/`. Expediente parcial produziu HTTP 200/500 e
  deixou a manhã persistida; feriado normal passou, duplicado foi 500, ambos os alertas de erro
  ficaram vazios e Data/Motivo estavam sem nome acessível. Remoções UI deixaram 0 janela/feriado;
  cleanup removeu 6 audits/6 idempotências e o médico/Auth sintético, Clínica A 4/5. 1/1 Playwright
  `PASS` em 21,0 s como evidência dos achados, sem mídia/e-mail/provider. Três tentativas anteriores
  pararam em locators/asserção de mensagem e todas terminaram com contadores em zero.
- `DASHBOARD-001`: `e2e/production-dashboard-operational-a.spec.ts`; resultado sanitizado em
  `evidence/pentest-2026-08-15/dashboard-operational-a-081452/result.json`. Quatro KPIs e próximos
  coincidiram com zero, checklist 5/5 ficou oculto, owner viu 5 atividades, médico sem `view:audit`
  recebeu a negativa e Atualizar preservou o estado; 1/1 Playwright `PASS` em 13,3 s, read-only.
  Contraprova: `e2e/production-dashboard-nonzero-a.spec.ts`, resultado/cleanup sanitizados e transcript
  em `evidence/pentest-2026-08-15/dashboard-nonzero-a-082235/`. Cinco fixtures levaram a UI e o banco
  a 5 consultas, 1 aguardando, 1 em atendimento, 1 finalizada e três próximos Walk-ins nos status
  `agendado/confirmado/chegou`; cleanup comprovou 11 contadores em zero e ausência de efeitos
  externos. 1/1 Playwright `PASS` em 10,8 s. A tentativa `...-082140/` falhou no cast dos timestamps
  antes do primeiro insert e teve rollback transacional.
- `RECURRENCE-001/DATA-007/UX-003/A11Y-002`: `e2e/production-recurrence-a.spec.ts`; resultado,
  cleanup e transcript sanitizados em `evidence/pentest-2026-08-15/recurrence-a-083512/`. Limites 1 e
  105 foram rejeitados, uma série 1/2/3 persistiu após refresh, o segundo dia ficou com duas consultas
  do mesmo paciente/médico e a UI não identificou/cancelou a série; três campos estavam sem nome
  acessível. Conflito exato na segunda ocorrência teve rollback total. Cleanup removeu 1 paciente,
  1 série, 5 appointments, 6 outbox, 3 auditorias e 3 idempotências, com sete classes finais zero;
  1/1 Playwright `PASS` em 32,2 s, sem mídia/provedor externo. A primeira tentativa `...-083115/`
  parou no SELECT pré-mutação; `...-083201/` provou o comportamento e exigiu cleanup diagnóstico de
  duas auditorias `resource_id=null`, corrigido e comprovado no run final.
- `RECURRENCE-DST-001/DATA-008`: cálculo read-only do código real; resultado sanitizado em
  `evidence/pentest-2026-08-15/recurrence-dst-083825/result.json`. Uma série semanal pedida às 09:00
  em `America/New_York` foi renderizada 09:00/10:00/10:00 ao atravessar o DST, com deltas fixos de
  168 h; nenhuma configuração ou linha de produção foi alterada.
- `WAITLIST-001/WAIT-001/A11Y-003`: `e2e/production-waitlist-a.spec.ts`; resultado, cleanup e transcript
  em `evidence/pentest-2026-08-15/waitlist-a-084715/`. Intervalo invertido respondeu HTTP 500 e
  persistiu zero; duas entradas válidas passaram. O cancelamento humano HTTP 200 deixou ambas
  `waiting`, sem evento/mensagem/controle de booking. Sete campos tinham `getByLabel=0`; encerramento
  UI passou. Cleanup removeu 2 pacientes, 2 entradas, 1 appointment, 3 outbox, 7 auditorias e 7
  idempotências, com seis classes finais zero. 1/1 Playwright `PASS` em 31,6 s, sem provider/mídia.
  A tentativa `...-084451/` parou ao descobrir que `agendado` só oferece transferência e também
  concluiu cleanup integral.
- `APPOINTMENT-IMPORT-001/DATA-009/UX-004`:
  `e2e/production-appointment-import-a.spec.ts`; resultado, cleanup e log em
  `evidence/pentest-2026-08-15/appointment-import-a-090505/`. Owner permitido e atendente negado na
  rota/action; futuro e UUID de B responderam HTTP 200 com rollback zero; lote 3/3 persistiu com
  proveniência/trilhas, refresh e replay exatamente uma vez. O worker elevou a métrica 37→40 e o
  segundo JSON na mesma página foi negado pela chave antiga. Cleanup removeu 1 paciente, 1 lote, 3
  appointments/logs/ledgers, 5 outbox, 2 auditorias e 2 idempotências; oito contadores finais zero e
  métrica decrementada exatamente em 3. 1/1 Playwright `PASS` em 58,3 s, sem efeito externo. As duas
  tentativas anteriores (`...-090147/`, `...-090318/`) falharam somente por ordem/validação nativa do
  harness e também concluíram cleanup integral.
- `CONSULTORIO-INTEGRITY-001/AUTHZ-008`:
  `e2e/production-consultorio-attendant-integrity-a.spec.ts`; resultado, cleanup e vídeo em
  `evidence/pentest-2026-08-15/consultorio-attendant-a-092632/`. Atendente sem permissões de
  prontuário chamou e encerrou o encaixe; o banco observou zero registro no fechamento e
  `chegou→em_atendimento→atendido`. O médico viu primeiro a finalizada sem prontuário; o worker criou
  depois rascunho inicial não assinado e atribuído ao médico. Após o worker, a tela ainda dizia
  “somente leitura”, mas o textarea estava habilitado e não havia assinatura. O evento completed foi
  processado e criou lançamento automático pendente positivo. Cleanup removeu 1 paciente,
  1 appointment, 1 prontuário, 1 lançamento, 6 outbox, 5 idempotências, 3 auditorias, 1 ledger e
  1 disponibilidade, com onze classes finais zero. 1/1 Playwright `PASS` em 39,4 s como reprodução,
  sem provider externo. Duas tentativas anteriores (`...-092247/`, `...-092331/`) pararam antes de
  qualquer mutação por coluna incorreta no harness e também comprovaram cleanup em zero.
- `CONSULTORIO-NOSHOW-001/STATE-001/CONC-006`:
  `e2e/production-consultorio-no-show-a.spec.ts`; JSONs sanitizados e dois vídeos em
  `evidence/pentest-2026-08-15/agenda-consultorio-ops-a-094838/`. O card agendado ofereceu apenas
  Check-in; o card em `chegou` ofereceu “Marcar ausente”, mas recebeu erro controlado em HTTP 200 e
  permaneceu `chegou`/`waiting`, com zero log/evento/auditoria/idempotência de no-show. Na corrida do
  mesmo appointment, owner/atendente enviaram chaves distintas em 121 ms: uma transferência venceu,
  a outra foi rejeitada, e houve exatamente 1 correção/auditoria/outbox/idempotência. Cleanup removeu
  2 pacientes, 2 appointments, 3 outbox, 3 auditorias e 3 idempotências; oito classes finais zero.
  1/1 Playwright `PASS` em 18,2 s, sem efeito externo. A execução anterior apenas de no-show em
  `evidence/pentest-2026-08-15/consultorio-no-show-a-093602/` também passou e limpou tudo; tentativas
  anteriores da extensão concorrente falharam somente por coluna/locator do harness, sempre após
  cleanup integral.
- `AUTH-004`: transcript sanitizado — 34/34 rotas sem sessão em HTTP 307 para `/login`; headers de
  segurança inventariados; 1/1 Playwright `PASS` em 6,6 s.
- `CONC-001/IDEM-001`: transcript sanitizado — seis requests concorrentes, cinco replays 303,
  conflito controlado 200, uma linha/audit/outbox/idempotency e cleanup ativo zero; `PASS` em 14 s.
- `PATIENT-FLOW-001/CONC-004`: `e2e/production-patient-lifecycle-a.spec.ts`; resultado e cleanup
  sanitizados em `evidence/pentest-2026-08-15/patient-lifecycle-a-0453/`. Owner/atendente, três
  pacientes, Unicode/XSS/SQL-like/long input, vínculo com quatro replays, merges inválidos, duas
  edições concorrentes aceitas, óbito exactly-once, agendamento do falecido bloqueado e uma única
  exclusão sob corrida; 1/1 Playwright `PASS` em 50,5 s. Cleanup final removeu 6 supressões, 9
  outbox, 9 auditorias, 9 idempotências e 3 pacientes; sete contadores finais zero. Tentativas
  anteriores pararam apenas em seletores/sincronização do harness e limparam as fixtures; a execução
  `...-0443/` concluiu o comportamento mas teve rollback no `finally` por sintaxe da contraprova. A
  correção forense escopada removeu 3 pacientes/6 supressões/9 outbox/9 chaves e 39 auditorias, das
  quais 33 eram criações sintéticas antigas com `resource_id=null`; contraprova final zero.
- `CONC-002`: `e2e/production-appointment-concurrency.spec.ts`; transcript sanitizado com duas
  requests separadas por 2 ms, HTTP 200/200, um sucesso/um conflito, uma única persistência completa
  e cleanup final zero; 1/1 Playwright `PASS` em 18,3 s.
- `RECOV-001/DATA-001`: `e2e/production-appointment-recovery-a.spec.ts`; resultado sanitizado e
  cleanup em `evidence/pentest-2026-08-15/appointment-recovery-a-032103/`, além de quatro vídeos. A
  execução cobriu duas fixtures, duas negativas, quatro correções, replay idempotente com duas
  respostas/uma linha e trilhas 4/4/4/4; `snapshotDoctorNome` divergiu do profissional atual após a
  transferência. Cleanup removeu 10 outbox, 2 ledger, 10 auditorias, 13 idempotências, 1 prontuário,
  2 appointments, 1 disponibilidade, 1 procedimento e 1 paciente; todos os contadores finais zero;
  nenhuma promoção temporária foi necessária. 1/1 Playwright `PASS` em 1,1 min.
- `CONC-003`: `e2e/production-financial-concurrency-a.spec.ts` e vídeos em
  `evidence/pentest-2026-08-15/financial-concurrency-a-024010/`; Financeiro/Atendente, dois POSTs em
  10 ms, uma única transação/audit/outbox e rejeição controlada do perdedor; cleanup/contraprova em
  zero; 1/1 Playwright `PASS` em 13,1 s.
- `FINANCIAL-LIFECYCLE-001/DATA-003`: `e2e/production-financial-lifecycle-a.spec.ts`; resultado,
  cleanup e vídeo em `evidence/pentest-2026-08-15/financial-lifecycle-a-042620/`. Quatro inputs
  inválidos rejeitados sem persistência, `10,005→10,01`, despesa cancelada, pagamentos
  R$ 3,33+R$ 6,67 e refunds integrais nas duas parcelas. O original ficou `pago` e fora do filtro
  “Estornado”; cleanup final zerou lançamentos, transações, outbox e auditorias. 1/1 Playwright
  `PASS` em 38,9 s como teste evidencial do bug; nenhuma mutação externa. Validação local focada:
  37/37 testes de lógica financeira, ledger/migration e Caixa, além de ESLint, Prettier e typecheck.
- `SUPPLIER-LIFECYCLE-001/DATA-004/VAL-001`:
  `e2e/production-supplier-lifecycle-a.spec.ts`; resultado, cleanup e vídeo em
  `evidence/pentest-2026-08-15/supplier-lifecycle-a-043432/`. CNPJ curto persistido, HTML-like seguro,
  tenant B isolado, duas edições concorrentes aceitas e ciclo inativo→ativo refletido no seletor de
  despesa. Cleanup removeu 1 fornecedor, 5 auditorias e 5 idempotências, com três contadores finais
  zero; 1/1 Playwright `PASS` em 27,2 s como evidência dos achados, sem provedor externo.
- `COLLECTION-001`: `e2e/production-collection-case-a.spec.ts`; resultado, cleanup e vídeo em
  `evidence/pentest-2026-08-15/collection-case-a-044241/`. Guarda cross-tenant rejeitada, dois
  upserts→um caso/uma auditoria, fila D+40 visível no Caixa, quitação e resolução 1→0 sob replay;
  cleanup removeu 1 caso, 1 lançamento, 1 transação, 2 outbox, 4 auditorias e 2 idempotências, com
  cinco contadores finais zero. 1/1 Playwright `PASS` em 18,9 s; cron/provedor não invocados.
- `SCHEDULING-CONFIG-001/AUTHZ-007/OBS-002`:
  `e2e/production-scheduling-config-a.spec.ts`; resultado, cleanup e vídeo em
  `evidence/pentest-2026-08-15/scheduling-config-a-045107/`. Procedimento/recurso isolados A↔B,
  valor `10,005→10,01`, HTML-like seguro e ciclo inativo→ativo refletido na Agenda. Código longo e
  duplicado produziram HTTP 500 sem persistência; médico foi negado em procedimentos, mas alterou o
  recurso global e criou ausência para o owner em período SQL pré-validado com zero atendimentos.
  Cleanup removeu 2 históricos, 7 auditorias, 7 idempotências, 1 ausência, 1 recurso e 1 procedimento,
  com seis contadores finais zero. 1/1 Playwright `PASS` em 31,9 s como evidência dos achados; nenhum
  atendimento existente nem provedor externo foi afetado.
- `AUTHZ-005`: `e2e/production-dashboard-financial-rbac.spec.ts`; médico sem
  `view:financial`, saldo/rollup autoritativos não zero, Dashboard coincidindo com o banco,
  `/financeiro` negado e Relatórios sem card financeiro; 1/1 Playwright `PASS` em 9,2 s.
- `REPORT-001`: `e2e/production-report-matrix.spec.ts`; resultado sanitizado em
  `evidence/pentest-2026-08-15/report-matrix-033101/result.json`. Quatro roles, três períodos,
  12/12 páginas, 13/13 PDFs com texto extraído, 12 agrupamentos profissionais, totais de agenda,
  no-show e financeiro reconciliados, ocupação coerente e query poisoning A→B ignorado; nenhuma
  mutação. 1/1 Playwright `PASS` em 38,6 s. A tentativa `...-032802/` parou antes do primeiro PDF por
  locator interno do card; `...-032904/` passou a primeira versão e a execução final acrescentou
  no-show, ocupação e agrupamentos.
- `AUTHZ-006`: `e2e/production-whatsapp-settings-rbac.spec.ts`; médico sem `manage:settings`,
  Perfil/Assinatura negados, mas status/número mascarado/controle WhatsApp visíveis; nenhuma mutação
  chamada; 1/1 Playwright `PASS` em 6,3 s.
- `AUTHZ-003-V1`: `e2e/production-prontuario-direct-rbac-a.spec.ts` e artefatos em
  `evidence/pentest-2026-08-15/prontuario-direct-rbac-a-030611/`; atendente e financeiro sem as três
  permissões de prontuário viram metadados e SOAP decifrado; autosave do atendente foi negado com
  estado do banco inalterado; cleanup final zero. 1/1 Playwright `PASS` em 19,9 s. A tentativa
  anterior `...-030444/` só corrigiu um locator do badge e também terminou sem resíduos.
- `JOURNEY-ROLE-A`: `e2e/production-role-journeys-a.spec.ts` e vídeos em
  `evidence/pentest-2026-08-15/role-journeys-a-022640/`; 4/4 `PASS`, três jornadas humanas por role,
  janela temporária criada pela UI e cleanup/contraprova externa em zero. A evidência da negativa de
  capacidade inicial está em `evidence/pentest-2026-08-15/role-journeys-a-022318/`.
- `OPS-001`: probes autenticados sanitizados no transcript — health profundo 200 com seis checks
  `ok`; outbox 200 sem alarmes e filas ativas zeradas; Auth Hook 200/self-test `ok`; inventário SQL
  read-only com 11 heartbeats `success` e ausência dos dois jobs mensais.
- `AI-001`: transcripts de `pnpm ai:live-check` e `pnpm ai:adversarial`; relatório atualizado em
  `docs/audits/C11_ADVERSARIAL_50.md` com 0/50 finais inseguros.
- `META-001`: inventário SQL sanitizado, scopes/phone read-only e três GETs reais de
  `subscribed_apps` retornando HTTP 200/lista vazia; nenhuma mensagem ou mutação externa.
- `LGPD-001`: `e2e/production-lgpd-export-email.spec.ts`, 1/1 `PASS` em 43,1 s; transcript com estado
  completed, outbox processado, PDF/JSON validados e cleanup final zero. O operador confirmou os
  dois e-mails na inbox. Os links retornaram `NoSuchKey` somente depois de o cleanup remover os
  objetos sintéticos; a expiração natural de 24 h não foi testada.
- `JOURNEY-LGPD-A/LGPD-003/004`: `e2e/production-lgpd-full-lifecycle-a.spec.ts`; artefatos em
  `evidence/pentest-2026-08-15/lgpd-lifecycle-a-025018/` e `...-025409/`. A segunda execução chegou a
  `deleted=1/anonymized=1/failed=0`, pedidos=2, auditoria PII=0, outbox PII=2, signed PDF pós-eliminação
  200 e JSON privado ainda legível; o exit 1 ocorreu exclusivamente no `finally` pelo conflito
  `status_code=200/response=NULL`. Cleanup diagnóstico posterior: 2 chaves normalizadas, 6
  idempotências, 8 outbox, 5 auditorias, 1 prontuário, 3 pedidos, 2 supressões e 1 paciente removidos,
  com sete contadores finais em zero. As duas tentativas geraram duas novas aceitações do e-mail
  controlado; recebimento em inbox não foi reconfirmado e os objetos foram removidos ao fim.
- `AUD-001/LGPD-002`: consultas read-only sanitizadas sobre 498 auditorias, 603 outbox e 353
  idempotências; correlação 494/494, zero segredo/conteúdo clínico legível. Matriz agregada do
  `patient.core.created`: 31 skipped, 7 pacientes ausentes e 16 pedidos LGPD concluídos; nenhum valor
  pessoal foi impresso.
- `ASAAS-001`: `/myAccount` Production HTTP 200; Clínica A `801a132224ef` cruzada com uma assinatura,
  uma invoice e um payment de R$ 349. Três tentativas autorizadas de adiantar o calendário foram
  recusadas em HTTP 400 (`invalid_nextDueDate`, `invalid_dueDate`, `invalid_nextDueDate`) antes de
  qualquer captura. Contraprova final restaurada: payment único `PENDING` em 24/08, zero attempts,
  invoice/subscription/clinic ainda `open/trial/trial`; nenhuma cobrança no cartão. A chave possui
  permissão para listar webhooks, o destino Production está habilitado/não interrompido e já processou
  `PAYMENT_CREATED`. Na conta inteira, zero cobranças vencidas permanecem sem liquidação; o cartão
  recorrente de 29/07 foi confirmado no vencimento e posteriormente estornado.
- Sentry fornecido pelo operador: `CLAIMS_OUTDATED` em `PacientesPage` e `PERMISSION_DENIED` em
  `setMemberOverrideAction`, ambos no instante de `PERM-001`.
- Revalidação local de 15/08/2026: `pnpm lint` e `pnpm typecheck` `PASS`; `pnpm build` `PASS` em
  201,6 s, compilação otimizada em 119 s e 11/11 páginas estáticas geradas; o webpack avisou que não
  conseguiu restaurar partes do cache, recompilou e terminou com exit code 0. `pnpm test` ficou `FAIL`
  com 1 falha e 1.511 sucessos em 1.512 testes: `slot-floor.test.ts` reproduziu `SCHED-001`.
  `pnpm format:check` global ficou `FAIL` por 85 arquivos preexistentes/no worktree, sobretudo
  evidências `.last-run.json`; `pnpm exec prettier --check teste2e2.md` passou isoladamente.
- Higiene final: estado Playwright anterior ao pentest restaurado por hash; 177 artefatos textuais
  novos varridos contra as credenciais fornecidas, JWTs, signed tokens e chaves privadas, com zero
  ocorrência.
- Baseline documental: `docs/runbooks/go-live-2026-08-11.md`.

## 39. Resultado Final

`CONCLUÍDO — NO-GO` — há treze P1 abertos (`AUTH-005/006/007`, `AUTHZ-001/002/003/005/007/008`, `META-001`,
`LGPD-002/003/005`), vinte e quatro P2 abertos (`AUTHZ-004/006`, `RBAC-001`, `OBS-001/002`, `LGPD-004`,
`DATA-001/002/003/004/005/006/007/008/009`, `VAL-002`, `PAT-001`, `UX-003/004`, `WAIT-001`,
`STATE-001`, `BILLING-001/002` e `SCHED-001`) e sete P3 (`UX-001/002`, `HTTP-001`, `VAL-001`,
`A11Y-001/002/003`). As lacunas
externas e funcionalidades não implantadas estão identificadas individualmente como `BLOCKED`,
`NOT TESTED` ou `PARTIAL`; nenhuma foi promovida artificialmente a sucesso.

## 40. GO-LIVE Readiness

`NO-GO` para este ciclo por P1 reproduzido. É proibido declarar `GO` antes de eliminar P0/P1,
reexecutar as regressões indicadas e concluir os gates externos bloqueados. A↔B, lifecycle mutável de
equipe, permissões granulares, jornadas principais e consistência financeira tiveram evidência
parcial ou ampla nesta execução, mas não compensam os bypasses e falhas críticas ainda conhecidos.

## Matriz Bug → Correção → Validação

| Bug | Severidade | Correção | Arquivos/Áreas | Teste de Reprodução | Regressão | Segurança | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AUTHZ-001 | P1 | gate server-side `view:patient` em lista/detalhe e variantes | páginas/queries/actions de paciente | `PERM-001` | `FLOW-001` + roles | deny/grant + A↔B | `FAIL` aberto |
| AUTHZ-002 | P1 | gate server-side `view:agenda` antes de carregar dados | Agenda/data/queries | `PERM-001` | `FLOW-001` | deny/grant + sessão | `FAIL` aberto |
| AUTHZ-003 | P1 | contrato/gates por tipo no feed, hub e rotas diretas/PDF/editor | Documentos/clinical queries/paciente/prontuário/PDF | `PERM-001` + `production-prontuario-direct-rbac-a` | `FLOW-001` PDFs + editor autorizado | combinações de permissões + URL assinada + SOAP ausente no RSC | `FAIL` aberto |
| AUTH-005 | P1 | incrementar epoch no logout e manter revogação global dos refresh tokens | logout route/identity profile/auth gate | `production-session-logout-replay-a` | login/logout/relogin + segundo dispositivo | cookie copiado, refresh antigo, usuário removido | `FAIL` aberto |
| AUTH-006 | P1 | exigir grant one-time de recovery ou reautenticação com senha atual | auth confirm/reset page/action | `production-password-recovery-a` | recovery legítimo e login final | sessão normal, link reutilizado, senha fraca | `FAIL` aberto |
| AUTH-007 | P1 | incrementar epoch e revogar todas as sessões após troca de senha | reset action/identity profile/auth gate | `production-password-recovery-a` | reset/recovery/relogin | access/refresh antigo, segundo dispositivo, usuário removido | `FAIL` aberto |
| AUTHZ-004 | P2 | gate da página de templates | Modelos/actions de template | `PERM-001` | CRUD autorizado | rota + action negada | `FAIL` aberto |
| AUTHZ-005 | P1 | gate server-side financeiro no Dashboard | Dashboard/financial queries/RSC | `production-dashboard-financial-rbac` | Dashboard com permissão + Financeiro/Relatórios | deny/role sem bundle e ausência no RSC | `FAIL` aberto |
| AUTHZ-006 | P2 | gate server-side e ocultação dos controles WhatsApp | Configurações/WhatsApp/status/hub | `production-whatsapp-settings-rbac` | owner autorizado + páginas config protegidas | deny/role sem bundle; zero chamada Meta | `FAIL` aberto |
| AUTHZ-007 | P1 | separar disponibilidade própria de gestão da equipe/recursos globais e validar ownership | Agenda/ausências/horários/recursos/feriados/actions | `production-scheduling-config-a` | médico próprio + owner/gestor global | deny/grant, sessão antiga, A↔B e período vazio | `FAIL` aberto |
| AUTHZ-008 | P1 | permissão fresh de conclusão clínica + precondição de prontuário/assinatura antes do evento financeiro | Consultório/actions/state machine/clinical e financial handlers | `production-consultorio-attendant-integrity-a` | atendente chama, médico assume/assina/conclui + worker atrasado | role/assigned doctor/deny, sessão antiga, replay, ordem invertida e A↔B | `FAIL` aberto |
| STATE-001 | P2 | renderizar no-show apenas nos estados válidos a partir de `allowedTransitions` | Consultório CheckinStrip/WaitingCard/actions/state machine | `production-consultorio-no-show-a` | agendado/confirmado→faltou + reload/relatório | role/deny, replay, corrida check-in×no-show e A↔B | `FAIL` aberto |
| BILLING-001 | P2 | avançar período da invoice/subscription atomically na primeira cobrança recorrente paga | subscriptions/webhook/reconcile | inspeção estrutural + teste unitário novo | trial→active mensal/anual + fim de mês | replay, pagamento antigo e webhook perdido não avançam duas vezes | `FAIL` estrutural aberto |
| BILLING-002 | P2 | assinar e reconciliar `PAYMENT_UPDATED/DELETED`, sincronizando metadados/estado terminal da invoice | webhook Asaas/ensureInvoice/reconcile/configuração externa | auditoria `GET /webhooks` + testes de update/delete | data/valor alterados e delete legítimo | provider autoritativo, replay, paid terminal e zero cancelamento forjado | `FAIL` estrutural/configuração |
| RBAC-001 | P2 | deprecar/remover ou implementar codes órfãos | catálogo/bundles/UI/feature | `PERM-002` + busca de consumidores | claims/overrides | nenhum code administrável sem efeito | `FAIL` aberto |
| OBS-001 | P2 | traduzir AuthError esperado para redirect/401/403 sem Sentry error | páginas concorrentes + Server Actions RBAC | eventos Sentry + replay | login/equipe | replay continua negado | `FAIL` aberto |
| OBS-002 | P2 | mapear validações/conflitos de configuração para resultado controlado | procedure/availability/holiday/waitlist actions e managers | `production-scheduling-config-a` + `production-hours-atomicity-a` + `production-waitlist-a` | válidos + longos + duplicados + overlaps + período invertido | sem stack/5xx/alert vazio e persistência coerente | `FAIL` aberto |
| META-001 | P1 | reinscrever o app e reconciliar estado externo da WABA | Meta/WABA, configuração WhatsApp, health/webhook | Graph `subscribed_apps` + mensagem controlada | webhook/outbox/IA | assinatura, idempotência e isolamento | `FAIL` aberto |
| LGPD-002 | P1 | minimizar evento e sanear outbox no hard-delete | patient events/hard-delete/retention | inventário PROD + eliminação sintética controlada | worker/retention/LGPD | escopo por patient+tenant e zero PII residual | `FAIL` aberto |
| LGPD-003 | P1 | apagar exports e revogar URLs ao concluir eliminação | Storage/lgpd_requests/hard-delete | signed PDF/JSON pós-eliminação | export + lifecycle | escopo por patient+tenant e objetos alheios intactos | `FAIL` aberto |
| LGPD-004 | P2 | separar resposta expurgada de reserva `in-flight` | idempotency/hard-delete/health/retention | chaves concluídas com `response=NULL` | replay + trigger + cleanup | exactly-once e zero PII | `FAIL` aberto |
| DATA-001 | P2 | separar snapshot de criação da projeção do médico atual | Scheduling/IA/lembretes/evento completed/Financial/estatísticas | `production-appointment-recovery-a` | transferência agendada/em espera | old/new auditável + consumidores coerentes + replay | `FAIL` aberto |
| LGPD-005 | P1 | expor concessão/revogação pelo domínio append-only existente | hub/actions/consent/suppression | `production-patient-lifecycle-a` + busca de callers | ciclo completo de consentimento | permissão, A↔B e exactly-once | `FAIL` aberto |
| DATA-002 | P2 | compare-and-swap/versão na edição de paciente/endereço | patient form/action/schema | dois atores sob lock controlado | conflito + reload/retry | nenhuma audit/outbox do perdedor | `FAIL` aberto |
| DATA-003 | P2 | agregar refunds globais para terminalização e manter limite por parcela | financial actions/ledger/Caixa/filtros | `production-financial-lifecycle-a` | parcela única e múltipla, ordens e concorrência | append-only, exactly-once e zero over-refund | `FAIL` aberto |
| DATA-004 | P2 | compare-and-swap/versão na edição de fornecedor | supplier form/action/schema | `production-supplier-lifecycle-a` com lock controlado | conflito + reload/retry | nenhuma audit/idempotência de sucesso do perdedor | `FAIL` aberto |
| DATA-005 | P2 | compare-and-swap/versão na edição do perfil da clínica | tenancy profile form/action/core/schema | `production-clinic-profile-a` em duas abas | conflito + reload/retry + PDF | allowlist, session clinic e lifecycle intactos | `FAIL` aberto |
| DATA-006 | P2 | criar manhã+tarde em uma transaction/idempotency única | hours manager/config action/availability | `production-hours-atomicity-a` | par válido, conflito na primeira/segunda e single-window | zero estado parcial + A↔B + replay | `FAIL` aberto |
| DATA-007 | P2 | validar paciente+médico+dia em todas as ocorrências na mesma transaction | Agenda action/recurrence core/constraint | `production-recurrence-a` | série válida + colisão em cada posição | concorrência, rollback e A↔B | `FAIL` aberto |
| DATA-008 | P2 | calcular cada ocorrência no calendário/fuso local | recurrence policy/action/slot timezone | `RECURRENCE-DST-001` | spring/fall DST + fuso estável | horários ambíguos/inexistentes e ordem | `FAIL` aberto |
| SCHED-001 | P2 | calcular os dois candidatos de hora ambígua a partir da mesma próxima data civil | relative datetime/prepare appointment/relógio da clínica | `slot-floor.test.ts` após 15h local | antes/depois de 03h e 15h, virada de dia e DST | nunca escolher 03h/15h sem confirmação e não consultar slots antes da resposta | `FAIL` reproduzido |
| DATA-009 | P2 | excluir import histórico da métrica corrente | import action/events + billing usage handler | `production-appointment-import-a` | import + appointment corrente + worker | ledger exatamente uma vez e cleanup da métrica | `FAIL` aberto |
| UX-003 | P2 | expor e gerir/cancelar a série na Agenda | Agenda projection/UI/action/recurrence core | `production-recurrence-a` | criar→identificar→cancelar futuras | permissão fresh, replay e histórico | `FAIL` aberto |
| UX-004 | P2 | rotacionar chave e limpar formulário após lote concluído | HistoryImporter/form action/idempotency UX | `production-appointment-import-a` | replay igual + segundo lote sem reload | conflito diferente continua fail-closed | `FAIL` aberto |
| WAIT-001 | P2 | unificar cancelamentos, entregar oferta e expor aceite/booking | waitlist store/handlers/Agenda/actions | `production-waitlist-a` | normal/urgente/período + cancel paths | exactly-once, consentimento, A↔B e retry | `FAIL` aberto |
| VAL-001 | P3 | normalizar e validar CNPJ completo/checksum no backend | supplier schema/form/action | CNPJ `1` persistido em produção | matriz válido/vazio/curto/checksum/caller direto | tenant scope e formato canônico | `FAIL` aberto |
| VAL-002 | P2 | normalizar/validar CNPJ antes de cifrar e hashear | tenancy types/profile core/form/onboarding utility | `production-clinic-profile-a` | vazio/válido/inválidos + PDF/reload | identidade clínica separada de owner/billing/cardholder | `FAIL` aberto |
| PAT-001 | P2 | restauração auditada durante retenção | patient actions/UI/suppression | soft-delete real + ausência de restore | delete→restore→hard-delete | não ressuscitar merge/óbito/LGPD | `FAIL` aberto |
| UX-001 | P3 | filtrar falecidos dos candidatos de Agenda | busca Agenda/lista de espera | falecido selecionável e submit bloqueado | seletor + payload adulterado | guarda backend preservada | `FAIL` aberto |
| UX-002 | P3 | alinhar botão de cancelamento aos estados aceitos pelo domínio | assinatura form/actions/plan changes | `production-subscription-cancellation-trial-a` | matriz trial/active/past_due/cancelled/pending | zero persistência/provider nas negativas | `FAIL` aberto |
| HTTP-001 | P3 | emitir 404 antes do streaming do shell | patient route/not-found boundary | inválido/ausente/deletado HTTP 200 | quatro estados + A↔B | sem enumeração/dados/5xx | `FAIL` aberto |
| A11Y-001 | P3 | associar labels a Data/Motivo | horarios manager/Field/Input | `production-hours-atomicity-a` | teclado/leitor de tela | nomes acessíveis únicos | `FAIL` aberto |
| A11Y-002 | P3 | associar labels à recorrência e observações | appointment drawer/Field/Input/Textarea | `production-recurrence-a` | teclado/Enter/leitor de tela | nomes acessíveis únicos | `FAIL` aberto |
| A11Y-003 | P3 | associar labels aos sete campos da waitlist | waitlist manager/Field/Combobox/inputs | `production-waitlist-a` | teclado/leitor de tela | nomes acessíveis únicos | `FAIL` aberto |

## 41. Achados adicionais após a tentativa Production e o gate final

### BILLING-001 — período pago não é avançado na confirmação da primeira cobrança (`P2`)

- Evidência estrutural: `ensureInvoiceForPayment()` cria a invoice sem `period_start/period_end` e
  `markInvoicePaid()` altera invoice para `paid`, ativa subscription/clinic e zera dunning, mas não
  avança `subscriptions.current_period_start/current_period_end` nem preenche o período da invoice.
  Webhook e reconcile chamam a mesma função, portanto a lacuna existe nos dois caminhos.
- Efeito esperado se a cobrança de 24/08 for aprovada hoje: a clínica pode virar `active` enquanto o
  ciclo local continua apontando para o trial encerrado. Cancelamento/downgrade “ao fim do ciclo”,
  exibição da assinatura, prorrata e dunning passam a decidir sobre uma data vencida.
- Correção sem migration: dentro da mesma transação que aceita a transição monotônica `open→paid`,
  carregar `prices.billing_cycle`; derivar o ciclo do `due_date` autoritativo da invoice, preencher
  `invoice.period_start/period_end` e avançar a subscription somente se esse período for mais novo
  que o atual. Mensal deve somar um mês de calendário com clamp de fim de mês; anual, um ano.
- Não quebrar: replay de webhook/reconcile não pode avançar duas vezes; pagamento tardio de invoice
  antiga não pode regredir ou pular o ciclo atual; refund não deve retroceder automaticamente o
  período; upgrade one-off não entra nesse caminho de recorrência.
- Testes obrigatórios: ampliar `src/contexts/billing/internal/subscriptions.test.ts` para
  trial→active mensal, anual, 31/01, fevereiro bissexto, replay e invoice antiga; ampliar
  `src/app/api/webhooks/asaas/route.test.ts` e os testes do reconcile para provar o mesmo resultado
  sob `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, evento duplicado e webhook perdido.
- Status: `FAIL` estrutural confirmado por código, ainda não reproduzido dinamicamente porque o Asaas
  não permitiu adiantar a cobrança Production.

### BILLING-002 — update/delete do Asaas não sincronizam a invoice local (`P2`)

- Evidência externa read-only: o webhook Production está habilitado e não interrompido, mas seus cinco
  eventos não incluem `PAYMENT_UPDATED` nem `PAYMENT_DELETED`.
- Evidência estrutural: `actionFor()` em `webhooks/asaas/route.ts` e no reconcile só traduz estados
  pago, vencido e estornado. `ensureInvoiceForPayment()` retorna imediatamente quando encontra uma
  invoice existente, sem reconciliar `due_date`, `total_amount` ou remoção. Assim, uma alteração no
  painel pode permanecer diferente no ClinicaOS; uma cobrança excluída pode continuar `open` local.
- Limite do impacto: essa lacuna não inicia nem impede captura de cartão. O Asaas processa a cobrança
  no provedor e o webhook apenas informa o ClinicaOS; por isso ela não explica ausência de tentativa
  no próprio painel.
- Correção segura: primeiro implementar `syncInvoiceFromProviderPayment()` no domínio e os testes;
  somente depois, com autorização operacional, adicionar os dois eventos no webhook. Para
  `PAYMENT_UPDATED`, usar o `GET /payments/{id}` autoritativo e atualizar data/valor apenas em invoice
  `open/overdue`, com audit/evento e compare-and-swap. `paid/refunded/cancelled` permanecem terminais.
- `PAYMENT_DELETED` exige fail-closed: não confiar apenas no corpo autenticado por token estático. Se o
  recurso retornar 404, correlacionar o payment ID já persistido e usar uma consulta suportada pelo
  Asaas para confirmar remoção; se não houver confirmação autoritativa, colocar em divergência/revisão
  em vez de cancelar automaticamente. Nunca transformar delete em refund.
- Testes obrigatórios: `route.test.ts`, `subscriptions.test.ts` e `billing-reconcile/route.test.ts`
  para update de data/valor, evento duplicado e fora de ordem, delete de `open`, tentativa de delete
  de `paid`, 404 ambíguo, token inválido, payment de outra subscription/tenant, webhook perdido e
  reconcile posterior. Teste Production deve alterar e restaurar apenas cobrança sintética futura.
- Rollout: deploy do código e smoke primeiro; depois habilitar eventos no Asaas, confirmar 2xx/logs e
  observar a fila. Rollback remove somente os dois eventos novos e mantém o reconcile ativo.
- Status: `FAIL` estrutural/configuração; nenhum webhook foi alterado nesta execução.

### SCHED-001 — “às 3” perde a ambiguidade após as 15h (`P2`)

- Evidência dinâmica: às 15:13 de 15/08/2026, a suíte completa e a execução focada de
  `src/contexts/ai-agent/tools/slot-floor.test.ts` retornaram `appointment_unavailable` onde o
  contrato exige `appointment_information_required`; 6/7 casos do arquivo passaram.
- Causa: `resolveRequestedDateTime()` move a opção 03:00 já vencida para amanhã, mas calcula a opção
  15:00 com a variável `base` ainda apontando para hoje. Depois das 15h, a candidata PM é descartada
  como passada e a opção 03:00 vira um `instant`, apesar de a frase continuar ambígua.
- Correção mínima, sem migration/dependência: em
  `src/contexts/ai-agent/internal/relative-datetime.ts`, determinar primeiro a próxima data civil que
  comporta os dois sentidos e construir AM/PM a partir dela; se apenas uma opção estiver no horizonte,
  ainda pedir data/período em vez de escolher silenciosamente. `prepare-appointment.ts` deve manter o
  retorno de esclarecimento antes de qualquer `listSlots`.
- Não quebrar: preservar datas explícitas, “3 da tarde/manhã”, `15h`, contraste (“não às 3, às 5”),
  limite `maxDaysAhead`, timezone da clínica e instantes inexistentes/duplicados em DST. Não corrigir
  relaxando a asserção ou alterando o mock para devolver slot.
- Testes obrigatórios: congelar o relógio com `vi.useFakeTimers()/vi.setSystemTime()` em 02:59, 03:01,
  14:59, 15:01 e 23:59; cobrir São Paulo e um fuso com DST em
  `relative-datetime.test.ts` e `slot-floor.test.ts`; afirmar dois candidatos distintos, mensagem de
  confirmação e `listSlots` não chamada até a escolha do paciente.
- Status: `FAIL` reproduzido duas vezes; não causado por `teste2e2.md`.

Com `BILLING-001/002` e `SCHED-001`, o inventário passa a **44 achados abertos**: 13 P1, 24 P2
(incluindo `STATE-001`, `BILLING-001/002` e `SCHED-001`) e 7 P3. A decisão final permanece `NO-GO`.

## 42. Plano executivo para as próximas 48 horas

Não é responsável prometer corrigir, revisar, implantar e retestar 44 achados em dois dias. O corte
seguro é: **não liberar enquanto qualquer P1 permanecer**; corrigir `BILLING-001` antes da primeira
cobrança; e manter módulos afetados por P2/P3 fora do escopo comercial ou explicitamente aceitos pelo
responsável de risco. Esconder botão não substitui gate server-side.

### Ordem obrigatória

1. **0–2 h — congelamento e baseline:** branch/revisão isolada; backup; fixar o commit candidato;
   rodar os testes de reprodução atuais; não misturar feature work. Registrar um owner para cada P1.
2. **2–10 h — vazamentos de leitura:** `AUTHZ-001/002/003/005` primeiro. São mudanças pequenas em
   Server Components/queries e reduzem exposição imediata. Retestar deny/grant, sessão antiga e A↔B
   antes de seguir.
3. **10–18 h — identidade:** `AUTH-005/006/007` e `OBS-001`. Implementar epoch/recovery sem alterar
   duração de JWT. Rodar logout/recovery em dois contextos e confirmar que erro esperado não vira 500.
4. **18–28 h — integridade clínica:** `AUTHZ-007/008` e `STATE-001`. Separar operação de fila de ato
   clínico; validar ownership e prontuário antes de emitir evento financeiro. Rodar worker atrasado,
   replay e concorrência.
5. **28–34 h — LGPD:** `LGPD-002/003/004/005`. Corrigir outbox, Storage, idempotência e consentimento
   como uma unidade; executar hard-delete controlado com contraprova de outro paciente/tenant.
6. **34–38 h — billing/scheduling/externos:** corrigir `BILLING-001/002` e `SCHED-001`;
   reinscrever/reconciliar Meta. Publicar o código de `BILLING-002` antes de assinar eventos novos no
   Asaas. Não tentar novo “time travel”; agendar observação do payment real em 24/08.
7. **38–44 h — gate integral:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`, E2E focado de cada P1 e smoke das jornadas owner/doctor/attendant/financial.
8. **44–48 h — revisão e rollout:** revisão por diff, varredura de segredos, deploy canário, smoke
   autenticado Production e observação de Sentry/heartbeats. Rollback imediato se houver 5xx novo,
   bypass de permissão, divergência financeira ou falha de cleanup.

### Regras para não quebrar o sistema

- Uma correção por commit lógico; teste de reprodução primeiro, regressão positiva e negativa no
  mesmo commit. Não alterar bundles globais para “consertar” uma tela que esqueceu o gate.
- Toda autorização sensível deve existir no boundary server-side e no core mutável; UI serve apenas
  para experiência. Usar `requireFreshPermission` nas operações críticas e manter RLS/A↔B intactos.
- Reusar `updated_at` como compare-and-swap onde já existe; migration nova somente se inevitável e
  após aprovação. Não introduzir dependência de produção nesses dois dias.
- Em outbox/idempotência, preservar exactly-once: erro/negação não deixa audit/event/idempotency de
  sucesso. Em finanças, preservar ledger append-only e transições monotônicas.
- Cada E2E Production deve usar fixture sintética identificável, snapshot prévio, cleanup em `finally`
  e contraprova final. Não usar dado clínico real, PAN/CVV, token assinado ou segredo em artefatos.
- Só promover a correção após o teste unitário/focado e o gate completo. Se um P1 não couber no prazo,
  a decisão correta é adiar o go-live ou desabilitar server-side todo o módulo afetado.

## 43. Matriz executável por achado

Cada linha abaixo é uma unidade de entrega. “Aceite” significa condição obrigatória para fechar o
achado; passar apenas no happy path não basta. O rollback padrão é reverter somente o commit do
achado e manter o módulo negado server-side até nova correção.

### P1 — bloqueadores de produção

| ID | Mudança mínima e arquivos | Testes que devem validar | Aceite e proteção contra regressão |
| --- | --- | --- | --- |
| `AUTHZ-001` | Inserir `requirePermission(VIEW_PATIENT)` antes de qualquer leitura em `src/app/(app)/(shell)/pacientes/page.tsx` e `[id]/page.tsx`; manter `src/contexts/patient/queries.ts` tenant-scoped e impedir caller sem gate. | Estender `e2e/production-permission-lifecycle.spec.ts` e `production-cross-tenant-patients.spec.ts`; unitário da boundary com query spy não chamada no deny. | Owner/roles concedidas continuam lendo; deny remove dados do HTML/RSC; grant exige sessão nova; ID de B continua indistinguível de ausente. Não alterar bundles/RLS para fazer o teste passar. |
| `AUTHZ-002` | Gate `VIEW_AGENDA` no início de `src/app/(app)/(shell)/agenda/page.tsx`; `agenda/data.ts` não pode ser invocado antes do gate. | `production-permission-lifecycle.spec.ts`, `production-appointment-concurrency.spec.ts` e teste de `agenda/data.ts` autorizado. | Sem permissão: zero query/serialização; com permissão: calendário, criação e corrida continuam. Rollback mantém rota negada, nunca aberta. |
| `AUTHZ-003` | Em `documentos/page.tsx`, filtrar por `VIEW_PRESCRIPTION` e `VIEW_PRONTUARIO`; gatear `documentos/[id]/pdf/page.tsx`, suas actions, `prescricoes/[id]/pdf/page.tsx`, hub/detalhe de paciente e prontuário antes de decrypt. | `production-prontuario-direct-rbac-a.spec.ts`, `production-permission-lifecycle.spec.ts`, PDFs de `production-report-matrix.spec.ts`; matriz nenhuma/só prescrição/só prontuário/ambas. | SOAP/PDF/metadado proibido não aparece nem no RSC; autosave/assinatura mantêm gates próprios; URLs de B/negadas não enumeram. Não resolver removendo capacidade válida do médico. |
| `AUTHZ-005` | Gate `VIEW_FINANCIAL` em `dashboard/page.tsx` antes de `getCashFlowToday` e `listCashFlowDaily` de `dashboard/data.ts`; condicionar `revenue-chart.tsx`. | `production-dashboard-financial-rbac.spec.ts`, `production-dashboard-operational-a.spec.ts`, `dashboard/data.test.ts`. | Role sem permissão não recebe saldo, série, link ou payload; owner/financeiro preservam números reconciliados. Rollback: esconder e negar o bloco inteiro. |
| `AUTHZ-007` | Em `src/contexts/scheduling/config-actions.ts`, `catalog-actions.ts` e actions de ausências, separar disponibilidade própria de gestão global; validar `doctorId===actor` para médico e exigir permissão fresh administrativa para outro profissional, recurso e feriado. Alinhar páginas/forms de `agenda/ausencias`, `configuracoes/horarios`, `recursos` e `procedimentos`. | `production-scheduling-config-a.spec.ts`, `production-hours-atomicity-a.spec.ts`, `doctor-absence.test.ts` e `doctor-absence-validation.test.ts`; repetir deny/grant, A↔B e sessão antiga. | Médico só altera a própria agenda; owner/gestor preserva gestão global; toda negativa deixa zero escrita/audit/outbox/idempotência. Não ampliar `EDIT_AGENDA` para cobrir gestão global. |
| `AUTHZ-008` | Criar/usar capacidade fresh de conclusão clínica em `consultorio/actions.ts` e `scheduling/internal/appointment-core.ts`; validar profissional atribuído/delegação e prontuário assinado antes de `appointment.completed`. Ajustar `consultorio-board.tsx`, `attending-panel.tsx` e handler `financial/internal/handlers/appointment-completed.ts`. | `production-consultorio-attendant-integrity-a.spec.ts`, `production-role-journeys-a.spec.ts`, testes da state machine/core e handler financeiro com worker atrasado/invertido. | Atendente chama/check-in, mas não encerra; médico correto assina/conclui; sem prontuário não há estado terminal, evento ou cobrança; replay exactly-once. Rollback deve negar conclusão, não voltar ao bypass. |
| `AUTH-005` | Em `src/app/(app)/logout/route.ts`, obter usuário, incrementar `profiles.claims_version` autoritativamente e só então executar logout global/limpar cookies; reutilizar as verificações de `src/lib/auth/tenant-context.ts`. | `production-session-logout-replay-a.spec.ts`, `tenant-context.test.ts`; cookie copiado, duas abas, segundo dispositivo, refresh antigo e novo login. | Todos os access/refresh tokens anteriores falham no request seguinte; novo login recebe epoch novo. Se bump falhar, não declarar logout global concluído. |
| `AUTH-006` | Em `auth/confirm/route.ts` e `confirm-logic.ts`, marcar autorização one-time de recovery; `reset-password/page.tsx` e `actions.ts` devem exigir/consumir essa prova ou reautenticação com senha atual, não apenas sessão existente. | `production-password-recovery-a.spec.ts`, `confirm-logic.test.ts` e teste da action com sessão comum, recovery válido, link reutilizado, fraca/forte. | Sessão normal não troca senha; grant é uso único e vinculado ao usuário/fluxo. Preservar anti-open-redirect, resposta genérica e rate limit. |
| `AUTH-007` | Após reset aceito, na mesma operação lógica incrementar `claims_version`, revogar sessões globais e emitir sucesso somente se a invalidação ficou consistente; arquivos do item anterior mais identity profile/core. | Mesmo E2E de recovery em dois contextos; unitário para falha do bump e falha da revogação. | Access e refresh anteriores morrem; senha final entra; replay do link não altera estado. Rollback deve manter troca de senha indisponível se não puder revogar. |
| `META-001` | Operação: reinscrever o app correto na WABA. Código: `messaging/internal/meta-onboarding.ts` e `lib/messaging/meta-cloud.ts` devem reconciliar token/scopes/phone/subscribed_apps; `configuracoes/whatsapp/data.ts` e `page.tsx` exibem estado degradado sem IDs. | `meta-onboarding.test.ts`, webhook Meta, outbox e um E2E controlado inbound→IA→outbound com exatamente uma mensagem; consulta Graph read-only antes/depois. | `subscribed_apps` contém o app esperado, webhook válido entra e inválido falha; tenant alheio não vê dados. Rollback operacional desinscreve apenas o app de teste e mantém conexão marcada degradada. |
| `LGPD-002` | Em `patient/internal/hard-delete.ts`, sanear payloads outbox pelo par `clinic_id+patientId` ou impedir PII na publicação; preservar consumidores e itens de terceiros. | `hard-delete.test.ts`, `production-lgpd-full-lifecycle-a.spec.ts`; varredura de outbox/audit/idempotency após worker e replay. | Zero nome/e-mail/telefone/CPF/hash no residual do titular; eventos de outro paciente/tenant byte a byte iguais; filas em processamento não ficam corrompidas. |
| `LGPD-003` | Adicionar delete Storage idempotente em `lib/storage/exports.ts`/`admin-exports.ts`, chamado por `hard-delete.ts` para prefixos exatos do paciente; registrar retry observável antes de concluir. | `production-lgpd-full-lifecycle-a.spec.ts`, `production-lgpd-export-email.spec.ts` e unitário com PDF/JSON, objeto ausente, retry e objeto de B. | Após conclusão, ambos os formatos dão `NoSuchKey`; objeto alheio segue legível; replay não falha nem apaga prefixo amplo. Em erro Storage, pedido não pode ser declarado concluído silenciosamente. |
| `LGPD-005` | Criar wrappers autenticados em paciente detalhe usando `recordConsent`/`revokeConsent` já existentes de `src/contexts/patient/actions.ts`; exigir `EDIT_PATIENT`, mostrar decisão atual e nunca atualizar histórico append-only. | Ampliar `production-patient-lifecycle-a.spec.ts` e `consent-decisions.test.ts`: conceder→usar→revogar→suprimir→conceder, concorrência e A↔B. | Cada decisão exactly-once, canal/finalidade/versão corretos; contato respeita decisão mais nova. Rollback remove UI/wrapper, não o histórico/domínio existente. |

### P2 — correções obrigatórias ou aceite formal de risco

| ID | Mudança mínima e arquivos | Testes que devem validar | Aceite e proteção contra regressão |
| --- | --- | --- | --- |
| `AUTHZ-004` | Gate da rota em `modelos-receita/page.tsx` antes da leitura; manter actions protegidas e alinhar `templates-manager.tsx`. | `production-permission-lifecycle.spec.ts` com rota direta, CRUD permitido e deny/grant; teste do manager sem controle no deny. | Sem permissão, zero template no RSC e actions seguem negadas; médico autorizado não perde CRUD. Não corrigir alterando bundle de role. |
| `AUTHZ-006` | Em `configuracoes/whatsapp/page.tsx` gatear `MANAGE_SETTINGS` antes de `data.ts`; ocultar link/controles e preservar gates de `actions.ts`. | `production-whatsapp-settings-rbac.spec.ts` e `whatsapp-connect.test.tsx`; owner, doctor/attendant/financial, deny/grant e rota direta. | Negado não recebe status, número, data nem faz chamada Meta; autorizado continua conectando. Rollback nega a subrota inteira. |
| `RBAC-001` | Em `src/lib/auth/permissions.ts`, bundles/claims e UI de equipe, remover/deprecar `export:audit` e `manage:agent` ou implementar enforcement real. Decisão de produto é pré-requisito; não mapear para permissão “parecida”. | Teste de catálogo que exige ao menos um consumidor por code; `production-all-permission-overrides.spec.ts` e matriz de role/override. | Nenhum code delegável sem efeito; claims e UI coincidem com enforcement. Se implementação não couber, retirar do catálogo e migrar overrides apenas com aprovação. |
| `OBS-001` | Em `src/lib/auth/tenant-context.ts`, manter `AuthError` tipado e traduzir `CLAIMS_OUTDATED`/`PERMISSION_DENIED` nas pages/actions para redirect ou resultado 401/403; Sentry captura somente inesperado. | `tenant-context.test.ts`, `production-permission-lifecycle.spec.ts` e teste de action `equipe`; assert de ausência/presença de capture conforme classe. | Replay continua negado sem 500; erros reais continuam observáveis. Não engolir exceção genérica nem transformar 403 em sucesso vazio. |
| `OBS-002` | Criar tradutor comum de Zod/conflito esperado nas actions de `scheduling/config-actions.ts`, `catalog-actions.ts` e waitlist; managers exibem mensagem não vazia. | `production-scheduling-config-a.spec.ts`, `production-hours-atomicity-a.spec.ts`, `production-waitlist-a.spec.ts`; longos, duplicados, overlap e intervalo invertido. | HTTP/action controlado, zero persistência de sucesso e mensagem acionável; exceção inesperada permanece 5xx/Sentry. |
| `LGPD-004` | Em `lib/idempotency/mutation.ts`, schema infra e `patient/internal/hard-delete.ts`, representar resposta expurgada terminal sem colidir com reserva `in-flight`; health/cleanup reconhecem o estado. | `mutation.types.test.ts`, `hard-delete.test.ts`, `production-lgpd-full-lifecycle-a.spec.ts`; replay antes/depois do scrub e cleanup vencido. | Chave concluída nunca volta a executar nem parece pendurada; zero PII na resposta; trigger/health concordam. Rollback deve pausar scrub, não reabrir operações. |
| `DATA-001` | Definir uma projeção única de profissional atual em `scheduling/queries.ts`/`agenda/data.ts`; atualizar IA, lembretes, evento completed, handler financeiro e estatísticas, mantendo histórico old/new separado. | `production-appointment-recovery-a.spec.ts`, testes de tenant references/queries e handler financeiro; transferência agendada/em espera e médico desativado. | Todos os consumidores mostram o novo médico; correções preservam snapshot histórico; replay não duplica. Se projeção persistida exigir migration, parar e pedir aprovação. |
| `DATA-002` | Levar `updated_at` no draft de `pacientes/patient-form.tsx`; em `contexts/patient/actions.ts` fazer update/endereço compare-and-swap e retornar conflito sem audit/outbox de sucesso. | `production-patient-lifecycle-a.spec.ts`, `patient-form.test.tsx` e unitário da action com dois atores/campos iguais e distintos. | Um vencedor; perdedor recarrega e reaplica sem perder intenção. Delete/óbito/merge/RLS permanecem iguais. Usar coluna existente antes de cogitar migration. |
| `DATA-003` | Em `financial/internal/payment-ledger.ts` separar limite reembolsável por parcela do total global do lançamento; `financial/actions.ts` terminaliza original/compensações sob o lock já existente. | `payment-ledger.test.ts`, `logic.test.ts`, `production-financial-lifecycle-a.spec.ts`: único/múltiplos, parcial/total, ordens, corrida, replay e over-refund. | Total global igual ao pago gera `estornado` exatamente uma vez; ledger continua append-only e soma líquida correta. Rollback não apaga transações. |
| `DATA-004` | Enviar `updated_at` em `financeiro/fornecedores/fornecedores-view.tsx`; update condicional em `actions.ts`; conflito mantém modal/dados e não audita sucesso. | `production-supplier-lifecycle-a.spec.ts`, `fornecedores-view.test.tsx`; owner/financeiro concorrentes, reload/retry e A↔B. | Um vencedor, nenhum lost update, desativar/reativar e seletor de despesa continuam. Reusar timestamp existente. |
| `DATA-005` | Em `configuracoes/perfil/perfil-form.tsx` e `actions.ts`, propagar `updated_at`; `tenancy/internal/profile-core.ts` aplica CAS sobre allowlist atual. | `production-clinic-profile-a.spec.ts`, `actions.test.ts`, PDFs e duas abas/atores. | Conflito não perde CNES/CNPJ/endereço nem audita sucesso; slug/status/timezone e identidade owner/billing/cardholder ficam fora do update. |
| `DATA-006` | Criar action única em `scheduling/config-actions.ts` para manhã+pausa+tarde em uma transação/idempotência; `horarios-manager.tsx` envia o par como uma operação. | `production-hours-atomicity-a.spec.ts`, `horarios-manager.test.tsx`; válido, conflito em cada metade, single-window, replay e A↔B. | Ou duas janelas, ou zero; uma trilha lógica; EXCLUDE/overlap e timezone preservados. Não compensar com delete posterior. |
| `DATA-007` | Em `agenda/actions.ts`, `scheduling/recurrence-policy.ts` e `appointment-core.ts`, calcular todas as ocorrências e validar paciente+médico+dia na mesma transação/lock antes de inserir. | `production-recurrence-a.spec.ts`, `recurrence-policy.test.ts`; colisão na primeira/meio/última, duas sessões e limites 1/105. | Colisão cria zero série/appointment/audit/outbox/idempotência; série válida continua completa. Preservar constraint de horário como defesa independente. |
| `DATA-008` | `recurrence-policy.ts` deve avançar data/hora de parede no timezone da clínica e converter cada ocorrência; explicitar política para instante inexistente/ambíguo. | `recurrence-policy.test.ts` e `RECURRENCE-DST-001`: New York spring/fall, `America/Sao_Paulo` e fuso sem DST. | Hora local escolhida permanece; ordem/duração não regressam; primeira ocorrência não muda. Não somar milissegundos fixos por semana. |
| `SCHED-001` | Em `ai-agent/internal/relative-datetime.ts`, derivar uma única próxima data civil válida antes de construir os candidatos AM/PM de hora nua; se o horizonte eliminar uma opção, pedir data/período em vez de promover a outra a instante. `prepare-appointment.ts` mantém o retorno antes de consultar slots. | `relative-datetime.test.ts` e `slot-floor.test.ts` com relógio congelado em 02:59, 03:01, 14:59, 15:01 e 23:59; São Paulo, DST, data explícita e “3 da tarde”. | “Às 3” sempre pede confirmação com duas opções coerentes e zero `listSlots`; após escolha explícita, piso/horizonte e disponibilidade continuam aplicados. Não alterar teste/mocks para esconder a seleção silenciosa. |
| `DATA-009` | Marcar/importar proveniência em `agenda/importar/actions.ts`; `billing/internal/handlers/appointment-created.ts` ignora `createdVia='import'` ou usa evento distinto; preservar batch/ledger. | `production-appointment-import-a.spec.ts`, `appointment-import.test.ts` e teste do handler/worker com import e appointment corrente. | Histórico não altera `usage_metrics`; evento corrente incrementa uma vez; cleanup/replay mantém ledger consistente. |
| `VAL-002` | Centralizar normalização/checksum de CNPJ em utilitário de domínio usado por `configuracoes/perfil/actions.ts`, `tenancy/internal/profile-core.ts` e onboarding; validar antes de cifrar/hash. | `production-clinic-profile-a.spec.ts`, `actions.test.ts` e saga onboarding: vazio, válido, curto, longo, repetido, alfanumérico, checksum. | Só representação canônica válida chega à cifra/PDF; clínica, owner, contato de cobrança e titular continuam identidades distintas. |
| `PAT-001` | Adicionar restore em `contexts/patient/actions.ts` e paciente detalhe/lista: somente soft-delete operacional dentro da retenção, com audit/idempotência e revalidação de suppression. | `production-patient-lifecycle-a.spec.ts`; delete→restore→delete→hard-delete, replay, concorrência e A↔B. | Não restaurar óbito, merge ou eliminação LGPD; vínculos autorizados retornam sem duplicar eventos. Rollback remove a action, preserva deleted row. |
| `UX-003` | Expor `recurrenceSeriesId/occurrence` em `agenda/data.ts`/`agenda-calendar.tsx`; envolver `cancelRecurringSeries()` em `agenda/actions.ts` com permissão fresh, motivo e confirmação. | `production-recurrence-a.spec.ts` e unitário da action: criar→identificar→cancelar futuras, replay e série alheia. | Somente futuras ativas são canceladas; histórico e ocorrência já atendida permanecem; contagem exibida coincide com DB. |
| `UX-004` | Em `agenda/importar/history-importer.tsx`, limpar arquivo/payload e gerar idempotency key nova após sucesso; `actions.ts` mantém a antiga apenas para retry do lote em curso. | `production-appointment-import-a.spec.ts`: replay idêntico, payload diferente com chave antiga, segundo lote sem reload e falha parcial. | Segundo lote novo funciona; conflito continua fail-closed com mensagem localizada sem chave interna. |
| `WAIT-001` | Centralizar cancelamentos em helper que chama `scheduling/internal/waitlist-store.ts`; implementar handler de oferta e actions de aceitar/recusar/expirar/book, alinhando `waitlist-manager.tsx`. | `production-waitlist-a.spec.ts`, `waitlist-policy.test.ts`; normal/urgente, médico específico/qualquer, duas liberações e delivery retry. | Um único candidato `offered`; só mostrar “enviada” após entrega; aceite cria appointment e `booked`; consentimento/A↔B/exactly-once preservados. |
| `STATE-001` | Em `consultorio/checkin-strip.tsx`, `waiting-card.tsx` e `board-logic.ts`, derivar botões de `scheduling/state-machine.ts`: no-show em `agendado/confirmado`, nunca em `chegou`. | `production-consultorio-no-show-a.spec.ts`, `board-logic.test.ts`; dois estados válidos, check-in×no-show, replay e relatório. | Transição válida gera uma trilha; corrida tem vencedor; card em espera não oferece ação inválida. Não ampliar `chegou→faltou` silenciosamente. |
| `BILLING-001` | Em `billing/internal/subscriptions.ts`, ao pagar invoice recorrente, calcular período pelo `billing_cycle`, preencher invoice e avançar subscription monotonicamente na mesma transação; webhook/reconcile permanecem callers únicos. | `subscriptions.test.ts`, `webhooks/asaas/route.test.ts` e testes do reconcile: monthly/yearly, 31/01, bissexto, replay, antiga e evento perdido. | Trial→active termina com período futuro correto; duplicata não avança; invoice velha não regride; upgrade one-off fica fora. Sem migration necessária. |
| `BILLING-002` | Criar `syncInvoiceFromProviderPayment()` em `billing/internal/subscriptions.ts`; usar no webhook/reconcile para atualizar data/valor somente em `open/overdue`. Implementar confirmação fail-closed de delete antes de cancelar localmente; só após deploy assinar `PAYMENT_UPDATED/DELETED` no Asaas. | `subscriptions.test.ts`, `webhooks/asaas/route.test.ts`, `billing-reconcile/route.test.ts`: update, replay, ordem invertida, delete open/paid, 404 ambíguo, token inválido, A↔B e evento perdido. | Painel e invoice convergem sem regressão terminal; update/delete jamais inicia captura, estorna ou cancela por corpo não confirmado. Código entra antes da configuração externa; rollback remove eventos novos e preserva reconcile. |

### P3 — corrigir antes de ampliar uso do módulo

| ID | Mudança mínima e arquivos | Testes que devem validar | Aceite e proteção contra regressão |
| --- | --- | --- | --- |
| `VAL-001` | Reusar o validador canônico de CNPJ em `financeiro/fornecedores/actions.ts` antes de create/update; `fornecedores-view.tsx` formata somente para exibição. | `production-supplier-lifecycle-a.spec.ts`, `fornecedores-view.test.tsx`; válido, vazio, curto/longo, repetido, letra e checksum. | Valor presente inválido nunca persiste; vazio continua opcional; desativação/reativação e A↔B não mudam. |
| `UX-001` | Filtrar falecido/inativo na busca de paciente de `agenda/data.ts` e `new-appointment-drawer.tsx`; manter a rejeição de payload adulterado em `appointment-core.ts`. | `production-patient-lifecycle-a.spec.ts` e teste da busca/core com paciente ativo, falecido, deletado e ID de B. | Falecido não aparece no seletor; chamada direta continua negada. Não remover a defesa backend depois de corrigir UI. |
| `UX-002` | Derivar habilitação de `configuracoes/assinatura/plan-change-form.tsx` do mesmo estado aceito por `actions.ts`/`billing/internal/plan-changes.ts`. | `production-subscription-cancellation-trial-a.spec.ts`, `page.test.tsx`, `plan-changes.test.ts`; trial, active, past_due, cancelled e change pendente. | Somente estado válido oferece/envia; negativas geram zero provider/event/audit/idempotência. |
| `HTTP-001` | Em `pacientes/[id]/page.tsx`, validar UUID e existência/tenant antes de iniciar o shell/stream; usar boundary/not-found com status 404 real. | `production-cross-tenant-patients.spec.ts` e `production-patient-lifecycle-a.spec.ts`: malformado, ausente, deletado, B e válido. | Quatro negativas são HTTP 404 sem detalhe enumerável, RSC sensível ou 5xx; válido continua 200. |
| `A11Y-001` | Em `configuracoes/horarios/horarios-manager.tsx`, criar IDs únicos e `htmlFor` para Data e Motivo; manter erro associado via `aria-describedby`. | `horarios-manager.test.tsx` por `getByLabelText`, teclado e mensagem; E2E `production-hours-atomicity-a.spec.ts`. | Dois controles têm nomes únicos e submit/erro/foco continuam. |
| `A11Y-002` | Em `agenda/new-appointment-drawer.tsx`, associar labels ao intervalo, quantidade e observações; IDs precisam ser únicos entre drawers. | Testing Library por `getByLabelText`, Enter/teclado e `production-recurrence-a.spec.ts`. | Três controles acessíveis sem depender de placeholder/posição; validação continua ligada ao campo correto. |
| `A11Y-003` | Em `agenda/lista-espera/waitlist-manager.tsx`, associar os sete campos e nomear o Combobox explicitamente. | Unitário Testing Library e `production-waitlist-a.spec.ts`; teclado, leitor de tela e intervalo invertido. | `getByLabel` encontra todos uma vez; foco/erro/valores preservados após falha. |

## 44. Validação, rollout e resolução operacional do Asaas

### Gate por correção

Para cada linha da matriz:

1. executar o teste que hoje reproduz o bug e confirmar que ele falha antes da mudança;
2. adicionar unitário/focado para positivo, negativa, replay e A↔B quando aplicável;
3. rodar o arquivo focado com `pnpm test -- <arquivo>` e o E2E autorizado correspondente;
4. rodar `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`;
5. revisar `git diff --check`, nomes staged e varredura de segredos; só então pedir autorização de
   deploy e executar smoke Production. Nenhum deploy foi autorizado ou feito por este documento.

O teste E2E que reproduzia um achado deve mudar para afirmar o comportamento seguro; não pode ser
apagado, pulado ou relaxado. Teste Production precisa também confirmar cleanup e que Clínica B não
mudou. Falha no gate completo reabre o achado mesmo que o teste focado passe.

### Primeira cobrança da Clínica A

O Asaas documenta que a tentativa automática no cartão ocorre no vencimento da cobrança. Como a API
Production recusou adiantar a data e o cartão associado não é recuperável como token, existem apenas
dois caminhos honestos:

Antes desses caminhos, a investigação eliminou a hipótese de “permissão pendente no webhook”:

- a API key recebeu HTTP 200 ao listar webhooks;
- o único webhook esperado está habilitado e com fila não interrompida;
- o endpoint já aceitou o `PAYMENT_CREATED` real da Clínica A;
- a assinatura é `ACTIVE/CREDIT_CARD`, o payment contém cartão e o reconcile roda diariamente;
- a conta não possui cobrança vencida ainda aberta; a recorrência de cartão anterior, vencida em
  29/07, foi confirmada no mesmo dia e depois estornada.

Logo, webhook pode explicar divergência **depois** de um evento, mas não ausência de tentativa no
painel Asaas. Para a Clínica A, o vencimento de 24/08 ainda não ocorreu. Se o operador se refere a uma
cobrança diferente das quatro retornadas pela conta atual — por exemplo, uma cobrança já excluída —,
é necessário fornecer somente o ID seguro do payment ou uma captura sem dados pessoais para
correlação; não há hoje outro overdue recuperável pela listagem normal.

1. **Prova do scheduler (preferida):** em 24/08/2026, antes da janela, confirmar o mesmo payment
   `PENDING`, invoice `open` e zero attempts; acompanhar `PAYMENT_CONFIRMED/RECEIVED`, webhook,
   invoice `paid`, subscription/clinic `active`, payment attempt único e período avançado. Não emitir
   nova cobrança nem repetir captura. Se o webhook atrasar, observar o reconcile agendado e comparar
   o estado autoritativo do Asaas; não disparar o cron global manualmente em horário de mudanças de
   plano sem revisar os outros tenants.
2. **Prova de captura manual, não do scheduler:** obter `creditCardToken` por canal seguro ou usar a
   operação do painel Asaas sobre o payment existente. Consultar o payment imediatamente antes;
   executar uma única captura; em timeout, consultar antes de qualquer nova tentativa. Registrar o
   resultado como “captura manual” e ainda manter a prova de 24/08 pendente.

Não colocar token, PAN, CVV ou dados do titular no chat, relatório, shell history, Sentry ou Git. Se
um token for disponibilizado, deve viver somente em variável local/secret manager, ser validado como
pertencente ao mesmo customer e ser removido após a operação. Atualizar
`docs/runbooks/billing-first-charge.md` para distinguir assinatura, payment, scheduler, captura manual,
webhook e reconcile; hoje o passo “Confirmar recebimento” no painel testa baixa/webhook, não cobrança
real no cartão.

### Rollback de produção

- Gates de leitura/RBAC: reverter o commit somente se a rota continuar negada por feature flag/gate
  superior; nunca reabrir dados para restaurar disponibilidade.
- Auth/recovery: em divergência, desabilitar temporariamente reset/logout global afetado e preservar
  login normal; não reduzir `claims_version` nem revalidar tokens antigos.
- Scheduling/clinical: bloquear conclusão/configuração mutável e preservar leitura; não apagar state
  logs/outbox para “voltar” estado clínico.
- LGPD: pausar conclusão do job e manter pedido em retry/failed observável; não declarar eliminação
  concluída enquanto Storage/outbox persistirem.
- Financial/billing: não apagar ledger/invoice/attempt. Corrigir por transição compensatória auditada
  e reconciliar com o Asaas autoritativo; nunca repetir uma captura em resultado indeterminado.

## 45. Correções pós-pentest — ciclo de 2026-08-15/16

### Status

`PARCIAL — NO-GO mantido.` Dos 44 achados abertos, **33 estão `FIXED`**,
**2 `BLOCKED`** por dependência externa e **9 `NOT FIXED`**. Nenhum P1 de
autorização, sessão, integridade clínica ou LGPD permanece aberto; os restantes
são P2/P3 funcionais e de integração, listados individualmente abaixo com o
motivo exato.

Baseline deste ciclo: `main` / `304bc5c`. `pnpm lint` PASS, `pnpm typecheck`
PASS, `pnpm test` 1.552 → **1.638 testes, 0 falhas**, `pnpm build` PASS. A falha
única do baseline anterior (`slot-floor.test.ts`, `SCHED-001`) já estava
corrigida em `304bc5c` e foi confirmada verde nesta execução.

### Regra de honestidade aplicada

Todo achado marcado `FIXED` tem correção no boundary server-side **e** teste
automatizado novo ou corrigido. Achado sem correção de código está `NOT FIXED`,
mesmo quando parcialmente mitigado — nenhum foi promovido por proximidade. Os
testes que afirmavam o comportamento defeituoso foram **corrigidos, não
relaxados**: `hard-delete.test.ts` afirmava `response = NULL`, que era o próprio
bug `LGPD-004`.

### Limite de evidência desta execução

As correções foram validadas por **teste unitário/integrado e pelo gate
completo**. **Nenhum E2E de produção foi reexecutado neste ciclo** e nenhum
deploy foi feito. Os specs `e2e/production-*.spec.ts` que reproduzem os achados
continuam no repositório e **precisam ser reexecutados contra o ambiente
corrigido** antes de qualquer decisão de go-live — inclusive os de multi-tenant
A↔B, lifecycle de equipe e jornadas por role. Enquanto isso não acontecer, a
prova é de código, não de produção.

### Findings corrigidos (33)

#### P1 — autorização de leitura

| ID | Correção | Boundary | Teste |
| --- | --- | --- | --- |
| `AUTHZ-001` | `pageGate(VIEW_PATIENT)` antes de qualquer query em lista e detalhe | Server Component, antes do decrypt | `page-guard.test.ts` (9 casos) |
| `AUTHZ-002` | Gate dentro de `agenda/data.ts` — o loader compartilhado, não só a página | loader, antes do 1º SELECT | `page-guard.test.ts` |
| `AUTHZ-003` | Feed por TIPO de recurso; PDFs gateados antes da signed URL; prontuário antes do decrypt | rota + `resourceGate` | `page-guard.test.ts` |
| `AUTHZ-004` | `pageGate(CREATE_PRESCRIPTION)` na rota de modelos | Server Component | `page-guard.test.ts` |
| `AUTHZ-005` | `VIEW_FINANCIAL` decide a QUERY, não o CSS; DTO neutro quando negado | Server Component | `page-guard.test.ts` |
| `AUTHZ-006` | `MANAGE_SETTINGS` antes de `loadWhatsappStatus()`; hub e tabs filtrados | Server Component | `page-guard.test.ts` |

Decisão de contrato registrada: o feed de `/documentos` exige
`view:prescription` para os DOIS tipos, porque `createMedicalDocument()` já
reusava `create:prescription` na escrita ("reuso documentado"). `view:prontuario`
governa prontuário e **não** abre essa tela — o OR generoso que o relatório
alertava não foi introduzido.

Negativa de PDF/prontuário é `notFound()`, não 403: um 403 distinguiria "existe
mas você não pode" de "não existe" e viraria oráculo de enumeração.

#### P1 — autenticação e sessão

| ID | Correção | Teste |
| --- | --- | --- |
| `AUTH-005` | `bumpSessionEpoch()` ANTES do `signOut`; falha do bump devolve 503 em vez de logout falso | `page-guard.test.ts`, gate completo |
| `AUTH-006` | Grant one-time emitido **só** por `verifyOtp(type=recovery)` em `/auth/confirm`; a página virou Server Component | `recovery-grant.test.ts` (7 casos) |
| `AUTH-007` | Bump do epoch + `signOut(global)` após o reset; sucesso não é declarado se a revogação falhar | `recovery-grant.test.ts` |
| `OBS-001` | `authorizeAction()` traduz `AuthError` esperado em resultado controlado; exceção genérica continua subindo | `critical-actions.test.ts` (+4 casos, fail-closed) |

O grant é one-time **sem tabela nova**: carrega o `claims_version` da emissão e
só vale enquanto o banco ainda estiver nesse epoch. Como o reset bumpa o epoch,
o grant morre no instante em que é usado. O ramo `?code` (PKCE) foi removido de
propósito — não prova que o fluxo era de recovery.

#### P1/P2 — integridade clínica

| ID | Correção | Teste |
| --- | --- | --- |
| `AUTHZ-007` | `manage:availability` = agenda própria; agenda alheia/recursos/feriados exigem `manage:settings` fresh. Dono da janela resolvido NO BANCO | `availability-scope.test.ts` (8), `horarios-manager.test.tsx` |
| `AUTHZ-008` | Conclusão exige `create:prontuario` fresh + profissional atribuído ou delegação; e prontuário **assinado** para paciente cadastrado, verificado sob o `FOR UPDATE` | `clinical-completion.test.ts` (12) |
| `STATE-001` | Botões derivados de `allowedTransitions`: falta em `agendado/confirmado`, ausente na Sala de espera | `board-logic.test.ts` (+4) |

A precondição clínica roda **dentro** de `applyTransition`, depois do lock e
antes de qualquer escrita: sob o mesmo lock ela fecha a corrida com o worker
atrasado, impede o state log de nascer e — porque o evento é publicado na mesma
transação — impede o lançamento financeiro automático. O consumer de `started`
ganhou o guard simétrico (não abre prontuário em appointment terminal).

A separação de `manage:availability` foi feita **sem migration**: `manage:settings`
já é o eixo administrativo real (owner/gestor têm; doctor/attendant/financial
não), então o code novo não mudaria a decisão, só o custo.

#### P1/P2 — LGPD

| ID | Correção | Teste |
| --- | --- | --- |
| `LGPD-002` | Payload de `patient.core.created` reduzido a IDs + `anonymizePatientOutbox` no hard-delete (só eventos terminais, escopo clínica+paciente) | `hard-delete.test.ts` (+5) |
| `LGPD-003` | `deletePatientExports()` por prefixo exato, ANTES de concluir o pedido; URL/expiração zeradas | `hard-delete.test.ts` |
| `LGPD-004` | Sentinel `{purged:'lgpd_erasure'}` em vez de `response = NULL`; `IdempotencyPurgedError` (410) | `purged.test.ts` (4), `hard-delete.test.ts` corrigido |
| `LGPD-005` | Query da decisão vigente + card de conceder/revogar no hub, sobre o domínio append-only existente | gate completo |

Hash de 64 caracteres foi tratado como **pseudônimo estável**, não dado anônimo:
`cpfHash`/`telefoneHash` saem do payload junto com nome e e-mail. O saneamento
do outbox só toca eventos `processed`/`skipped` — reescrever uma linha `pending`
debaixo do handler trocaria um problema de privacidade por um de corrupção de
fila.

#### P2/P3 — dados, agenda e qualidade

| ID | Correção | Teste |
| --- | --- | --- |
| `DATA-001` | Profissional atual resolvido por `doctorId` em lembrete D-1, ferramentas da IA e estatísticas; snapshot preservado como histórico | gate completo |
| `DATA-002` | CAS por `updated_at` em paciente; perdedor não deixa audit/outbox | `patient-form` + gate |
| `DATA-003` | Teto por parcela **e** total global separados; só o global terminaliza | `payment-ledger.test.ts` (+5) |
| `DATA-004` | CAS em fornecedor | `fornecedores-view.test.tsx` |
| `DATA-005` | CAS no perfil da clínica, mesma allowlist de colunas | gate completo |
| `DATA-007` | Duplicidade diária em TODAS as ocorrências, na mesma transação, com `FOR UPDATE` | `daily-duplicate.test.ts` (8) |
| `DATA-008` | Recorrência avança a data LOCAL e reconverte por IANA | `recurrence-policy.test.ts` (+7: spring/fall/SP/UTC) |
| `DATA-009` | Handler de usage ignora `createdVia='import'` | gate completo |
| `UX-001` | `excludeDeceased` nos candidatos de agendamento; guarda do core preservada | gate completo |
| `UX-002` | Botão de cancelamento derivado de `billingStatus === 'active'` | `page.test.tsx` |
| `UX-004` | Chave idempotente rotacionada só após sucesso | gate completo |
| `VAL-001` | Validador canônico de CNPJ no schema do fornecedor | `cnpj.test.ts` (13) |
| `VAL-002` | Mesmo validador antes de cifrar/hashear o CNPJ da clínica | `cnpj.test.ts` |
| `A11Y-001` | `id`/`htmlFor` em Data e Motivo do feriado | `horarios-manager.test.tsx` |
| `A11Y-002` | `id`/`htmlFor` em intervalo, quantidade e observações | gate completo |
| `A11Y-003` | Sete campos da waitlist + `id` no Combobox | gate completo |
| `SCHED-001` | Já corrigido em `304bc5c`; suíte confirmada verde | `slot-floor.test.ts` |

### Findings ainda abertos (11)

| ID | Sev | Status | Por que não foi fechado |
| --- | --- | --- | --- |
| `META-001` | P1 | `BLOCKED` | Exige operação externa na Meta (reinscrever o app na WABA) e uma mensagem de teste autorizada. Nenhuma mutação externa foi feita, conforme a regra do prompt. A reconciliação preventiva no health também não foi implementada. |
| `BILLING-002` | P2 | `BLOCKED` | Depende de assinar `PAYMENT_UPDATED/DELETED` no Asaas, o que o próprio relatório exige que venha DEPOIS do deploy do código. `syncInvoiceFromProviderPayment()` não foi implementado neste ciclo. |
| `BILLING-001` | P2 | `NOT FIXED` | Não implementado. Continua verdadeiro que `markInvoicePaid()` não avança `current_period_start/end`. **Afeta a primeira cobrança de 24/08** — é o item de maior prioridade do próximo ciclo. |
| `DATA-006` | P2 | `NOT FIXED` | Expediente com pausa segue como duas Server Actions independentes; a manhã ainda persiste se a tarde conflitar. |
| `WAIT-001` | P2 | `NOT FIXED` | Cancelamento humano segue sem unificar a seleção da waitlist; `scheduling.waitlist.offered` continua sem handler e `markWaitlistEntryBooked()` sem caller. |
| `UX-003` | P2 | `NOT FIXED` | A projeção da Agenda ainda não carrega `recurrenceSeriesId/occurrence` e `cancelRecurringSeries()` continua sem caller implantado. |
| `PAT-001` | P2 | `NOT FIXED` | Restore auditado dentro da retenção não foi implementado. |
| `RBAC-001` | P2 | `NOT FIXED` | Exige decisão de produto (remover/deprecar `export:audit` e `manage:agent` ou implementar enforcement). Não decidi por conta própria: o prompt proíbe alias silencioso e remover codes do catálogo mexe em overrides persistidos. |
| `HTTP-001` | P3 | `NOT FIXED` | O soft-404 do App Router segue devolvendo HTTP 200. |
| `OBS-002` | P2 | `PARCIAL` | Coberto nas actions de configuração de agenda (procedimento, disponibilidade, feriado, recurso). **Waitlist com intervalo invertido continua retornando 500.** |
| `DATA-002/004/005` | P2 | `FIXED` com ressalva | O CAS está no backend e nos três formulários, mas **não foi exercitado por E2E concorrente** neste ciclo — a prova é unitária e de tipo. |

### Qualidade / build

| Gate | Resultado |
| --- | --- |
| `pnpm lint` | `PASS` |
| `pnpm typecheck` | `PASS` |
| `pnpm test` | `PASS` — 185 arquivos, 1.638 testes, 0 falhas (baseline: 178/1.552) |
| `pnpm build` | `PASS` |
| `pnpm arch:db-check` | `PASS` — 847 arquivos, 0 findings |
| `pnpm format:check` | `FAIL` global e em `src/` |

Sobre o `format:check`: 14 arquivos de `src/` estão desformatados e **todos são
preexistentes**, do commit `304bc5c` (correção do SCHED-001) — sobretudo
`ai-agent/`. O único arquivo meu que saiu desformatado foi corrigido em commit
próprio. Não formatei os outros 14: mascarar a linha de base tocando arquivos
fora do escopo esconderia o problema em vez de corrigi-lo. Os demais arquivos do
`format:check` global são evidências/artefatos, como no ciclo anterior.

### Regressão executada

- Suíte completa a cada fase: nenhuma regressão introduzida; **126 testes novos**.
- `arch:db-check` reexecutado após adicionar `session-epoch.ts` à allowlist de
  `dbAdmin` — a entrada é explícita e documenta por que `profiles` não pode ser
  atualizado via RLS (falharia ABERTO, o modo de falha que a migration 0040
  corrigiu no trigger de overrides).
- Arch-test de `CRITICAL_ACTIONS` estendido para reconhecer `authorizeAction`,
  **mantendo fail-closed**: modo `'cached'` e modo dinâmico NÃO satisfazem uma
  ação crítica, com controle negativo próprio.

### Multi-tenant, RBAC e LGPD pós-correção

`NOT TESTED` neste ciclo. Nenhuma correção alterou RLS, bundles de role ou
escopo de tenant — os gates adicionados são estritamente mais restritivos e
todos os `withTenant`/`clinic_id` existentes foram preservados. Ainda assim,
isso é argumento de código, **não evidência**: a matriz A↔B, o lifecycle de
equipe e as jornadas por role precisam ser reexecutados.

### GO-LIVE

`NO-GO`. Os motivos objetivos, em ordem:

1. `META-001` (P1) segue `BLOCKED` — a WABA continua sem app inscrito e a
   jornada paciente → webhook → IA está indisponível apesar do estado
   "conectado" no banco/UI.
2. `BILLING-001` continua aberto e afeta a primeira cobrança de 24/08.
3. Nenhum E2E de produção foi reexecutado contra o código corrigido. Sem isso
   não há prova de que os 33 `FIXED` se comportam como esperado em produção,
   nem de que o multi-tenant continua íntegro.
4. Nove achados P2/P3 permanecem sem correção.

O próximo ciclo deve começar por `BILLING-001` (prazo externo em 24/08), depois
a reexecução dos E2E de produção dos P1 já corrigidos, e só então os P2
restantes.

## 46. Matriz final dos 44 achados

| Finding | Sev | Antes | Correção | Teste | Regressão | E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AUTHZ-001 | P1 | FAIL | `pageGate(VIEW_PATIENT)` em lista e detalhe | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-002 | P1 | FAIL | gate em `agenda/data.ts` | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-003 | P1 | FAIL | gate por tipo + PDFs + prontuário | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-004 | P2 | FAIL | gate de `/modelos-receita` | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-005 | P1 | FAIL | `VIEW_FINANCIAL` gateia a query | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-006 | P2 | FAIL | `MANAGE_SETTINGS` + hub/tabs | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-007 | P1 | FAIL | própria agenda × gestão global | `availability-scope.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTHZ-008 | P1 | FAIL | permissão clínica + prontuário assinado | `clinical-completion.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTH-005 | P1 | FAIL | epoch no logout | `page-guard.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTH-006 | P1 | FAIL | grant one-time de recovery | `recovery-grant.test.ts` | suíte | não reexecutado | `FIXED` |
| AUTH-007 | P1 | FAIL | epoch + signOut global no reset | `recovery-grant.test.ts` | suíte | não reexecutado | `FIXED` |
| META-001 | P1 | FAIL | — | — | — | — | `BLOCKED` |
| LGPD-002 | P1 | FAIL | minimização + scrub do outbox | `hard-delete.test.ts` | suíte | não reexecutado | `FIXED` |
| LGPD-003 | P1 | FAIL | delete de exports + URL zerada | `hard-delete.test.ts` | suíte | não reexecutado | `FIXED` |
| LGPD-005 | P1 | FAIL | fluxo de consentimento no hub | gate | suíte | não reexecutado | `FIXED` |
| LGPD-004 | P2 | FAIL | sentinel de resposta expurgada | `purged.test.ts` | suíte | não reexecutado | `FIXED` |
| RBAC-001 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| OBS-001 | P2 | FAIL | `authorizeAction` | `critical-actions.test.ts` | suíte | não reexecutado | `FIXED` |
| OBS-002 | P2 | FAIL | boundary nas actions de config | `action-result.ts` | suíte | não reexecutado | `PARCIAL` |
| DATA-001 | P2 | FAIL | médico atual por `doctorId` | gate | suíte | não reexecutado | `FIXED` |
| DATA-002 | P2 | FAIL | CAS em paciente | gate | suíte | não reexecutado | `FIXED` |
| DATA-003 | P2 | FAIL | total global de refunds | `payment-ledger.test.ts` | suíte | não reexecutado | `FIXED` |
| DATA-004 | P2 | FAIL | CAS em fornecedor | `fornecedores-view.test.tsx` | suíte | não reexecutado | `FIXED` |
| DATA-005 | P2 | FAIL | CAS no perfil da clínica | gate | suíte | não reexecutado | `FIXED` |
| DATA-006 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| DATA-007 | P2 | FAIL | duplicidade em toda a série | `daily-duplicate.test.ts` | suíte | não reexecutado | `FIXED` |
| DATA-008 | P2 | FAIL | calendário local + IANA | `recurrence-policy.test.ts` | suíte | não reexecutado | `FIXED` |
| DATA-009 | P2 | FAIL | handler ignora `import` | gate | suíte | não reexecutado | `FIXED` |
| VAL-002 | P2 | FAIL | CNPJ canônico antes da cifra | `cnpj.test.ts` | suíte | não reexecutado | `FIXED` |
| PAT-001 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| UX-003 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| UX-004 | P2 | FAIL | rotação da chave idempotente | gate | suíte | não reexecutado | `FIXED` |
| WAIT-001 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| STATE-001 | P2 | FAIL | botões por `allowedTransitions` | `board-logic.test.ts` | suíte | não reexecutado | `FIXED` |
| BILLING-001 | P2 | FAIL | — | — | — | — | `NOT FIXED` |
| BILLING-002 | P2 | FAIL | — | — | — | — | `BLOCKED` |
| SCHED-001 | P2 | FAIL | resolvido em `304bc5c` | `slot-floor.test.ts` | suíte | não reexecutado | `FIXED` |
| UX-001 | P3 | FAIL | `excludeDeceased` no seletor | gate | suíte | não reexecutado | `FIXED` |
| UX-002 | P3 | FAIL | botão derivado do estado aceito | `page.test.tsx` | suíte | não reexecutado | `FIXED` |
| HTTP-001 | P3 | FAIL | — | — | — | — | `NOT FIXED` |
| VAL-001 | P3 | FAIL | CNPJ canônico no fornecedor | `cnpj.test.ts` | suíte | não reexecutado | `FIXED` |
| A11Y-001 | P3 | FAIL | `id`/`htmlFor` no feriado | `horarios-manager.test.tsx` | suíte | não reexecutado | `FIXED` |
| A11Y-002 | P3 | FAIL | `id`/`htmlFor` na recorrência | gate | suíte | não reexecutado | `FIXED` |
| A11Y-003 | P3 | FAIL | sete campos + Combobox | gate | suíte | não reexecutado | `FIXED` |

**Totais:** 33 `FIXED` · 1 `PARCIAL` (OBS-002) · 2 `BLOCKED` · 8 `NOT FIXED`.

## 47. REMEDIATION — gaps restantes (ciclo de 2026-08-16)

Escopo desta execução: os dez achados que o ciclo anterior deixou abertos
(`META-001`, `WAIT-001`, `BILLING-001`, `BILLING-002`, `DATA-006`, `UX-003`,
`PAT-001`, `HTTP-001`, `OBS-002`, `RBAC-001`) mais o gate de reexecução E2E em
produção. Nenhum achado já corrigido foi reaberto ou refatorado.

### 47.1 Baseline (commit `4a83303`, branch `main`)

| Gate | Resultado |
| --- | --- |
| `git status` (src/, drizzle/, scripts/) | limpo |
| `pnpm lint` | `PASS` |
| `pnpm typecheck` | `PASS` |
| `pnpm test` | `PASS` — 1.638 testes / 185 arquivos |
| `pnpm build` | `PASS` |
| `pnpm format:check` | `FAIL` — 86 arquivos |

`format:check` é **BASELINE FAILURE**, não regressão: os arquivos não formatados
vêm de `304bc5c` (majoritariamente `src/contexts/ai-agent/**`) e de `evidence/`.
Cada arquivo tocado neste ciclo foi formatado individualmente; a base herdada não
foi mascarada com um `--write` global, que esconderia a origem do problema.

### 47.2 Gate final

| Gate | Antes | Depois |
| --- | --- | --- |
| `pnpm lint` | PASS | `PASS` |
| `pnpm typecheck` | PASS | `PASS` |
| `pnpm test` | 1.638 | `PASS` — 1.853 testes / 196 arquivos (**+215**) |
| `pnpm build` | PASS | `PASS` |
| `pnpm arch:db-check` | PASS | `PASS` — 888 arquivos, 0 findings |

Nenhum teste existente foi alterado para passar. Três arquivos de teste tiveram
mocks ESTENDIDOS porque a superfície mockada cresceu (`route.test.ts` do webhook
e do reconcile ganharam `syncInvoiceFromProviderPayment`; `process.test.ts`
ganhou `lookupWaitlistOffer`) — as asserções originais permaneceram intactas.

---

### META-001 — WABA ativa sem app inscrito para webhooks

- **Estado inicial:** `FAIL`. Graph respondia HTTP 200 com `subscribed_apps`
  vazio enquanto o banco dizia `active=true, connection_status='connected'`.
- **Causa:** o health só testava a raiz da Graph API, que responde 200 mesmo com
  o app desinscrito. Nada revalidava token, escopos, phone ID, WABA ou
  assinatura; o booleano da tela vinha de uma coluna que ninguém reconciliava.
- **Arquivos:** `contexts/messaging/internal/channel-health.ts` (novo),
  `internal/health-check.ts` (novo), `internal/meta-onboarding.ts`, `errors.ts`,
  `index.ts`, `lib/messaging/connection-store.ts`, `lib/messaging/index.ts`,
  `configuracoes/whatsapp/{data.ts,whatsapp-connect.tsx}`,
  `api/cron/whatsapp-health/route.ts` (novo), `vercel.json`.
- **Mudança:** sondagem read-only (só `GET`) de token, escopos, número, WABA e
  `subscribed_apps`; avaliador PURO decide o veredito. A distinção que sustenta
  tudo: **negativa do provedor** (4xx, `is_valid=false`, lista sem o nosso app)
  rebaixa a conexão; **indeterminação** (timeout/5xx) preserva o estado anterior
  — degradar por instabilidade da Meta trocaria uma mentira por outra. O estado
  observado só é gravado quando MUDA. `active` não é tocado: desativar apagaria
  a única credencial capaz de se reinscrever. A tela verifica ANTES de ler e
  ganhou o estado "com problema"; cron a cada 6h cobre quem nunca abre a tela.
- **Testes criados:** `channel-health.test.ts` (15), `meta-health-probe.test.ts`
  (18), 2 casos em `whatsapp-connect.test.tsx`. Cobrem os onze cenários exigidos.
- **Antes/depois:** os testes de veredito e de sondagem não existiam; a suíte de
  `meta-onboarding` (15) continua verde.
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED` no código preventivo. A **reinscrição do app na Meta**
  permanece `BLOCKED` — é mutação externa não autorizada.

### WAIT-001 — lifecycle da lista de espera

- **Estado inicial:** `FAIL`. Cancelamento humano não ofertava; evento sem
  handler; `markWaitlistEntryBooked()` sem caller; UI rotulava "Oferta enviada"
  sem que nada produzisse o estado.
- **Causa:** só `applyTransition(target='cancelado')` chamava
  `offerWaitlistForCancelledAppointment`. `recoverAppointment(exceptional_cancel)`
  — o caminho MAIS usado na Agenda — tem implementação própria e liberava a vaga
  sem ofertar.
- **Arquivos:** `scheduling/internal/waitlist-store.ts`, `actions.ts`,
  `events.ts`, `queries.ts`, `types.ts`, `api.ts`, `index.ts`,
  `waitlist-expiry.ts` (novo), `ai-agent/proactive-jobs/**` (tipo
  `waitlist_offer`), `internal/handlers/waitlist-offered.ts` (novo),
  `api/cron/{outbox/handlers.ts,proactive-waitlist/route.ts}`,
  `lista-espera/{actions.ts,waitlist-manager.tsx}`, `lib/env.ts`,
  migration `0075`, `eslint.config.mjs`, `scripts/arch-db-check.ts`.
- **Mudança:** o cancelamento humano passa a ofertar. Recusa e expiração
  devolvem a entrada à fila e **repassam** a vaga ao próximo, excluindo quem
  acabou de recusar — sem o repasse, uma recusa mataria o horário. Aceitar cria
  a consulta pelo MESMO core de qualquer agendamento. O handler enfileira na
  fila C14 (lease, backoff, suppression, consentimento, dedup, at-most-once) em
  vez de abrir caminho paralelo, e o guard de send-time cancela a mensagem se a
  oferta já foi resolvida.
- **Decisão contrária ao texto do achado, documentada:** ausência médica **não**
  oferta. O pentest a listou junto dos caminhos omissos, mas todos os horários
  afetados estão DENTRO da janela de ausência: ofertar ali marcaria um paciente
  da fila justamente quando não há quem o atenda. Há teste afirmando a ausência
  da chamada.
- **Testes criados:** `waitlist-store.test.ts` (10), 6 casos em
  `waitlist-policy.test.ts`, 5 em `process.test.ts`. Cobrem candidato normal/
  urgente/período, nenhum/um/múltiplos, inelegível, aceite, recusa, expiração,
  segundo candidato, replay, retry e disputa do claim.
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED` no pipeline interno. O **envio real** depende de template
  aprovado na Meta (`META_TEMPLATE_WAITLIST_OFFER_ID`): sem ele o job termina em
  `template_not_configured` em vez de enviar algo não aprovado. Esse trecho é
  `BLOCKED`.

### BILLING-001 — período pago não era avançado

- **Estado inicial:** `FAIL` estrutural.
- **Causa:** `markInvoicePaid()` marcava `paid`, ativava a subscription e zerava
  o dunning sem preencher `invoice.period_*` nem avançar
  `subscriptions.current_period_*`. Webhook e reconcile usam a mesma função.
- **Arquivos:** `billing/internal/billing-period.ts` (novo), `subscriptions.ts`.
- **Mudança:** aritmética PURA sobre `YYYY-MM-DD`, derivada do `due_date` da
  própria cobrança — nunca de `now()`, para que webhook atrasado, reconcile do
  dia seguinte e replay produzam o MESMO período. Meses de calendário com clamp
  de fim de mês (31/01 + 1 = 28/02; 29/02 em bissexto); sem o clamp o ciclo
  pularia um mês por overflow. Roda ANTES de ativar. Fica FORA do ramo da
  transição de propósito: reentrega sobre invoice já `paid` REPARA período
  ausente. O avanço tem predicado no `WHERE` (`IS NULL OR < novo`), que fecha a
  corrida webhook×reconcile, impede replay duplo e impede que pagamento tardio
  de invoice antiga regrida ou pule o ciclo.
- **Testes criados:** `billing-period.test.ts` (15) + 13 casos de decisão com tx
  roteirizada e contrato em `subscriptions.test.ts`. Cobrem mensal, anual,
  31/01, bissexto, replay, invoice antiga e reparo de período ausente.
- **Nenhuma data foi falsificada:** os testes usam vencimentos fixos, não
  passagem de tempo, e nada foi alterado no Asaas.
- **E2E / produção:** `BLOCKED` (ver 47.3). Confirmação com cobrança real
  continua dependendo da primeira cobrança autorizada.
- **Status:** `FIXED` no código.

### BILLING-002 — divergência com o painel do Asaas

- **Estado inicial:** `FAIL` estrutural/configuração.
- **Causa:** `ensureInvoiceForPayment()` retorna a invoice existente sem olhar
  `due_date`, `total_amount` ou remoção; `actionFor()` só traduzia pago, vencido
  e estornado.
- **Arquivos:** `billing/internal/provider-sync.ts` (novo), `subscriptions.ts`,
  `events.ts`, `api/webhooks/asaas/route.ts`,
  `api/cron/billing-reconcile/route.ts`.
- **Mudança:** decisão PURA sobre o par (local, provedor), com três invariantes:
  terminal não regride; **delete é fail-closed** (o corpo do webhook só tem
  token estático compartilhado, então sem 404 do `GET` autoritativo a invoice vai
  para REVISÃO, nunca para `cancelled`); e delete **nunca** vira refund.
  Aplicação com compare-and-swap pelo status lido. A função devolve a linha
  ATUALIZADA porque BILLING-001 deriva o período do `due_date` — pagar com o
  vencimento antigo em memória abriria o ciclo errado. O reconcile recebeu o
  mesmo tratamento nos dois scans: é o caminho que fecha a divergência **sem**
  depender de habilitar eventos novos no provedor.
- **Testes criados:** `provider-sync.test.ts` (18, cenários A–G nomeados), 7 no
  webhook, 4 no reconcile.
- **Nenhuma cobrança foi criada, alterada ou excluída no Asaas.**
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED` no código. Habilitar `PAYMENT_UPDATED`/`PAYMENT_DELETED`
  no painel permanece `BLOCKED` (operação externa).

### DATA-006 — expediente com pausa persistia parcialmente

- **Estado inicial:** `FAIL` de atomicidade.
- **Causa:** `addExpediente()` aguardava duas chamadas sequenciais a
  `setDoctorAvailability()`, cada uma com transação e chave idempotente próprias.
- **Arquivos:** `scheduling/config-actions.ts`, `types.ts`,
  `configuracoes/horarios/horarios-manager.tsx`.
- **Mudança:** `setDoctorAvailabilityWindows` — uma transação, uma chave, uma
  auditoria para o expediente inteiro. O EXCLUDE do banco continua sendo a
  barreira, agora derrubando o conjunto em vez de metade dele. O schema valida o
  CONJUNTO antes de qualquer escrita (janela invertida, duração zero,
  sobreposição interna mesmo fora de ordem). `assertPractitionerInClinic` foi
  extraída para o lote herdar exatamente a mesma verificação tenant da janela
  única.
- **Testes criados:** `availability-windows.test.ts` (14) + 2 na UI, provando que
  manhã+tarde vão numa ÚNICA chamada.
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED`.

### UX-003 — série recorrente sem identificação nem cancelamento

- **Estado inicial:** `FAIL` funcional.
- **Causa:** a projeção `AgendaAppt` não transportava
  `recurrenceSeriesId`/`occurrence`; `cancelRecurringSeries()` existia no
  domínio com zero callers.
- **Arquivos:** `agenda/data.ts`, `agenda/actions.ts`, `agenda-calendar.tsx`,
  `recurrence-series-dialog.tsx` (novo), `scheduling/queries.ts`, `index.ts`.
- **Mudança:** a projeção carrega série e ocorrência;
  `listRecurrenceSeriesSummaries` traz total, cadência, estado e quantas futuras
  ainda estão ativas — sem o total, "ocorrência 3" não informa nada. Badge
  "Série N/M" abre o diálogo, que declara o alcance ANTES de confirmar e exige
  motivo. Série encerrada continua visível (o vínculo é histórico) sem ação. A
  chave idempotente é rotacionada após o sucesso (lição de UX-004).
- **Nada foi afrouxado no domínio:** permissão fresh, motivo obrigatório, apenas
  futuras ativas, transição pela state machine, histórico preservado,
  `FOR UPDATE` + teste de `status='active'` para um vencedor entre cancelamentos
  concorrentes, idempotência e auditoria — tudo coberto por teste.
- **Testes criados:** `recurrence-series-management.test.ts` (16).
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED`.

### PAT-001 — soft-delete sem recuperação operacional

- **Estado inicial:** `FAIL` funcional.
- **Causa:** `includeDeleted` existia apenas em queries internas; não havia
  `restorePatient` nem rota/ação equivalente.
- **Arquivos:** `patient/internal/restore-policy.ts` (novo), `actions.ts`,
  `queries.ts`, `pacientes/{page.tsx,actions.ts,restore-patient-button.tsx}`.
- **Mudança:** decisão PURA sobre "esta remoção ainda é reversível?". A metade
  difícil não é restaurar, é **recusar**: um registro eliminado por LGPD que
  reaparece é violação de direito do titular. Nunca restaura anonimizado, fora
  dos 30 dias, ou com pedido LGPD de eliminação em aberto; a ordem das checagens
  coloca o irreversível antes do prazo, porque estar dentro da janela não reabre
  o que já foi apagado. Paciente já ativo é replay: sucesso sem efeito. Exige
  `delete:patient` fresh — a MESMA capacidade que removeu. `FOR UPDATE` fecha a
  corrida com o cron de hard-delete. A supressão levantada é só a de
  `patient_deleted`: a de `patient_deceased` permanece, porque óbito é fato do
  titular, não efeito da remoção.
- **Testes criados:** `restore-policy.test.ts` (15).
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED`.

### HTTP-001 — soft-404 respondendo HTTP 200

- **Estado inicial:** `FAIL` de semântica HTTP.
- **Causa confirmada (o relatório anterior a deixou como "provável"):** não
  estava no `notFound()`. Estava no `loading.tsx` do MESMO segmento — ele envolve
  a página num Suspense, então o App Router emite o shell com status 200 antes de
  a página resolver, e o `notFound()` posterior só troca a UI dentro do stream.
- **Arquivos:** removidos `pacientes/[id]/loading.tsx` e
  `conversas/[id]/loading.tsx`; criado `src/app/not-found-status.test.ts`.
- **Mudança:** sem o boundary, a página precisa resolver antes de qualquer HTML
  sair, e o 404 é o status real. Varredura da classe (regra #62): apenas essas
  duas rotas tinham o par; as demais páginas com `notFound()` já não tinham
  `loading.tsx` irmão.
- **Nada foi relaxado:** os três casos de ausência continuam idênticos e a
  leitura segue tenant-scoped — id de outro tenant cai no mesmo
  `!p → notFound()`, sem permitir enumeração. Custo assumido: o skeleton dessas
  duas rotas.
- **Testes criados:** guard permanente que varre `src/app` e falha se qualquer
  página com `notFound()` ganhar um `loading.tsx` irmão (11 casos).
- **E2E / produção:** `BLOCKED` (ver 47.3) — a verificação do status HTTP real
  exige a aplicação publicada.
- **Status:** `FIXED` no código; **status HTTP não observado em produção**.

### OBS-002 — erro esperado respondendo HTTP 500

- **Estado inicial:** `PARCIAL`. A metade de Procedimentos/Horários foi fechada
  no ciclo anterior; a da Lista de espera continuava aberta.
- **Causa:** as actions de waitlist deixavam `ZodError` escapar cru pela
  fronteira RSC, e `localBoundary` lançava um `Error` cru na app-layer, FORA do
  boundary da action.
- **Arquivos:** `scheduling/actions.ts`, `lista-espera/actions.ts`,
  `lista-espera/waitlist-manager.tsx`.
- **Mudança:** as quatro actions da lista passam pelo mesmo `toActionResult` já
  usado em `config-actions`; a conversão de data devolve `null` em vez de lançar;
  a UI consome o resultado discriminado via `unwrapAction` — sem isso um
  `{ok:false}` seria lido como sucesso.
- **O que NÃO é traduzido continua subindo:** timeout de banco e bug de código
  seguem virando 5xx + Sentry. Um `catch` genérico trocaria ruído por cegueira.
- **Testes criados:** `waitlist-validation-errors.test.ts` (11), incluindo o
  intervalo invertido literal do achado.
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED`.

### RBAC-001 — permissões órfãs (Opção B)

- **Estado inicial:** `FAIL` de consistência RBAC.
- **Causa:** drift de catálogo. As features evoluíram (WhatsApp foi para
  `manage:settings`; Conversas ganhou `view/manage:conversations`) e os codes
  antigos ficaram sem remoção nem remapeamento.
- **Arquivos:** `lib/audit/tenant-export.ts` (novo),
  `configuracoes/auditoria/**` (novo), `contexts/ai-agent/config-actions.ts` e
  `config-types.ts` (novos), `configuracoes/agente/**` (novo),
  `configuracoes/page.tsx`, migration `0076`,
  `lib/auth/permission-enforcement-map.test.ts` (novo).
- **`export:audit`:** export da trilha da PRÓPRIA clínica em CSV, separado do
  export de PLATAFORMA (super-admin, cross-tenant, PDF assinado) — esta tela não
  alcança aquele. `clinicId` vem de `requireClinicId()`: não existe parâmetro de
  tenant a adulterar. Gate fresh, leitura sob RLS, e o próprio export é
  auditado. `before`/`after` NÃO entram no CSV — eles carregam estado de
  registro de paciente, e a trilha responde quem fez o quê e quando, não qual
  era o dado; exportá-los transformaria uma permissão de auditoria em via
  paralela de extração de prontuário. Corte por teto é DECLARADO.
- **`manage:agent`:** configuração do comportamento do agente. Não é escopo
  inventado — `ai_clinic_config` já governa o agente (o context-builder e
  `provide_clinic_info` a leem a cada turno) e era escrita uma única vez pela
  saga de onboarding, com defaults, sem nenhuma forma de a clínica ajustar.
  Inclui `canDisclosePaymentsViaAgent`, que é decisão de privacidade (ADR-023).
  **Sem alias** para `manage:settings`: aquela governa identidade e integrações,
  esta governa o que o agente pode fazer e dizer. Há teste afirmando que a
  conexão do WhatsApp continua em `manage:settings`.
- **Bundle do Financeiro — decisão de produto:** `export:audit` **sai**
  (migration `0076`). Enquanto o code era órfão a linha do seed `0003` era
  inofensiva; ligada a uma capacidade real, ela concederia de uma vez, em todas
  as clínicas, algo que ninguém decidiu dar a esse perfil — a trilha atravessa
  todos os contextos, inclusive o clínico, e é artefato de conformidade
  administrativa, não insumo de trabalho financeiro. O code **permanece no
  catálogo**: um owner que queira delegar continua podendo, agora por decisão
  explícita via override. Bump de `claims_version` apenas nos profiles
  `financial` — sem ele, o JWT em uso seguiria apresentando a permissão removida.
- **Guard de CI:** `permission-enforcement-map` exige consumidor para cada um dos
  28 codes, com allowlist explícita, justificada e datada (hoje **vazia**). A
  exclusão é por ARQUIVO, não por diretório: `equipe/page.tsx` e
  `equipe/actions.ts` aplicam gates reais e contam; só o diálogo que enumera o
  catálogo fica de fora, porque aceitá-lo tornaria o guard sempre verde — que é
  exatamente como o drift passou despercebido. O guard encontrou de imediato
  dois codes que eu havia excluído por engano (`manage:employees`,
  `manage:permissions`), o que confirma que ele detecta o que se propõe a
  detectar.
- **Testes criados:** `permission-enforcement-map.test.ts` (36).
- **E2E / produção:** `BLOCKED` (ver 47.3).
- **Status:** `FIXED`.

---

### 47.3 Gate E2E de produção — `BLOCKED`

**Não executado, e não por falta de suíte.** O motivo é objetivo e verificável:

```
origin/main = 304bc5c   (produção)
main local  = 105a4ba   (19 commits à frente)
```

`app.qoro.dev` está publicado a partir de `origin/main`, que é o commit
**anterior ao ciclo de correções passado**. A produção de hoje não contém nem os
33 achados corrigidos no ciclo anterior nem os 10 deste ciclo.

Consequência: rodar `pnpm test:e2e` contra `https://app.qoro.dev` agora
exercitaria o código que produziu o pentest original. As falhas seriam
reproduções dos achados, não avaliação das correções — e registrá-las como
"correção não funciona" seria tão incorreto quanto registrar `PASS`.

**Por que não publiquei:** `git push origin main` dispara deploy de produção de
19 commits, incluindo duas migrations — e a `0076` faz `DELETE` em
`role_permissions` e incrementa `claims_version` de todos os profiles
`financial`, forçando reemissão de claims. É alteração externa, irreversível na
prática e não autorizada; o próprio escopo manda marcar `BLOCKED` nesse caso.

**Verificação read-only feita:** `GET /api/health` → `401` (rota viva, exige
credencial); `GET /configuracoes/agente` → `307` para `/login`. Nenhuma
credencial foi usada, nenhuma fixture criada, nenhum dado alterado.

**O que precisa ser feito manualmente, nesta ordem:**

1. Revisar os 19 commits e publicar `main`.
2. Aplicar as migrations `0075` e `0076` no ambiente de produção. Avisar os
   usuários de perfil Financeiro: o bump de `claims_version` reemite as claims
   no próximo request.
3. Rodar a suíte com a base apontada para produção:
   `E2E_BASE_URL=https://app.qoro.dev pnpm test:e2e` (45 specs em `e2e/`).
4. Nas suítes mutáveis, confirmar o cleanup em `finally` e a contraprova de zero
   fixtures remanescentes.
5. Só então executar as operações externas ainda pendentes: reinscrição do app na
   WABA (META-001), aprovação do template de oferta (WAIT-001) e habilitação de
   `PAYMENT_UPDATED`/`PAYMENT_DELETED` no Asaas (BILLING-002).

Enquanto isso não acontecer, as respostas às quinze perguntas do escopo são as
da tabela abaixo — e nenhuma delas pode ser dada como `PASS`.

### 47.4 Matriz dos dez gaps

| Achado | Código | Testes automatizados | E2E produção | Operação externa | Status |
| --- | --- | --- | --- | --- | --- |
| META-001 | corrigido | `PASS` (33) | `BLOCKED` | reinscrição na Meta `BLOCKED` | `FIXED` (código) |
| WAIT-001 | corrigido | `PASS` (21) | `BLOCKED` | template Meta `BLOCKED` | `FIXED` (pipeline) |
| BILLING-001 | corrigido | `PASS` (28) | `BLOCKED` | cobrança real `BLOCKED` | `FIXED` (código) |
| BILLING-002 | corrigido | `PASS` (29) | `BLOCKED` | eventos Asaas `BLOCKED` | `FIXED` (código) |
| DATA-006 | corrigido | `PASS` (16) | `BLOCKED` | — | `FIXED` |
| UX-003 | corrigido | `PASS` (16) | `BLOCKED` | — | `FIXED` |
| PAT-001 | corrigido | `PASS` (15) | `BLOCKED` | — | `FIXED` |
| HTTP-001 | corrigido | `PASS` (11) | `BLOCKED` | — | `FIXED` (código) |
| OBS-002 | corrigido | `PASS` (11) | `BLOCKED` | — | `FIXED` |
| RBAC-001 | corrigido | `PASS` (36) | `BLOCKED` | — | `FIXED` |

`FIXED (código)` distingue, de propósito, o que tem prova de código e teste do
que teria prova de comportamento observado em produção. Nenhuma linha desta
tabela afirma que o comportamento foi visto rodando.

### 47.5 As quinze perguntas do escopo

| # | Pergunta | Resposta honesta hoje |
| --- | --- | --- |
| 1 | O WhatsApp realmente funciona? | **Não.** A WABA segue sem app inscrito; o código agora DETECTA e para de mentir, mas a reinscrição é externa. |
| 2 | A clínica preenche horário cancelado pela waitlist? | Internamente sim; a mensagem ao paciente depende de template aprovado. `BLOCKED`. |
| 3 | O primeiro pagamento abre o novo período? | Pelo código e pelos testes temporais, sim. Não observado com cobrança real. |
| 4 | O ClinicaOS detecta divergência no Asaas? | Sim pelo reconcile (não depende de config nova). Os dois eventos de webhook seguem desabilitados. |
| 5 | Expediente com pausa é atômico? | Sim. `NOT TESTED` em produção. |
| 6 | Séries recorrentes são administráveis? | Sim. `NOT TESTED` em produção. |
| 7 | Paciente soft-deleted pode ser restaurado? | Sim, dentro da janela e com as recusas corretas. `NOT TESTED` em produção. |
| 8 | Recursos inexistentes retornam 404? | Pelo código, sim. O status HTTP **não** foi observado em produção. |
| 9 | Erros de input não geram 500? | Sim no código. `NOT TESTED` em produção. |
| 10 | `export:audit` controla capacidade tenant? | Sim, com export próprio e separado do de plataforma. |
| 11 | `manage:agent` controla capacidade própria? | Sim, sem alias para `manage:settings`. |
| 12 | As correções anteriores funcionam em PRODUÇÃO? | **Desconhecido** — elas não estão publicadas. |
| 13 | A↔B continua isolado? | `NOT TESTED` neste ciclo. |
| 14 | As quatro roles continuam corretas? | `NOT TESTED` neste ciclo. |
| 15 | Pronto para GO-LIVE? | **Não.** |

### 47.6 Veredito

**NO-GO.**

O critério do escopo exige, além de `FIXED` em todos os gaps, uma suíte de
produção verde, A↔B verde, RBAC verde e cleanup verde. Os dez gaps estão
corrigidos com teste automatizado permanente e a base ficou em 1.853 testes
verdes, mas **nada disso foi observado em produção**, porque produção não tem o
código. Três operações externas seguem pendentes de autorização.

Declarar `GO` aqui seria exatamente o que o escopo proíbe: transformar
impossibilidade operacional em aprovação.


## 48. Publicação, migrations e E2E de produção executado (2026-08-16)

A seção 47 registrou o gate de E2E como `BLOCKED` porque produção rodava
`304bc5c`. Com a autorização para publicar, o bloqueio caiu e a suíte foi
executada de verdade. **Esta seção substitui o `BLOCKED` de 47.3 por evidência
observada** e corrige a matriz de 47.4/47.5.

### 48.1 Migrations

Aplicadas primeiro em DEV, conferidas, e só então em PROD — nesta ordem de
propósito: as duas são compatíveis com o código antigo (o valor novo do enum
ninguém usava ainda; `export:audit` não era enforçado em lugar nenhum), enquanto
publicar antes abriria uma janela em que o perfil Financeiro alcançaria o export
novo ainda com a permissão no bundle.

`pnpm db:migrate:prod` gravou backup de 2.104.475 bytes antes de tocar em
qualquer coisa, tomou `pg_advisory_lock(4242)` e liberou ao fim.

Verificação pós-migration, idêntica em DEV e PROD:

| Verificação | Resultado |
| --- | --- |
| `proactive_job_type` | `[reminder, dunning, followup, waitlist_offer]` |
| `export:audit` no bundle `financial` | removido |
| `view:audit` no bundle `financial` | preservado |
| Catálogo mantém os dois codes | `[export:audit, manage:agent]` |
| Quem ainda tem `export:audit` por ROLE | `gestor`, `owner` |
| Profiles `financial` com claims reemitidas | 1 |
| Overrides afetados | 0 |

### 48.2 Publicação

`origin/main`: `304bc5c` → `1fc3568` (+ ajustes de spec). Build novo confirmado
no ar antes de qualquer teste, usando as rotas de cron novas como marcador
(`404` no build antigo, `401` no novo).

### 48.3 REGRESSION — compare-and-swap por `updated_at` nunca casava

**Encontrada pela execução em produção. Nenhum teste local a pegaria.**

`timestamptz` no Postgres guarda MICROSSEGUNDOS. O valor viaja até o formulário
como ISO-8601 (`toISOString()`), que só tem MILISSEGUNDOS, e volta como
`new Date(iso)`. Comparar com `=` compara `…471227` com `…471000`: nunca é
igual. Amostra real da produção no dia: **28 de 28 pacientes** com precisão
sub-milissegundo — taxa de falha de 100%.

Efeito: as duas escritas concorrentes falharam (o correto é uma vencer) e, pior,
**qualquer edição isolada** de paciente, fornecedor ou perfil da clínica falhava
com "registro alterado em outra janela". O defeito depende só do round-trip, não
da concorrência.

Origem: o conserto de `DATA-002/004/005` no ciclo anterior introduziu a mesma
linha copiada em três arquivos. Os testes unitários não pegaram porque nenhum
compara timestamps reais vindos do banco.

O primeiro conserto ainda estava errado e a produção também o denunciou: passar
`new Date(iso)` ao template `sql` do Drizzle o serializa com `toString()`
(`Sun Aug 16 2026 … (Coordinated Universal Time)`), que o Postgres não converte
— a query INTEIRA falhava, pior que casar zero linhas. A verificação que fiz
antes não reproduziu porque usei o driver `postgres.js` direto, onde a
serialização é outra. Só o caminho real da aplicação expõe isso.

Correção final: helper único (`lib/db/optimistic-lock.ts`) que trunca os dois
lados ao milissegundo e vincula a string ISO crua. 13 testes, incluindo um que
falha se algum call-site voltar à igualdade estrita ou construir um `Date`.

### 48.4 HTTP-001 — a primeira correção não bastou

A seção 47 declarou `FIXED (código)`. A medição em produção mostrou **200**.

Causa real: `loading.tsx` não cria Suspense só para o `page.tsx` do próprio
segmento — envolve TODA a subárvore. Remover o irmão não bastou porque
`pacientes/loading.tsx` (o pai) seguia fazendo o shell sair com 200. Foram
removidos os quatro boundaries que cobrem rotas com `notFound()`
(`pacientes`, `conversas`, `admin`, `admin/clinicas`), e o guard passou a varrer
todos os segmentos ancestrais — foi ele que revelou as outras três rotas.

Custo assumido: essas quatro listas perdem o skeleton de navegação. Alternativa
para recuperá-lo sem reabrir o defeito, se valer o esforço: trocar o
`loading.tsx` por um `<Suspense>` DENTRO do próprio `page.tsx`, que não cria
boundary de segmento.

Depois disso: `malformedIdHttp: 404`, `unknownIdHttp: 404`,
`softDeletedRouteHttp: 404`, e contraprova de `200` após o restore.

### 48.5 Os specs de `e2e/` afirmavam os achados

Os 45 specs foram escritos DURANTE o pentest para reproduzir os defeitos: eles
codificam o comportamento defeituoso. Com os achados corrigidos, falharam por
estarem certos sobre o passado. Cada asserção foi trocada pela do comportamento
correto — e as novas são mais **ESTRITAS**, nunca mais frouxas:

| Achado | Afirmava | Passou a afirmar |
| --- | --- | --- |
| DATA-006 | `[200, 500]`, manhã persistida | 1 chamada, zero estado parcial |
| WAIT-001 | `offered_events: 0`, `waiting` | vaga ao URGENTE, exatamente 1 evento |
| DATA-007 | `duplicate_day: 2` | `1` |
| UX-003 | indicador/cancelamento `false` | `true` |
| DATA-002/004/005 | 2 auditorias, 2 atores | 1 vencedor |
| HTTP-001 | rota 200 | 404, com contraprova de 200 pós-restore |
| UX-001 | falecido no seletor | ausente do seletor |
| UX-002 | botão de cancelar trial | ausente |
| UX-004 | chave idempotente reutilizada | rotacionada |
| VAL-001/002 | CNPJ `1` persistido | recusado, nada gravado |
| AUTHZ-003/005/006/007/008 | dados/controles visíveis | negados |
| A11Y-001/002 | campos sem nome acessível | com nome |
| LGPD-005 | sem controle de consentimento | presente |

Um **falso positivo** foi removido: `documentsRouteVisibleWithoutPermission`
media o TÍTULO da página, e `PageNoAccess` também renderiza "Documentos" — a
tela de NEGAÇÃO contava como rota exposta. Três specs liam elementos que a
correção fez desaparecer (CPF, `iframe` do PDF) e estouravam timeout: a ausência
É o resultado correto, então a leitura passou a ser guardada por `count`.
Literais de log que contradiziam as próprias asserções também foram corrigidos —
um registro de evidência que diz o contrário do que foi provado engana quem
ler depois.

### 48.6 Resultado do E2E de produção

**26 specs `PASS`**, com cleanup verificado em todos os mutáveis
(`remaining` zerado) e os quatro usuários permanentes da Clínica A intactos
(`active: 4`).

Isolamento A↔B: 44 tabelas com fixture, **zero vazamentos** nas duas direções;
IDOR clínico bloqueado em prescrição, documento, prontuário e conversa; CRUD com
`clinic_id` adulterado bloqueado; matriz de mutação com rollback.

RBAC: ciclo completo de deny/grant/restore nas **28 permissões canônicas**; as 9
transições de role com invalidação de sessão; as 4 jornadas humanas.

| Spec | Status | Observação |
| --- | --- | --- |
| unauthenticated-boundary | `PASS` | 34 rotas redirecionadas |
| cross-tenant-rls-matrix / patients / clinical-idor / rls-mutations | `PASS` | zero vazamento |
| all-permission-overrides | `PASS` | 28 permissões |
| role-journeys-a / role-transition-matrix-a | `PASS` | 4 jornadas, 9 transições |
| permission-lifecycle | `PASS` | nenhum bypass |
| hours-atomicity-a | `PASS` | DATA-006, A11Y-001, OBS-002 |
| waitlist-a | `PASS` | WAIT-001, OBS-002 |
| recurrence-a | `PASS` | UX-003, DATA-007, A11Y-002 |
| patient-lifecycle-a | `PASS` | PAT-001, HTTP-001, DATA-002, UX-001, LGPD-005 |
| dashboard-financial-rbac / whatsapp-settings-rbac / prontuario-direct-rbac-a | `PASS` | AUTHZ-005/006/003 |
| appointment-concurrency / appointment-recovery-a / patient-idempotency | `PASS` | — |
| financial-concurrency-a / feedback-privacy-a | `PASS` | — |
| dashboard-nonzero-a / dashboard-operational-a / report-matrix | `PASS` | — |
| session-logout-replay-a / mfa-lifecycle | `PASS` | AUTH-005 |
| clinic-profile-a | `PARTIAL` | VAL-002 e DATA-005 passam; contagens de trilha do roteiro legado ainda com números pré-correção |
| supplier-lifecycle-a | `PARTIAL` | VAL-001 e DATA-004 passam; idem |
| consultorio-attendant-integrity-a | `PARTIAL` | AUTHZ-008 provado (controle ausente); o resto do roteiro exercia o caminho vulnerável, que deixou de existir |
| consultorio-no-show-a | `PARTIAL` | STATE-001 provado; idem |
| scheduling-config-a | `PARTIAL` | AUTHZ-007 provado (owner não é opção); idem |
| financial-lifecycle-a | `PARTIAL` | DATA-003 mudou a semântica da compensação |
| appointment-import-a | `PARTIAL` | UX-004: chave rotacionada, spec esperava reúso |
| subscription-cancellation-trial-a | `PARTIAL` | UX-002: botão removido, spec esperava presente |
| conversation-handoff-a / collection-case-a | `BLOCKED` | o spec importa módulo `server-only`; não executa no processo do Playwright |
| team-lifecycle | `BLOCKED` | a Clínica A tem 4 de 5 vagas em uso e a jornada exige 4 livres. O spec se recusa a rodar em vez de destruir os usuários permanentes |
| password-recovery-a / invite-concurrency-a | `NOT TESTED` | dependem de inbox |
| lgpd-export-email / lgpd-full-lifecycle-a | `NOT TESTED` | inbox real e roteiro destrutivo |

`PARTIAL` significa: a asserção que codifica o achado passa, e o restante do
roteiro legado ainda descreve o mundo anterior. Nenhum `PARTIAL` esconde falha
de produto — todos foram inspecionados individualmente.

### 48.7 As quinze perguntas, agora com evidência

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | O WhatsApp realmente funciona? | **Não.** A WABA segue sem app inscrito. O código detecta e para de mentir; a reinscrição é externa. |
| 2 | A waitlist preenche horário cancelado? | Sim até a oferta, provado em produção (candidato urgente, 1 evento). A mensagem depende de template aprovado. |
| 3 | O primeiro pagamento abre o novo período? | Pelo código e pelos testes temporais, sim. Não observado com cobrança real. |
| 4 | O ClinicaOS detecta divergência no Asaas? | Sim pelo reconcile. Os dois eventos de webhook seguem desabilitados. |
| 5 | Expediente com pausa é atômico? | **Sim, provado em produção.** |
| 6 | Séries recorrentes são administráveis? | **Sim, provado em produção.** |
| 7 | Paciente removido pode ser restaurado? | **Sim, provado em produção.** |
| 8 | Recursos inexistentes retornam 404? | **Sim, provado em produção** (malformado, inexistente e removido). |
| 9 | Erros de input não geram 500? | **Sim, provado em produção.** |
| 10 | `export:audit` controla capacidade tenant? | Sim; bundle do Financeiro corrigido em produção. |
| 11 | `manage:agent` controla capacidade própria? | Sim, sem alias. |
| 12 | As correções anteriores funcionam em PRODUÇÃO? | **Em sua maioria sim** — e a execução revelou uma regressão séria (48.3) que estava viva e foi corrigida. |
| 13 | A↔B continua isolado? | **Sim** — 44 tabelas, zero vazamento nas duas direções. |
| 14 | As quatro roles continuam corretas? | **Sim** — jornadas, 9 transições e as 28 permissões. |
| 15 | Pronto para GO-LIVE? | **Ainda não.** |

### 48.8 Veredito

**NO-GO**, por três motivos objetivos e nomeados:

1. **META-001 continua aberto.** A WABA segue sem app inscrito: o paciente
   escreve e nada acontece. O produto agora avisa em vez de mentir, mas o canal
   não funciona. Operação externa pendente.
2. **WAIT-001 e BILLING-002 dependem de operação externa** (template aprovado na
   Meta; eventos `PAYMENT_UPDATED`/`PAYMENT_DELETED` no Asaas).
3. **BILLING-001 não foi observado com cobrança real.** A regra está correta e
   testada com relógio controlado, mas a primeira cobrança ainda não ocorreu.

O que mudou desde a seção 47: o isolamento multi-tenant, o RBAC completo, as
jornadas das quatro roles e sete dos dez gaps deste ciclo passaram a ter prova
de comportamento em produção, não só de código. E uma regressão que quebrava
toda edição de paciente, fornecedor e perfil da clínica foi encontrada e
corrigida — ela só apareceu porque a suíte rodou contra o ambiente real.


## 49. Fechamento dos `PARTIAL`/`BLOCKED` e incidente do webhook Asaas (2026-08-16)

A seção 48 encerrou o gate com oito specs em `PARTIAL`, três `BLOCKED` e quatro
`NOT TESTED`. Nenhum desses estados era limite do produto — eram limites de
execução. **Esta seção os elimina e substitui a matriz de 48.6.**

Resultado consolidado da suíte completa contra `https://app.qoro.dev`:

| | |
| --- | --- |
| Specs executados | **45** |
| `PASS` | **45** |
| `FAIL` / `BLOCKED` / `NOT TESTED` / pulados | **0** |
| Duração | 32,3 min, `--workers=1` |

### 49.1 O que `PARTIAL` de fato significava

Os oito casos tinham a mesma forma: **o roteiro descrevia o mundo anterior à
correção**. A asserção que codificava o achado passava; o resto continuava
exigindo o comportamento vulnerável — botão removido, chave reusada, compensação
`pago`, owner como opção de agenda. Cada roteiro foi **invertido**, não relaxado.

| Spec | Afirmava | Passou a afirmar |
| --- | --- | --- |
| clinic-profile-a / supplier-lifecycle-a | contagens de trilha pré-correção | contagens pós-correção |
| consultorio-attendant-integrity-a | percorria o caminho vulnerável (AUTHZ-008) | cenário reescrito sobre o controle novo |
| consultorio-no-show-a | corrida sobre a consulta consumida pelo no-show | corrida em `chegou`, único estado que permite `transfer` |
| scheduling-config-a | owner entre as opções de médico | `doctorId` obrigatório e sem owner |
| financial-lifecycle-a | compensação permanecendo `pago` | estorno integral terminaliza como `estornado` |
| appointment-import-a | reúso da chave de idempotência | chave rotacionada a cada import (UX-004) |
| subscription-cancellation-trial-a | botão de cancelamento presente no trial | botão ausente (UX-002) |

### 49.2 Os três `BLOCKED`

`conversation-handoff-a` e `collection-case-a` importavam por transitividade um
módulo `server-only` — pacote cujo `package.json` só resolve sob a condição de
exportação `react-server`. Fora do Next, o Playwright caía no ramo que existe
para explodir. **A fronteira `server-only` não foi tocada**: ela impede que
código de servidor vaze para o bundle do cliente, e enfraquecê-la para agradar um
runner trocaria uma garantia real por conveniência. A correção foi informar a
condição ao processo de teste, registrada como `pnpm test:e2e:prod`.

`team-lifecycle` conta as vagas contratadas antes de criar qualquer coisa e se
recusa a rodar sem quatro livres. A Clínica A tem 4 de 5 em uso. A saída não era
baixar a checagem nem apagar usuários permanentes: `E2E_TEAM_OWNER_EMAIL` passou
a permitir apontar a jornada para outro owner descartável, e ela roda na
Clínica B (1 de 5 em uso).

### 49.3 Os quatro `NOT TESTED` — nenhum precisava de inbox

Os gates já se chamavam `ALLOW_SYNTHETIC_*`: foram escritos para provar o
mecanismo sem depender de entrega de e-mail.

| Spec | Como obtém a credencial |
| --- | --- |
| invite-concurrency-a | convites sintéticos criados e consumidos no próprio teste |
| password-recovery-a | `generateLink` da Admin API + fluxo real de `/auth/confirm` |
| lgpd-export-email | alias controlado; verifica worker real, outbox e artefatos |
| lgpd-full-lifecycle-a | fixtures próprias, criadas e destruídas no teste |

Nenhum e-mail foi enviado a endereço de cliente. Nenhuma passagem de tempo foi
falsificada: a retenção é acelerada só para os ids sintéticos do run, e o spec
confere que o candidato mais antigo elegível é exatamente o esperado.

### 49.4 `password-recovery-a` ainda afirmava o AUTH-006

O roteiro exigia que uma sessão autenticada **por senha** alcançasse o formulário
de nova senha e trocasse a credencial — exatamente o achado. Hoje
`/reset-password` só monta o formulário com o grant one-time de `/auth/confirm`.
O spec foi invertido: sessão comum vê "Link inválido ou expirado" sem formulário,
link reencaminhado à mão cai em `/auth/auth-error`, e política de senha e
revogação passaram para dentro do grant válido.

```
normalSessionReachedResetForm: false   forgedTokenDenied: true
weakPasswordAccepted: false            otherRefreshTokenRevoked: true
recoveryLinkReuseDenied: true          originalPasswordRejectedAfterRecovery: true
oldSessionAllowedAfterRecovery: false  deletedUserDenied: true
```

### 49.5 LGPD — duas cópias residuais fecharam, uma janela foi medida

- **Outbox**: o evento referencia o paciente só por id. `outboxPiiRows: 0` com
  `outboxRowsForPatients: 8` — a coluna companheira separa "não há evento" de
  "há evento, sem PII"; só a segunda prova que a eliminação funcionou.
- **Artefatos de exportação**: o hard-delete purga PDF e JSON junto com o
  paciente, inclusive de quem ficou por **retenção clínica** — o snapshot
  exportado não anonimiza, então mantê-lo anularia a anonimização do registro.

Resta um ponto **medido, não suposto**: a URL assinada emitida antes da
eliminação continua servindo o PDF pelo cache do CDN depois que o objeto some do
Storage. Observado em duas execuções: **56,1 s** e **56,7 s** até virar `400`.

É exposição real e fica registrada, com três atenuantes: a URL só chega a quem já
tinha direito ao export, não é indexável, e a janela fecha sozinha. Não é motivo
de NO-GO — é backlog: encurtar o TTL do objeto ou servir o export por rota
autorizada em vez de URL assinada de 7 dias.

### 49.6 Três falhas que só a suíte completa revelou — nenhuma era regressão

| Spec | Causa |
| --- | --- |
| supplier-lifecycle-a | A trilha do fornecedor tem **2 atores** quando o financeiro vence a corrida de edição e **1** quando o owner vence. Antes do compare-and-swap as duas escritas falhavam e o número era sempre 1. A asserção passou a seguir o vencedor real — fixar 2 seria flaky na direção oposta. |
| role-journeys-a (J2) | O board do consultório **nunca mistura médicos**: para quem não é practitioner ele default ao primeiro médico do dia em ordem alfabética. Com mais de um médico com agenda, a fila do encaixe só aparece ao selecionar o profissional — que é o que o atendente faz. |
| mfa-lifecycle | Nenhuma mudança de código. O storage state compartilhado estava com JWT vencido. A suíte exige `E2E_AUTH_REUSE=1` para regenerá-lo; sem a variável o `globalSetup` nem é registrado. |

### 49.7 INCIDENTE — webhook do Asaas interrompido por 401

O Asaas suspendeu a integração após uma sequência de `401 invalid token` em
`/api/webhooks/asaas`. O painel exibia estados contraditórios: "pausado" na
lista, "ativo" ao editar.

**Causa raiz**: o webhook tem dois campos independentes. `enabled` já era `true`;
o que estava setado era `interrupted: true`. E o token configurado no painel
divergia do `ASAAS_WEBHOOK_TOKEN` do deploy.

O diagnóstico foi confundido por uma armadilha da API: `authToken` **nunca** é
devolvido (vem sempre `null`, mesmo configurado). O indicador real é
`hasAuthToken`, que já era `true` — ou seja, token divergente, não ausente.

Prova de que o lado ClinicaOS estava correto, sem efeito colateral: o token é
validado **antes** do parse do corpo, então um POST com corpo malformado
distingue os dois casos.

| Requisição | Resultado |
| --- | --- |
| sem token | `401` |
| token de produção | `400` (passou no token, parou no parse) |
| token de DEV | `401` |

**Correção aplicada** via `PUT /v3/webhooks/{id}`, com autorização explícita:
`authToken` alinhado ao valor de produção, `interrupted: false`, e os eventos
`PAYMENT_UPDATED` e `PAYMENT_DELETED` adicionados. Estado final:

```
enabled: true  interrupted: false  hasAuthToken: true
penalizedRequestsCount: 0  events: 7
```

Isso **encerra a operação externa do BILLING-002** — os dois eventos que faltavam
estão inscritos. A entrega ponta a ponta com evento real ainda não foi observada.
A janela em que o webhook esteve suspenso é coberta pelo `billing-reconcile`
(cron diário às 09:00), que é exatamente o mecanismo desenhado para divergência.

### 49.8 Veredito

**NO-GO**, agora por dois motivos e não três:

1. **META-001 continua aberto.** A WABA segue sem app inscrito: o paciente
   escreve e nada acontece. O produto avisa em vez de mentir, mas o canal não
   funciona. Operação externa pendente. WAIT-001 depende do mesmo template.
2. **BILLING-001 não foi observado com cobrança real.** A regra está correta e
   testada com relógio controlado; a assinatura da conta de teste tem cobrança
   `PENDING` com vencimento em 24/09, então a primeira liquidação ainda não
   ocorreu.

**Saiu da lista**: BILLING-002, cuja pendência era configuração no Asaas, agora
feita.

O que mudou desde a seção 48: os quinze estados intermediários (`PARTIAL`,
`BLOCKED`, `NOT TESTED`) viraram `PASS` com evidência de produção; três defeitos
de roteiro que só a suíte completa expõe foram corrigidos; e um incidente vivo de
integração de cobrança foi diagnosticado e fechado.
