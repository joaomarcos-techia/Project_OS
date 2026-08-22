# Runbook de migrations

## Status

Reference — procedimento atual. Fonte executável: `scripts/db-migrate-*.ts` e `drizzle`.

## Preparação

1. confirme `git status` e migration nova append-only;
2. rode `pnpm check:migrations` e `pnpm arch:db-check`;
3. revise SQL, lock, duração, grants, RLS, rollback e compatibilidade com código anterior;
4. confirme URL/ambiente sem imprimir credencial.

## Desenvolvimento

```bash
pnpm db:migrate:dev
```

Depois rode testes focados e verificação conectada apropriada. Não presuma que Drizzle schema prova aplicação da migration.

## Produção

`pnpm db:migrate:prod` é destrutivo no sentido operacional: exige autorização explícita. O script requer ambiente PROD, cria backup, usa advisory lock e registra progresso. Não execute com variáveis DEV nem contorne guards.

Checklist:

- backup concluído e recuperável;
- migration id/sha revisados;
- janela de operação definida;
- lock adquirido/liberado;
- tabela de migrations contém a nova versão;
- constraints, grants/RLS e smoke pós-migration verificados;
- deploy compatível concluído ou rollback decidido.

## Falha

- Pare; não reexecute cegamente.
- Descubra se a transação fez rollback e qual versão foi registrada.
- Migration parcial fora de transação exige plano manual revisado.
- Restore usa ambiente isolado primeiro; não sobrescreva produção para “testar”.
