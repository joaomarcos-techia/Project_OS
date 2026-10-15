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

## Condições de ativação

1. Medir o custo real de IA por conversa e as despesas Meta por clínica; confirmar quem paga a Meta. As estimativas do PDF não são medições do Qoro.
2. Implementar definição e contagem de conversa de 24 horas, franquia de 500 por profissional, aviso em 80% e política de excedente. Não anunciar franquia como benefício vigente antes disso.
3. Implementar no billing o catálogo Consultório/Clínica por quantidade de profissionais, preço anual, mudança de quantidade, prorrata, limites server-side e migração de clientes legados. A rota de prévia não participa dessas decisões.
4. Implementar e testar o trial proposto de 14 dias a partir da conexão do WhatsApp ou primeiro agendamento pela IA; hoje o cadastro autônomo usa 7 dias a partir do fluxo atual.
5. Revisar textos e Termos de Uso com responsável jurídico: tarifas de terceiros, cancelamento, reajuste, trial, uso justo e transição. O relatório sugere preservar preços legados por 12 meses, avisar com 60 dias e limitar a elevação anual a 20%, mas isso ainda não está em contrato nem no código.
6. Fazer E2E Preview com conta nova: valor exibido = valor reservado = Checkout Asaas = assinatura = próxima cobrança; testar 1, 2, 3, 10 e 11 profissionais, mensal/anual, reentrada, cancelamento, upgrade/downgrade e webhook duplicado. Só então ativar a landing e o catálogo em produção juntos.

## Taxas Asaas da conta da clínica

`GET /myAccount/fees/` devolve as condições da conta conectada. `/configuracoes/pagamentos` consulta esse endpoint após a autenticação e mostra PIX e cartão à vista como **referência**, sem definir preço do atendimento automaticamente. Promoções e contratos variam por conta. A taxa efetiva e o líquido são conciliados pelo pagamento real (`netValue`) e não por estimativa, preservando a base de repasse escolhida pela clínica.

## Evidência e limites

Os cálculos da proposta têm testes de limite e valores nos dois repositórios; as páginas de prévia são `noindex`. Nenhuma migration, alteração de preço no Asaas ou mudança de trial foi feita nesta fase. Anotar aqui o SHA/URL do Preview e o resultado do E2E antes de aprovar ativação.
