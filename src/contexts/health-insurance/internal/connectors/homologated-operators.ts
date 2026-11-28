/**
 * P9.4 — operadoras com webservice HOMOLOGADO, por registro ANS (a homologação é da operadora; a
 * credencial é de cada clínica). **Em produção a lista é vazia** até a homologação com cada
 * operadora (B5) e o GO do fundador (P15.8): sem entrada aqui, nenhum lote sai pelo conector e a
 * tela nem oferece o envio eletrônico. Um teste garante que a lista de produção é vazia.
 *
 * Cada entrada traz o que a operadora informa na homologação (endereços, SOAPAction, versão SOAP,
 * codificação da senha, deduplicação) e a evidência do aceite. Nada disto é presumido no código.
 */
import type { TissSoapConfig } from './tiss-soap/tiss-soap-adapter';

export interface OperatorHomologation {
  registroANS: string;
  /** `AAAA-MM-DD` do aceite da operadora. */
  homologatedOn: string;
  /** Referência do aceite (protocolo, e-mail), sem dado de paciente. */
  evidence: string;
  soap: Omit<TissSoapConfig, 'id' | 'insurerId' | 'registroANS'>;
}

export type HomologationRegistry = ReadonlyMap<string, OperatorHomologation>;

/** Produção: nenhuma operadora homologada (B5). */
export const PRODUCTION_HOMOLOGATIONS: HomologationRegistry = new Map();

/** Fonte usada pelo app; só os harnesses (Postgres descartável + stub) a substituem. */
export const homologationRuntime: { registry: () => HomologationRegistry } = {
  registry: () => PRODUCTION_HOMOLOGATIONS,
};
