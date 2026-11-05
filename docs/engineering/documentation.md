---
title: "Como manter a documentação"
description: "Convenções de organização, autoria, links, evidências e validação adotadas pelo Qoro."
docType: "guide"
---

## O que vem do Mintlify

As referências oficiais são [páginas](https://www.mintlify.com/docs/organize/pages),
[navegação](https://www.mintlify.com/docs/organize/navigation),
[configuração](https://www.mintlify.com/docs/organize/settings) e
[validação](https://www.mintlify.com/docs/cli/commands#mint-validate).

| Convenção | Exigência da ferramenta ou escolha deste projeto? |
| --- | --- |
| `docs.json` com nome, tema, cor principal e navegação | Configuração da ferramenta |
| Páginas em `.md` ou `.mdx` | Ambos são aceitos; Markdown é preservado quando não há componentes |
| Referências da navegação sem extensão | Formato da ferramenta |
| Um padrão principal de navegação | Orientação oficial; usamos abas para seções do mesmo público técnico |
| `title` e `description` explícitos | Convenção do Qoro; o Mintlify permite omiti-los |
| Um assunto principal por página | Convenção editorial adotada para facilitar leitura e manutenção |
| Separar regra atual, proposta e evidência | Regra de governança do Qoro |

Não descreva uma convenção editorial nossa como limitação obrigatória do Mintlify.

## Escolha o lugar certo

| Tipo de conteúdo | Lugar | Pode definir a regra atual? |
| --- | --- | --- |
| Visão geral e estado da revisão | `overview/`, `architecture/` | Sim, dentro do escopo identificado |
| Regra implementada do domínio | `onboarding/`, `billing/`, `domains/`, `ai/` | Sim, com referência ao código |
| Procedimento operacional | `runbooks/`, `operations/` | Define como operar, não autoriza executar |
| Decisão arquitetural | `adr/` | Registra decisão e contexto; observar revisões e compatibilidade |
| Especificação ou implementação planejada | `specs/`, `implementation/` | Não, até confrontar implementação e evidência |
| Resultado de teste ou auditoria datada | `quality/`, `audits/`, `evidence/`, `achados/` | Não; comprova somente o cenário descrito |
| Handoff, checkpoint e material substituído | `archive/` e registros históricos existentes | Não |
| Inventário gerado | Local indicado pelo gerador, como `security/acoes.md` | Não editar manualmente |

O [catálogo](/catalog) cobre também arquivos mantidos fora da navegação.
Ausência da barra lateral não significa descarte do documento nem controle de acesso.

## Escreva uma página

Use nomes estáveis e descritivos. Novos caminhos usam minúsculas e hífens. Não
renomeie caminhos referenciados por código, CI ou runbooks sem atualizar as
referências e preparar uma ponte de compatibilidade.

```yaml
---
title: "Nome do assunto"
description: "O que esta página explica e para qual tarefa serve."
docType: "reference"
---
```

O título vem dos metadados; o corpo começa com uma introdução curta e subtítulos
`##`. Evite repetir um `#` igual ao título. Use listas numeradas para passos,
tabelas para comparações e blocos com linguagem para comandos.

Uma referência de domínio explica responsabilidade, entradas, estados, integrações,
erros e fonte no código. Um runbook informa ambiente, pré-requisitos, autorização,
comandos, resultado esperado, interrupção, recuperação e evidência. Um relatório
informa data, revisão, ambiente, cenário executado e o que não foi comprovado.

## Atualize a navegação e o catálogo

1. Coloque a página no grupo correspondente de `docs.json`, sem `.md` ou `.mdx`.
2. Se for um registro propositalmente fora da navegação, classifique-o no catálogo.
3. Se substituir uma referência principal, retire a duplicação do índice antigo
   e aponte para a referência nova.
4. Preserve decisões e evidências antigas com data e escopo. Não reescreva um
   resultado histórico como se tivesse sido executado novamente.
5. Atualize `organizar_docs.md` depois de um bloco relevante desta reorganização.

## Valide antes de entregar

A partir da raiz do checkout, confira a estrutura e os testes documentais:

```powershell
node docs/tooling/catalog.mjs
node --test docs/tooling/catalog.test.mjs
```

Quando adicionar arquivos, use `node docs/tooling/catalog.mjs --write` e revise
o diff gerado. O catálogo classifica o acervo; não transforma cada texto antigo
em regra revalidada. Os links `/assunto/pagina` são rotas do portal; para ler no
Git, use também os índices `README.md` e os links dos registros originais.

A CLI utilizada nesta reorganização é o pacote oficial `mint`, versão fixada
`4.2.1203`, executado sem adicionar dependência ao aplicativo:

```powershell
Set-Location 'C:\dev\ClinicaOS_V2_docs_mintlify_20261105\docs'
npx --yes mint@4.2.1203 --telemetry=false validate
npx --yes mint@4.2.1203 --telemetry=false broken-links
npx --yes mint@4.2.1203 --telemetry=false dev --port 3334 --no-open
```

Em outro checkout, troque somente o caminho da primeira linha pelo diretório
`docs` correspondente. O servidor local não exige contratação ou publicação.

Não use `mint deploy`, não conecte GitHub ao serviço e não ative automações para
publicar documentação interna durante uma tarefa de organização local.

## Cuide das referências e dos dados

Não inclua credenciais, senhas, códigos ativos, URLs assinadas, links com bypass
ou conteúdo de pacientes. Use nomes de variáveis e exemplos sintéticos. Código
comprova implementação; credenciais, migrações remotas e saúde dos provedores
exigem evidência própria. Mudança documental não aprova alteração de preço,
contrato, cobrança ou operação em Produção.
