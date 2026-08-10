# Reset do banco de produção antes do go-live

Use este procedimento somente para limpar a base de pré-lançamento autorizada. Ele remove dados de clínicas e artefatos operacionais do PostgreSQL, preservando apenas o profile de super-admin indicado e a configuração necessária ao runtime.

Não toca Supabase Auth, Storage, Asaas nem Meta. Após o reset, as contas Auth externas podem continuar existindo sem profile; não as remova por este runbook.

## Pré-requisitos

- Branch revisada e testes verdes.
- `pg_dump` disponível no `PATH`.
- `DATABASE_URL_PROD` conferida para o projeto correto.
- UID do único super-admin que será preservado.

## Passos

1. Abra uma sessão PowerShell exclusiva e defina o opt-in:

```powershell
$env:SUPABASE_PROJECT_ENV = 'prod'
$env:DATABASE_URL_PROD = '<URI production com sslmode=require>'
```

2. Execute a simulação e confira que o perfil a preservar é um `super_admin` sem `clinic_id`:

```powershell
pnpm reset:prod --preserve-user-id 5d7da268-292b-4035-9fc0-972232dd7234
```

3. Execute a limpeza somente após revisar a prévia. O script cria um backup SQL em `backups/` antes da transação de remoção:

```powershell
pnpm reset:prod --apply --confirm=RESET_PRODUCTION_DATA --preserve-user-id 5d7da268-292b-4035-9fc0-972232dd7234
```

4. Confira a mensagem final de verificação: `clinics=0`, `profiles=1` e tabelas transitórias vazias.

## Rollback

Interrompa se a etapa de backup falhar: nenhuma escrita terá começado. Depois de uma limpeza concluída, restaure somente pelo backup gerado, em uma janela controlada, usando o procedimento de restore do Supabase/PostgreSQL. Não use o backup para sobrescrever Auth, Storage ou Asaas.
