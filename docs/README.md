# Documentação do ClinicaOS — Índice Mestre

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01

Esta é a **porta de entrada** da engenharia do ClinicaOS — a memória externa do projeto. Se você é novo, comece em [Começe aqui](#começe-aqui). Se procura algo específico, use o [mapa por intenção](#mapa-por-intenção).

> 🎯 Teste de sucesso desta doc: *"uma pessoa nova daqui a 6 meses entende o sistema apenas pela documentação."*

---

## Começe aqui

1. **Rodar o projeto** → [development/setup.md](./development/setup.md)
2. **Trilha do dev novo (Dia 1/2/3)** → [development/onboarding.md](./development/onboarding.md)
3. **Entender a arquitetura** → [VisãoGeral.md](./VisãoGeral.md) + [architecture/context-map.md](./architecture/context-map.md)
4. **Como contribuir** → [engineering/git-workflow.md](./engineering/git-workflow.md)

---

## Mapa por intenção

### 🏛️ Arquitetura & Produto
| Quero… | Vá para |
|---|---|
| A fonte-da-verdade (visão, arquitetura, estratégia) | [VisãoGeral.md](./VisãoGeral.md) |
| Mapa dos 8 bounded contexts + eventos | [architecture/context-map.md](./architecture/context-map.md) |
| Decisões arquiteturais e seus racionais | [adr/README.md](./adr/README.md) |
| Contratos de eventos | [contracts/events/billing.md](./contracts/events/billing.md) |

### 🛠️ Engenharia & Convenções
| Quero… | Vá para |
|---|---|
| Regras de código (naming, imports, RLS, threat model) | [CONVENTIONS.md](./CONVENTIONS.md) |
| Branches, commits, PR, CI | [engineering/git-workflow.md](./engineering/git-workflow.md) |
| "Isto precisa de ADR / migration / evento?" | [engineering/decision-guide.md](./engineering/decision-guide.md) |
| Trabalhar com Claude Code + Documentação Automática | [engineering/ai-development.md](./engineering/ai-development.md) |
| Saber quando algo está "pronto" | [engineering/definition-of-done.md](./engineering/definition-of-done.md) |

### 💻 Desenvolvimento
| Quero… | Vá para |
|---|---|
| Instalar e rodar | [development/setup.md](./development/setup.md) |
| Entender as variáveis de ambiente | [development/environment.md](./development/environment.md) |
| Onboarding de desenvolvedor | [development/onboarding.md](./development/onboarding.md) |

### 📊 Estado do projeto
| Quero… | Vá para |
|---|---|
| Status de cada camada (C0–C16) | [PROGRESS.md](./PROGRESS.md) |
| O plano de implementação completo | [PlanoAção.md](./PlanoAção.md) |
| Planos/specs de follow-up ativos | [implementation/README.md](./implementation/README.md) |

### 🚨 Operação & Produção
| Quero… | Vá para |
|---|---|
| Runbooks operacionais (incidentes, migrations, DR) | [runbooks/README.md](./runbooks/README.md) |
| Observabilidade / hardening / production readiness | [c16/README.md](./c16/README.md) |
| Checklist de go-live | [runbooks/production-readiness.md](./runbooks/production-readiness.md) |

### 🔒 Segurança & Compliance
| Quero… | Vá para |
|---|---|
| Threat model + anti-padrões | [CONVENTIONS.md](./CONVENTIONS.md) (seção Threat Model) |
| RLS / isolamento de tenant | [adr/007-rls-implementation-patterns.md](./adr/007-rls-implementation-patterns.md) |
| SECURITY DEFINER | [adr/010-security-definer-patterns.md](./adr/010-security-definer-patterns.md) |
| Encryption per-tenant | [adr/012-encryption-strategy.md](./adr/012-encryption-strategy.md) |
| Retenção clínica vs LGPD | [adr/017-...](./adr/017-clinical-record-retention-vs-lgpd.md) · [adr/021-...](./adr/021-lgpd-anonymization-on-clinical-retention.md) |
| Security headers / CSP | [adr/030-security-headers-csp.md](./adr/030-security-headers-csp.md) |
| Incidente de dados (72h) | [runbooks/lgpd-breach-72h.md](./runbooks/lgpd-breach-72h.md) |

### 📚 Governança da documentação
| Quero… | Vá para |
|---|---|
| Qual doc vence quando dois discordam | [documentation-authority.md](./documentation-authority.md) |
| Frescor: status, owner, revisão | [documentation-lifecycle.md](./documentation-lifecycle.md) |
| Inventário classificado de toda a doc | [documentation-audit.md](./documentation-audit.md) |
| Conformidade dos ADRs ao template | [adr-conformance.md](./adr-conformance.md) |
| Histórico de mudanças (changelog) | [../CHANGELOG.md](../CHANGELOG.md) |
| O relatório da modernização | [achados/documentation-modernization-report.md](./achados/documentation-modernization-report.md) |

---

## Como navegar

- **Fonte da verdade em conflito:** siga [documentation-authority.md](./documentation-authority.md) — ADRs > CONVENTIONS > VisãoGeral > Planos > histórico.
- **Confiar num doc?** Olhe o cabeçalho `Status / Última revisão` (padrão em [documentation-lifecycle.md](./documentation-lifecycle.md)).
- **Cada módulo do código** tem README próprio: [`src/contexts/*/README.md`](../src/contexts/) e [`src/lib/*/README.md`](../src/lib/).

### Convenção de ícones (herdada da VisãoGeral)

| Ícone | Significado |
|---|---|
| 🔒 | Decisão permanente — não negocie sem repensar tudo |
| 🔓 | Decisão temporária — deve mudar com o produto |
| ⚠️ | Armadilha conhecida — leia antes de tocar |
| 💡 | Insight de experiência, não de teoria |
| 📌 | Ponto onde "o eu do futuro" tende a simplificar e se ferrar |

---

## Estrutura de `docs/`

```
docs/
├── README.md                     ← você está aqui (índice mestre)
├── documentation-authority.md    ← fonte da verdade
├── documentation-lifecycle.md    ← frescor
├── documentation-audit.md        ← inventário
├── VisãoGeral.md                 ← fonte-da-verdade (visão+arquitetura)
├── CONVENTIONS.md                ← lei viva (regras de código)
├── PlanoAção.md · PROGRESS.md    ← plano + estado (C0–C16)
├── architecture/  → context-map
├── development/   → setup · environment · onboarding
├── engineering/   → git-workflow · ai-development · decision-guide
├── adr/           → 30 ADRs + README (decisões)
├── runbooks/      → 25+ runbooks + README (operação)
├── c16/           → observabilidade/hardening
├── contracts/     → contratos de eventos
├── implementation/→ planos de follow-up + relatórios (README desambigua)
├── audits/ · remediation/ → registro histórico
└── achados/       → relatório da modernização
```
