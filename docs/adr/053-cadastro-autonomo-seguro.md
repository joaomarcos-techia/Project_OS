# ADR-053 — Cadastro autônomo seguro e atribuição de aquisição

- **Status:** Proposed
- **Data:** 2026-09-02
- **Contextos:** onboarding, identity, tenancy e billing, entregues em slices de no máximo dois
  bounded contexts
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-008](008-identity-patterns.md), [ADR-010](010-security-definer-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md) e
  [onboarding canônico](../onboarding-spec.md)
- **Plano detalhado:** [Qoro v2 §21](../qorov2.md#21-track-o--arquitetura-segura-do-cadastro-autônomo)

## Contexto

O onboarding atual começa em convite criado pelo super-admin. A aquisição futura deve permitir que um
visitante de `qoro.dev` inicie o cadastro em `app.qoro.dev`, verifique a identidade, escolha plano,
configure a assinatura e seja provisionado sem intervenção humana. A superfície é pública e pode ser
chamada diretamente por bots; validações de frontend e um token aleatório não contêm DDoS, spam,
enumeração, abuso de e-mail/pagamento ou criação massiva de tenants.

O fluxo também precisa preservar atribuição de Google Ads sem compartilhar cookies de autenticação
entre subdomínios, expor PII ao marketing ou usar o hit de um crawler como conversão de negócio.

## Decisão proposta

1. `qoro.dev/comecar` será uma ponte de atribuição com destino fixo para
   `app.qoro.dev/cadastro`. Ela aceita somente parâmetros Google/UTM allowlisted, não cria sessão no
   banco e nunca aceita um redirect arbitrário.
2. A sessão anônima será apenas bootstrap: token CSPRNG de 256 bits em cookie `__Host-`, host-only,
   `HttpOnly`, `Secure` e `SameSite=Lax`; banco guarda somente HMAC, TTL, estado, tentativas e CAS.
   Token anônimo não autoriza billing, tenant, role ou dashboard e não aparece na URL.
3. Supabase Auth continua dono da senha/sessão. E-mail confirmado e PKCE substituem a autoridade
   anônima antes de dados de clínica, plano e billing. Respostas públicas não enumeram contas.
4. WAF/edge e Upstash aplicam limites multidimensionais por IP, sessão, HMAC de e-mail/telefone,
   cookie de dispositivo não invasivo, usuário, endpoint e orçamento global. Operações anônimas com
   amplificação de custo falham fechadas/degradadas quando o limiter distribuído está indisponível.
5. Bot protection é adaptativa: baixo risco sem desafio, risco moderado com Turnstile validado no
   backend e alto risco com cooldown/bloqueio antes de qualquer escrita ou I/O caro.
6. Plano, preço, trial, role e estado de pagamento são resolvidos no servidor. O self-service usa
   Checkout recorrente hospedado/tokenização oficial; PAN/CVV nunca atravessam o backend do Qoro.
7. Browser callback não confirma pagamento. Webhook autenticado, event id, máquina monotônica,
   intenção/lease e reconcile autorizam o provisionamento idempotente.
8. A clínica definitiva e o owner nascem uma vez, em transação, após identidade verificada e gate de
   billing aceito. O frontend nunca fornece `clinic_id` como autoridade. Recursos posteriores seguem
   `withTenant`, RLS/FORCE RLS, grants mínimos e constraints tenant-safe.
9. Marketing e segurança não compartilham cookies. Google linker/consentimento preservam atribuição.
   A primeira campanha usa somente `signup_completed` como conversão primária e mantém
   `subscription_activated` secundária; a troca futura é explícita e nunca torna o redirect conversão
   de negócio.
10. A implementação será dividida em O-1–O-7 conforme §21; este ADR não autoriza migration, regra WAF,
    integração Google/Turnstile, mudança de API pública ou deploy.
11. O trial de sete dias começa somente depois de uma intenção idempotente e de readback server-side
    confirmarem no Asaas a assinatura recorrente esperada — customer, plano, valor e vencimento — em
    estado não terminal. A primeira cobrança pode vencer ao fim do trial; callback do navegador não
    concede acesso.

## Decisões de negócio registradas em 02/09/2026

1. Trial: assinatura recorrente criada de forma idempotente e confirmada por readback server-side;
   não método informado pelo browser e não primeira cobrança liquidada.
2. Ads: `signup_completed` é a única conversão primária inicial; `subscription_activated` permanece
   secundária até haver volume suficiente para uma troca explícita.

## Gate técnico ainda necessário para aceitar o ADR

1. Confirmar disponibilidade/contrato do Checkout recorrente hospedado no ambiente real antes de
   remover o checkout por convite existente. Os fluxos coexistem durante a migração.

## Consequências

### Positivas

- bots não criam tenants ou recursos financeiros antes de provar identidade e passar gates de custo;
- token roubado tem autoridade curta, single-use e não vaza por URL/Referer;
- pagamento, plano e isolamento tenant permanecem autoritativos no backend/banco;
- aquisição pode ser medida entre landing e app sem acoplar analytics à autenticação;
- replay, múltiplas abas e callbacks fora de ordem são resolvidos por estado/unique/CAS.

### Custos e riscos

- exige migration global pré-tenant, janitor, limiter fail-closed e observabilidade própria;
- requer configuração manual coordenada em Vercel, Supabase, Turnstile, Google e Asaas;
- e-mail confirmado e Checkout externo aumentam passos; métricas devem medir abandono sem reduzir os
  controles silenciosamente;
- saga precisa reconcile/compensação para recursos externos órfãos;
- o fluxo por convite atual transporta cartão pela Server Action e não deve ser copiado para o
  self-service.

## Alternativas rejeitadas

- token em query string como proteção principal: vaza e não limita abuso volumétrico;
- criar tenant antes de verificar e-mail/billing: amplifica custo e lixo no banco;
- aceitar `payment=true`, preço, role ou `clinic_id` do browser: quebra autoridade e multi-tenancy;
- CAPTCHA obrigatório para todos: aumenta abandono sem substituir limites;
- IP como único sinal: falha em botnet e pune redes NAT;
- compartilhar cookie em `.qoro.dev`: aumenta o impacto de comprometimento da landing;
- encaminhar cartão pelo backend: amplia escopo e risco sem necessidade quando há Checkout hospedado;
- um endpoint público `signup/complete`: permite tentar pular a máquina de estados.

## Evidência necessária para Accepted

- contrato do provider para o gate de trial e decisão das duas questões de negócio;
- threat model e matriz endpoint/limites aprovados;
- proof de Checkout recorrente hospedado no Sandbox sem PAN/CVV no Qoro;
- desenho de migration, grants/RLS, cleanup, idempotência, saga/reconcile e rollback revisado;
- plano de testes unit, integration DB, contract, adversarial, load scratch, E2E e Product Acceptance;
- responsáveis pelas configurações manuais e pelos alertas/runbooks definidos.
