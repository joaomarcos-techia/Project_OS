# Organização técnica da documentação com Mintlify — 05/11/2026

## Escopo e revisão

Worktree `C:/dev/ClinicaOS_V2_docs_mintlify_20261105`, branch
`codex/docs-mintlify-20261105`, baseado em `main`
`af677c00cfb9a4faa8474ddbf1d69d489d8c8849`.

Organização da documentação do próprio sistema; sem publicação, conta Mintlify,
mudança de dependência de produção, CI, aplicativo, banco ou provedor. O worktree
principal e suas alterações anteriores foram preservados. O pedido posterior
de HTML para Supabase foi tratado como entregável separado, sem ativação.

## Organização entregue

- `docs/docs.json`: seis abas e 40 páginas curadas, usando Markdown nativo.
- `docs/.mintignore`: compila o manual; mantém o acervo bruto no repositório.
- `docs/catalog.md` / `catalog.json`: inventário determinístico por finalidade,
  incluindo decisões, procedimentos, especificações, evidências e histórico.
- `docs/tooling/catalog.mjs`: valida navegação, metadados, links internos, favicon
  e atualização do catálogo. Não lê credenciais nem executa operações externas.
- Índices de ADRs, runbooks, especificações, evidências e percursos de leitura.
- Referências focadas para cadastro, convites, planos, assinaturas e política
  financeira; arquitetura com 13 contextos, incluindo `payments`.
- Pontes para os caminhos antigos e links ao snapshot anterior. Os 220 arquivos
  originais continuam presentes; o inventário gerado `security/acoes.md` não mudou.

## Correções documentais verificadas no código

A referência atual não apresenta mais o catálogo Solo/Clínica/Pro como única
oferta, cadastro apenas por convite, 80 migrations como contagem atual ou preço
por meio de pagamento como implementação planejada vigente. Foram separados
legados, nova oferta, flag anual, trial desde Auth, médicos e equipe, permissões
avançadas, pagamento do paciente, crédito antecipado e repasse.

O journal versionado contém 136 entradas, até `0135_ai_clinic_operational_info`.
Isso não é consulta ao journal remoto. As leituras externas históricas de banco,
Meta, Gemini, Asaas e e-mail receberam escopo de data; não foram reexecutadas.

## Validação executada

| Verificação | Resultado | Alcance |
| --- | --- | --- |
| `node docs/tooling/catalog.mjs` | PASS | 40 páginas, catálogo e links estruturais |
| `node --test docs/tooling/catalog.test.mjs` | PASS — 6/6 | Navegação, slugs, classificação, catálogo e identidade visual |
| `mint@4.2.1203 --telemetry=false validate` | PASS | Build completo e validação estrita Mintlify |
| `mint@4.2.1203 --telemetry=false broken-links` | PASS | Nenhum link interno quebrado identificado |
| ESLint das duas ferramentas `.mjs` | PASS | Sem avisos ou erros |
| Prettier dos arquivos JS/configuração | PASS | Invocação direta da versão instalada |
| `git diff --check` | PASS | Sem problemas de whitespace |
| Chromium desktop/mobile | PASS — 12/12 | Início, arquitetura, cadastro, planos, catálogo e ADRs |
| Preservação do acervo original | PASS | 220 arquivos presentes; inventário gerado byte a byte igual |

No Chromium, foram inspecionados início, arquitetura, cadastro, planos, catálogo
e ADRs em 1440 e 375 px. Todos responderam HTTP 200, com um título H1 e sem
overflow horizontal. A logo preservou os seis paths da identidade existente.
Screenshots e resultados locais estão em
`dist/quality/docs-browser-results.json` e `dist/quality/*.png`, ignorados pelo Git.

A primeira tentativa de `pnpm exec prettier` encontrou o mecanismo de instalação
automática da versão local do pnpm e foi abortada sem TTY. A validação foi feita
diretamente pelo Prettier instalado, sem reinstalar o `node_modules` compartilhado.
A primeira importação do inspetor usou `playwright`, indisponível no topo do
checkout; foi corrigida para o `@playwright/test` já instalado. Esses erros de
ferramenta não foram contados como aprovação.

## E-mail: decisão final mantém Resend

O usuário descartou a troca para envio nativo Supabase e pediu somente a logo no
template atual. Os rascunhos dessa alternativa foram retirados da entrega e
preservados em `dist/quality/supabase-draft-cancelled`, fora do Git.

A alteração do template real tem validação própria em
`docs/quality/confirmacao-email-logo-2026-11-05.md`: 104 testes, 6 cenários visuais,
TypeScript, lint e build Next aprovados. O código de oito dígitos e sua validação
permanecem no fluxo existente. Não houve novo envio externo nem mudança de SMTP.

## O que não foi refeito

Na etapa exclusivamente documental, não foram repetidos os milhares de testes
de aplicação nem o build Next. A alteração posterior da logo executou seus gates
próprios; a consolidação para `main` exige também a CI do PR. Não afirmar que todos os relatórios
históricos foram revisados parágrafo por parágrafo: eles foram inventariados e
classificados, preservando autoria, contexto e data.

## Referências oficiais

- [Páginas Mintlify](https://www.mintlify.com/docs/organize/pages): `.md` e `.mdx`, metadados opcionais na ferramenta.
- [Navegação](https://www.mintlify.com/docs/organize/navigation) e [configuração](https://www.mintlify.com/docs/organize/settings).
- [Validação Mintlify](https://www.mintlify.com/docs/cli/commands).

Metadados explícitos e separação entre evidência/proposta/manual são convenções
editoriais adotadas pelo Qoro, não exigências universais inventadas da plataforma.
