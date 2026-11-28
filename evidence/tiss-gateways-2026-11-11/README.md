# CNPJ alfanumérico nos gateways de cobrança (B11), 11/11/2026

## Asaas: executado no sandbox

- **Documentação vigente** (`docs.asaas.com/reference/criar-novo-cliente`, lida em 11/11): `POST /v3/customers`,
  `name` e `cpfCnpj` obrigatórios; `cpfCnpj` descrito só como "CPF ou CNPJ do cliente", sem regra de formato e sem
  menção a CNPJ alfanumérico. Sandbox oficial: `https://api-sandbox.asaas.com`.
- **Ambiente usado:** `ASAAS_BASE_URL_DEV` = `https://sandbox.asaas.com/api/v3`, com a chave `ASAAS_API_KEY_DEV`
  (prefixo de homologação). O script aborta se a URL não for de sandbox ou se a chave não for de homologação.
  **Cuidado:** no `.env.local`, as variáveis sem sufixo (`ASAAS_API_KEY`, `ASAAS_BASE_URL`) apontam para
  **produção**, e não foram usadas.
- **Dados:** CNPJ de teste numérico e o exemplo oficial da Receita (`12.ABC.345/01DE-35`); nome sintético;
  notificações desligadas; nenhuma cobrança criada; clientes apagados no fim.
- **Resultado** (`asaas-sandbox-cnpj-alfanumerico.json`):

| Caso | Enviado | HTTP | Resultado |
| --- | --- | --- | --- |
| controle numérico | `11222333000181` | 200 | aceito, `personType` JURIDICA |
| alfanumérico, sem pontuação | `12ABC34501DE35` | 200 | aceito, devolvido `12ABC34501DE35`, JURIDICA |
| alfanumérico, com pontuação | `12.ABC.345/01DE-35` | 200 | aceito, normalizado para `12ABC34501DE35` |
| alfanumérico com DV errado | `12ABC34501DE36` | 400 | `invalid_object: O CPF/CNPJ informado é inválido.` |

Limpeza: 3 clientes apagados (HTTP 200, `deleted: true`).

**Leitura:** o sandbox aceita CNPJ alfanumérico no cadastro de cliente **e confere o dígito verificador**. Ou seja,
não é uma aceitação de qualquer texto.

**Não comprovado:**
- comportamento em produção;
- assinatura, cobrança ou checkout com esse cliente (exigiria criar cobrança, mesmo que de sandbox; fica como
  próximo passo se o fundador quiser).

## AbacatePay: delegado

A integração está no PR #53, com outro agente, e nenhum agente estava ativo nesta máquina em 11/11. Para não
concorrer nos mesmos endpoints, o teste não foi feito aqui. A verificação equivalente (criar cliente com `taxId`
alfanumérico no ambiente de desenvolvimento da AbacatePay e apagar) fica registrada como dependência do PR #53
(B11) no plano mestre.
