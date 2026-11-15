/**
 * P6.4 — porta `OperatorConnector`: as operações que a clínica faz com a operadora, com o mesmo
 * contrato para o caminho MANUAL (padrão e completo) e para o eletrônico (adaptador homologado,
 * P6.5, só depois da homologação com cada operadora, B5).
 *
 * Regras (C.13, D24, P12.5):
 *   - nenhum resultado diz "enviado", "autorizado" ou "recebido" sem recibo real da operadora
 *     (eletrônico) ou registro humano numa tela do Qoro (manual);
 *   - o manual é o comportamento padrão: diz o que fazer no portal ou no papel e ONDE registrar o
 *     resultado no Qoro (tela e ação que já existem);
 *   - conector fora do ar, circuito aberto ou sem homologação → volta ao manual, sem estado falso;
 *   - a porta não recebe credencial: o adaptador homologado lê a dele pelo módulo de credenciais
 *     (P12.5) e nada dela aparece em resultado, mensagem ou log.
 */
import type { ConnectorOutcome } from '../../tiss/connector/connector';

/** Operações do webservice TISS 4.03.00 (P6.5) que a clínica faz hoje à mão. */
export const OPERATOR_OPERATIONS = [
  'submit_batch',
  'request_authorization',
  'authorization_status',
  'eligibility',
  'protocol_status',
  'statement',
  'submit_appeal',
] as const;
export type OperatorOperation = (typeof OPERATOR_OPERATIONS)[number];

/** Onde o resultado da operação manual é registrado no Qoro (tela e ação existentes). */
export interface ManualRecordTarget {
  /** Caminho da tela, com o identificador do objeto quando houver (ex.: `/convenios/lotes/<id>`). */
  path: string;
  /** Texto da ação na tela (o mesmo do botão ou do painel). */
  action: string;
}

/** Por que o caminho é manual (a tela explica; nunca é erro do usuário). */
export type ManualReason =
  /** Padrão: nenhuma operadora tem conector homologado no Qoro. */
  | 'not_homologated'
  /** A clínica guardou credencial, mas guardar não é homologar: nada é transmitido. */
  | 'credential_without_homologation'
  /** O conector homologado não respondeu (tempo, rede, circuito aberto): o manual segue valendo. */
  | 'connector_unavailable';

export type OperatorOutcome =
  | {
      kind: 'manual';
      operation: OperatorOperation;
      reason: ManualReason;
      /** Passos em linguagem simples, na ordem. */
      steps: readonly string[];
      recordIn: ManualRecordTarget;
    }
  | {
      kind: 'electronic';
      operation: OperatorOperation;
      /** Resultado do transporte homologado, como a operadora respondeu (sem interpretação). */
      outcome: Extract<ConnectorOutcome, { kind: 'accepted' } | { kind: 'rejected' }>;
    };

/** O objeto da operação: só identificadores do Qoro, nunca dado do paciente nem credencial. */
export interface OperatorRequest {
  operation: OperatorOperation;
  insurerId: string;
  /** Lote, guia, solicitação ou recurso a que a operação se refere (para apontar a tela certa). */
  subjectId?: string | undefined;
  /** XML `mensagemTISS` já validado no XSD, quando a operação envia arquivo (lote, recurso, solicitação). */
  xml?: Uint8Array | undefined;
  /** Igual nas repetições do MESMO pedido (deduplicação na operadora, quando ela suporta). */
  idempotencyKey: string;
}

export interface OperatorConnector {
  /** `manual` para o adaptador manual; o identificador do adaptador homologado, para o eletrônico. */
  readonly id: string;
  perform(request: OperatorRequest): Promise<OperatorOutcome>;
}
