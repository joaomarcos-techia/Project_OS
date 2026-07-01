<!--
Convenções: docs/engineering/git-workflow.md
Regra dura: mudança arquitetural sem ADR = bloqueada (docs/engineering/decision-guide.md).
Antes de abrir: rode os gates locais (typecheck, lint, arch:*, check:migrations, test, build).
-->

## Objetivo
<!-- O problema/necessidade que este PR resolve. 1-3 linhas. -->

## Alterações
<!-- O que mudou, agrupado por área/contexto. Bullet points. -->
-

## Testes
<!-- Como foi verificado. Cole a saída relevante. Não afirme "passa" sem evidência. -->
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm arch:check` / `arch:db-check` (se tocou estrutura)
- [ ] smoke da camada afetada (se aplicável): `pnpm smoke:cN`

## Riscos
<!-- O que pode quebrar. Impacto em produção/dados/segurança. "Nenhum" é uma resposta válida se for verdade. -->

## Rollback
<!-- Como reverter. Se tem migration, descreva a reversão. -->

## Documentação (Documentation-Driven Development)
<!-- Toda mudança documenta a si mesma no lugar certo. Ver docs/engineering/ai-development.md -->
- [ ] Decisão arquitetural → **ADR** criado/referenciado (regra dura)
- [ ] Regra nova → `CONVENTIONS.md`
- [ ] Avanço de camada/feature → `PROGRESS.md` / plano
- [ ] Contrato de evento novo/alterado → `docs/contracts/` + ADR-015
- [ ] `Status`/`Última revisão` atualizados nos docs tocados

<!-- ===== Se este PR CRIA OU ALTERA TABELA, cole aqui o checklist anti-vazamento
     de docs/CONVENTIONS.md (categorias A/B/C do ADR-007 §10) e marque os itens. ===== -->
