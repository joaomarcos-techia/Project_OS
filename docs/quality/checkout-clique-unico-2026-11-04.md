# Cadastro: continuar para o checkout com um clique

## Escopo e comportamento

Base: `main` `cd6adc2369558082a7ff34b9a6b2c97f1da58153`. A mudança fica na branch
`codex/signup-one-click-checkout-20261104`, sem migration ou publicação em Production.

A seleção antes exigia um clique em “Salvar plano” e outro em “Continuar no Checkout
Asaas”. O botão único “Continuar para o checkout” salva a seleção pela API existente,
confere a resposta e somente então solicita o checkout. Se o plano já estiver salvo,
a continuação utiliza essa seleção sem repetir a escrita. Preço, trial, idempotência
financeira, autorização e criação da assinatura continuam sob as regras do servidor.

O bloqueio síncrono cobre as duas requisições; plano e ciclo ficam desabilitados
durante o processo. Falha de salvamento, conflito ou resposta incompatível não abre
checkout. A falha posterior preserva o plano salvo para retomada. URLs externas
continuam restritas aos hosts oficiais do Asaas.

Os cenários antigos exclusivamente de autenticação passam a preparar sua seleção
pela API real, sem acionar faturamento incidentalmente. Os cenários de checkout real
passam a usar um único clique. O teste local de navegador simula explicitamente a
indisponibilidade da fronteira de checkout; isso não representa prova do Asaas.

## Evidências

- Testes da tela: **26/26 PASS** em 04/11, incluindo clique repetido enquanto salva e
  enquanto aguarda checkout, falha de rede, retomada sem nova escrita, HTTP de erro,
  resposta de salvamento incompatível e URL externa não autorizada.
- A regressão completa, lint, TypeScript e build devem ser consultados nos checks do
  commit candidato. Execuções locais amplas simultâneas foram interrompidas devido
  à pressão de memória da máquina; interrupção não é PASS nem falha do produto.
- Nenhuma conta do usuário, cobrança real ou integração de produção foi alterada.

## Consulta dos leads — somente leitura

Consulta de Production e Resend realizada em **04/11/2026 às 16h04 de Brasília**.
Os três envios das 10h38 têm eventos de entrega assinados persistidos no Qoro e
resposta HTTP 200 da consulta individual no Resend, cujo último evento é `delivered`.
O domínio está com `open_tracking=false` e `click_tracking=false`: não é possível
afirmar abertura, clique no e-mail ou ausência deles. Não se alterou rastreamento.

| Identificador | Entrega | Retomada do cadastro | Situação atual observada |
| --- | --- | --- | --- |
| lead-01 | Confirmada | Token não consumido | E-mail ainda não confirmado; nenhuma clínica provisionada |
| lead-03 | Confirmada | Token não consumido | E-mail ainda não confirmado; nenhuma clínica provisionada |
| lead-04 | Confirmada | Token consumido às **11h13m31s de 04/11** | Draft sem plano, checkout ou assinatura; usuário Auth anteriormente vinculado ausente |

Para lead-04, a busca por hash do mesmo endereço também não encontrou uma identidade
Auth atual. Não foi atribuída uma causa à remoção nem criada uma conta substituta.
O consumo do token comprova execução da retomada, sem comprovar contratação, leitura
humana do e-mail ou o motivo da interrupção posterior. Os outros dois links ainda
não consumidos vencem em 05/11 por volta das 10h38 de Brasília.

lead-02 não recebeu a recuperação nesta rodada: o bloqueio anterior por rejeição
permanente foi preservado. Nenhum reenvio foi executado, e a campanha permanece
intocada. Evidência detalhada sanitizada permanece em
`dist/quality/lead-engagement-20261104.json`, ignorada pelo Git.

Referências do provedor: [consulta de envio](https://resend.com/docs/api-reference/emails/retrieve-email)
e [rastreamento por domínio](https://resend.com/blog/introducing-custom-tracking-domain).
Entrega ao servidor destinatário não comprova presença na caixa principal.
