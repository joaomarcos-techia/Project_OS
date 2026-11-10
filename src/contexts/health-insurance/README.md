# Context `health-insurance` (Convênios)

Convênios e faturamento no Padrão TISS da ANS: operadoras, planos, credenciamento, contratos,
carteirinhas, coberturas, coparticipação, autorizações, guias (Consulta e SP/SADT), lotes, XML,
demonstrativos, glosas, recursos e conectores.

- Decisões duradouras: [ADR-067](../../../docs/adr/067-convenios-e-tiss.md).
- Plano, tarefas, harness e evidências: [`QORO_TISS_MASTER_PLAN.md`](../../../QORO_TISS_MASTER_PLAN.md),
  a fonte única do módulo.
- Schemas XSD oficiais: `tiss/schemas/<versão>/` com `MANIFEST.json` (bytes idênticos aos da ANS).
- Terminologia TUSS: gerada de `data/tiss/terminologia/<competência>/`, carregada nas tabelas
  globais `tiss_*`.

Regras que não mudam:

- CID e dados clínicos nunca alimentam guia.
- O recebível da operadora é ligado à guia, nunca ao atendimento.
- "Enviada", "autorizada" e "homologada" só com registro humano ou recibo real.
