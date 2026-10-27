# Oferta 2026 — conta nova versus contratos legados

Auditoria da branch `integration/pricing-plan-sync-20261018`, iniciada no commit `2a938371` em 26/10/2026. Ambientes usados: Postgres local descartável, Supabase DEV `pqhkirrszzpwezdaqrai`, Preview do PR #42 e Asaas Sandbox. Nenhuma conta, contrato ou migration de produção foi alterada. **A jornada pós-Checkout da conta nova ainda não recebeu PASS**; a etapa humana está indicada abaixo.

## Como a configuração é criada e aplicada

- `src/contexts/onboarding/internal/signup-provision.ts` resolve plano e preço no servidor, relê o marco do Auth e só chama `provisionTenantCoreTx` após confirmar a assinatura do Asaas. `src/contexts/onboarding/internal/saga.ts` grava na mesma transação clínica, owner, configuração da IA, customer de billing, assinatura, claim do draft e eventos. Antes do Checkout concluído, ainda não deve existir clínica.
- `src/contexts/onboarding/internal/signup-trial.ts` conserva **7 dias a partir da tentativa de Checkout** no cadastro legado. Os planos versionados de 2026 usam **14 dias desde `auth.users.created_at`**; a data vem do Auth, não do navegador. A migration `0124_offer_2026_trial_deadline.sql` adiciona `enforce_trial_deadline NOT NULL DEFAULT false`, preservando legados. O provisionamento da nova oferta grava `true`.
- `0122_offer_2026_seats.sql` cria códigos, preços e tetos novos sem atualizar os três códigos legados. A assinatura mantém seu `plan_id` e `price_id`; um preço de campanha continua fixado nessa FK. Os novos planos usam `plan_seat_limits` (1 ou 2 a 5 médicos e 3 acessos de equipe) e `plan_limits.users` (médicos + equipe). Legados continuam com `plan_limits` e não entram na trigger categórica. `comparePlans` recusa troca automática entre tabelas comerciais.
- `src/contexts/billing/proposed-offer.ts` calcula Consultório R$ 197/mês, Clínica R$ 397/mês com 2 médicos, R$ 147/mês por médico adicional até 5, anual por 10 mensalidades e referência de 500 conversas por médico. A referência de IA avisa sem interromper o serviço; não cria cobrança excedente.

## Cenários A, B e C

| Elemento | A — legado antes da migration, reproduzido em Postgres descartável | B — legado após migrations no DEV | C — conta recém-criada no Preview/DEV |
| --- | --- | --- | --- |
| Origem | Clínica, owner, configuração de IA e assinatura sintéticos inseridos antes de `0122` | 6 assinaturas legadas existentes, leitura agregada | Cadastro real, e-mail Resend, confirmação, escolha de Clínica mensal e Checkout hospedado |
| Plano e preço | `clinica` com `price_id` de campanha `fundador`; snapshot antes de `0122` | 6 continuam em códigos legados; preço pertence ao plano escolhido | `clinica_2026_2`; catálogo de R$ 397/mês e página hospedada mostra R$ 397,00 |
| Ciclo | Mensal, preservado após todas as migrations | Códigos/ciclos não foram modificados pelo probe | Mensal escolhido no navegador e persistido no draft |
| Trial | Data histórica preservada | 0/6 com `enforce_trial_deadline=true` | Fim do trial exatamente 14 dias após `auth.users.created_at`; ainda não há assinatura local antes da conclusão |
| Limites | `plan_limits.users` preservado; conta antiga aceita 4 médicos + owner (5 usuários), sem herdar teto de 2 médicos | 0/6 com `plan_seat_limits`; todos têm `plan_limits.users` | O plano selecionado tem 2 vagas médicas e 3 de equipe no catálogo; aplicação à clínica depende de provisionamento após Checkout |
| Configuração e permissões | Owner e `ai_clinic_config` preservados na fixture histórica | 0/6 sem `ai_clinic_config`; **3/6 sem qualquer perfil**, portanto sem owner ativo | Auth confirmado; perfil, clínica e config ainda ausentes por desenho até a conclusão; permissões após provisionamento **NOT TESTED** |
| Provider | Nenhuma chamada externa no cenário histórico | Readback do Asaas por contrato legado **NOT TESTED** nesta rodada | Checkout Sandbox aberto; conclusão humana e assinatura provider **PENDENTES** |

O cenário A é uma reprodução do **schema e contrato de banco anterior à oferta**, não a execução da versão histórica completa da UI. O cenário B mede assinaturas reais de DEV, mas não prova valores de contratos de produção. Em DEV há 3 assinaturas da oferta, todas com deadline obrigatório e `plan_seat_limits`; nenhuma das 9 assinaturas está sem configuração de IA nem usa preço de outro plano. Não há contrato de campanha legado nesse DEV; a preservação de campanha foi provada no cenário A, não em conta real.

Uma conta legada válida do DEV foi testada também pela UI real do Preview: login de owner, `/configuracoes/assinatura` com plano **Pro** e o mesmo preço persistido no banco, sem oferecer ciclo anual ou contratação de médico da tabela nova. O teste foi somente de leitura. Seu `trial_ends_at` já passou, mas clínica e assinatura ainda constam como `trial`; o flag novo é `false` e `src/lib/tenant-access/index.ts` só aplica o bloqueio temporal quando o flag é `true`. Assim, o acesso observado está de acordo com **a regra atual para legados**, mas a conversão/cobrança dessa assinatura específica não foi conciliada com o Asaas nesta rodada. Não extrapolar esse PASS de tela para a saúde financeira dos contratos antigos.

**Achado no DEV:** três das seis assinaturas legadas estão `past_due` enquanto a clínica está em `trial`, sem qualquer perfil, embora possuam billing customer e identificador de assinatura do provedor. Duas têm nome/slug de teste; a terceira não foi classificada como fixture só pelo nome. O probe é agregado e não expõe identidade. Isso impede afirmar que **todas** as clínicas legadas do DEV têm owner e acesso funcional. Não há evidência de que a migration 0122 criou esse estado, nem de que exista em produção. Nenhum registro foi corrigido ou apagado sem conciliação com a origem e com o Asaas.

## Execuções e limites

| Prova | Resultado |
| --- | --- |
| `node --env-file=<env local> --import=tsx scripts/probe-offer-trial-dev.ts` | exit 0: 3/3 assinaturas da oferta com deadline, 6 legadas sem deadline |
| `node --env-file=<env local> --import=tsx scripts/probe-offer-cohorts-dev.ts` | exit 0: 9 assinaturas, preço e limites de coorte coerentes; 0 configurações IA ausentes; **3 legadas sem perfil** registradas separadamente |
| `npx tsx scripts/security/offer-legacy-migration-db.ts` | exit 0: contrato, `price_id`, preço de campanha, trial, owner, config e cota legados preservados após migrations reais; nova trigger não restringe a clínica antiga |
| E2E `checkout recorrente abre...` contra Preview/DEV | 1/1 PASS, exit 0: e-mail Resend, Auth, catálogo, trial calculado, Checkout Sandbox aberto e draft persistido; fixture removida |
| E2E `@prepare-offer-checkout` com `E2E_SIGNUP_FRESH_OFFER=1` | Primeira tentativa FAIL por resposta HTML de SSO em leitura direta do teste; cleanup removeu a fixture. Após corrigir o teste, 1/1 PASS, exit 0: conta nova com trial vigente e Checkout Clínica mensal preparado; fixture mantida intencionalmente para conclusão humana |
| E2E `@inspect-fresh-offer-checkout` | 1/1 PASS, exit 0: Auth recém-criado, 14 dias absolutos, draft sem profile, preço de catálogo e valor na UI do Asaas; nenhum header de bypass enviado ao host do Asaas |
| `e2e/offer-legacy-account-preview.spec.ts` | 1/1 PASS, exit 0: login e tela de assinatura de uma conta Pro antiga no Preview, preço igual à FK persistida, sem ações exclusivas da oferta nova. A primeira execução falhou por seletor ambíguo do teste (dois títulos “Pro”); seletor corrigido e teste repetido |
| `npx vitest run` direcionado | 99/99 em 6 arquivos, exit 0; unitário/integração local, não prova pagamento externo |
| `npx vitest run` integral | 5.680/5.680 em 538 arquivos, exit 0 nesta branch |
| `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` | exit 0 cada, após corrigir o uso de um campo ausente no teste novo |
| `npx tsx scripts/security/local-build.ts` | build Next 15.5.24 em cópia isolada, exit 0; 19/19 páginas estáticas geradas |
| `npx tsx scripts/check-migration-safety.ts` | exit 0; nenhuma operação destrutiva não aprovada nas migrations |
| `e2e/vercel-bypass-isolation.spec.ts` com marcador sintético | 1/1 PASS, exit 0: segredo de bypass limitado à origem correta; execução direta sem variáveis do app primeiro falhou ao subir o servidor, depois repetida com ambiente DEV isolado |

O `GET /v3/checkouts/{id}` retornou 404, mas a referência pública do Asaas documenta criação (`POST`) e cancelamento (`POST /{id}/cancel`), não leitura por esse caminho. A página hospedada do mesmo Checkout respondeu HTTP 200. Esse 404 isolado não foi classificado como falha do produto.

Na revisão final, o primeiro typecheck apontou que o novo teste de inspeção lia `checkoutUrl` de um recibo que armazena apenas `checkoutId`. O teste passou a usar a URL efetivamente persistida no draft, retornada por `assertHostedCheckoutPersisted`; typecheck e Playwright de inspeção foram repetidos com exit 0. Uma tentativa direta de executar esse spec sem `E2E_SIGNUP_WRITE=1` foi recusada pelo guard antes de qualquer operação. A execução correta, com os guards de DEV/Preview/Sandbox ativos, passou 1/1.

**Proteção do runner:** `playwright.config.ts` define o bypass de Vercel como header global. Com um marcador sintético, o teste de isolamento inicialmente mostrou que o header também alcançava outro host. O spec de cadastro agora desliga o header global, aplica-o somente à origem do Preview em navegação e explicitamente em chamadas `request` à mesma origem sem redirecionamento. O teste de isolamento foi repetido com marcador sintético e passou. Outros specs que usam o header global e abrem destinos externos devem seguir a mesma regra; não se concluiu uma migração global do runner nesta rodada.

## Landing candidata versus comportamento medido

O PR draft #3 da landing define Consultório R$ 197 com 1 médico, Clínica R$ 397 com 2 médicos, R$ 147 por médico adicional até 5, 3 logins de equipe e 14 dias desde a conta (`src/data/planos.ts`, `src/data/faq.ts`). Isso coincide com o catálogo, o trial da identidade nova e o preço exibido no Checkout Sandbox da conta preparada. A landing não foi publicada. O anual por 10 mensalidades consta no catálogo e no app; a primeira renovação anual após um ano permanece parcialmente comprovada. **O valor final cobrado e o plano efetivamente provisionado para esta conta nova ainda não foram medidos.**

## Pendência para fechar C

O Checkout desta fixture expira aproximadamente uma hora após 27/10/2026 02:02 UTC. O link foi entregue somente na conversa, não neste documento. Após o usuário concluir o formulário e reCAPTCHA no Sandbox, executar `@verify-offer-checkout` com `E2E_SIGNUP_FRESH_OFFER=1`. O teste deve exigir tenant único, owner, config de IA, `trial` vigente, deadline obrigatório, preço e ciclo, cotas 2+3, assinatura Asaas ativa, nenhuma invoice paga prematura, UI autenticada e replay idempotente. Só então a coluna C passa de **PARTIAL** a **PASS**. Se expirar sem conclusão, usar o runner `@retire-expired-offer-checkout` após readback de ausência de assinatura/cobrança, nunca descartar o recibo sem conciliar.

## Estado de publicação

PR #42 e PR #3 continuam draft. Renovação anual transcorrida, restauração efetiva de backup e publicação coordenada seguem pendentes conforme `finalizacao-oferta-2026-10-26.md`. Não confundir checks verdes, Checkout criado ou cadastro Auth com uma assinatura provisionada para cliente novo.

O `paymentBook` anual merece diagnóstico separado: o [endpoint oficial](https://docs.asaas.com/reference/gerar-carne-de-assinatura) permite antecipar cobranças futuras no Sandbox, e a [explicação do Asaas](https://docs.asaas.com/docs/como-gerar-novas-cobran%C3%A7as-de-uma-assinatura) distingue criação de pagamento. Nos dois probes anteriores desta branch, a resposta foi HTTP 400 `invalid_action` **com** a parcela futura criada e comprovada por readback. A documentação não explica essa combinação. Não repetimos a chamada com efeito colateral; a causa do 400 e a renovação paga após um ano continuam sem PASS.
