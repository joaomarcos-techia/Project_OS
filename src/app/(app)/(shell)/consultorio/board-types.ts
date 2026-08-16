/**
 * DTOs compartilhados do Consultório (C8) entre as Server Actions e os client
 * components. Vivem fora de `actions.ts` porque um arquivo `'use server'` só pode
 * exportar funções async — tipos e consts ficam aqui.
 */
import type { ProntuarioDetail } from '@/contexts/clinical/types';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';

/** Result tipado das actions C8 (board atualiza in-place, sem redirect). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export interface BoardCardDTO {
  appointmentId: string;
  patientId: string | null;
  pacienteNome: string;
  alergias: string[];
  /** idade em anos (derivada de data_nascimento); null se desconhecida. */
  idade: number | null;
  /** sexo do paciente (M|F|O|N) para a linha demográfica do card; null se ausente. */
  sexo: 'M' | 'F' | 'O' | 'N' | null;
  /** scheduled_at (ISO). */
  horario: string;
  /** procedimento (+ observação) — "Motivo" do card. */
  motivo: string;
  status: AppointmentStatusDTO;
  urgencia: boolean;
  /** instante do check-in (ISO) — base do "tempo aguardando". */
  checkInAt: string | null;
  /** Ordem e previsão registradas pela fila operacional do consultório. */
  queuePosition?: number;
  estimatedWaitMinutes?: number;
  /** true se a consulta finalizou SEM cobrança registrada (pendência aberta no
   *  Financial) — o board destaca o vazamento. Best-effort: ausente = não sabemos. */
  cobrancaPendente?: boolean;
}

export interface BoardDoctorDTO {
  id: string;
  nome: string;
}

export interface BoardDTO {
  /** médico cuja fila está em foco (null = visão de todos, p/ gestor sem seleção). */
  activeDoctorId: string | null;
  /** seletor de médico (vazio quando o usuário é médico — vê só a própria fila). */
  doctors: BoardDoctorDTO[];
  /** a chegar hoje (agendado|confirmado) — pré-passo de check-in. */
  aChegar: BoardCardDTO[];
  salaEspera: BoardCardDTO[]; // chegou
  emAtendimento: BoardCardDTO[]; // em_atendimento
  finalizadas: BoardCardDTO[]; // atendido (hoje)
  /** true se a janela do dia estourou o teto de leitura (mostra aviso). */
  truncated: boolean;
}

export interface AtendimentoDTO {
  appointmentId: string;
  patientId: string | null;
  pacienteNome: string;
  alergias: string[];
  /** idade em anos (derivada de data_nascimento); null se desconhecida. */
  idade: number | null;
  /** sexo do paciente (M|F|O|N); null se ausente. */
  sexo: 'M' | 'F' | 'O' | 'N' | null;
  motivo: string;
  status: AppointmentStatusDTO;
  /** prontuário vinculado (rascunho p/ editar ou assinado p/ leitura). */
  prontuario: ProntuarioDetail | null;
  /**
   * AUTHZ-008 — os dois derivam da MESMA regra que o backend aplica
   * (`canCompleteClinically` / `create:prontuario`). A tela lê daqui em vez de
   * decidir sozinha: antes ela renderizava "Encerrar consulta" para qualquer
   * usuário da página, e um atendente fechou a consulta por ali.
   *
   * Isto é UX. O gate real está na action e no core — nenhum dos dois consulta
   * estes campos.
   */
  canComplete: boolean;
  canEditProntuario: boolean;
}
