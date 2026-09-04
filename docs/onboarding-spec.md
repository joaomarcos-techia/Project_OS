# Identidade e onboarding de clínicas

## Status

Canonical — autenticação, equipe e provisionamento inicial.

## Source of Truth

`src/lib/auth`, `src/contexts/identity`, `src/contexts/onboarding`, `src/app/(app)/join` e migrations relacionadas.

O self-service futuro ainda não está implementado. Seu desenho de segurança, atribuição Google Ads,
sessão anônima, e-mail verificado, Checkout hospedado e provisionamento pós-webhook está congelado em
[Qoro v2 §21](qorov2.md#21-track-o--arquitetura-segura-do-cadastro-autônomo) e no
[ADR-053 Proposed](adr/053-cadastro-autonomo-seguro.md). Até o aceite do ADR e os gates O-0–O.H, não
tratar o fluxo atual por convite como cadastro público nem adicionar parâmetros de campanha ao token
do convite.

## Roles e sessão

Roles tenant: `owner`, `gestor`, `doctor`, `attendant`, `financial`. Role de plataforma: `super_admin`.

Supabase Auth mantém a sessão. Em requests protegidas, `authenticate()` relê o profile, compara `claims_version` e obtém permissions efetivas. Alterar role, status ou override incrementa o epoch; token antigo deixa de autorizar. Logout revoga refresh tokens, e a comparação de epoch limita access tokens copiados.

MFA AAL2 é obrigatório para super-admin. Gestor/financial sem MFA recebem orientação, mas não um bloqueio obrigatório.

## Convite de clínica

1. Super-admin cria convite opcionalmente enviado por e-mail.
2. O token bruto aleatório aparece somente no link; banco guarda HMAC-SHA256.
3. Convite expira em 24 h e usa `version` para impedir concorrência/replay.
4. `/join/[token]` coleta clínica, owner, plano e checkout.
5. Trial criado: 14 dias.

## Produto único — sem módulos por especialidade

O onboarding atual e o futuro self-service provisionam o mesmo produto Qoro. Não existe seleção,
feature gate, plano ou dashboard diferente por psiquiatria, psicologia ou outra especialidade.
Especialidade permanece um dado clínico/operacional de profissionais, procedimentos, documentos e
configuração informativa do agente; esta decisão não autoriza remover esses campos.

### `clinic_invites.step_state`

Pode persistir somente:

- `currentStep`, `completed`;
- dados parciais da clínica;
- nome/e-mail do owner;
- `planId`.

Senha, cartão/CVV e `billingContact` ficam somente na request. Não devem ser serializados, logados ou salvos no `step_state`.

## Saga de checkout

```text
validar convite/versão
  -> criar customer e assinatura no Asaas
  -> criar owner no Supabase Auth
  -> dbAdmin.transaction:
       clínica + profile owner + config IA
       billing customer/subscription
       convite completed
  -> publicar eventos pós-tenant
```

Asaas e Supabase Auth são I/O externos e ficam fora da transação PostgreSQL. Se a etapa local falhar, a saga tenta cancelar a assinatura Asaas. Essa compensação é best-effort: não existe o cron `onboarding-reconcile` citado por um comentário antigo; veja [limitações](roadmap/known-limitations.md).

O checkout envia dados do cartão ao Server Action e ao Asaas; não há tokenização client-side/hosted checkout.

## Convite de membro

- owner/gestor com `manage:employees` convida por Supabase Auth;
- assentos são validados antes do convite;
- membro pode ser ativado/desativado e trocar role;
- override granular exige plano Clínica/Pro e `manage:permissions`;
- perfis desativados/deletados não entram no shell.

## Super-admin e impersonação

Super-admin não tem `clinic_id`. Operação cross-tenant usa serviços admin explícitos. Acesso ao shell clínico exige impersonação assinada, temporária e auditada; o ator real não é substituído no audit log.

## Failure modes

- convite expirado/usado/versionado: rejeitar sem provisionar;
- falha de e-mail: convite continua criado e pode ter link copiado;
- falha após criação externa: compensar e registrar erro; verificar resíduos manualmente;
- quota de assentos: bloquear antes de convidar;
- claims drift: exigir nova autenticação/refresh.
