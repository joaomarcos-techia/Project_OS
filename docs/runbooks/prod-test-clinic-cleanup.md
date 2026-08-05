# Limpeza de clínicas de teste em produção

Use somente para clínicas de teste identificadas por UUID. O script não aceita
um comando de apagar todas as clínicas: faça primeiro a simulação, revise os
IDs e informe-os explicitamente na execução destrutiva.

## Pré-requisitos

- Backup do banco de dados da aplicação criado automaticamente em `backups/`.
  Ele não inclui usuários do Supabase Auth, objetos do Storage nem registros
  externos do Asaas; por isso a execução exige IDs explícitos e confirmação.
- Variáveis de produção definidas somente na sessão atual:
  `SUPABASE_PROJECT_ENV`, `DATABASE_URL_PROD`, `SUPABASE_URL_PROD`,
  `SUPABASE_SECRET_KEY_PROD` e `SUPABASE_PROJECT_REF_PROD`.
- Se a simulação listar assinaturas Asaas, acrescente
  `ASAAS_BASE_URL_PROD` e `ASAAS_API_KEY_PROD` e use `--cancel-asaas`.

## Execução

```powershell
pnpm cleanup:test-clinics:prod
```

O comando acima é somente leitura e imprime as clínicas, usuários Auth,
objetos Storage e assinaturas Asaas associados. Depois de revisar a saída:

```powershell
pnpm cleanup:test-clinics:prod --apply --confirm=DELETE_TEST_CLINICS --clinic-id <uuid-1> --clinic-id <uuid-2>
```

Se houver assinatura Asaas, use:

```powershell
pnpm cleanup:test-clinics:prod --apply --confirm=DELETE_TEST_CLINICS --cancel-asaas --clinic-id <uuid-1>
```

O script cancela recorrências Asaas antes de remover Storage, usuários Auth e
dados SQL. Históricos externos de cliente/pagamento no Asaas não são apagados;
o objetivo é impedir cobranças futuras e eliminar os dados da aplicação.

## Somente banco de dados

Para apagar exclusivamente os registros PostgreSQL e os dados removidos por
cascata ao excluir a clínica, sem consultar ou alterar Asaas, Supabase Auth ou
Supabase Storage, use:

```powershell
pnpm cleanup:test-clinics:prod --apply --database-only --confirm=DELETE_TEST_CLINICS --clinic-id <uuid-1> --clinic-id <uuid-2>
```

Esse modo preserva as assinaturas, usuários de login e objetos de Storage nos
provedores externos; somente as referências SQL vinculadas às clínicas são
excluídas.
