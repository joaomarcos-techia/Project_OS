# Ensaios das migrations 0144 e 0145 (convênios), 11/11/2026

Método da D19 do `QORO_TISS_MASTER_PLAN.md`: nenhuma aplicação persistente no DEV compartilhado enquanto o PR #53
estiver aberto. Cada migration nova é provada de duas formas, sem gravar nada.

| Prova | Onde | Resultado | Log |
| --- | --- | --- | --- |
| Postgres 17 descartável local, com **todas** as migrations reais em ordem (`scripts/security/scratch-schema.ts`) | `scripts/security/health-insurance-clinic-db.ts` | **21/21** (0144, 0145 e numeração; 400 alocações concorrentes em 24 conexões) | `scratch-schema-0144-0145.log` |
| Ensaio transacional no DEV: SQL da 0144 → sondas → `ROLLBACK` | `rehearse-0144.mjs` | **26/26** | `rehearse-0144-dev.log` |
| Ensaio transacional no DEV: SQL da 0144 + 0145 → sondas → `ROLLBACK` | `rehearse-0145.mjs` | **16/16** | `rehearse-0144-0145-dev.log` |

Os UUIDs de clínicas do DEV foram trocados por `<uuid>` nos logs.

## Garantia de não persistência

- Tudo roda numa única transação, encerrada por `ROLLBACK`. As sondas usam `SAVEPOINT` e `ROLLBACK TO SAVEPOINT`.
- A última linha de cada ensaio confere, **depois** do `ROLLBACK`:
  - nenhuma tabela `hi_*`;
  - nenhuma função `hi_next_counter`;
  - nenhum registro em `_schema_version`;
  - `drizzle.__drizzle_migrations` com as mesmas 144 linhas.
- O ensaio não chama o migrator do Drizzle, então nada é gravado em `drizzle.__drizzle_migrations`.

## Recuperação

- **Processo interrompido** (queda de rede, `Ctrl+C`, `CONNECTION_CLOSED`): o Postgres desfaz a transação aberta. Isso foi verificado em 10/11, na carga da terminologia.
- **Conferência depois de qualquer interrupção**, só leitura, no DEV:
  ```sql
  select to_regclass('public.hi_insurers'), to_regclass('public.hi_memberships'),
         to_regprocedure('public.hi_next_counter(uuid,text,text)'),
         (select count(*) from drizzle.__drizzle_migrations);
  -- esperado: null, null, null, 144 (enquanto a 0144/0145 não forem aplicadas)
  ```
- **Se algo tiver persistido**, o que não aconteceu: o cabeçalho de cada migration traz o rollback reverso (`DROP TABLE … CASCADE`, `DROP FUNCTION`, `DELETE FROM _schema_version`). Executar só no DEV, depois de registrar no plano.
