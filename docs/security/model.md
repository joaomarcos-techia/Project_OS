# Modelo de segurança

## Status

Canonical — autenticação, autorização, isolamento, criptografia e auditoria.

## Source of Truth

`src/lib/auth`, `src/lib/db`, `src/lib/crypto`, `src/lib/storage`, `src/lib/audit`, guards/actions e migrations.

## Controles em camadas

```text
sessão Supabase
  -> profile autoritativo + claims_version
  -> role/permission guard
  -> gate de status da clínica
  -> validação/idempotência/auditoria
  -> withTenant + RLS FORCE
```

Nenhuma camada isolada substitui as demais. Middleware não é boundary de autenticação.

## Identidade e autorização

- roles: `owner`, `gestor`, `doctor`, `attendant`, `financial`, `super_admin`;
- 28 permissions canônicas em `src/lib/auth/permissions.ts`;
- JWT carrega `permissions: string[]`; profile/epoch do banco vence claim antiga;
- overrides individuais são persistidos e só existem em Clínica/Pro;
- super-admin exige AAL2 e não pertence a tenant;
- acesso cross-tenant usa admin service ou impersonação auditada.

## Multi-tenancy

- `clinic_id` está em toda entidade tenant-scoped;
- `withTenant` define role/GUC dentro da transação usada pela query;
- RLS é habilitada e forçada; policies usam subqueries InitPlan quando aplicável;
- tabelas globais e de plataforma não fingem ser tenant tables;
- URL runtime com papel `NOBYPASSRLS` é requisito operacional. Está comprovada no DEV usado pelo localhost; produção exige prova separada.

## Criptografia e PII

- AES-256-GCM com nonce/tag e versão de chave;
- HKDF deriva chave por clínica;
- HMAC-SHA256 produz lookup determinístico sem plaintext;
- master keys e lookup salt vêm do backend de secrets;
- logs/audit/eventos não recebem CPF, telefone, cartão, senha, token ou conteúdo clínico em claro;
- Sentry scrub remove body/headers/campos sensíveis conhecidos.

## Storage

| Bucket | Acesso | TTL padrão |
| --- | --- | ---: |
| `clinical-pdfs` | privado | 24 h |
| `lgpd-exports` | privado | 24 h no workflow atual |
| `admin-exports` | privado | 7 dias |
| `clinic-logos` | público, tipo/tamanho validados | não se aplica |
| `logo_qoro` | público, ativo legado da marca | não se aplica |

Signed URL é bearer token temporário. Expirar/revogar sessão não revoga imediatamente URL já emitida.

Em produção, em 2026-08-18, os três buckets de conteúdo sensível estavam privados; `clinical-pdfs` e `lgpd-exports` continham objetos reais. Não há policies no schema `storage`: o acesso privado depende dos caminhos privilegiados e de URLs assinadas da aplicação.

## Achado ativo de grants

No DEV, `bump_plan_claims_version()` é `SECURITY DEFINER` e possui `EXECUTE` herdado por `PUBLIC`, logo também por `anon`. A função é desenhada como trigger e não foi invocada durante a auditoria, mas o grant contradiz o padrão least-privilege. Corrija por nova migration com `REVOKE`; não edite a `0055` aplicada.

## Webhooks e crons

- Meta: HMAC SHA-256; Asaas: token constante; ambos deduplicam persistentemente.
- Cron: Bearer de no mínimo 32 caracteres; tarefas destrutivas podem usar segredo separado.
- Comparações de segredo usam tempo constante quando o contrato exige.

## Headers e rede

Next aplica HSTS, frame/content/referrer/permissions headers. CSP está em modo `Report-Only`, portanto coleta violações mas ainda não bloqueia. Data API, rede do Postgres e políticas de buckets são configuração externa e precisam ser confirmadas no ambiente.

## Auditoria e retenção

Mutations relevantes gravam ator real, clínica, action/resource, request id e before/after sanitizado. Impersonação não apaga o ator de plataforma. Partições e retenção são mantidas por cron.

## Regras de revisão

- entrada externa sem Zod/validação: falha;
- permission apenas na UI: falha;
- acesso tenant fora de `withTenant`: falha;
- `dbAdmin` em fluxo comum sem seam mínimo: revisar/bloquear;
- catch que engole provider/DB error: falha;
- segredo/PII em log, evento ou documentação: falha.
