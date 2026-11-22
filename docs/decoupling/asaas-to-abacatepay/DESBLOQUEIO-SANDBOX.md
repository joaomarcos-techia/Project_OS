# Comprovar Dev mode sem criar cobrança

## Resultado atual — PASS

Em 07/11, às 22h24 de Brasília (08/11, 01h24 UTC), a chave configurada consultou o produto fornecido pelo titular, `prod_yFBfdSA5twXU3hLREy1YkJtW`, e a API V2 retornou **`devMode=true`**, BRL, 100 centavos, sem ciclo nem trial. A fixture corresponde ao produto avulso de R$1,00 previsto. O preflight também confirmou zero checkouts de assinatura. [Evidência sanitizada](SANDBOX-ATTESTATION-2026-11-07.json).

**Não é necessário criar outro produto, enviar chave nem repetir esta ação.** A engenharia realizou cinco GETs nesta continuação e nenhuma mutação; o produto foi criado manualmente pelo titular e será mantido como testemunho de ambiente. Esse PASS não homologa pagamento, recorrência, webhook ou equivalência financeira.

## O que já foi feito

A chave `ABACATEPAY_API_KEY` já foi encontrada e autenticou na API V2. Não é necessário enviá-la, copiá-la, renomeá-la nem substituí-la. Nas nove leituras iniciais, nenhum objeto retornou `devMode` porque as listas estavam vazias. HTTP200 sozinho provou somente autenticação; a leitura posterior do produto resolveu a comprovação de ambiente.

## Procedimento realizado — referência para repetição futura

O print enviado pelo titular em 07/11 confirma o painel da loja `qoro.dev` com a faixa **“Você está no Modo de teste (Sandbox)”** e o seletor **“Modo Teste (Sandbox)”** ligado no menu lateral. O catálogo está vazio e o botão **“Novo produto”** está visível no canto superior direito. Não é necessário procurar nem alternar novamente o modo. Essa evidência confirma o ambiente exibido no painel, mas ainda não vincula a chave local a ele; a leitura autenticada do produto continua necessária.

1. Abra o [painel AbacatePay](https://app.abacatepay.com/) e confira que está na mesma loja da chave configurada.
2. Confira que a faixa superior continua indicando **Modo de teste (Sandbox)** e o seletor lateral está ligado. Não clique em **“Ir para produção”**. Se o ambiente estiver em produção, pare; não crie nada.
3. Em [Produtos](https://app.abacatepay.com/products?status=ACTIVE&chargeType=all), clique em **“Novo produto”** no canto superior direito e crie **somente um produto de teste**, não um checkout nem assinatura:
   - nome: `TESTE Qoro — prova de ambiente 20261107`;
   - identificador externo, se houver esse campo: `qoro-env-probe-20261107`;
   - preço sintético: R$1,00; moeda BRL;
   - avulso, sem recorrência, trial, anexos ou dados de clientes.
4. Informe somente o ID do produto, com início `prod_`. O ID não é uma credencial. Não envie API key, screenshot com chave, secret de webhook nem link de pagamento.

Esse registro não cobra ninguém. Ele permite à engenharia executar `GET /products/get?id=...` e exigir `devMode=true` na resposta autenticada. A declaração visual, sozinha, não substitui essa consulta.

## Fixture preparada antes da criação

| Campo             | Valor                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ID            | `qoro-env-probe-20261107`                                                                                                                                                                                       |
| Objetivo          | Prova do ambiente no recurso da API V2; nenhum pagamento                                                                                                                                                        |
| Inicial observado | Catálogo vazio, zero checkouts de assinatura nas leituras desta rodada                                                                                                                                          |
| Recurso permitido | Um produto avulso sintético identificado acima                                                                                                                                                                  |
| Esperado          | Mesmo produto consultado, BRL, 100 centavos e `devMode=true`                                                                                                                                                    |
| Proibido          | Checkout, cliente, assinatura, transação, arquivo, mensagem ou cobrança                                                                                                                                         |
| Limpeza           | Após registrar a prova, apagar somente esse produto no painel Dev mode, ou manter até o fim da homologação se for usado como testemunho. Engenharia não excluirá automaticamente sem conferir ID e dependências |

## Comando de conferência preparado

O agente pode executar o comando abaixo após receber o ID. Quem preferir executar manualmente deve substituir `prod_ID_DO_TESTE` pelo ID real do produto sintético:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
.\node_modules\.bin\tsx.cmd --conditions=react-server scripts/abacatepay-readonly-check.ts --env-file 'C:\dev\ClinicaOS_V2\.env.local' --product-id 'prod_ID_DO_TESTE'
```

Resultado esperado: `authentication=PASS`, `sandbox=PASS`, `mutations=0`. Se responder `environment_mismatch`, parar todos os comandos de criação. Se responder `BLOCKED`, informar somente o código sanitizado. Não colar respostas brutas da API.

## O que esta ação não resolve

Ela concluiu a comprovação de ambiente. A equivalência do trial absoluto de 14 dias, do upgrade imediato com proporcional e da reativação ainda precisa de solução/homologação antes de ligar o gateway ao cadastro Qoro. O [plano mestre](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md) registra essas diferenças. Não há cutover ou publicação autorizados nesta etapa.

## Referências conferidas em 07/11

- [Índice oficial da API V2](https://www.abacatepay.com/llms.txt): catálogo de endpoints; não é evidência da configuração da conta.
- [Dev mode](https://docs.abacatepay.com/pages/devmode): os testes pela API usam chave de desenvolvimento.
- [Criação de produto](https://docs.abacatepay.com/pages/products/create): produto de catálogo separado do checkout; preço em centavos e moeda BRL.
- [Consulta de produto](https://docs.abacatepay.com/pages/products/get): leitura do recurso antes de autorizar operações financeiras de teste.

Na conferência do print e das referências houve somente leitura da documentação pública e análise da imagem. Na continuação, o recurso criado pelo titular foi consultado pela API. Nenhum novo recurso, checkout, cobrança ou alteração de configuração foi executado pela engenharia.
