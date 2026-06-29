# Runbook — Incidente de dados pessoais (LGPD) — janela de 72h

> C16 FASE 9. SEV1. A LGPD (art. 48) exige comunicar a ANPD e os titulares em
> **prazo razoável** após confirmar um incidente de segurança com risco. Trate
> como **72h** internamente. Este runbook é operacional; **não substitui o jurídico/DPO**.

## Relógio
- **T0** = momento em que você **confirma** o incidente (não a suspeita).
- Meta interna: avaliar e, se houver risco relevante, comunicar **dentro de 72h** de T0.

## Passo 0 — Conter (imediato)
1. Estanque o vazamento: rotacione credenciais comprometidas ([secret-rotation.md](./secret-rotation.md)), revogue sessões, feche o vetor.
2. Suspeita de acesso indevido cross-tenant? Verifique o isolamento (RLS FORCE + `withTenant`) — ver [c2-validation.md](./c2-validation.md). NÃO desligue RLS.
3. Preserve evidências: NÃO apague logs. `audit_events` é append-only e particionado (forense).

## Passo 1 — Investigar (escopo)
1. **O quê**: que dados pessoais (nome/CPF/telefone/dados clínicos)? Lembre: PII de paciente é **cifrada em repouso** (AES-256-GCM per-tenant) e logs/audit passam por `sanitizePayload` — isso limita o exposto.
2. **Quem/quantos**: quais clínicas/titulares? Use `audit_events` filtrando por `request_id`/`correlation_id`/`action`/janela temporal (via dbAdmin / export admin).
3. **Como**: vetor (credencial, bug, terceiro). Cheque Sentry pelo `trace_id`.

## Passo 2 — Avaliar risco (com DPO/jurídico)
- Há risco relevante aos titulares? (dado sensível clínico = alto). Isso decide se comunica ANPD + titulares.

## Passo 3 — Comunicar (se risco relevante)
- **ANPD**: notificação no prazo, com: natureza, dados afetados, nº de titulares, medidas adotadas, riscos.
- **Titulares afetados**: comunicação clara do ocorrido e do que fazer.
- Registre datas/horas de cada comunicação.

## Passo 4 — Remediar e registrar
- Corrija a causa raiz (post-mortem — ver [incident-response.md](./incident-response.md)).
- Documente o incidente completo (timeline T0→resolução) para o registro de incidentes / DPA.

## Recursos do sistema que ajudam
- Export por titular: ação LGPD de export ([c5-validation.md](./c5-validation.md)); `lgpd_requests` registra pedidos.
- Direito ao apagamento: hard-delete + anonimização (ADR-021) já implementados.
- Cripto per-tenant + sanitização de logs reduzem o material exposto por padrão.
