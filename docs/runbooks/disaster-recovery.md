# Recuperação de banco — Qoro

## Alcance do backup

O workflow `db-backup.yml` deve produzir diariamente um único snapshot lógico cifrado de `public` **e** `auth`. Tabelas de `public` referenciam `auth.users`; um dump sem Auth falha no restore estrito. O artifact de 26/10/2026 (483.259 bytes) excluía Auth: a tentativa local com PostgreSQL/Supabase 17.11 e `ON_ERROR_STOP=1` falhou por FK em `appointment_corrections`. Ele continua preservado como evidência, mas **não é um backup restaurável da aplicação**.

O fluxo corrigido envia `pg_dump` direto ao GPG AES-256, sem SQL em claro no disco, não passa a senha GPG em argumentos de processo e verifica o marcador final após descriptografia em stream. `pnpm db:backup:prod` e o backup de `pnpm db:migrate:prod` usam a mesma composição. O operador precisa de `BACKUP_PASSPHRASE`; ausência da senha bloqueia a migration antes de qualquer DDL. **Nos scripts locais**, a conexão é passada ao `pg_dump` por variáveis `PG*`, não em argv; o workflow de CI ainda passa a URL como argumento ao processo no runner privado.

Este snapshot **não** inclui objetos do Supabase Storage, nem substitui as configurações de Auth, chaves JWT, provedores externos, Edge Functions e backups gerenciados/PITR do Supabase. Confira separadamente esses componentes antes de tratar o serviço como totalmente recuperável. A [documentação oficial de backup do Supabase](https://supabase.com/docs/guides/platform/backups) confirma que backup de banco não contém os arquivos do Storage; o [guia oficial de restauração](https://supabase.com/docs/guides/self-hosting/restore-from-platform) inclui `auth.users` e descreve as demais configurações necessárias.

## Prova local de 28/10/2026

- Docker Desktop 4.97.0, Engine/Client 29.9.2, WSL2 e Supabase CLI 2.122.0 funcionaram. Imagem oficial `public.ecr.aws/supabase/postgres:17.11.0.006`; `supabase_vault` 0.3.1 disponível.
- Nova cópia da Produção obtida **somente por leitura**, com Auth e public no mesmo `pg_dump`: GPG e `pg_dump` exit 0; 2.965.219 bytes decifrados em memória; 600.448 bytes cifrados; SHA-256 do arquivo cifrado `76f17b44e3d3e87b3735a0606295d389be7b013ff42a35eb7c4dee76292b778d`. Está em `%TEMP%/qoro-restore-lab-20261028/prod-20261028-public-auth.sql.gpg`, fora do Git. Não é o artifact antigo.
- Restaurada com `psql` 17.11, `ON_ERROR_STOP=1`, função local `supabase_admin`, exit 0 e zero erros SQL. No destino: 135 tabelas public, 27 auth, 8 usuários Auth, 4 clínicas, 8 profiles, 4 assinaturas, 25 pacientes, 64 agendamentos, 1.486 eventos de auditoria, 254 FKs public, 145 políticas public e zero constraints public não validadas. Essas contagens agregadas coincidiram com leitura da origem após o backup.
- Destino: dois contêineres descartáveis com `--network none`, nenhuma porta, `--log-driver none`, dados PostgreSQL em `tmpfs`, memória e limite de swap iguais; nenhum SQL decifrado foi gravado como arquivo. Após as verificações, os dois contêineres e o volume sintético de inicialização foram removidos. O arquivo GPG original de 26/10 foi preservado.
- A sequência 0119–0132 passou, 14/14, numa segunda restauração isolada. Consultar [fechamento da oferta](../quality/fechamento-oferta-2026-10-28.md) para os readbacks.

**Limite da prova:** recuperação lógica de `public`+`auth` e compatibilidade das migrations. Não houve restauração de objetos Storage, configuração completa do serviço ou recuperação da Produção ativa.

## Repetição segura do drill

1. Em estação autorizada, obtenha o artifact `.sql.gpg` e a senha do cofre. Confirme hash, origem, data, espaço livre, Docker e versão do PostgreSQL. Não extraia `.sql` para a pasta do projeto.
2. Inicie **um contêiner novo**, com nome exclusivo, imagem Supabase PostgreSQL compatível, `--network none`, sem `-p`, `--log-driver none`, `--memory 2g --memory-swap 2g`, `--tmpfs /var/lib/postgresql/data:rw,nosuid,size=1g` e `--tmpfs /tmp:rw,nosuid,size=128m`. Verifique `docker inspect`: rede `none`, `PortBindings={}`, `Tmpfs` nos dois caminhos e log `none`. Não use Production nem DEV compartilhado.
3. Verifique o servidor e a extensão dentro do contêiner com `psql -U supabase_admin -d postgres -X -Atqc "select current_setting('server_version'),(select extversion from pg_extension where extname='supabase_vault')"`.
4. Em Bash com `set -o pipefail`, leia a senha de forma oculta (`read -rs BACKUP_PASSPHRASE`), envie-a apenas ao stdin do GPG, e faça pipe do SQL decifrado diretamente para `docker exec -i NOME psql -X -w -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`. Exemplo para o trecho GPG: `printf '%s\n' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --no-tty --pinentry-mode loopback --passphrase-fd 0 --decrypt "$BACKUP"`. Desfaça a variável após a execução. **Ambos** os códigos de saída e qualquer erro SQL devem ser verificados; não use `ON_ERROR_STOP=0`.
5. Conte tabelas public/auth, `auth.users`, clínicas, profiles, assinaturas, pacientes, agendamentos, eventos, FKs, políticas, constraints não validadas e migrations. Compare com a origem do **mesmo snapshot** ou com contagens tomadas na janela de backup; contagens de outro dia não provam paridade. Teste consultas essenciais sem expor dados pessoais.
6. Para migrations, restaure **outra** instância isolada do mesmo arquivo. Aplique as migrations pendentes em ordem e transações individuais, verificando código de saída e readback. Preserve a primeira instância até a comparação. Destrua somente os contêineres identificados após a prova; nunca execute limpeza recursiva em caminho genérico.

`pnpm restore:test` ainda aceita arquivo SQL e URL local e **não** deve ser usado para decifrar o artifact nem para declarar recuperação de Auth/Storage por conta própria. O comando de Production `pnpm db:migrate:prod` continua proibido até autorização da janela de rollout; backup pré-migration não substitui restore testado.

## Estratégia sem PITR, em 28/10/2026

O titular observou oito backups físicos no painel de `qoro-prod`, de 21 a 28/10, o último em **28/10 09:10:54 UTC**. A organização foi consultada em modo leitura e está no plano **Pro**. A [regra documentada do Pro é acesso aos últimos sete dias de backups diários](https://supabase.com/docs/guides/platform/backups); oito linhas visíveis em datas inclusivas não estabelecem retenção contratual de oito dias. Não ativar PITR nem trocar de plano. Os backups físicos são gerenciados pelo Supabase, não são cópias independentes controladas pela Qoro e não incluem os bytes dos arquivos de Storage. O workflow `db-backup.yml` fornece um segundo snapshot lógico **cifrado de public+auth** no GitHub Actions, com retenção configurada de 30 dias; sua primeira execução **agendada** após o merge ainda precisa ser observada. O artifact é dado sensível mesmo cifrado: restringir acesso ao repositório, ao artifact e à senha guardada em cofre; verificar restauração periodicamente.

Sem PITR, uma exclusão ou corrupção exige escolher um snapshot anterior e restaurar a um destino isolado, comparar com o estado atual e só então planejar recuperação seletiva ou troca controlada do serviço. Restaurar o banco ativo diretamente recua **todas** as alterações posteriores: pacientes, agendas, pagamentos, usuários Auth e eventos podem divergir de Asaas, Meta, e-mails e arquivos. O [Supabase recomenda restauração em novo projeto para recuperar linhas antigas](https://supabase.com/docs/guides/platform/clone-project); isso pode ter custo e disparar jobs externos do banco restaurado, portanto exige autorização, contenção e revisão antes de usar. Jamais reexecutar webhooks ou operações financeiras apenas porque o banco voltou no tempo.

**RPO de planejamento:** até aproximadamente 24 horas entre snapshots saudáveis, podendo ser maior após falha do agendamento ou antes de comprovar a cópia de Storage. Não é garantia de perda máxima nem recuperação contínua. **RTO de planejamento:** 24–48 horas para serviço completo, **não comprovado**; o restore local do banco não mediu reconstrução de Auth/Storage, DNS, integrações nem reconciliação financeira. Medir o RTO em drill isolado antes de tratá-lo como compromisso. Para dados médicos, o risco de perder registros do dia e a indisponibilidade durante a recuperação exigem aceite explícito do responsável e um procedimento de contingência clínica.

| Estratégia | O que recupera | Lacuna e decisão |
| --- | --- | --- |
| A — físicos Pro | Snapshot diário do banco gerenciado, sujeito à retenção documentada de sete dias. | Sem recuperação por minuto; Storage binário, configurações gerenciadas e mudanças posteriores ao snapshot ficam fora. Insuficiente sozinha para declarar recuperação completa. |
| B — físicos + cópia independente | Acrescenta dump lógico cifrado `public+auth`, com restore local já comprovado; o workflow tem retenção de artifact configurada em 30 dias. | A execução agendada ainda precisa ser observada. Falta copiar/restaurar Storage e completar o inventário Auth; manter chave e cópia em domínios de falha distintos. É a opção inicial proposta, sujeita a drill completo e aceite do RPO/RTO. |
| C — PITR | Permite escolher um ponto mais próximo do incidente, conforme disponibilidade e configuração do provedor. | Reduz perda entre backups, mas tem custo adicional e **não será contratado agora**. Também não substitui backup dos bytes de Storage e configurações do serviço. |

Controles de baixo custo: verificar diariamente o resultado do backup gerenciado e do workflow cifrado; alertar falha/ausência de artifact sem incluir dados; testar mensalmente a restauração de uma cópia isolada; restringir quem pode apagar dados ou alterar backups; guardar o procedimento e as credenciais de recuperação em cofre separado; manter diário de eventos financeiros para reconciliar Asaas após restore. Esses controles reduzem a chance de falha silenciosa, mas não recuperam eventos que nunca foram salvos em um snapshot.

## Arquivos do Storage

Leitura agregada em Production em 28/10: `admin-exports` (privado, 0 registros), `clinic-logos` (público, 3), `clinical-pdfs` (privado, 36), `lgpd-exports` (privado, 2), `logo_qoro` (público, 1). São **42 metadados em `storage.objects`**, não 42 arquivos físicos comprovados. Nenhum conteúdo ou nome de objeto foi aberto. Os cinco buckets são `STANDARD`, sem versionamento/lifecycle; `clinic-logos` limita arquivo a 5 MiB e tipos de imagem. O SQL restaurado não continha os binários. A [documentação de Storage](https://supabase.com/docs/guides/storage/schema/design) distingue os metadados do conteúdo do provedor; exclusão de objeto não é revertida pelo backup do banco.

O helper `scripts/storage-encrypted-backup.ts` está preparado, **não executado em Production**. Ele exige opt-in explícito, URL/ref/chave da Production e destino local seguro. A chave administrativa tem poderes de escrita, embora o helper invoque apenas listagem e download; por isso a execução exige supervisão e proteção da chave. Enumera buckets e objetos pela Storage API, baixa pelo cliente administrativo, cifra cada corpo e o manifesto com AES-256-GCM, guarda visibilidade, limite de tamanho e tipos MIME dos buckets, verifica SHA-256 e recusa arquivo acima de 32 MiB. Nenhum path de paciente é escrito em claro no disco ou no log. O teste sintético prova cifragem, restauração dos bytes em memória, bucket vazio e detecção de adulteração. A listagem antes/depois detecta alterações de nomes, mas **não produz snapshot atômico nem detecta alteração do conteúdo entre as duas listagens**. Isso não comprova a recuperabilidade real dos 42 registros, não copia políticas RLS de `storage` (o dump lógico exclui esse schema) e não cobre todas as configurações gerenciadas do bucket. Uma política de Storage precisa ser versionada/recuperada separadamente.

Para concluir o gate: escolher e autorizar **um destino local protegido ou cofre de backup independente** com acesso restrito, retenção, cópia fora da máquina e chave separada. Não enviar arquivos clínicos a artifacts do GitHub ou serviço externo por padrão. Rodar o helper em janela supervisionada, confirmar contagem/erros/hash e testar restore para **projeto isolado autorizado**. No destino, recriar buckets com os mesmos limites/visibilidade via API, aplicar políticas versionadas e só então usar `restoreStorageArchive` para subir os bytes verificados; comparar contagem, hashes e acesso público/privado, sem expor arquivos. A API deve executar as mutações, nunca um `INSERT` em `storage.objects`. Não apontar o restore para Production ou DEV compartilhado.

## Configuração do Supabase Auth

O restore de `auth` contém usuários e registros de autenticação, **não a configuração operacional completa**. O [guia de clone do Supabase](https://supabase.com/docs/guides/platform/clone-project) requer reconfigurar Auth settings/API keys e Storage; o [guia de configuração Auth](https://supabase.com/docs/guides/auth/general-configuration) enumera URL, provedores, sessões, e-mail, MFA e rate limits. Inventário seguro a conferir no painel de Production, sem copiar valores para este documento:

| Grupo | O que registrar no cofre operacional |
| --- | --- |
| URL Configuration | Site URL e redirect URLs permitidos, com versão/data. |
| Sign In/Providers | Métodos e OAuth habilitados, projeto/cliente externo e localização dos segredos. |
| Email/SMTP | Provedor, sender, host/porta, template ativo e localização da senha. |
| Sessions/Security | Duração, refresh, confirmação de e-mail, proteção CAPTCHA, rate limits, MFA. |
| Keys e integrações | Onde ficam JWT/API keys, `APP_BASE_URL`, Vercel env, Resend, Turnstile, Google e demais credenciais; jamais valores no Git. |

O [Supabase informa que backups diários não guardam senhas de roles PostgreSQL customizadas](https://supabase.com/docs/guides/platform/backups). Se a Qoro usar essas roles, inventariar **nomes e responsáveis** e manter a redefinição das senhas no procedimento de restauração; não registrar senhas neste arquivo.

Este inventário descreve **o que precisa ser conferido**, não afirma que os valores atuais foram lidos ou que o cofre já está completo. Após desastre, reconstruir um projeto isolado, restaurar o banco, reconfigurar esses grupos no Dashboard/cofre, atualizar secrets específicos do novo projeto na Vercel, fazer novo deployment e provar login, recuperação de senha, confirmação, convite, claims/RLS, redirect e logout com contas sintéticas antes de mudar DNS ou receber pacientes. Segredos antigos não devem ser copiados de DEV nem enviados em chat.

## Drill real de Storage — 29/10/2026

Após autorização explícita para criar a pasta e utilizá-la, o helper baixou os **42 arquivos** nos cinco buckets. Archive cifrado em `%LOCALAPPDATA%/Qoro/Recovery/storage-20261029/qoro-storage-S0upJf`, 2.565.459 bytes; `manifest.enc` SHA-256 `043a66f68862ff974a654a7e010415f86eb4c7a811041c23a606aa31e17c077c`. A ACL da pasta não herda permissões e permite somente o usuário Windows atual. A chave aleatória foi cifrada com DPAPI CurrentUser em `%LOCALAPPDATA%/Qoro/RecoveryKeys/storage-20261029.dpapi`. Nenhum arquivo ou path clínico em claro foi gravado no host e não houve upload externo ou mutação em Production.

O novo `scripts/storage-local-restore-drill.ts` restaura **somente** em contêineres novos e identificados. Usa imagens oficiais Supabase PostgreSQL 17.11.0.006/Storage API v1.81.0, rede Docker `internal`, nenhuma porta publicada, logs desativados, bancos e binários em `tmpfs` e memória/swap limitados. O cliente usa tokens sintéticos locais; corpos entram/saem por pipes em memória. A prova restaurou os cinco buckets e os 42 arquivos pela Storage API, conferiu **42 hashes**, **38 negativas de acesso privado anônimo** e **4 leituras públicas com hash**. Contêineres e rede foram removidos no `finally`; a ausência foi conferida. A primeira tentativa com porta de host falhou ambientalmente; a execução via pipe passou. Não restaura políticas RLS originais nem transforma isso em prova de todo o serviço Auth.

Para repetir **apenas quando necessário**, em PowerShell no worktree da oferta, com Docker iniciado e esta cópia ainda disponível:

```powershell
Add-Type -AssemblyName System.Security
$keyPath = Join-Path $env:LOCALAPPDATA 'Qoro\RecoveryKeys\storage-20261029.dpapi'
$keyBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
  [IO.File]::ReadAllBytes($keyPath), $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$env:BACKUP_PASSPHRASE = [Text.Encoding]::UTF8.GetString($keyBytes)
$env:STORAGE_ARCHIVE_DIR = Join-Path $env:LOCALAPPDATA 'Qoro\Recovery\storage-20261029\qoro-storage-S0upJf'
$env:STORAGE_RESTORE_LOCAL = 'approved'
try {
  pnpm exec tsx scripts/storage-local-restore-drill.ts
  if ($LASTEXITCODE -ne 0) { throw 'Drill não concluiu; não marcar PASS' }
} finally {
  Remove-Item Env:BACKUP_PASSPHRASE,Env:STORAGE_ARCHIVE_DIR,Env:STORAGE_RESTORE_LOCAL -ErrorAction SilentlyContinue
  $keyBytes = $null
}
```

**Ainda pendente:** definir cópia e chave recuperáveis fora desta máquina/perfil e uma rotina supervisionada de snapshots/retentativa/retencão. DPAPI CurrentUser protege o segredo em repouso, mas não é cofre portátil; perder o perfil pode perder acesso à chave. Uma tentativa de envelope portátil com a senha existente de backup foi recusada pelo requisito de comprimento do novo envelope, sem escrever arquivo nem alterar a credencial. Preparar a exportação somente para um cofre aprovado, sem expor a chave em terminal/chat. Não apagar snapshots automaticamente; a retenção operacional será definida com o destino aprovado. A restauração passou para este snapshot, mas não dá RPO futuro sem agendamento. Guardar o arquivo cifrado localmente também não constitui uma cópia independente contra perda do computador.

**Auth em 29/10:** leitura pública `/auth/v1/settings` respondeu 200 e mostrou somente e-mail habilitado, `disable_signup=false` e `mailer_autoconfirm=false`. Não comprova SMTP, URLs, MFA ou hooks. A Management API oficial de configuração respondeu 401 com o acesso disponível, e a CLI Supabase não tinha sessão administrativa. Completar pelo painel/cofre ou autenticação legítima da CLI; não compartilhar PAT por chat.

## Configuração Auth cifrada — atualização após login em 29/10

O titular concluiu o login legítimo e a Management API oficial respondeu 200. Foram inventariadas **243 configurações**, guardadas em `%LOCALAPPDATA%/Qoro/Recovery/auth-20261029/auth-config.dpapi` com ACL restrita ao usuário atual e DPAPI CurrentUser. O readback decifrado em memória foi idêntico à resposta de origem; arquivo cifrado de 40.694 bytes, SHA-256 `7618178c51bc0d34fbe49be16ba6149cf0f69b5069346b36d98a19669655c66b`. A credencial administrativa ficou só em memória e no Credential Manager existente, sem gravação em arquivo do projeto.

| Grupo | Conferência efetiva, sem segredos |
| --- | --- |
| URLs | Site URL é `https://app.qoro.dev`; allow-list de redirects está preenchida e incluída no snapshot. |
| Métodos | E-mail ativo, confirmação obrigatória; provedores OAuth listados desabilitados. |
| SMTP/templates | Host/porta/remetente/usuário/senha e templates retornados; protegidos no snapshot. Nenhum e-mail foi enviado por este teste. |
| Sessões | Refresh rotation ativo; JWT de 900 segundos; campos de timebox/inatividade e reuso incluídos. |
| MFA | TOTP enroll e verify habilitados; configurações de demais métodos incluídas, sem alterar fatores de usuários. |
| Segurança | HIBP ativo; mínimo gerenciado de senha de seis caracteres. CAPTCHA Supabase desabilitado, distinto do Turnstile próprio do Qoro. Rate limits incluídos. |
| Hook de claims | Habilitado e URI corresponde a `pg-functions://postgres/public/custom_access_token_hook`; a função está no schema restaurável. |

O snapshot recupera as configurações retornadas pela API, **não** chaves JWT/API do projeto, segredos Vercel, chaves de criptografia do Qoro ou credenciais de todos os serviços. Antes do GO, conferir no cofre a recuperabilidade de `CRYPTO_MASTER_KEY_V1`, `CRYPTO_LOOKUP_SALT`, `LOGIN_HASH_PEPPER`, segredos de tokens de autenticação, Resend, Asaas, Meta e demais nomes do inventário de ambiente. Sem a chave correta, um SQL com conteúdo cifrado pode ser íntegro e ainda assim não permitir ler os prontuários. Não copiar valores DEV para resolver isso.

### Reconstrução segura do serviço

1. Em incidente autorizado, preservar o banco atual e conter jobs/webhooks. Escolher destino isolado e obter aprovações de custo antes de criar projeto hospedado. Não apontar app público para ele durante a preparação.
2. Restaurar `public+auth` pelo procedimento aprovado e conferir função de claims, RLS, usuários e relacionamentos. Restaurar Storage por API e aplicar as políticas autorizadas; a prova dos bytes não recria automaticamente todas as políticas do serviço gerenciado.
3. Recuperar o snapshot Auth no perfil Windows autorizado: `ProtectedData.Unprotect` sobre o arquivo `.dpapi`, mantendo JSON somente em memória. Sem esse perfil, será necessária a cópia portátil guardada no cofre; ela **ainda não foi preparada**. Não imprimir o JSON nem colocá-lo em Git/artifact.
4. Revisar cada campo contra o [contrato oficial de atualização Auth](https://supabase.com/docs/reference/api/v1-update-auth-service-config). Não enviar cegamente toda a resposta GET para PATCH, pois pode conter campos não editáveis. Reconfigurar somente o projeto de destino explicitamente aprovado; adaptar URLs ao destino, sem remover confirmação, MFA ou validação para facilitar o teste. Recriar o hook apontando para a função restaurada.
5. Manter SMTP e integrações externas sem saída durante o drill; usar destinatários sintéticos e ambiente de e-mail isolado antes de habilitar entrega real. Não usar a senha SMTP real em um teste que possa enviar a pacientes. Reaplicar credenciais específicas do projeto recuperado e fazer novo deployment da aplicação autorizada.
6. Provar com contas sintéticas: login, confirmação, recuperação de senha, convite, claims/tenant, refresh, sessão expirada, revogação, redirects, MFA e logout. Mudança de chaves de assinatura pode invalidar sessões; exigir novo login controlado em vez de reaproveitar cookies de DEV. Se fatores MFA não puderem ser recuperados com segurança, seguir recuperação aprovada pelo provedor, sem desativar MFA como atalho.
7. Só liberar tráfego após readback das configurações, comparação de dados/arquivos, reconciliação financeira e autorização operacional. **Esse drill completo de Auth ainda é NOT RUN**; a prova desta rodada é inventário, snapshot cifrado e readback local.

A pasta e a chave DPAPI continuam no mesmo domínio de falha da estação. Definir cofre e cópia independente permanece pendente. O mínimo de senha gerenciado não foi modificado; eventual alinhamento com a política de senha do Qoro deve ser revisado em janela própria.

## Estado prevalente após ensaio funcional de 29/10

O `NOT RUN` do ensaio Auth acima foi superado para o escopo sintético local: `scripts/auth-local-recovery-drill.ts` concluiu **14 verificações**, usando GoTrue oficial v2.197.0, Postgres/Supabase 17.11, **133 migrations reais do Qoro**, hook de claims real, parser do backend e RLS real. Os sete campos não secretos recuperados do snapshot são expiração JWT, confirmação/e-mail, rotação de refresh, mínimo de senha e TOTP enroll/verify. URLs foram adaptadas ao destino local; SMTP real, templates externos, chaves e usuários reais não entraram nos contêineres.

Passaram: health, carga dos campos, migrations, cadastro sem sessão antes da confirmação, confirmação recebida no SMTP local, login/getUser, claims reconhecidas pelo parser Qoro, leitura da própria clínica e recusa de outra por RLS, token inválido, operação admin proibida, refresh com versão de claims atualizada, recuperação de senha por e-mail local, recusa de replay e de senha antiga, TOTP/AAL2 e logout com refresh recusado. O código nunca presume que logout revoga access tokens criptográficos ainda válidos: a revogação autoritativa por request do Qoro segue coberta pelos testes próprios de `tenant-context`.

Execução final após adequação ESM do SMTP: **103.893 ms** (a execução anterior completa levou 68.575 ms), incluindo inicialização, migrations e cleanup. Rede Docker interna, nenhuma porta publicada, logs desativados, dados Postgres em tmpfs e recursos removidos ao concluir. O primeiro ensaio encontrou a função gerenciada opcional `rls_auto_enable` ausente na imagem local; foi provisionado o corpo funcional do exemplo oficial, sem pular migration. Outra execução detectou body vazio no transporte de logout do próprio runner; o runner foi corrigido. As falhas pertenciam à infraestrutura de teste, não a um bug confirmado do Auth/Qoro.

**PASS:** Auth real recuperado com identidades inteiramente sintéticas, hook/parser/RLS e e-mail local. **PARTIAL:** reconstrução do serviço completo com todas as dependências externas/chaves em cofre e HTTP de uma instância Next recuperada. O ensaio não restaura fatores MFA de pacientes reais, não envia e-mail real e não mede RTO de produção. A comparação Auth/Storage/banco deve continuar respeitando snapshots de horários diferentes.

Pacote portável cifrado, prova de recuperação Linux sem DPAPI, rotina e monitor estão detalhados em [recuperação portável e rotina](recuperacao-portavel-e-rotina-2026-10.md). A exportação real e o agendamento Storage/Auth aguardam o destino independente aprovado. Não há ação de login administrativo pendente.

## Consolidação corrente — 30/10/2026

A nova [auditoria de fechamento](../quality/fechamento-definitivo-oferta-2026-10-30.md) encerrou a lacuna da 0133 no backup real: **15/15 migrations**, campos legados preservados e rollback/concorrência comprovados. O Auth real sintético passou 14 verificações com **134 migrations**. O E2E passou também com a sessão anterior ao downgrade, sem refresh e sem gravação. A configuração da IA tem fallback operacional já existente; corrigiu-se a leitura para que erro/corrupção não reative Gemini. As fotografias anteriores de 14 migrations e ausência de mecanismo identificado de fallback são históricas, não o estado corrente. Produção não foi alterada.

Cofre/cópia independente, configuração externa Auth, desafio real Turnstile, painel Gemini, RTO/contingência e aprovações seguem no [guia humano simplificado](../runbooks/acoes-manuais-pendentes-pricing-2026-10.md). A ausência de PITR e o aceite limitado do intervalo entre backups não encerram esses gates.
