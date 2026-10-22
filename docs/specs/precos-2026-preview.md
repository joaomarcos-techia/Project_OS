# Prévia da oferta por médico — outubro de 2026

> **Estado atualizado em 22/10:** no DEV/Preview, Consultório e Clínica de entrada já foram ativados e dois Checkouts Sandbox tiveram pagamento e provisionamento confirmados. As variantes Clínica de 3–5 médicos também foram ativadas **somente no DEV** para ensaio de alteração de assinatura; a UI autenticada mostrou preços e cotas com fixture sintética e cleanup. A compra adicional pela UI ainda não teve E2E de pagamento; o anual e o aviso da franquia de IA ainda não foram implementados. Produção conserva a oferta antiga. A simulação `/oferta-preview` continua sem compra. Leia a evidência datada em `docs/quality/validacao-autonoma-2026-10-21.md`; os checkpoints abaixo descrevem estados anteriores.

Esta é uma **hipótese comercial**, baseada em `Qoro_mudancas_de_preco.pdf` (13/10/2026). A rota `/oferta-preview` do app e `/precos-preview` da landing são simulações sem contratação e sem indexação. **Em produção**, o catálogo, o cadastro, o trial e o Checkout Asaas continuam na oferta legada; a ativação experimental acima se restringe ao DEV/Preview. Não usar os valores desta página em proposta comercial até a ativação conjunta do produto, contrato e landing.

## Tabela proposta

| Médicos com agenda própria | Plano | Mensal | Anual proposto | Conversas de IA/mês propostas |
| ---: | --- | ---: | ---: | ---: |
| 1 | Consultório | R$ 197 | R$ 1.970 | 500 |
| 2 | Clínica | R$ 397 | R$ 3.970 | 1.000 |
| 3 | Clínica | R$ 544 | R$ 5.440 | 1.500 |
| 5 | Clínica | R$ 838 | R$ 8.380 | 2.500 |

Fórmula Clínica: `397 + 147 × (médicos − 2)`. O anual equivale a 10 mensalidades. A prévia calcula até **5 médicos no total** (2 incluídos + até 3 adicionais), conforme decisão de 18/10; acima disso não apresenta preço automático. A quantidade não é um simples campo visual: antes da ativação, precisa ser validada no servidor com base em médicos ativos, inclusive em convites, mudança de papel/CRM, desativação e reativação.

**Revisão de 18/10 conforme pedido do fundador:** Consultório propõe **1 médico + até 3 logins de equipe**; Clínica propõe **2 médicos + até 3 logins de equipe**. Cada médico adicional da Clínica propõe **R$ 147/mês**. A hipótese de equipe ilimitada na Clínica, registrada em 17/10, foi revogada. Um login ocupa uma categoria, sem contagem dupla. Médico significa conta com capacidade clínica: papel `doctor`, ou titular/gestor com CRM não vazio; o titular/gestor que atende não deve ser contado como equipe administrativa. Esta classificação já existe na agenda, mas **não** na cota de billing vigente. A simulação usa números informados, não examina os membros reais do tenant. Esses valores **não** participam do catálogo ativo nem do Checkout atual. As prévias calculam sem oferecer compra.

**Regra aprovada em 17/10/2026 para a implementação futura:** ao adicionar um **médico cobrável**, cobrar proporcionalmente aos dias restantes do ciclo e informar o valor antes do Checkout; ao retirar, manter acesso e cobrança contratados até o fim do ciclo e reduzir a recorrência seguinte, sem estorno automático. Adicionar equipe dentro da cota de três logins não cria cobrança por login. Acima da cota de equipe, a prévia não calcula preço automático. A regra ainda não foi implementada no Asaas, no controle de médicos ou na UI.

Há uma assinatura promocional ativa em produção, além de uma promocional cancelada, conforme leitura agregada somente de consulta em 16/10/2026. O preço-base contratado dessa conta ativa tem desconto **vitalício**: não será recalculado pela tabela nova nem sofrerá reajuste automático. Uma eventual compra de **profissional adicional** terá componente separado e não mudará o `price_id` do contrato-base; logins de equipe da proposta não terão adicional financeiro. Se não existir preço da mesma campanha para um plano de destino, a troca deve ser recusada antes de cobrar.

## Condições de ativação

1. Medir o custo real de IA por conversa e as despesas Meta por clínica; confirmar quem paga a Meta. As estimativas do PDF não são medições do Qoro.
2. Implementar definição e contagem de conversa de 24 horas, franquia de 500 por profissional, aviso em 80% e política de excedente. Não anunciar franquia como benefício vigente antes disso.
3. Implementar no billing o catálogo Consultório/Clínica por quantidade de médicos, preço anual, mudança de quantidade, prorrata, limite de três logins de equipe em ambos os planos, limites server-side e migração de clientes legados. A contagem deve distinguir `doctor` e `owner`/`gestor` com CRM dos papéis administrativos e cobrir convite, aceite, mudança de papel, cadastro/remoção de CRM, desativação e reativação sob concorrência. Em 19/10, o predicado foi corrigido e as migrations 0122–0123 adicionaram cota categórica e reserva da cota do downgrade ao banco **somente no DEV**, com os planos novos inativos; ainda falta o caminho de compra. A rota de prévia não participa dessas decisões.
4. Implementar e testar **14 dias contados da criação da conta**, prazo absoluto escolhido pelo fundador em 19/10. A ideia anterior de iniciar na conexão do WhatsApp/primeiro agendamento pela IA foi revogada. O cadastro autônomo ainda usa 7 dias a partir do fluxo atual; a decisão nova não está implementada.
5. Revisar textos e Termos de Uso com responsável jurídico: tarifas de terceiros, cancelamento, reajuste, trial, uso justo e transição. A sugestão do PDF de preservar preços legados por apenas 12 meses **não se aplica ao cliente com desconto vitalício**. O preço-base contratado dele permanece, inclusive após a nova tabela.
6. Fazer E2E Preview com conta nova: valor exibido = valor reservado = Checkout Asaas = assinatura = próxima cobrança; testar 1, 2, 3 médicos e os limites superiores da oferta quando definidos; equipe 0/3/4 nos dois planos; titular e gestor com/sem CRM, convite pendente, alteração de CRM, mensal/anual, reentrada, cancelamento, upgrade/downgrade e webhook duplicado. Só então ativar a landing e o catálogo em produção juntos.
7. Definir explicitamente os entitlements do futuro Consultório e Clínica. As políticas financeiras avançadas hoje são de Clínica e Pro; a prévia de preço não altera esse gate.

## Taxas Asaas da conta da clínica

[`GET /myAccount/fees/`](https://docs.asaas.com/reference/recuperar-taxas-da-conta) devolve as condições da conta conectada. `/configuracoes/pagamentos` consulta esse endpoint após a autenticação e mostra PIX e cartão à vista como **referência**, sem definir preço do atendimento automaticamente. Promoções e contratos variam por conta. A taxa efetiva e o líquido são conciliados pelo pagamento real (`netValue`) e não por estimativa, preservando a base de repasse escolhida pela clínica.

## Evidência e limites

Os cálculos da proposta têm testes de limite e valores nos dois repositórios; as páginas de prévia são `noindex`. As migrations 0122–0123 foram aplicadas **só no DEV**, inserindo cinco planos inativos e uma trava de cota médica/equipe que considera downgrade agendado. Não houve alteração de preço no Asaas nem mudança de trial.

Em 15/10/2026, a landing foi publicada na branch `preview/pricing-2026-10`, inicialmente no commit `2a8fb56`, em `https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview`. O commit `bc4ad4d` de 16/10 incluiu a hipótese intermediária de equipe a R$ 79, **revogada na revisão de 17/10**. A URL externa pode apontar para outro deployment da branch e exige autenticação SSO da Vercel; não é prova de interação pública atualizada.

O app foi publicado na branch `preview/payment-settings-pricing-20261015`, inicialmente no commit `47c24b18` e atualizado em 16/10 para `c43b3132`, em `https://project-os-git-preview-payment-s-8e7b79-clinic-os-v2-s-projects.vercel.app/oferta-preview`. Esta rota requer login e não participa do cadastro. O E2E anterior verificou valores para 1, 2, 3, 5 e 10 profissionais e a hipótese **agora revogada** de equipe a R$ 79; o spec completo passou 10/10 com readback de cleanup zero. Esses resultados históricos não validam a revisão do PDF. Mesmo após reteste, a simulação não provará contratação nem trial.

Uma comparação antiga com `npx tsx` entre `quoteProposedOffer` (app) e `cotarProposta` (landing) confirmou **144 combinações da hipótese anterior**, inclusive o adicional de equipe agora revogado; aquele PASS não se aplica. Em 17/10, outra comparação executou **42 combinações** da hipótese de equipe ilimitada; esse PASS também não valida a revisão de 18/10. Em 19/10, os dois cálculos coincidiram em **30/30 combinações** (1–6 médicos × 0–4 logins de equipe), incluindo o limite de 5 médicos e 3 logins: exit 0. Isso mede paridade de cálculo local, não catálogo nem página externa.

Na revisão de 19/10, `npx vitest run` passou **5.520/5.520 testes em 528 arquivos**, exit 0; os cinco arquivos dirigidos à proposta, capacidade clínica, credenciais e troca de planos passaram **52/52**. `npx tsc --noEmit`, ESLint dos arquivos alterados, Prettier e `git diff --check` passaram. O build isolado `npx tsx scripts/security/local-build.ts` passou com `NODE_ENV=production`, credenciais sintéticas e 19 páginas estáticas. Uma tentativa direta de `next build` com `.env.local` falhou no prerender de `/404` porque aquele arquivo define `NODE_ENV=development`; não é evidência de build de produção. Na landing, `npm run typecheck`, `npm run lint`, `npm run build` (54 rotas; gates 27/27 da ponte, 2/2 de conversão e 20 de segurança) e `scripts/testar-proposta-precos.mjs` passaram. O readback somente de leitura do DEV confirmou os limites **Solo 1, Clínica 5, Pro 10 logins totais** e preços mensais R$ 149/349/699. A nova contagem por médicos/equipe e a compra adicional continuam **não implementadas**; o E2E da nova decisão em Preview ainda não foi executado.

Para cada prova restante, responsável, pré-condição, comando/rota, critério e evidência a guardar, ver [validacao-nova-oferta-2026-10.md](../runbooks/validacao-nova-oferta-2026-10.md).
