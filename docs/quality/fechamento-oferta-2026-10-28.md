# Fechamento técnico da oferta — 28/10/2026

Escopo: branch `integration/pricing-plan-sync-20261018` do aplicativo e PR draft #3 da landing. Esta prova não autoriza merge, deploy ou migration em Production.

## Avanço desta rodada

| Frente | Estado | Evidência e limite |
| --- | --- | --- |
| Docker, WSL2 e Supabase local | **PASS** | Docker Desktop 4.97.0 instalado por usuário de fonte oficial; Client/Server 29.9.2; WSL2; Supabase CLI 2.122.0; imagem oficial PostgreSQL 17.11 com `supabase_vault` 0.3.1. Nenhuma licença foi aceita em nome do usuário nem houve reinício do Windows. |
| Artifact de 26/10 | **FAIL para restore íntegro** | Decifração passou, mas o dump de `public` sem `auth.users` falhou com FK de `appointment_corrections` sob `ON_ERROR_STOP=1`. O erro não foi ignorado nem foram fabricados usuários. |
| Novo backup lógico e restore | **PASS para public+auth; PARTIAL para serviço completo** | `pg_dump` Production somente de leitura e GPG exit 0; backup cifrado de 600.448 bytes, SHA-256 `76f17b44e3d3e87b3735a0606295d389be7b013ff42a35eb7c4dee76292b778d`. `psql` 17.11 exit 0, zero erros SQL em Supabase local isolado. Storage e configurações externas não foram restaurados; consulta agregada em Production encontrou 5 buckets e 42 registros em `storage.objects`. |
| Storage — atualização 29/10 | **PASS de cópia e restore real local; PARTIAL operacional** | Cinco buckets e 42 arquivos reais copiados com autorização, archive cifrado, 42 hashes conferidos após restore local, 38 acessos privados anônimos recusados e 4 leituras públicas conferidas. Falta rotina recorrente e cópia/chave em domínio de falha independente. Nenhuma escrita em Production. |
| Configuração Auth — atualização 29/10 | **PASS de inventário/cópia e serviço sintético; PARTIAL para reconstrução integral** | 243 configurações cifradas verificadas. Auth oficial local com sete campos recuperados, 133 migrations, hook/parser/RLS, e-mail local, sessão, recuperação e TOTP/AAL2: 14 verificações aprovadas. Cofre independente e reconstrução do produto completo continuam pendentes. |
| Migrations 0119–0132 | **PASS na cópia restaurada; NOT RUN em Production** | 14/14 SQLs em ordem, cada um em transação com `ON_ERROR_STOP=1`; journal 119 → 133; zero constraints públicas não validadas. Nenhuma migration remota foi aplicada. |
| Contratos legados | **PASS de preservação na cópia** | Os quatro registros de assinatura conservaram exatamente todos os campos pré-existentes; os planos e preços legados também tiveram digest igual antes/depois. Os cinco planos 2026 nasceram inativos. Não houve atualização de contrato real. |
| Três contratos DEV sem titular | **PARTIAL, não bloqueio direto de Production** | São três registros DEV `past_due` sem profile/paciente/agendamento; possuem IDs de assinatura Asaas e histórico variável. Não se comprovou quem removeu os titulares. Production tinha zero órfãos no readback anterior. Não foram alterados. |
| Renovação anual | **PARTIAL — retirada de novas vendas na fase mensal** | Código e contratos anuais existentes preservados. O novo portão server-side impede escolha anual, reserva de Checkout anual e troca mensal→anual quando desligado; cobrança automática após um ano continua sem observação temporal. Não é bloqueio da oferta **somente mensal** se o portão e a landing estiverem validados no SHA final. |
| Turnstile | **PASS funcional em Preview apropriado; CI 2 SKIP** | Teste positivo 201 e negativo 401 anteriores usaram Previews com secrets de teste distintos. A CI pública passou 7 e ignorou 2 por ausência intencional das chaves no build isolado. A configuração efetiva de Production ainda deve ser conferida antes de reabrir cadastro. |
| Tier Gemini | **PARTIAL — decisão operacional externa** | O modelo padrão no código é `gemini-3.6-flash`; o projeto, tier, faturamento, limites efetivos e política de dados da chave de Production não foram comprovados. Não há portão global de IA identificado que permita prometer desativação isolada sem mudança de código. Confirmar no AI Studio antes de usar IA com dados de pacientes; nenhum plano externo foi comprado. |
| Landing candidata | **PASS no Preview mensal; publicação coordenada pendente** | Candidata mantém Consultório R$197/1 médico, Clínica R$397/2 médicos + R$147 por médico adicional até 5, até 3 acessos de equipe e trial 14 dias. A comunicação de **nova contratação anual** foi retirada para a primeira fase mensal; quatro inspeções de navegador passaram no deployment `81341c4`. A landing pública não foi alterada. |
| Documentos contratuais | **PARTIAL** | Termos remetem às condições da página de preços; FAQ candidato explica anual pré-pago, cancelamento de renovação e ausência de estorno automático. Revisão jurídica/comercial humana continua necessária antes da publicação. |

## Prova do backup e integridade

O novo SQL decifrado **em memória** tinha 2.965.219 bytes, marcador de conclusão, 135 `CREATE TABLE public`, 27 `CREATE TABLE auth`, 133 blocos `COPY public` e 27 `COPY auth`. O destino teve 135 tabelas public, 27 auth, 8 usuários Auth, 4 clínicas, 8 profiles, 4 assinaturas, 25 pacientes, 64 agendamentos, 1.486 eventos de auditoria, 254 FKs public, 145 políticas RLS public e zero constraints public não validadas. As contagens de usuários, clínicas, profiles, assinaturas, pacientes, agendamentos, eventos, tabelas e constraints não validadas coincidiram com uma leitura da origem após o snapshot.

O novo helper `scripts/prod-encrypted-backup.ts` também foi executado contra a origem **somente para leitura**, já com a verificação de descriptografia integrada. Terminou com código 0 e produziu outro `.sql.gpg` de 600.431 bytes, SHA-256 `029d40a501f9fbafc0c2d768af4aba03304cd0595d5dee589f94e715631d51c3`, em `%TEMP%/qoro-backup-helper-20261028`. A verificação do marcador final foi parte do próprio helper; não houve restauração desse segundo artifact, pois a restauração estrita já havia passado para o backup do mesmo dia. Isso prova o caminho local do código, **não** a execução do workflow alterado no GitHub.

Depois do push do commit `303cd4a3`, o [workflow de backup executado manualmente no GitHub Actions](https://github.com/joaomarcos-techia/Project_OS/actions/runs/40691933945) passou, incluindo dump+cifragem e upload. O artifact baixado `prod-20261028T125616Z.sql.gpg` tinha 605.324 bytes e SHA-256 `488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992`. Sua **restauração estrita**, em outro contêiner local sem rede/portas, terminou com GPG=0 e `psql`=0, sem SQL aberto em arquivo. Readback: 135 tabelas public, 27 auth, 8 usuários Auth, 4 clínicas, 8 profiles, 4 assinaturas, 25 pacientes, 65 agendamentos, 1.487 eventos de auditoria, 254 FKs public, 145 políticas public, zero constraints public não validadas e 119 migrations. O contêiner foi removido após a prova. Os dois contadores que diferem do primeiro backup do dia são de snapshots distintos; não são prova de perda nem de paridade exata com a origem no mesmo instante. A primeira execução diária **agendada** após a publicação do workflow ainda deverá ser observada.

Dois contêineres independentes usaram rede `none`, zero portas, log driver `none`, `tmpfs` para dados e `/tmp`, e swap limitado à memória. O primeiro preservou a base restaurada para comparação; o segundo recebeu as migrations. Após o readback, ambos e o volume sintético inicial foram removidos. O `.sql.gpg` de 28/10 permanece somente no diretório temporário local fora do Git. O artifact cifrado de 26/10 foi preservado. Nenhum SQL em claro foi gravado em arquivo durante esta prova.

O restore estrito só passou com o usuário local `supabase_admin`, dono do event trigger `pgrst_drop_watch`; o usuário `postgres` da imagem Supabase não é superusuário e falhou no `DROP` desse objeto. O dump com Auth permitiu que todas as FKs fossem recriadas e validadas. Não foi usado `ON_ERROR_STOP=0`, bypass de constraint ou alteração do SQL para forçar aprovação. Procedimento: [disaster recovery](../runbooks/disaster-recovery.md).

## Migrations e janela de rollout

O journal real de Production tinha 119 entradas até 0118; DEV tinha 133 até 0132. A sequência faltante corresponde aos 14 arquivos 0119–0132, na ordem do `_journal.json`. Na cópia do backup real, os 14 arquivos saíram com código 0, e os readbacks encontraram 5 limites de assentos, 5 novos planos inativos, 10 preços novos, preços por meio de pagamento ativos = 0, políticas de sobretaxa = 0, e os dois gatilhos `profiles_offer_2026_seats` e `profiles_preserve_contract_owner`. O digest dos campos antigos das quatro assinaturas coincidiu antes/depois; o novo campo `enforce_trial_deadline` explica a diferença do digest da linha inteira.

Há divergência de **hash histórico**, não de ordem: alguns arquivos antigos não têm hash igual ao journal remoto. Em DEV, 0124 tem hash aplicado diferente do arquivo atual, embora o readback do campo/default corresponda. A origem exata do desvio não foi demonstrada. Production ainda não aplicou 0124; a versão atual passou no clone do backup real. Não use igualdade de contagem de migrations como único preflight.

O risco principal de indisponibilidade é lock de DDL em tabelas vivas, especialmente 0121 (`ALTER TABLE` de políticas de preços), 0122 (gatilho em `profiles`) e 0132 (outro gatilho em `profiles`). No snapshot de Production havia zero linhas ativas de preço por método e zero políticas de sobretaxa; a 0121 não precisou converter registros. O teste local inteiro durou cerca de 6 segundos incluindo 14 processos Docker, mas **não** estima duração em Production sob concorrência. Fechar o cadastro, verificar transações/locks, fixar janela, registrar baseline e interromper ao primeiro erro. O roteiro controlado está em [publicação coordenada](../runbooks/publicacao-coordenada-oferta-2026-10.md).

## Contratos DEV e renovação anual

Os três órfãos DEV não foram atribuídos a titulares por inferência nem apagados. Dois eram Solo `past_due` sem eventos de auditoria; um era Pro `past_due` com auditoria e histórico. A proteção contra novos órfãos na 0132 passou anteriormente com concorrência e agora foi instalada no clone real. Como o readback de Production mostrou quatro assinaturas legadas e zero órfãos, esses três registros DEV são pendência de saneamento/investigação histórica independente, salvo se surgir vínculo com cliente real. Confirmar o estado de Production novamente na janela.

A [documentação do Asaas sobre `paymentBook`](https://docs.asaas.com/reference/gerar-carne-de-assinatura) permite antecipar a **criação** de parcela no Sandbox, não o pagamento do cartão no aniversário. A evidência anterior de duas parcelas anuais e readback de valor/data é válida; não comprova cobrança após um ano. Classificação: **C** (dependência temporal), com lacuna de cobertura operacional. Monitorar a data do primeiro vencimento anual e a data de renovação de cada assinatura; comparar parcela Asaas, webhook, estado da assinatura Qoro, permissões e dunning. Alertar se a parcela não surgir no prazo esperado, se houver `PAYMENT_OVERDUE`/falha de cartão, ou se o webhook não conciliar. Uma decisão de lançamento pode aceitar formalmente esse risco **sem chamá-lo PASS**; o fundador ainda não deu esse aceite.

## Validação do patch desta rodada

No worktree isolado com as dependências do lockfile (Zod 4.6.6), `next build` com `NODE_ENV=production` terminou com código 0, incluindo compilação, lint/tipos internos e geração das 19 páginas estáticas. `tsc --noEmit` e ESLint focado também terminaram com código 0; Prettier e `git diff --check` passaram. O teste `src/lib/db/prod-encrypted-backup.test.ts` foi repetido após o ajuste final: **2/2 PASS**. O bloco `Dump + cifrar` do workflow passou em `bash -n`. O helper local e o workflow remoto foram exercitados de verdade contra Production somente para leitura, com restauração estrita dos artifacts indicados acima. A [CI do código no SHA `cba8b620`](https://github.com/joaomarcos-techia/Project_OS/actions/runs/40784646130) terminou com **5.689/5.689 testes**, typecheck, lint, inventário de segurança, isolamento de dois tenants, build e E2E público **7 PASS / 2 SKIP**. Os dois skips exigem chaves Turnstile ausentes intencionalmente no build isolado; não foram convertidos em PASS. A suíte integral não foi repetida localmente nesta rodada, pois a CI cobriu o mesmo código.

Uma primeira tentativa de build no worktree de validação herdou `NODE_ENV=development` do `.env.local` e falhou ao pré-renderizar `/404`, após avisar que o modo era inválido para `next build`. A repetição com o modo correto passou. Isso foi uma falha de configuração da execução do teste, não uma alteração ou correção do produto.

## Próximos gates de publicação

| Frente | Estado em 28/10 | Bloqueia lançamento? | Ação concreta |
| --- | --- | --- | --- |
| Docker/Supabase local | PASS | Não | Manter o runbook de recuperação. |
| Restauração lógica real | PASS para `public` + `auth`; PARTIAL para serviço | Sim, até confirmar Storage/configuração | Conferir backup gerenciado/PITR e cópia de objetos Storage. |
| Migrations 0119–0132 | PASS no clone; NOT RUN em Production | Sim, até janela autorizada | Repetir preflight de journal/locks, depois aplicar na janela. |
| Contratos legados DEV | PARTIAL | Não, com Production sem órfãos no readback | Investigar a origem histórica separadamente; não inventar titulares. |
| Renovação anual | PARTIAL (limite temporal) | Sim, sem aceite de risco | Aprovar monitoramento e risco residual ou adiar a oferta anual. |
| Turnstile | PASS em Preview; configuração Production não conferida | Sim | Conferir as variáveis efetivas antes de reabrir cadastro. |
| Tier Gemini | PARTIAL | Sim para tráfego clínico com IA | Titular confirma projeto, tier pago, crédito e orçamento. |
| Revisão comercial/contratual | PARTIAL | Sim | Aprovar texto e regras do candidato. |
| Landing candidata | PASS de fonte/Preview; Production divergente | Sim | Publicar junto com o app somente na janela. |
| Rollout coordenado | PREPARADO; não executado | Sim | Autorizar janela após todos os gates. |
| [PR #42](https://github.com/joaomarcos-techia/Project_OS/pull/42) | Aberto em draft | — | Validar checks do SHA final; não mesclar agora. |
| [PR #3](https://github.com/joaomarcos-techia/landing_page/pull/3) | Aberto em draft | — | Preservar até a publicação coordenada. |

1. O workflow corrigido **passou sob `workflow_dispatch`** e seu artifact foi restaurado. Confirmar a primeira execução **agendada** após a publicação coordenada, porque até o merge o agendamento da `main` continua usando a versão antiga do workflow.
2. Confirmar os backups físicos gerenciados e o plano de recuperação de Storage/Auth; PITR não será contratado nesta fase e o dump lógico não é recuperação completa do serviço.
3. Conferir Turnstile efetivo de Production, tier Gemini e revisão contratual, sem expor chaves.
4. Manter novas contratações anuais fechadas na primeira fase; observar renovação temporal e obter aceite explícito do risco antes de reabrir essa modalidade.
5. Na janela autorizada, seguir [o roteiro coordenado](../runbooks/publicacao-coordenada-oferta-2026-10.md): fechar cadastro por novo deployment, confirmar 503, aplicar migrations com backup cifrado/advisory lock, verificar contratos, publicar app e landing juntos, reabrir cadastro em novo deployment e executar smoke/monitoramento.

**Decisão atual: NO-GO de Production.** O restore lógico e o teste em dados reais eliminam o bloqueio técnico anterior; faltam gates externos e a publicação coordenada autorizada. Nenhum merge, deploy de Production, cobrança ou migration remota ocorreu nesta rodada.

## Atualização da fase mensal e recuperação complementar — 28/10/2026

O titular observou oito backups físicos diários no painel de Production (21–28/10, o último **28/10 09:10:54 UTC**) e decidiu **não contratar PITR**. A organização consultada em modo leitura é **Pro**; a [retenção documentada é de sete dias de backups diários](https://supabase.com/docs/guides/platform/backups), não oito dias garantidos pela contagem visual. Sem PITR, o RPO de planejamento é aproximadamente 24 horas sob backups saudáveis e pode crescer se uma execução falhar. O RTO completo ainda não foi medido; 24–48 horas é objetivo de planejamento, não SLA comprovado. O workflow cifrado de `public+auth` é cópia complementar independente de execução manual comprovada, mas o primeiro agendamento da `main` ainda não foi observado.

Storage Production: `admin-exports` privado 0, `clinic-logos` público 3, `clinical-pdfs` privado 36, `lgpd-exports` privado 2, `logo_qoro` público 1. Total **42 registros de metadados**, sem prova dos bytes. Foi criado archive cifrado para cópia local autorizada e teste de restauração **sintético**, com hashes e detecção de adulteração. Nenhum arquivo real foi copiado; o destino seguro e o drill isolado ainda são gates. A configuração gerenciada do Auth também não está incluída no restore de `auth`; inventário e reconstrução operacional estão no [runbook](../runbooks/disaster-recovery.md).

O journal de Production foi lido novamente sem escrita: **119 entradas, último ID 119**. As 14 migrations 0119–0132 permanecem pendentes; o teste anterior no clone real continua aplicável, mas o preflight de locks, contratos, schema e backup deve ser repetido na janela. Os três órfãos DEV seguem pendência histórica isolada, sem equivalente encontrado na última leitura de Production; não foram alterados.

Para preparar o lançamento mensal primeiro, `OFFER_2026_ANNUAL_NEW_SALES_ENABLED` nasce `false`. O servidor omite o anual do catálogo e rejeita escolha direta, draft anual pré-existente sem checkout e troca mensal→anual; contratos anuais já ativos, cancelamento e conciliação não são desligados. A landing candidata e a prévia do app deixam de oferecer/anunciar nova contratação anual. **Não houve ativação em Production.** Testes direcionados deste patch: 51/51 de signup draft/reserva, 1/1 archive cifrado sintético, 35/35 de alteração/cancelamento de plano e 4/4 da prévia comercial; todos PASS com dependências locais compartilhadas. O typecheck local ainda depende de corrigir o ambiente do worktree: seu junction aponta para `node_modules` da main com Zod 3, enquanto esta branch exige Zod 4; a tentativa de remover somente o junction foi rejeitada pela política automática. Portanto build/typecheck do SHA final exigem a CI isolada e ainda não são PASS nesta atualização.

**Decisão de prontidão:** NO-GO. Banco restaurável e migrations em clone têm prova; Storage real, Auth gerenciado, Turnstile efetivo de Production, tier Gemini/privacidade, aprovação comercial/jurídica e checks finais permanecem abertos. A modalidade anual pode ficar fora do lançamento mensal sem apagar o código, mas sua reativação depende de nova prova/aceite de risco e rollout próprio.

## Continuação em 29/10/2026

O CI de `5ec3e7be` passou typecheck e a suíte de testes, mas parou no inventário de segurança desatualizado: o novo script introduziu três acessos a variáveis de ambiente. O documento gerado foi refeito e revisado, sem superfícies `REVIEW_REQUIRED`, variáveis públicas não registradas ou regressão de testes de rota. Uma primeira execução em `001a148b` havia encontrado dois acessos de array possivelmente indefinidos no teste sintético; foram corrigidos com verificações explícitas, sem casts ou desativação de validações. Esses runs permanecem FAIL e não comprovam build/E2E final.

A landing em `81341c4` passou typecheck, lint, build completo e os checks remotos aplicáveis; o Vercel Agent Review ficou `NEUTRAL/skipping`. O build local resultante passou **4/4** verificações em Chromium: `/` e `/precos`, desktop 1440 px e celular 375 px, com preços, cotas, CTAs, ausência de oferta anual e ausência de overflow. É evidência de navegador contra o build local; o novo deployment Preview foi publicado automaticamente pela branch, mas não recebeu nova inspeção autenticada nesta rodada.

O archive de Storage preserva também o MIME type retornado no download. A regressão sintética passou **3/3**: cifragem/restauração dos bytes e MIME, adulteração e senha errada, nenhuma escrita antes de verificar o archive completo, remoção do archive incompleto após falha de download sem tocar arquivo vizinho e rejeição de bucket desconhecido antes da rede. Typecheck estrito focado do helper/archive/teste passou. Isso continua sem constituir backup ou restore real dos arquivos Production. A autorização de destino protegido foi solicitada; nenhum arquivo clínico real foi copiado.

### Prova real de Storage após autorização do titular

O titular autorizou criar e utilizar uma pasta protegida. Em 29/10, o helper baixou **5 buckets/42 objetos** de Production, sem mutações. O archive está fora do Git em `%LOCALAPPDATA%/Qoro/Recovery/storage-20261029/qoro-storage-S0upJf`: 44 arquivos cifrados/estruturais, 2.565.459 bytes; SHA-256 de `manifest.enc` = `043a66f68862ff974a654a7e010415f86eb4c7a811041c23a606aa31e17c077c`. ACL sem herança permite somente ao usuário Windows corrente. A chave aleatória ficou em `%LOCALAPPDATA%/Qoro/RecoveryKeys/storage-20261029.dpapi`, protegida por DPAPI CurrentUser, sem plaintext no disco.

`scripts/storage-local-restore-drill.ts` restaurou a cópia em imagens oficiais PostgreSQL/Supabase 17.11.0.006 e Storage API v1.81.0, rede Docker **internal**, sem portas publicadas, logs `none`, dados PostgreSQL e arquivos em `tmpfs`, sem swap adicional. Criou os cinco buckets, subiu arquivos por API e fez readback: **42/42 hashes iguais**, **38/38 downloads privados recusados ao token anônimo local** e **4/4 arquivos públicos com hash igual**. Contêineres e rede foram removidos, e `docker ps -a --filter name=qoro-storage-drill` não retornou recursos. Uma primeira tentativa usando porta de host não alcançou a API e foi FAIL ambiental; a API respondia dentro do contêiner. A execução aprovada usou transporte por `docker exec`, mantendo a rede isolada.

**Limites:** prova do snapshot copiado e dos bytes/configurações de bucket representadas no manifesto; não prova restauração das políticas RLS originais nem reconstrução integral do Auth. A única cópia/chave ainda está nesta máquina; perder o perfil Windows pode tornar a chave DPAPI inacessível. Ainda é obrigatório guardar uma chave recuperável em cofre independente e aprovar um destino para a cópia fora da máquina. Nenhum upload externo ou agendamento de cópia clínica foi feito. A contagem de 42 se refere ao snapshot, não garante cobertura de objetos criados depois dele.

O CI completo de `2293ff23` ficou **PASS**, incluindo tipo/lint/testes/build e E2E público, em [run 40849781435](https://github.com/joaomarcos-techia/Project_OS/actions/runs/40849781435). Esse check antecede os ajustes finais de MIME, regressão e novo drill; o SHA final precisa de seus próprios checks.

A CLI Vercel 65.7.0, autenticada legitimamente, confirmou a presença das duas variáveis Turnstile no escopo Production. O cadastro publicado respondeu 200; a leitura de 20 assets encontrou chave pública com formato real e nenhuma chave Cloudflare dummy conhecida. Isso não prova paridade secret/widget/domínio nem um token real validado; o teste funcional continua obrigatório na janela. A CLI também confirmou a presença de `GEMINI_API_KEY`, mas isso não determina projeto/tier/billing.

A inspeção autenticada da landing `81341c4` foi concluída no deployment `https://landing-page-8kg1zwlm9-clinic-os-v2-s-projects.vercel.app`: **4/4 PASS** em Chromium, home/preços e desktop/mobile. O cookie temporário de Deployment Protection ficou somente na memória do processo e foi removido do ambiente após o teste. Não houve alteração de proteção ou publicação em Production.

O readback de Production em 29/10 usou `psql` com `default_transaction_read_only=on`, `BEGIN READ ONLY` e timeout. Confirmou 119 migrations, **todos os 119 timestamps/ordem iguais ao journal**, 135 tabelas públicas, quatro assinaturas, zero constraints públicas não validadas e **zero contratos sem nenhum owner cadastrado**. Existe um contrato `cancelled` sem owner **ativo**; seu titular permanece cadastrado/inativo, portanto não é o mesmo problema dos três registros DEV sem profile. Nenhum titular ou contrato foi alterado.

Os desvios históricos de hash já registrados foram quantificados: 32 arquivos, índices **0000–0021, 0033, 0037, 0044–0050 e 0071**; 87 hashes coincidem. Não houve desvio de ordem. Isso não autoriza regravar o journal nem reaplicar migrations antigas. As 14 pendentes são exatamente 0119–0132; a fotografia validada do banco continua sendo a prova de compatibilidade, não a reexecução cega do histórico. Na janela, qualquer diferença nova frente a essa baseline exige interrupção/investigação.

O drill foi repetido após endurecer os próprios controles: o runner confirma rede interna, nenhuma porta publicada, `tmpfs` e logs desativados; só emite PASS **depois da limpeza**. A execução final repetiu 42/42 hashes, 38 negativas privadas, 4 leituras públicas e `cleanup=completed`, exit 0. Uma execução intermediária falhou em `docker exec`, sem evidência suficiente para atribuir uma causa exata; a espera do PostgreSQL foi reforçada para exigir TCP e a role de Storage, evitando considerar pronto o servidor temporário de inicialização. A falha intermediária não foi convertida em PASS; a execução final é uma prova nova.

Após os ajustes finais: **93/93 testes direcionados** (51 signup, 15 alterações de plano, 20 cancelamento, 4 prévia comercial, 3 archive), typecheck estrito dos helpers de backup/restore e lint/formatação focados passaram. O inventário foi regenerado com 392 acessos a env, zero superfícies sem guard identificado e zero divergências de variáveis públicas/rotas. Os checks de cada commit estão em [PR #42 — checks](https://github.com/joaomarcos-techia/Project_OS/pull/42/checks); não atribuir resultados de um SHA ao outro. O build/lint/typecheck da landing e seus checks aplicáveis passaram em `81341c4`, com Agent Review explicitamente `NEUTRAL/skipping`.

### Configuração gerenciada do Auth recuperada após login legítimo

O primeiro login informou sucesso, mas a API ainda recusou a credencial com HTTP 401; a tentativa com um perfil inexistente foi recusada pela CLI. O titular então concluiu o login de navegador com `--name`, fora do repositório com o `.env.local` antigo. A CLI passou a listar os projetos e a API de configuração respondeu 200. A credencial foi lida do Credential Manager do próprio usuário somente em memória; não foi copiada para arquivo nem incluída neste relatório.

Foram recuperadas **243 configurações** da Management API. Snapshot em `%LOCALAPPDATA%/Qoro/Recovery/auth-20261029/auth-config.dpapi`, 40.694 bytes cifrados, SHA-256 `7618178c51bc0d34fbe49be16ba6149cf0f69b5069346b36d98a19669655c66b`; ACL restrita e sem herança. Descriptografia de readback em memória coincidiu exatamente com a resposta original. Valores secretos, conteúdo de templates e endereços de remetente não foram impressos.

Conferências não secretas: `site_url` corresponde a `https://app.qoro.dev`; allow-list de redirects preenchida; e-mail habilitado e Google desabilitado; confirmação de e-mail obrigatória; rotação de refresh habilitada; JWT = 900 segundos; TOTP enroll/verify habilitados; hook customizado habilitado e apontando para `public/custom_access_token_hook`; SMTP e templates presentes, com credencial SMTP retornada sem máscara. O CAPTCHA gerenciado do Supabase está desligado, enquanto o Turnstile próprio do Qoro protege o caminho de risco moderado. HIBP está habilitado. O mínimo gerenciado de senha é seis caracteres; isso é configuração atual, não aprovação da suficiência da política nem alteração feita nesta rodada.

**Limites:** não foi reconstruído um serviço Auth completo nem testados login/MFA/SMTP nele. JWT signing keys, credenciais Vercel/Google/Resend e chaves de cifra do domínio precisam continuar recuperáveis em cofre independente; a resposta Auth não é inventário de todos esses serviços. O snapshot DPAPI depende deste perfil Windows. O procedimento de reconstrução e as verificações obrigatórias estão no runbook de recuperação. Não repetir o login manual já concluído.

O CI de `d0431df4` identificou dois `undefined` explícitos incompatíveis com `exactOptionalPropertyTypes` nos helpers novos; foram substituídos por MIME fallback explícito, sem afrouxar o TypeScript. A verificação local foi repetida incluindo `--exactOptionalPropertyTypes` e passou, assim como os 3 testes do archive. O run seguinte pertence ao commit corretivo `04fef91c`; o FAIL anterior permanece registrado.

## Conclusão técnica autônoma — rodada de 29/10

As evidências antigas continuam preservadas. Os checks exatos de `279e06bd` passaram: [CI 40855194640](https://github.com/joaomarcos-techia/Project_OS/actions/runs/40855194640), 540 arquivos, **5.694/5.694 testes**, build, lint, TypeScript, isolamento e segurança. E2E público: **7 PASS e 2 SKIP**, sem converter os SKIPs de Turnstile em PASS. Vercel, Snyk e Semgrep passaram nesse SHA. Landing `81341c4` também estava mergeable/draft com checks aplicáveis aprovados; Agent Review era NEUTRAL.

Nesta rodada foram implementados:

- Ensaio funcional Auth descrito no [runbook](../runbooks/disaster-recovery.md): **14 verificações reais locais**, 133 migrations reais, SMTP sem saída, hook/parser/RLS Qoro, TOTP/AAL2, cleanup confirmado em 103.893 ms na execução final (68.575 ms na anterior). Isso supera o antigo NOT RUN do serviço Auth sintético; não prova um HTTP de Next recuperado nem custódia externa de todas as chaves.
- Formato `QOROREC1` com cifra autenticada e envelope independente do DPAPI, exportador opt-in com senha custodiada, verificador e teste de portabilidade em Linux sem rede/volume. CLI seal/verify, recusa de sobrescrita e alerta por backup ausente passaram com dados sintéticos. Nenhuma exportação real ou upload foi feita.
- Monitor operacional de três famílias de backup: recusa estado ausente, cópia parcial, hash inválido, relógio futuro, cópia independente/chave/drill não comprovados. Rotina, retenção proposta e watchdog documentados; não existe scheduler real de Storage/Auth instalado enquanto o destino não for aprovado.
- Regressões Turnstile para replay e JSON inválido; probe da janela real preparado, não executado com credencial Production. O roteiro foi corrigido: cadastro fechado responde 503 e não pode, ao mesmo tempo, comprovar uma criação 201.
- Regressões Gemini 402/429: status preservado sem corpo sensível e sem retentativa curta de 4xx. Não houve chamada Gemini real nesta rodada; tier, projeto, limites, billing e privacidade continuam pendentes no painel.
- CTA da landing corrigido para separar Preview de Production com destinos constantes, bloquear host desconhecido e preservar UTM sem open redirect. **28/28** verificações de ponte/artefato e build completo da landing passaram. Browser local desktop/mobile, com e sem JS: **4/4 PASS**, sem enviar requests de conversão ou contratação externa. Essa prova cobre a navegação da ponte; não é novo Checkout ou webhook.

Validação local focada: **41/41 testes** em seis arquivos (12 Gemini, 8 retry, 11 Turnstile, 3 archive, 3 pacote e 4 monitor), TypeScript estrito dos helpers e lint. Nenhuma dependência de produção adicionada, nenhuma configuração CI/CD alterada nesta rodada. O inventário AST foi regenerado. As verificações completas do novo SHA devem ser lidas nos [checks do PR #42](https://github.com/joaomarcos-techia/Project_OS/pull/42/checks), sem atribuir a ele o PASS de `279e06bd` automaticamente.

### Matriz atual

| Área | Resultado | O que falta |
| --- | --- | --- |
| Banco e migrations no clone | PASS preservado | Preflight e autorização da janela; Production não migrado. |
| Storage | PASS local real | Cópia/chave independente, rotina ativa e watchdog aprovados. |
| Auth funcional | PASS sintético real; PARTIAL serviço completo | Cofre externo e ensaio conjunto do app recuperado com todas as dependências. |
| Exportação portável | PREPARADA e testada sinteticamente | Escolha do cofre, custódia da senha e autorização da cópia real. |
| Automação | PARTIAL | Workflow DB existente; checker e procedimento preparados; Storage/Auth e canal de alertas ainda não ativados. |
| Turnstile | PASS técnico/Preview; PARTIAL Production | Widget/domínio humano e gate real na janela. |
| Gemini | PASS de tratamento técnico; PARTIAL operacional | Projeto/tier/billing/limites/privacidade e alertas reais. |
| Oferta mensal/legados | PASS das provas anteriores preservado | Texto contratual aprovado, checks finais e rollout conjunto. |
| Landing candidata | PASS build e ponte local | Checks e probe do deployment do novo SHA. |
| Produção | NÃO ALTERADA | Sem merge, migration, deploy, alteração de contrato ou cobrança. |

Os [gates técnicos](gates-tecnicos-oferta-2026-10-29.md) registram a comparação comercial e os limites das provas. O [guia final](../runbooks/acoes-manuais-pendentes-pricing-2026-10.md) separa Grupo A obrigatório humano, B opcional e C engenharia na janela. **NO-GO mantido** por cofre/risco operacional, Turnstile Production, Gemini e aprovação contratual, não por ausência de instalação ou repetição de pagamentos.


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


### Complemento solicitado: 5 logins base versus 5 médicos

Após a dúvida do titular, os cards e o cadastro passaram a mostrar também o **total de pessoas**: Consultório 1+3=4; Clínica base 2+3=5; Clínica ampliada até 5+3=8. “Até 5 médicos” é o teto após comprar vagas médicas, não o número incluído nos R$ 397. Os três administrativos estão incluídos e não precisam ser comprados; não há compra online de um quarto administrativo. O código calcula os totais a partir da cota de médicos e da cota administrativa, sem mudar os limites.

Reteste das partes afetadas: **34/34 PASS** (15 predicado, 14 seleção e 5 calculadora), incluindo novo caso 2 médicos + 3 administrativos por R$ 397 e 5 + 3 por R$ 838, com recusa de quarto administrativo. Typecheck/lint/build da landing passaram novamente. O navegador contra o build atualizado passou **4/4** (home/preços × desktop/mobile), exigindo os totais 4/5/8 e a inclusão dos administrativos. O ambiente de controle da sessão Cloudflare do usuário retornou `browser access host unavailable` e `native pipe unavailable`; não foi possível abrir os hostnames pela interface, nenhuma configuração foi alterada. A ação humana continua restrita à conferência de Hostname Management, sem repetir lista de widgets, compras ou login Supabase.
