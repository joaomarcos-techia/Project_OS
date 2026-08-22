# ADR-009 — Mitigação de drift de claims

## Status

Accepted — Reference.

## Decision

JWT carrega `claims_version` e permissions planas. `authenticate()` relê o profile e compara o epoch atual. Alteração de role, status ou override incrementa o epoch, invalidando claims antigas mesmo antes de o access token expirar.

Logout revoga refresh tokens; o check server-side cobre access token copiado. Cache nunca pode sobreviver ao epoch autoritativo.

## Failure mode

Profile ausente, desativado/deletado ou epoch divergente resulta em sessão inválida/negação, não estado silencioso dentro do produto.
