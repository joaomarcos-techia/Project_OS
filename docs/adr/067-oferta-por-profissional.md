# ADR-067 — Oferta de outubro/2026: cobrança por profissional de saúde

## Status

Proposed — implementado em código em 21/10/2026, na branch `claude/checkout-nova-tabela-734f4e`
(sobre `origin/main` + PR #41). A migration é a 0119. Nada foi aplicado em DEV, Preview ou
produção. A tabela antiga não muda.

Provado em Postgres descartável com todas as migrations reais:
`scripts/security/offer-2026-seats-db.ts` (13/13) e `signup-provision-db.ts` (12/12). Falta o
Checkout e a troca de plano contra o Asaas Sandbox, em Preview
([roteiro](../runbooks/validacao-nova-oferta-2026-10.md)).

## Contexto

O fundador trocou a cobrança por usuário (Solo R$ 149, Clínica R$ 349, Pro R$ 699) pela cobrança
por profissional de saúde. A base é o documento "Mudanças de preço, oferta e comunicação", de
13/10/2026. A landing (`qoro.dev`) já anuncia a tabela nova:

| Plano | Mensal | Profissionais | Equipe administrativa |
| --- | ---: | ---: | --- |
| Consultório | R$ 197 | 1 | até 3 usuários |
| Clínica | R$ 397 + R$ 147 × (n − 2) | 2 a 10 | ilimitada |

- O Pro não é vendido a clientes novos.
- Só há ciclo mensal.
- O teste continua o do cadastro autônomo: 7 dias depois da ativação.
- Clientes atuais (Solo, Clínica, Pro e preço de fundador) mantêm plano, preço e limite.

Até aqui o único teto comercial era o total de usuários ativos (`plan_limits.users`: 1/5/10),
conferido no convite.

**Profissional** é quem a agenda trata como profissional: `isPractitioner` / `practitionerSql`
(ADR-032 §2), ou seja, papel `doctor` ou alguém com CRM preenchido. Recepção, gestão e financeiro
sem CRM são equipe administrativa. Convite pendente ocupa vaga, como já ocupava no total de
usuários.

A PR #42 (draft) preparou uma versão anterior da proposta: até 5 médicos, 3 logins de equipe na
Clínica, anual e teste de 14 dias. Esta ADR segue a tabela que a landing publica hoje e aproveita
três decisões técnicas da #42: um plano por quantidade, teto aplicado por trigger e reserva da
capacidade do downgrade agendado.

## Decisão

1. **Um plano por quantidade de profissionais.**
   - Planos `consultorio_2026` e `clinica_2026_2` … `clinica_2026_10`.
   - Cada um tem uma linha de preço mensal de tabela, calculada na migration pela fórmula de
     `src/contexts/billing/offer-2026.ts`. Um bloco `DO` no fim da migration falha se o catálogo
     não bater com a fórmula.
   - A assinatura fixa `price_id`. Assim, renovação, rateio, reativação e sincronização com o
     Asaas continuam lendo um único valor e não precisam de cálculo novo em runtime.
   - O preço nunca vem do browser. O cadastro escolhe um `planId`, e o servidor resolve o valor e
     o envia ao Checkout recorrente do Asaas.
2. **Tetos por categoria na linha do plano.**
   - `plan_seat_limits(plan_id, professionals, staff)`, com `staff NULL` = equipe ilimitada.
   - É catálogo global, como `plans` e `prices`: leitura `authenticated`, escrita só por
     migration.
   - Planos sem linha ali são da tabela antiga e seguem com `plan_limits.users`.
3. **O teto é aplicado no write de `profiles`.**
   - A trigger `profiles_plan_seat_limits` recusa com `check_violation`
     (`plan_professional_seat_limit` / `plan_staff_seat_limit`) a escrita que faz uma categoria
     passar do teto.
   - Cobre convite, reconvite, reativação, troca de papel e CRM do próprio perfil, inclusive
     caminhos futuros.
   - Só barra o que cresce: mudar o nome, reconvidar ou trocar de papel sem mudar de categoria
     passa, e uma clínica acima do teto sempre consegue reduzir.
   - Usa a mesma chave de advisory lock do convite.
   - Identity traduz a recusa para `UserQuotaExceededError` com a dimensão, e a tela diz o que
     fazer.
   - A checagem barata antes do e-mail de convite (`billingApiV1.checkSeatQuota`) usa a mesma
     regra.
4. **Incluir ou remover profissional é troca de plano.**
   - **Incluir** (`clinica_2026_3 → _4`, `consultorio_2026 → clinica_2026_2`) é upgrade:
     - cobra hoje a diferença proporcional ao restante do ciclo;
     - quando o pagamento é confirmado, a PR #41 (incluída nesta branch) atualiza o valor
       recorrente e as parcelas já emitidas do novo ciclo no Asaas, relê os dois, e só então
       muda o plano local;
     - a nova vaga só existe depois disso.
   - **Remover** é downgrade:
     - é agendado para o fim do ciclo, se a equipe ativa couber no destino;
     - a capacidade do destino fica reservada desde o pedido (trigger e `getSeatLimits`);
     - o cron confere de novo antes de sincronizar o Asaas.
   - Ninguém é desativado automaticamente.
5. **A troca só existe dentro da mesma tabela.**
   - `comparePlans` recusa `cross_catalog_change`, e a tela só lista planos da tabela da
     assinatura atual.
   - Levar um cliente antigo para a tabela nova muda preço e limite de quem já assina. Essa
     decisão comercial está em aberto.
6. **Recursos da Clínica.** Ajuste de permissão por pessoa, repasse a profissionais e preço por
   meio de pagamento valem para a Clínica nova, a Clínica antiga e o Pro. Não valem para
   Consultório nem Solo.
7. **Canais.**
   - O cadastro autônomo vende só a oferta nova.
   - O convite do fundador continua só com a tabela antiga, que é a que tem preço de fundador: o
     wizard não tem seletor de profissionais.
   - Os planos antigos continuam `ativo` para as trocas de quem já assina.
   - Um draft que salvou plano antigo antes do deploy volta à escolha (`invalid_plan`).
   - Um Checkout já aberto com plano antigo conclui normalmente.

## Consequências

- O catálogo ganha 10 planos.
- O valor de cada quantidade é uma linha de preço, então reajuste futuro segue o padrão de
  `active_until` + nova linha. Quem já assina mantém o `price_id`.
- Os badges do admin mostram códigos como `clinica_2026_4`.
- Uma recusa da trigger que chegue à tela sem passar pela checagem barata (corrida) mostra a mesma
  mensagem acionável.
- O convite que perde a corrida já enviou o e-mail; o usuário Auth é apagado na compensação, como
  antes.
- A PR #41 corrige também um defeito que já existia: o upgrade pago não alterava a recorrência no
  Asaas.

## Fora desta decisão (pendências)

- Transição de clientes atuais para a tabela nova.
- Plano anual.
- Uso justo / franquia de IA (a hipótese de 500 conversas por profissional não está implementada).
- Teste de 14 dias.
- Preço de fundador e convite do fundador para a tabela nova.
- Teto de 30 convites/hora por clínica (`rate-limit.ts`) para a Clínica com equipe ilimitada.
- DEV/Preview já receberam a 0119–0126 da PR #42. A 0119 desta branch falha alto lá
  (`plan_seat_limits` já existe com outro formato) até o banco ser reconciliado.

## Revisitar quando

- O fundador decidir a transição dos clientes atuais ou o anual.
- Uma clínica precisar de mais de 10 profissionais (hoje: contato comercial).
- O papel de profissional deixar de ser "doctor ou CRM" (ADR-032 §2). A trigger, `seat-usage.ts`
  e `practitionerSql` mudam juntos; `seat-usage.test.ts` falha se divergirem.
