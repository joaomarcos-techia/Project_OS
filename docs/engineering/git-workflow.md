---
title: "Workflow Git"
description: "Workflow Git — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Reference — mudanças revisáveis e preservação do worktree.

1. Inspecione `git status --short` e identifique alterações preexistentes.
2. Faça diff pequeno, com um objetivo.
3. Rode testes focados durante o desenvolvimento e o gate completo antes do handoff.
4. Antes de commit: revise nomes staged, `git diff --cached`, `git diff --cached --check` e added-line secrets.
5. Não use `reset --hard`/checkout destrutivo para limpar trabalho alheio.
6. Não altere CI, migration ou contrato público sem aprovação quando exigida.

Mensagem/PR deve dizer comportamento, risco, testes executados e o que não foi validado externamente.
