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
