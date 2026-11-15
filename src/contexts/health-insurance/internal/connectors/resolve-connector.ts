/**
 * P6.4 — qual adaptador atende uma operadora. Sem adaptador HOMOLOGADO para aquela operadora e
 * aquela operação, é o manual. O eletrônico que não responde (tempo, rede, circuito aberto, sem
 * configuração) também cai no manual, com o motivo: nenhum estado falso (C.13).
 *
 * O registro de homologados é injetado. No código de produção ele é vazio até a homologação com
 * cada operadora (B5/P6.5): guardar credencial (P12.5) não liga o envio eletrônico.
 */
import type { ConnectorOutcome } from '../../tiss/connector/connector';

import { createManualAdapter, manualOutcome } from './manual-adapter';
import type {
  OperatorConnector,
  OperatorOperation,
  OperatorOutcome,
  OperatorRequest,
} from './operator-connector';

/** Transporte eletrônico já homologado para uma operadora (P6.5 entrega o SOAP). */
export interface HomologatedTransport {
  readonly id: string;
  /** Operações homologadas com esta operadora; as demais seguem manuais. */
  readonly operations: ReadonlySet<OperatorOperation>;
  submit(request: OperatorRequest): Promise<ConnectorOutcome>;
}

export type HomologatedRegistry = ReadonlyMap<string, HomologatedTransport>;

/** Produção, hoje: nenhuma operadora homologada. */
export const NO_HOMOLOGATED_OPERATORS: HomologatedRegistry = new Map();

export function resolveOperatorConnector(args: {
  insurerId: string;
  registry: HomologatedRegistry;
  /** Há credencial ativa guardada (P12.5)? Só muda o motivo mostrado; não liga nada. */
  hasActiveCredential: boolean;
}): OperatorConnector {
  const transport = args.registry.get(args.insurerId);
  const manualReason = args.hasActiveCredential ? 'credential_without_homologation' : 'not_homologated';
  if (!transport) return createManualAdapter(manualReason);
  return {
    id: transport.id,
    async perform(request: OperatorRequest): Promise<OperatorOutcome> {
      if (request.insurerId !== args.insurerId) {
        // Pedido de outra operadora por este adaptador: recusa em vez de transmitir para a errada.
        throw new Error('operadora do pedido diferente da do adaptador');
      }
      if (!transport.operations.has(request.operation)) return manualOutcome(request, manualReason);
      const outcome = await transport.submit(request);
      if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
        return { kind: 'electronic', operation: request.operation, outcome };
      }
      // unavailable, circuit_open, not_configured: o manual continua valendo, sem estado falso.
      return manualOutcome(request, 'connector_unavailable');
    },
  };
}
