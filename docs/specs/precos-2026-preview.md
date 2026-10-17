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

O fundador decidiu que qualquer login adicional poderá ser contratado. Na proposta, o Consultório inclui **1 profissional com agenda + 1 login de equipe** e a Clínica inclui **2 profissionais com agenda + 2 logins de equipe**. Cada profissional além da cota custa **R$ 147/mês** e cada login de equipe além da cota custa **R$ 79/mês**. Um login ocupa uma categoria, sem contagem dupla. A simulação aceita de 0 a 10 logins de equipe; acima disso, a proposta é sob consulta. Esses adicionais **não** participam do catálogo ativo nem do Checkout atual. As prévias calculam os valores sem oferecer compra.

**Regra aprovada em 17/10/2026 para a implementação futura:** ao adicionar um assento, cobrar proporcionalmente aos dias restantes do ciclo e informar o valor antes do Checkout; ao retirar, manter acesso e cobrança contratados até o fim do ciclo e reduzir a recorrência seguinte, sem estorno automático. A regra ainda não foi implementada no Asaas, no controle de assentos ou na UI.

Há uma assinatura promocional ativa em produção, além de uma promocional cancelada, conforme leitura agregada somente de consulta em 16/10/2026. O preço-base contratado dessa conta ativa tem desconto **vitalício**: não será recalculado pela tabela nova nem sofrerá reajuste automático. A eventual compra de login adicional terá componente separado e não mudará o `price_id` do contrato-base. Se não existir preço da mesma campanha para um plano de destino, a troca deve ser recusada antes de cobrar.

## Condições de ativação

1. Medir o custo real de IA por conversa e as despesas Meta por clínica; confirmar quem paga a Meta. As estimativas do PDF não são medições do Qoro.
2. Implementar definição e contagem de conversa de 24 horas, franquia de 500 por profissional, aviso em 80% e política de excedente. Não anunciar franquia como benefício vigente antes disso.
3. Implementar no billing o catálogo Consultório/Clínica por quantidade de profissionais, preço anual, mudança de quantidade, prorrata, limites server-side e migração de clientes legados. A rota de prévia não participa dessas decisões.
4. Implementar e testar o trial proposto de 14 dias a partir da conexão do WhatsApp ou primeiro agendamento pela IA; hoje o cadastro autônomo usa 7 dias a partir do fluxo atual.
5. Revisar textos e Termos de Uso com responsável jurídico: tarifas de terceiros, cancelamento, reajuste, trial, uso justo e transição. A sugestão do PDF de preservar preços legados por apenas 12 meses **não se aplica ao cliente com desconto vitalício**. O preço-base contratado dele permanece, inclusive após a nova tabela.
6. Fazer E2E Preview com conta nova: valor exibido = valor reservado = Checkout Asaas = assinatura = próxima cobrança; testar 1, 2, 3, 10 e 11 profissionais, mensal/anual, reentrada, cancelamento, upgrade/downgrade e webhook duplicado. Só então ativar a landing e o catálogo em produção juntos.
7. Definir explicitamente os entitlements do futuro Consultório e Clínica. As políticas financeiras avançadas hoje são de Clínica e Pro; a prévia de preço não altera esse gate.

## Taxas Asaas da conta da clínica

[`GET /myAccount/fees/`](https://docs.asaas.com/reference/recuperar-taxas-da-conta) devolve as condições da conta conectada. `/configuracoes/pagamentos` consulta esse endpoint após a autenticação e mostra PIX e cartão à vista como **referência**, sem definir preço do atendimento automaticamente. Promoções e contratos variam por conta. A taxa efetiva e o líquido são conciliados pelo pagamento real (`netValue`) e não por estimativa, preservando a base de repasse escolhida pela clínica.

## Evidência e limites

Os cálculos da proposta têm testes de limite e valores nos dois repositórios; as páginas de prévia são `noindex`. Nenhuma migration, alteração de preço no Asaas ou mudança de trial foi feita nesta fase.

Em 15/10/2026, a landing foi publicada na branch `preview/pricing-2026-10`, inicialmente no commit `2a8fb56`, em `https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview`. Em 16/10, o commit `bc4ad4d` incluiu a cota de equipe e o adicional de R$ 79 na simulação. Build Vite, typecheck, lint e runner da proposta passaram localmente nessa ponta; a URL externa pode apontar para outro deployment da branch e exige autenticação SSO da Vercel, portanto não é prova de interação pública atualizada.

O app foi publicado na branch `preview/payment-settings-pricing-20261015`, inicialmente no commit `47c24b18` e atualizado em 16/10 para `c43b3132`, em `https://project-os-git-preview-payment-s-8e7b79-clinic-os-v2-s-projects.vercel.app/oferta-preview`. Esta rota requer login e não participa do cadastro. O novo build Next 15.5.24 terminou com exit 0. O E2E no Preview/DEV verificou os valores para 1, 2, 3, 5 e 10 profissionais, cotas de equipe 1/2, adicional de equipe R$ 79, rejeitou 11 e constatou que a página não oferece link de contratação; o spec completo passou 10/10 com readback de cleanup zero. Isso valida a simulação, **não** a futura contratação nem a regra de trial proposta.

Uma comparação executada com `npx tsx` entre `quoteProposedOffer` (app) e `cotarProposta` (landing) confirmou mensal, anual, franquia, equipe incluída e adicionais em **144 combinações** de 0 a 11 profissionais × 0 a 11 logins de equipe (exit 0). Essa verificação cobre a proposta exibida nos dois repositórios, não o catálogo vigente.
