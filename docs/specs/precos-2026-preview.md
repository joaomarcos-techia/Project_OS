# Prévia da oferta por profissional — outubro de 2026

Esta é uma **hipótese comercial**, baseada em `Qoro_mudancas_de_preco.pdf` (13/10/2026). A rota `/oferta-preview` do app e `/precos-preview` da landing são simulações sem contratação e sem indexação. O catálogo, o cadastro, o trial e o Checkout Asaas continuam cobrando a oferta vigente. Não usar os valores desta página em proposta comercial até a ativação conjunta do produto, contrato e landing.

## Tabela proposta

| Profissionais com agenda própria | Plano | Mensal | Anual proposto | Conversas de IA/mês propostas |
| ---: | --- | ---: | ---: | ---: |
| 1 | Consultório | R$ 197 | R$ 1.970 | 500 |
| 2 | Clínica | R$ 397 | R$ 3.970 | 1.000 |
| 3 | Clínica | R$ 544 | R$ 5.440 | 1.500 |
| 5 | Clínica | R$ 838 | R$ 8.380 | 2.500 |
| 10 | Clínica | R$ 1.573 | R$ 15.730 | 5.000 |

Fórmula Clínica: `397 + 147 × (profissionais − 2)`. O anual equivale a 10 mensalidades. Acima de 10 profissionais, a proposta é sob consulta. A quantidade não é um simples campo visual: antes da ativação, precisa ser validada no servidor com base em profissionais ativos com agenda, inclusive em convites, mudança de papel, desativação e reativação.

**Revisão de 17/10 conforme pedido do fundador:** a proposta anterior de R$ 79 por login extra de equipe foi retirada. O Consultório inclui **1 profissional com agenda + até 3 logins de equipe**; a Clínica inclui **2 profissionais com agenda e equipe sem cobrança por login**. Cada profissional adicional da Clínica custa **R$ 147/mês**, até 10 profissionais. Um login ocupa uma categoria, sem contagem dupla. Com um profissional e mais de três logins de equipe, a simulação não dá preço automático: requer avaliação comercial. A quantidade de equipe da Clínica não muda o preço. Esses valores **não** participam do catálogo ativo nem do Checkout atual. As prévias calculam sem oferecer compra.

**Regra aprovada em 17/10/2026 para a implementação futura:** ao adicionar um **profissional cobrável**, cobrar proporcionalmente aos dias restantes do ciclo e informar o valor antes do Checkout; ao retirar, manter acesso e cobrança contratados até o fim do ciclo e reduzir a recorrência seguinte, sem estorno automático. Adicionar equipe dentro da cota do Consultório ou na Clínica não cria cobrança por login. A regra ainda não foi implementada no Asaas, no controle de profissionais ou na UI.

Há uma assinatura promocional ativa em produção, além de uma promocional cancelada, conforme leitura agregada somente de consulta em 16/10/2026. O preço-base contratado dessa conta ativa tem desconto **vitalício**: não será recalculado pela tabela nova nem sofrerá reajuste automático. Uma eventual compra de **profissional adicional** terá componente separado e não mudará o `price_id` do contrato-base; logins de equipe da proposta não terão adicional financeiro. Se não existir preço da mesma campanha para um plano de destino, a troca deve ser recusada antes de cobrar.

## Condições de ativação

1. Medir o custo real de IA por conversa e as despesas Meta por clínica; confirmar quem paga a Meta. As estimativas do PDF não são medições do Qoro.
2. Implementar definição e contagem de conversa de 24 horas, franquia de 500 por profissional, aviso em 80% e política de excedente. Não anunciar franquia como benefício vigente antes disso.
3. Implementar no billing o catálogo Consultório/Clínica por quantidade de profissionais, preço anual, mudança de quantidade, prorrata, limite de três logins de equipe no Consultório, equipe incluída na Clínica, limites server-side e migração de clientes legados. A rota de prévia não participa dessas decisões.
4. Implementar e testar o trial proposto de 14 dias a partir da conexão do WhatsApp ou primeiro agendamento pela IA; hoje o cadastro autônomo usa 7 dias a partir do fluxo atual.
5. Revisar textos e Termos de Uso com responsável jurídico: tarifas de terceiros, cancelamento, reajuste, trial, uso justo e transição. A sugestão do PDF de preservar preços legados por apenas 12 meses **não se aplica ao cliente com desconto vitalício**. O preço-base contratado dele permanece, inclusive após a nova tabela.
6. Fazer E2E Preview com conta nova: valor exibido = valor reservado = Checkout Asaas = assinatura = próxima cobrança; testar 1, 2, 3, 10 e 11 profissionais; equipe 0/3/4 no Consultório e 0/11 na Clínica; mensal/anual, reentrada, cancelamento, upgrade/downgrade e webhook duplicado. Só então ativar a landing e o catálogo em produção juntos.
7. Definir explicitamente os entitlements do futuro Consultório e Clínica. As políticas financeiras avançadas hoje são de Clínica e Pro; a prévia de preço não altera esse gate.

## Taxas Asaas da conta da clínica

[`GET /myAccount/fees/`](https://docs.asaas.com/reference/recuperar-taxas-da-conta) devolve as condições da conta conectada. `/configuracoes/pagamentos` consulta esse endpoint após a autenticação e mostra PIX e cartão à vista como **referência**, sem definir preço do atendimento automaticamente. Promoções e contratos variam por conta. A taxa efetiva e o líquido são conciliados pelo pagamento real (`netValue`) e não por estimativa, preservando a base de repasse escolhida pela clínica.

## Evidência e limites

Os cálculos da proposta têm testes de limite e valores nos dois repositórios; as páginas de prévia são `noindex`. Nenhuma migration, alteração de preço no Asaas ou mudança de trial foi feita nesta fase.

Em 15/10/2026, a landing foi publicada na branch `preview/pricing-2026-10`, inicialmente no commit `2a8fb56`, em `https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview`. O commit `bc4ad4d` de 16/10 incluiu a hipótese intermediária de equipe a R$ 79, **revogada na revisão de 17/10**. A URL externa pode apontar para outro deployment da branch e exige autenticação SSO da Vercel; não é prova de interação pública atualizada.

O app foi publicado na branch `preview/payment-settings-pricing-20261015`, inicialmente no commit `47c24b18` e atualizado em 16/10 para `c43b3132`, em `https://project-os-git-preview-payment-s-8e7b79-clinic-os-v2-s-projects.vercel.app/oferta-preview`. Esta rota requer login e não participa do cadastro. O E2E anterior verificou valores para 1, 2, 3, 5 e 10 profissionais e a hipótese **agora revogada** de equipe a R$ 79; o spec completo passou 10/10 com readback de cleanup zero. Esses resultados históricos não validam a revisão do PDF. Mesmo após reteste, a simulação não provará contratação nem trial.

Uma comparação antiga com `npx tsx` entre `quoteProposedOffer` (app) e `cotarProposta` (landing) confirmou **144 combinações da hipótese anterior**, inclusive o adicional de equipe agora revogado; aquele PASS não se aplica. Em 17/10, a comparação atual executou **42 combinações** (7 quantidades de profissionais × 6 quantidades de equipe, incluindo limites e inválidos), conferiu cotação nula, mensal, anual e conversas: **42/42 PASS, exit 0**. Isso mede paridade de cálculo local, não catálogo nem página externa.

Para cada prova restante, responsável, pré-condição, comando/rota, critério e evidência a guardar, ver [validacao-nova-oferta-2026-10.md](../runbooks/validacao-nova-oferta-2026-10.md).
