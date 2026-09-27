# Disaster recovery

## Status

Canonical — backup, restore e recuperação.

## Backup versionado

Workflow diário às 06:00 UTC executa `pg_dump` PG17, exclui schemas Supabase gerenciados, cifra com GPG AES-256 e retém artifact por 30 dias. Credencial/chave ficam em secrets do CI.

## Restore test

1. escolha backup e verifique hash/tamanho/descriptografia;
2. crie banco scratch explicitamente identificado;
3. execute `pnpm restore:test` com variáveis do scratch;
4. confira migrations, contagens, constraints, RLS e queries críticas;
5. destrua o scratch somente após validar o path exato.

## Produção

Restore sobre produção é último recurso e exige autorização, RPO/RTO, snapshot adicional, janela, rollback e comunicação. Não teste restore no banco ativo. Auth/Storage/providers têm backups/estados próprios; `pg_dump` não os restaura.

## Evidência — 2026-08-18

Os dez últimos workflows diários concluíram com sucesso. O artifact mais recente contém dump cifrado não vazio e expira em 2026-09-17. Não houve download, descriptografia ou restore nesta auditoria; recuperabilidade permanece `NOT_TESTED`.

## Checkpoint — 2026-09-15

O backup diário de produção está `FAIL`. Os runs de [15/09](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34962218431) e [14/09](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34840979071) instalaram PostgreSQL client 17 com sucesso (`PASS`), mas falharam em `Dump + cifrar` com `FATAL: password authentication failed for user "postgres"` ao conectar pela porta 5432. O upload do artifact ficou `SKIPPED`; esses runs não produziram um novo backup cifrado publicado. A evidência de dez runs verdes acima é histórica, de 18/08, e não descreve este checkpoint.

O [último run de CI observado, de 05/09](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33942979910), passou (`PASS`) em `main`, SHA `93da840f620816e0fdf3300dd82a25f97c01118c`. Esse resultado é independente do workflow de backup e não comprova backup ou recuperabilidade.

O workflow e o script de backup remotos coincidem com os arquivos locais. Os secrets necessários existem e seus guards de presença passaram. A causa comprovada é a rejeição da autenticação apresentada ao banco; senha desatualizada, caracteres reservados sem percent-encoding ou divergência de host/usuário continuam hipóteses. Nenhum valor secreto foi lido, reproduzido ou alterado; `.env.local` não foi consultado e não houve rerun ou acesso ao banco nesta investigação.

**Transição confirmada:** o [último backup PASS, 29/08, run 33252428397](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33252428397), e o [primeiro FAIL, 30/08, run 33308814087](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33308814087), usaram o mesmo commit `3612b08ef13121e6ab92dbedf8086a8d4ce5227d` e o mesmo `pg_dump` 17.11. A primeira falha já foi rejeição de autenticação. O secret tem `updated_at` de 24/07/2026; workflow de backup sem alteração desde 01/07. Não houve alteração de código/workflow/cliente entre sucesso e falha; a mudança específica no estado externo de autenticação depende de evidência do Supabase.

Para corrigir a credencial, o operador deve:

1. abrir o projeto correto no Supabase Dashboard, escolher **Connect → Session pooler** e copiar a conexão completa na porta **5432**;
2. manter o host e o usuário da conexão copiada; no shared pooler, o formato documentado é `postgres.[PROJECT-REF]`. Não deduzir o usuário original apenas pela mensagem de erro;
3. inserir a senha atual do banco e aplicar percent-encoding aos caracteres reservados, seguindo a [documentação oficial de conexão](https://supabase.com/docs/guides/database/connecting-to-postgres);
4. atualizar `DATABASE_URL_PROD` em **GitHub → Settings → Secrets and variables → Actions**, sem enviar a URL ou a senha em mensagens ou logs. Preservar `BACKUP_PASSPHRASE`, pois não houve evidência de falha na cifra;
5. confirmar que o secret foi corrigido e obter autorização específica antes de executar um único rerun do workflow de backup de produção.

**Correção posterior em 15/09:** o fundador confirmou rotação da senha do banco em30/08 e
atualização apenas na Vercel. Autorizou copiar `DATABASE_URL_PROD` de `.env.local` para o
secret GitHub via comando. Atualização PASS, `updated_at=2026-09-15T12:56:26Z`; conexão
foi enviada por stdin, sem exibição/cópia temporária ou alteração do arquivo.
Um único [backup34971934566](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34971934566)
foi disparado às12:57:06Z, somente leitura do banco, para validar a correção e concluiu
**PASS** às12:58:01Z. Instalação PG17, dump/cifra e upload aprovados. API confirmou
artifact `db-backup`, ID10397950443, **527.083 bytes**, `expired=false`, criado12:57:59Z,
expira `2026-10-15T12:57:58Z`. Incidente operacional encerrado. Não houve segundo disparo,
download, descriptografia ou restore.
A autorização adicional de rerun acima era uma interpretação editorial, sem proibição literal
de leitura em §34.2; a instrução original de resolver o workflow e a autorização atual do secret
cobrem este teste. Não inferir permissão para restore/migration/deploy/rotação.

 O fechamento do incidente operacional de backup exige um novo run `PASS` e artifact cifrado não vazio publicado. O fechamento da recuperabilidade exige, separadamente, restore em scratch explicitamente autorizado. No checkpoint final, backup **PASS** e recuperabilidade **NOT TESTED**. A evidência de fechamento é o run remoto acima, independente do gate Chromium da CI.
