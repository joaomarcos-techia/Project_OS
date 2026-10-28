# Fechamento técnico da oferta — 28/10/2026

Escopo: branch `integration/pricing-plan-sync-20261018` do aplicativo e PR draft #3 da landing. Esta prova não autoriza merge, deploy ou migration em Production.

## Avanço desta rodada

| Frente | Estado | Evidência e limite |
| --- | --- | --- |
| Docker, WSL2 e Supabase local | **PASS** | Docker Desktop 4.97.0 instalado por usuário de fonte oficial; Client/Server 29.9.2; WSL2; Supabase CLI 2.122.0; imagem oficial PostgreSQL 17.11 com `supabase_vault` 0.3.1. Nenhuma licença foi aceita em nome do usuário nem houve reinício do Windows. |
| Artifact de 26/10 | **FAIL para restore íntegro** | Decifração passou, mas o dump de `public` sem `auth.users` falhou com FK de `appointment_corrections` sob `ON_ERROR_STOP=1`. O erro não foi ignorado nem foram fabricados usuários. |
| Novo backup lógico e restore | **PASS para public+auth; PARTIAL para serviço completo** | `pg_dump` Production somente de leitura e GPG exit 0; backup cifrado de 600.448 bytes, SHA-256 `76f17b44e3d3e87b3735a0606295d389be7b013ff42a35eb7c4dee76292b778d`. `psql` 17.11 exit 0, zero erros SQL em Supabase local isolado. Storage e configurações externas não foram restaurados. |
| Migrations 0119–0132 | **PASS na cópia restaurada; NOT RUN em Production** | 14/14 SQLs em ordem, cada um em transação com `ON_ERROR_STOP=1`; journal 119 → 133; zero constraints públicas não validadas. Nenhuma migration remota foi aplicada. |
| Contratos legados | **PASS de preservação na cópia** | Os quatro registros de assinatura conservaram exatamente todos os campos pré-existentes; os planos e preços legados também tiveram digest igual antes/depois. Os cinco planos 2026 nasceram inativos. Não houve atualização de contrato real. |
| Três contratos DEV sem titular | **PARTIAL, não bloqueio direto de Production** | São três registros DEV `past_due` sem profile/paciente/agendamento; possuem IDs de assinatura Asaas e histórico variável. Não se comprovou quem removeu os titulares. Production tinha zero órfãos no readback anterior. Não foram alterados. |
| Renovação anual | **PARTIAL — limitação temporal e risco financeiro** | Código, parcela futura e reconciliação têm evidência anterior; cobrança automática no vencimento após um ano ainda não pode ser observada. O HTTP 400 `invalid_action` histórico de `paymentBook` não tem descrição completa preservada; o método cria parcela, não força pagamento. Exige monitoramento e aceite formal de risco residual para lançamento. |
| Turnstile | **PASS funcional em Preview apropriado; CI 2 SKIP** | Teste positivo 201 e negativo 401 anteriores usaram Previews com secrets de teste distintos. A CI pública passou 7 e ignorou 2 por ausência intencional das chaves no build isolado. A configuração efetiva de Production ainda deve ser conferida antes de reabrir cadastro. |
| Tier Gemini | **PARTIAL — decisão operacional externa** | Código não alterado. Confirmar no projeto/chave de Production o tier, faturamento, crédito e política de tratamento de dados antes de usar IA com dados de pacientes. Nenhum plano externo foi comprado. |
| Landing candidata | **PASS de coerência de fonte; public ainda divergente** | Candidata mantém Consultório R$197/1 médico, Clínica R$397/2 médicos + R$147 por médico adicional até 5, até 3 acessos de equipe, anual por 10 mensalidades e trial 14 dias. A landing pública ainda anuncia oferta antiga por desenho do rollout; não foi publicada isoladamente. |
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
2. Confirmar backup gerenciado/PITR do Supabase e plano de Storage; o dump lógico não é recuperação completa do serviço.
3. Conferir Turnstile efetivo de Production, tier Gemini e revisão contratual, sem expor chaves.
4. Obter aceite explícito do risco temporal da renovação anual ou adiar contratação anual.
5. Na janela autorizada, seguir [o roteiro coordenado](../runbooks/publicacao-coordenada-oferta-2026-10.md): fechar cadastro por novo deployment, confirmar 503, aplicar migrations com backup cifrado/advisory lock, verificar contratos, publicar app e landing juntos, reabrir cadastro em novo deployment e executar smoke/monitoramento.

**Decisão atual: NO-GO de Production.** O restore lógico e o teste em dados reais eliminam o bloqueio técnico anterior; faltam gates externos e a publicação coordenada autorizada. Nenhum merge, deploy de Production, cobrança ou migration remota ocorreu nesta rodada.
