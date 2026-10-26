# Disaster recovery

## Status

Canonical — backup, restore e recuperação.

## Backup versionado

Workflow diário às 06:00 UTC executa `pg_dump` PG17, exclui schemas Supabase gerenciados, cifra com GPG AES-256 e retém artifact por 30 dias. Credencial/chave ficam em secrets do CI.

## Restore test

1. escolha backup e verifique hash/tamanho/descriptografia;
2. crie **PostgreSQL local** com banco dedicado nomeado `qoro_restore_*`; o runner recusa host remoto e nomes genéricos como `postgres` ou `scratch`;
3. prepare nesse scratch as dependências de schema/extensões do dump e execute `pnpm restore:test` com a URL local; qualquer erro SQL ou status não zero do `psql` reprova, mesmo que tabelas antigas continuem visíveis;
4. compare as contagens impressas com as da origem do **mesmo backup** e confira migrations, constraints, RLS e queries críticas; exit 0 do script prova apenas que o SQL terminou e as âncoras puderam ser lidas, não paridade nem cobertura dos schemas geridos pelo Supabase;
5. destrua o scratch somente após validar o path exato.

## Produção

Restore sobre produção é último recurso e exige autorização, RPO/RTO, snapshot adicional, janela, rollback e comunicação. Não teste restore no banco ativo. Auth/Storage/providers têm backups/estados próprios; `pg_dump` não os restaura.

## Evidência — 2026-08-18

Os dez últimos workflows diários concluíram com sucesso. O artifact mais recente contém dump cifrado não vazio e expira em 2026-09-17. Não houve download, descriptografia ou restore nesta auditoria; recuperabilidade permanece `NOT_TESTED`.
