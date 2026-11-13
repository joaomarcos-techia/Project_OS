# E2E de Convênios no navegador — Preview que usa o DEV (12/11/2026)

Spec: `e2e/convenios-preview.spec.ts`. A fixture sintética foi criada no DEV por
`scripts/security/hi-dev-e2e-fixture.ts`, com as clínicas `e2e-hi-paga`, `e2e-hi-trial` e `e2e-hi-suspensa`. As
contas e os IDs ficam fora do repositório. Antes de qualquer escrita, a prova assinada do runtime confirmou o DEV.

## Execuções

| Log | Preview (head) | Resultado |
| --- | --- | --- |
| `e2e-2.log` | `5134a343` | 10 testes passaram, todos menos o lote e a solicitação SP/SADT (ver abaixo) |
| `e2e-5.log` | `8b720c7c` | o lote passou (montar, gerar o XML, validar no XSD na Vercel, baixar e conferir); a solicitação falhou com 500 na tela de detalhe, que foi corrigido em `f7d40dec` |
| `e2e-7.log` | `f7d40dec` | a solicitação passou: registrar, conferir, gerar o documento oficial, abrir o PDF (200), registrar a autorização parcial e ligar a sessão |

O que os 10 testes do `e2e-2.log` cobrem:
- runtime DEV;
- acesso anônimo;
- médica sem acesso;
- recepção somente leitura;
- trial contratável;
- suspensa em modo de consulta;
- todas as telas no desktop e no celular;
- guia: conferir, emitir e baixar o PDF;
- ação repetida.

No `e2e-2.log`, o lote falhou porque o motor XSD estava fora do rastreamento da Vercel (R47, corrigido em
`d163455a`).

O spec muda o estado da fixture: a guia é emitida e entra em lote. Por isso, cada teste foi validado na execução
indicada na tabela acima.

## Capturas

Pasta `capturas/`, só com dados sintéticos. Trazem as telas por perfil e estado, a guia emitida, o lote com XML e
a solicitação com o documento oficial e a autorização parcial.
