# Diagramas atuais

Todos os diagramas desta página são sínteses de código observado, fontes [E01–E25](01-contexto-atual.md). Arestas completas por import/evento estão nos artefatos gerados [dependency-graph](dependency-graph.mmd), [event-flow](event-flow.mmd) e [context-map](context-map.mmd).

## Sistema

```mermaid
flowchart LR
  P[Visitante] --> L[Landing Vite estática na Vercel]
  L -->|ponte de atribuição e host aprovado| N[App Next na Vercel]
  U[Equipe da clínica] --> N
  N --> C[13 contexts e lib]
  C -->|Drizzle e postgres| D[(PostgreSQL Supabase)]
  C --> A[Supabase Auth]
  C --> S[Supabase Storage]
  C --> B[Asaas SaaS Qoro]
  C --> R[Asaas na conta recebedora da clínica]
  C --> X[Meta / Gemini / Resend / Upstash / secrets]
  V[21 Vercel Crons] --> N
  D --> O[Outbox e handlers]
  O --> C
  C --> J[JSON sanitizado / Sentry]
```

## Identidade e continuidade

```mermaid
sequenceDiagram
  participant U as Navegador
  participant N as Next cadastro/Auth
  participant D as Postgres
  participant A as Supabase Auth
  participant E as Resend
  U->>N: Sessão / respostas / identidade e senha
  N->>D: Persistir jornada e controle de confirmação
  N->>A: Criar/vincular identidade no fluxo autorizado
  N->>E: Código/link conforme etapa
  U->>N: Confirmar código ou retomar pela ponte segura
  N->>D: Validar tentativa, expiração e consumo
  N->>A: Operações de confirmação/sessão
  N-->>U: Cookie HttpOnly e próxima etapa pendente
  U->>N: Requisição autenticada
  N->>A: getClaims / sessão server-side
  N->>D: Perfil autoritativo, ativo, versão e permissões
  N-->>U: Acesso ou recusa
```

Não representa senha gravada no banco de negócio nem um segundo login obrigatório. Sequências variam entre cadastro, retomada e legado; E07 contém a implementação específica.

## Leitura e escrita tenant

```mermaid
sequenceDiagram
  participant U as Request autenticada
  participant G as Guard de identidade/permissão
  participant C as Caso de uso
  participant T as withTenant
  participant D as Postgres
  U->>G: Sessão e ação
  G->>D: Perfil autoritativo e claims_version
  G->>C: CurrentUser / clinicId verificados
  C->>T: Operação tenant-scoped
  T->>D: BEGIN + SET LOCAL ROLE authenticated
  T->>D: set_config app.current_clinic e app.current_user
  C->>D: Query / mutation / evento na mesma transação
  D-->>C: RLS, constraints e resultado
  T->>D: COMMIT ou ROLLBACK e fim do contexto local
```

Admin e worker são caminhos distintos allowlisted, não usuários tenant com privilégio irrestrito.

## Webhook financeiro atual

```mermaid
sequenceDiagram
  participant A as Asaas
  participant W as Route Handler SaaS ou paciente
  participant P as Cliente Asaas da conta correta
  participant D as Postgres
  participant C as Billing ou Payments
  A->>W: POST de evento
  W->>W: Limite de corpo / ref / token constante / parse IDs
  W->>P: Readback autoritativo fora da transação
  P-->>W: Estado / valor / vínculos / deleted
  opt Upgrade SaaS pago
    W->>P: Sincronizar e reler recorrência antes da cota
  end
  W->>D: BEGIN + dedup namespace atual
  W->>C: Resolver contrato/cobrança e aplicar transição
  C->>D: Estado e auditoria/eventos na mesma transação local
  D-->>W: COMMIT ou rollback incluindo dedup
  W-->>A: 200 aceito/duplicado ou não-2xx em falha transitória
```

Não há inbox bruta assíncrona universal: processed_webhooks registra dedup/processamento local; outbox publica efeitos. Introduzir inbox seria decisão posterior, não correção automática.

## Estados atuais

```mermaid
stateDiagram-v2
  state "Assinatura SaaS" as S {
    [*] --> trial
    trial --> active
    trial --> past_due
    trial --> cancelled
    active --> past_due
    active --> cancelled
    past_due --> active
    past_due --> cancelled
  }
```

`cancelled` é terminal na transição genérica. Reativação é operação auditada própria após confirmação do provedor. Plano, ciclo, quota e acesso são dimensões adicionais; não estão codificados nesse diagrama simplificado.

```mermaid
stateDiagram-v2
  state "Invoice SaaS" as I {
    [*] --> open
    open --> partial
    open --> paid
    open --> overdue
    open --> cancelled
    partial --> paid
    partial --> overdue
    partial --> cancelled
    overdue --> paid
    overdue --> cancelled
  }
```

`paid` não regride por evento atrasado; refund é registrado fora desse estado. Restauração autoritativa de cobrança removida usa seam específico. Pagamento de paciente tem estados próprios (`pending`, `paid`, `expired`, `cancelled`, `refunded`, `failed`) e risco separado. `CONFIRMED` pode quitar obrigação sem significar saldo liquidado no banco.

## Arquivos

```mermaid
flowchart LR
  N[Action autorizada] --> H[Helpers Storage]
  H --> S[Supabase: clinical-pdfs / lgpd-exports / admin-exports / clinic-logos]
  H --> D[(Paths de PDF / URL de logo no Postgres)]
  U[Navegador] --> G[Rota clínica same-origin com sessão + tenant]
  G --> H
  H -->|PDF privado como bytes| G
  S -->|URL assinada: export; pública: logo| U
```

Os quatro buckets são os helpers identificados; não representam inventário atual de todos os buckets remotos. O quinto bucket de marca aparece em templates e em evidência histórica.
