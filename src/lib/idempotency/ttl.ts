/**
 * TTLs de idempotência (segundos). Fonte única — antes clonado em 4 contextos
 * (patient/clinical/scheduling/financial) como `IDEM_TTL`/`PATIENT_IDEM_TTL`
 * + literais `604_800` inline. Centralizar mata a deriva de nome/valor (S1/S4).
 */

/**
 * 7 dias — janela de dedup das mutations críticas que podem ter retry tardio
 * (cliente mobile offline > 24h). É o OVERRIDE que as Server Actions dos 4
 * contextos passam em `idempotency.ttlSeconds`.
 *
 * Distinto de IDEMPOTENCY_TTL_DEFAULT_SECONDS (24h, em ./mutation): aquele é o
 * default quando nenhum override é passado; este é a política de 7 dias.
 */
export const MUTATION_IDEM_TTL_SECONDS = 604_800;
