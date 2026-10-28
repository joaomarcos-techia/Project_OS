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
