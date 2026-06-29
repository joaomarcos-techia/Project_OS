# ADR-030 — Security headers + CSP faseada (Report-Only primeiro)

**Status:** accepted
**Date:** 2026-06-29

## Context

A `next.config.ts` não enviava nenhum header de segurança (sem HSTS, anti-clickjacking,
nosniff, CSP). Para um SaaS clínico/LGPD indo a produção, isso amplia a superfície de
XSS/clickjacking/MIME-sniffing. Ao mesmo tempo, uma **CSP bloqueante ligada de uma vez**
quebra apps Next (scripts inline de hydration, analytics) — risco inaceitável para um app
em produção com clientes reais.

## Decision

Adicionar os security headers via `headers()` em `next.config.ts`, aplicados a `/(.*)`:

- **Imediatos e bloqueantes** (seguros): `Strict-Transport-Security`
  (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera/microphone/geolocation/browsing-topics negados).
- **CSP em `Content-Security-Policy-Report-Only`** primeiro — NUNCA bloqueia, só reporta.
  Política inicial com `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
  e `connect/img` amplos o bastante para Supabase (storage/realtime) e o tunnel do Sentry
  (`/monitoring`, same-origin).
- **Promover a CSP bloqueante** só depois de observar violações reais por algumas semanas,
  e então com **nonce via middleware** (não `'unsafe-inline'`). Nunca ligar bloqueante direto.

## Consequences

- Clickjacking, MIME-sniffing e downgrade HTTP fechados já (headers bloqueantes).
- CSP coleta violações sem risco de quebrar a UI; a evolução para bloqueante é incremental
  e reversível (basta o header voltar a Report-Only).
- A versão bloqueante exigirá gerar nonce por request no middleware e propagá-lo aos
  scripts — trabalho de uma fase futura, fora desta decisão.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` cobrem navegadores novos e antigos.

## Alternatives

- **CSP bloqueante direto com `'unsafe-inline'`:** rejeitado — `'unsafe-inline'` anula o
  valor da CSP e ainda arrisca quebrar; pior dos dois mundos.
- **CSP bloqueante com nonce já agora:** adiado — toca o middleware de auth (sensível,
  recém-alterado para carimbar `request_id`) e tem alto risco de quebrar hydration sem
  dados de violação reais para calibrar.
- **Headers via middleware em vez de `next.config`:** rejeitado para os estáticos —
  `headers()` cobre todas as respostas de forma declarativa e simples; o middleware fica
  reservado para o nonce na fase bloqueante.

## References

- Plano C16 (Onda 3 / FASE 10), `docs/c16/slo.md`
- ADR-029 (observability) — o tunnel do Sentry influencia `connect-src`/matcher do middleware
