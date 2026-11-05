---
title: "Guia de decisão para mudanças"
description: "Guia de decisão para mudanças — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Reference — ponte operacional usada pelos templates de issue/PR e pelo aviso de ADR no CI.

## Scope

Ajuda a escolher o owner, a documentação e os gates antes de implementar. Não redefine arquitetura, banco ou workflow.

## Fluxo

1. Procure implementação, contrato, documento e helper existentes; estenda em vez de duplicar.
2. Defina o bounded context owner em [context-map](/architecture/context-map).
3. Se mudar boundary, isolamento, provider, contrato público, modelo de dados ou decisão transversal, registre uma ADR conforme o [índice de decisões](/adr/index).
4. Se tocar banco, atualize schema e migration append-only juntos; revise constraints, indexes, grants e RLS conforme [schema](/database/schema) e [runbook](/runbooks/migrations).
5. Comunicação entre contexts usa contrato/evento e outbox; não introduza dependência direta sem decisão explícita.
6. Atualize testes e a fonte documental canônica afetada, depois execute os gates proporcionais ao risco.

## Referências canônicas

- [Convenções](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/CONVENTIONS.md)
- [Definition of Done](/engineering/definition-of-done)
- [Desenvolvimento com IA](/engineering/ai-development)
- [Workflow Git](/engineering/git-workflow)
- [Prontidão de produção](/runbooks/production-readiness)
