// Superfície pública do context `health-insurance` (convênios e faturamento
// TISS; ADR-072). Outros contexts só importam deste arquivo
// (eslint-plugin-boundaries). O plano de execução é o QORO_TISS_MASTER_PLAN.md.
export {
  tissSchemaVersions,
  tissTerminologyVersions,
  tissTerms,
  type TissSchemaVersionRow,
  type TissTermRow,
  type TissTerminologyVersionRow,
} from './schema';
