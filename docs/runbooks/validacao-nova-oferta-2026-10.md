# Validação da oferta por profissional (out/2026)

**Escopo:** a implementação da [ADR-067](../adr/067-oferta-por-profissional.md): Consultório
R$ 197 e Clínica R$ 397 + R$ 147 por profissional adicional, até 10, só mensal, com 7 dias de
teste. Este roteiro **não** autoriza migration em DEV ou produção, deploy nem alteração de
assinatura real. Cada passo com escrita exige autorização explícita.

> A PR #42 (draft) mantém uma versão anterior deste roteiro, com outra regra: 5 médicos, 3 logins
> de equipe na Clínica, anual e 14 dias. Ela não vale para esta implementação.

## 1. Antes do merge (local)

Um gate por comando, com o exit code de cada um (ver `gate-exit-codes`):

- `tsc --noEmit`, `eslint .`, `vitest run --coverage`;
- `npx tsx scripts/check-migration-safety.ts`;
- `npx tsx scripts/security/inventory.ts --check`;
- `madge --circular` e `check:registry:strict`, com os fakes de env do `ci.yml`.

A branch inclui a PR #41 (sincronização da recorrência na troca de plano). Se a #41 for mergeada
antes, os três commits dela somem do diff sozinhos.

## 2. Banco de validação

A migration 0119 cria `plan_seat_limits`, os 10 planos da oferta, os preços mensais e a trigger
`profiles_plan_seat_limits`.

- **Produção (até a 0118):** aplica limpo.
- **DEV e Preview:** já receberam a 0119–0126 da PR #42, inclusive outra `plan_seat_limits`, a
  trigger `profiles_offer_2026_seats` e preços anuais. A 0119 desta branch falha **de propósito**
  nesse estado (`CREATE TABLE` sem `IF NOT EXISTS`). Antes de validar aqui, decidir com o dono do
  ambiente: restaurar o DEV para o estado de produção, ou reconciliar manualmente os objetos da #42.

Conferência só de leitura, depois de aplicar (`BEGIN READ ONLY`, ver `pooler-set-session-vaza`):

```sql
SELECT p.code, l.professionals, l.staff, pr.amount
  FROM plans p
  JOIN plan_seat_limits l ON l.plan_id = p.id
  JOIN prices pr ON pr.plan_id = p.id AND pr.active_until IS NULL AND pr.campaign_code IS NULL
 ORDER BY l.professionals;
```

Esperado: 10 linhas, só `monthly`. Consultório: 1 / 3 / 197,00. Clínica: 397,00 com 2, 544,00
com 3, e assim até 1.573,00 com 10, sempre com equipe `NULL`. Solo, Clínica e Pro seguem
`ativo = true`, com os mesmos preços e `plan_limits`.

## 3. Cadastro autônomo (Preview, Asaas Sandbox)

1. `/cadastro/plano` mostra só **Consultório** e **Clínica**.
   - Consultório: R$ 197/mês, "1 profissional de saúde e até 3 usuários de equipe".
   - Clínica: "a partir de R$ 397", "2 a 10 profissionais", "R$ 147 por profissional adicional".
2. Clínica + seletor em 4: total R$ 691,00. Salvar e seguir para o Checkout.
3. No Checkout do Asaas:
   - valor 691,00, recorrente, mensal, só cartão;
   - item "Clínica · 4 profissionais";
   - primeiro vencimento 7 dias depois da ativação.
4. Pagar no Sandbox. A clínica nasce com o plano `clinica_2026_4`. Readback da assinatura no
   Asaas: `value = 691`, `cycle = MONTHLY`, `billingType = CREDIT_CARD`.
5. Repetir com o Consultório (197,00).
6. Draft antigo: com um draft que tenha `selected_plan_id` de Solo/Clínica/Pro e nenhuma
   tentativa de cobrança, a tela abre sem plano marcado. `POST /api/signup/checkout` responde
   409 `invalid_plan` (a tela volta à escolha com "Esse plano não está mais disponível") e nenhum
   Checkout é criado.

## 4. Limites (servidor)

Na clínica do Consultório:

- O dono sem CRM é equipe (1 de 3). Ao cadastrar o próprio CRM em Perfil, passa a profissional
  (1 de 1).
- Convidar um médico: o drawer avisa "Sem vaga para esta função" e o servidor recusa **antes** de
  criar a conta e mandar e-mail.
- Convidar 3 atendentes funciona; o 4º é recusado.
- Trocar o papel de um atendente para médico: "Todas as vagas de profissional…".
- Reativar um médico desativado com a vaga ocupada: a mesma recusa.

Na Clínica de 4:

- 4 profissionais entram; o 5º é recusado.
- Equipe administrativa sem limite.

Corrida: dois convites de médico simultâneos para a última vaga terminam com um sucesso e um
"Limite do plano atingido".

## 5. Incluir e remover profissional (Configurações › Assinatura)

1. Na Clínica de 4, ativa: o seletor começa em "4 profissionais (atual)". Ao escolher 5, aparece
   "Contratar agora".
2. A cobrança proporcional sai pela diferença de R$ 147 no restante do ciclo.
3. Pagar no Sandbox. O webhook:
   - atualiza a recorrência para 838,00 e as parcelas já emitidas do novo ciclo;
   - relê os dois;
   - só então aplica `clinica_2026_5`.
4. A 5ª vaga de profissional só existe depois disso.
5. Escolher 3 com 5 profissionais ativos: "A equipe ativa não cabe neste plano", botão bloqueado.
6. Com 3 profissionais ativos: "Agendar para o fim do ciclo".
   - Enquanto o downgrade está agendado, um 4º profissional é recusado: a capacidade fica
     reservada.
   - No fim do ciclo, o cron confere de novo, sincroniza o Asaas e aplica.
7. Consultório → Clínica de 2 (upgrade) e Clínica de 2 → Consultório (downgrade: 1 profissional e
   até 3 de equipe).

## 6. Clientes atuais

- Uma assinatura Solo, Clínica ou Pro vê na tela de assinatura só os planos da tabela antiga, com
  o mesmo preço (e o de fundador, quando há). A troca entre eles segue como antes, agora com a
  recorrência sincronizada pela #41.
- O convite do fundador (`/admin/clinicas` e `/join`) lista só a tabela antiga.
- Nenhuma assinatura existente muda de plano, preço ou limite com o deploy.

## 7. Produção (só com autorização)

1. Backup, depois `db:migrate:prod` da 0119. Conferência da seção 2, só leitura.
2. Deploy do `main` com esta branch.
3. Um cadastro real de ponta a ponta, ou o roteiro da seção 3 com cartão de teste em Preview, antes
   de publicar a landing.
4. Conferir a landing (`C:\dev\qoro`, `src/data/planos.ts`) contra o catálogo aplicado: valores,
   "até 10", equipe ilimitada na Clínica, 7 dias de teste, nenhum anual. Até o deploy, o site
   anuncia um preço que o app ainda não cobra.
