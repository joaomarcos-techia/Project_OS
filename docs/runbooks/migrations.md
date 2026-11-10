# Runbook de migrations

## Status

Reference — procedimento atual. Fonte executável: `scripts/db-migrate-*.ts` e `drizzle`.

## Preparação

1. confirme `git status` e migration nova append-only;
2. rode `pnpm check:migrations` e `pnpm arch:db-check`;
3. revise SQL, lock, duração, grants, RLS, rollback e compatibilidade com código anterior;
4. confirme URL/ambiente sem imprimir credencial.

### Ordem lógica do journal

O Drizzle seleciona migrations pendentes pelo `when` do journal, não apenas pelo prefixo do arquivo. O gate `check:migrations` exige índices/prefixos contíguos e valores `when` estritamente crescentes antes de qualquer aplicação. Um arquivo novo com timestamp menor ou igual ao último aplicado pode ser ignorado pelo migrador; não use uma contagem como prova de aplicação.

O `when` é uma versão lógica, não o horário observado da execução. A 0142 usa `1794326400000` (10/11/2026 16:00 UTC), embora tenha sido aplicada no DEV às 04:36 UTC. **Não regravar esse histórico.** Ao preparar uma migration nova ainda não aplicada, a engenharia deve usar uma versão maior que a anterior (`max(horário atual, versão anterior + 1)`), validar o gate e confrontar o prefixo/journal com o histórico remoto. Esse ajuste vale só para a entrada nova não aplicada; não reescreve migrations anteriores ou o banco. Nenhuma configuração de CI/deploy foi alterada para adicionar essa verificação ao checker existente.

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
