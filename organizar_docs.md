# Organização da documentação — Mintlify

Atualizado em 05/11/2026. Branch isolada `codex/docs-mintlify-20261105`, baseada
em `main` `af677c00`. O worktree principal e suas alterações permanecem intactos.

## Escopo

Organizar a documentação técnica do próprio Qoro segundo as convenções oficiais
de páginas, metadados, navegação e validação do Mintlify. Não criar central de
ajuda comercial, conta paga, deploy, conexão externa ou publicação automática.

## Entrega concluída e validada

- Manual focado com seis áreas e navegação em `docs/docs.json`.
- Cadastro, planos, financeiro e arquitetura confrontados com a revisão-base.
- Catálogo completo separando manual, ADRs, procedimentos, propostas e evidências.
- Pontes para caminhos antigos; originais preservados no histórico do Git.
- Validação local de estrutura e compilação Mintlify; resultados finais no relatório.
- Rascunho Supabase retirado da entrega e preservado somente nos artefatos locais
  ignorados. A decisão final mantém Resend; somente a logo do e-mail muda.

## Autoridade

Código/configuração > teste e evidência no cenário executado > referência atual >
proposta e histórico. Organização documental não comprova saúde de provedores.

## Preservação

O checkpoint anterior permanece integralmente na revisão-base:
[organizar_docs.md anterior](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/organizar_docs.md).
Não copiar conteúdo não revisado de worktrees antigos para a referência atual.

## Validação executada

Compilação e validação estrita Mintlify aprovadas, nenhum link interno quebrado,
6/6 testes documentais e 12/12 cenários de navegador da documentação aprovados. ESLint, Prettier
dos arquivos JS/configuração e `git diff --check` aprovados. Os 220 arquivos
originais continuam presentes; o inventário gerado não mudou.

Resultados e limites em `docs/quality/organizacao-mintlify-2026-11-05.md`.

## Próximo passo

Consolidação da documentação e da logo para PR e `main`, autorizada pelo usuário
em 05/11. Sem conta Mintlify, mudança de CI, migration ou alteração de contrato.
Somente integrar após checks aprovados e conferir o deployment do mesmo commit.
