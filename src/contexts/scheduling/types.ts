/**
 * Scheduling context public DTOs + Server Action input schemas.
 *
 * Wire/DB types (`AppointmentRow`, …) come from schema.ts. These are what the
 * application + internal API speak. The BACKEND is the source of truth for
 * validation (frontend is UX only) — size/format caps reject junk in O(n)
 * before any DB work. All access is Drizzle-parameterized (no interpolation).
 */
import { z } from 'zod';

import { createdViaEnum } from './events';
import type { APPOINTMENT_STATES } from './state-machine';

// --- shared field schemas --------------------------------------------------

const uuid = z.string().uuid();
const CodigoSchema = z.string().trim().min(1).max(40);
const DescricaoSchema = z.string().trim().min(1).max(160);
const CategoriaSchema = z.string().trim().min(1).max(60);
const ValorSchema = z.number().nonnegative().max(10_000_000);
const DuracaoSchema = z.number().int().min(1).max(480);
const ObservacoesSchema = z.string().trim().max(2000);
const MotivoSchema = z.string().trim().min(1).max(500);
// HH:MM or HH:MM:SS, 24h.
const TimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'horário deve ser HH:MM');
const WeekdaySchema = z.number().int().min(0).max(6);
const DateSchema = z.string().date(); // YYYY-MM-DD

// --- procedures ------------------------------------------------------------

export const CreateProcedureSchema = z.object({
  codigo: CodigoSchema,
  descricao: DescricaoSchema,
  categoria: CategoriaSchema.optional(),
  valorPadrao: ValorSchema,
  duracaoPadraoMin: DuracaoSchema,
  ativo: z.boolean().optional(),
});
export type CreateProcedureInput = z.infer<typeof CreateProcedureSchema>;

export const UpdateProcedureSchema = z.object({
  codigo: CodigoSchema.optional(),
  descricao: DescricaoSchema.optional(),
  categoria: CategoriaSchema.nullable().optional(),
  valorPadrao: ValorSchema.optional(),
  duracaoPadraoMin: DuracaoSchema.optional(),
  ativo: z.boolean().optional(),
});
export type UpdateProcedureInput = z.infer<typeof UpdateProcedureSchema>;

// --- doctor availability ---------------------------------------------------

export const SetAvailabilitySchema = z.object({
  doctorId: uuid,
  unitId: uuid.nullable().optional(),
  weekday: WeekdaySchema,
  startTime: TimeSchema,
  endTime: TimeSchema,
});
export type SetAvailabilityInput = z.infer<typeof SetAvailabilitySchema>;

// --- clinic holidays -------------------------------------------------------

export const CreateHolidaySchema = z
  .object({
    date: DateSchema,
    reason: z.string().trim().max(200).optional(),
    unitId: uuid.nullable().optional(),
    startTime: TimeSchema.optional(),
    endTime: TimeSchema.optional(),
  })
  .refine((v) => (v.startTime == null) === (v.endTime == null), {
    message: 'feriado parcial exige start_time E end_time (ou nenhum, para dia inteiro)',
    path: ['endTime'],
  });
export type CreateHolidayInput = z.infer<typeof CreateHolidaySchema>;

// --- appointments ----------------------------------------------------------

export const CreateAppointmentSchema = z
  .object({
    doctorId: uuid,
    patientId: uuid.nullable().optional(),
    procedureId: uuid,
    unitId: uuid.nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }),
    valorAjustado: z.boolean().optional(),
    valor: ValorSchema.optional(),
    valorAjusteMotivo: MotivoSchema.optional(),
    urgencia: z.boolean().optional(),
    observacoes: ObservacoesSchema.optional(),
    createdVia: createdViaEnum.optional(),
    // permite import de histórico (datas no passado). Default false.
    isHistoricalImport: z.boolean().optional(),
  })
  .refine((v) => !v.valorAjustado || (v.valor != null && v.valorAjusteMotivo != null), {
    message: 'valor_ajustado=true exige valor E motivo',
    path: ['valorAjusteMotivo'],
  });
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

export const CreateWalkInSchema = z.object({
  doctorId: uuid,
  patientId: uuid.nullable().optional(),
  procedureId: uuid,
  unitId: uuid.nullable().optional(),
  urgencia: z.boolean().optional(),
  observacoes: ObservacoesSchema.optional(),
  createdVia: createdViaEnum.optional(),
});
export type CreateWalkInInput = z.infer<typeof CreateWalkInSchema>;

export const RescheduleSchema = z.object({
  newScheduledAt: z.string().datetime({ offset: true }),
  reason: MotivoSchema.optional(),
});
export type RescheduleInput = z.infer<typeof RescheduleSchema>;

export const ReasonSchema = MotivoSchema.optional();

// --- DTOs ------------------------------------------------------------------

export type AppointmentStatusDTO = (typeof APPOINTMENT_STATES)[number];

/** Non-sensitive appointment projection (lists, audit, events, API). */
export interface AppointmentSummary {
  id: string;
  clinicId: string;
  unitId: string | null;
  doctorId: string;
  patientId: string | null;
  procedureId: string;
  scheduledAt: string;
  durationMin: number;
  status: AppointmentStatusDTO;
  valor: number;
  valorAjustado: boolean;
  valorAjusteMotivo: string | null;
  snapshotProcedureName: string;
  snapshotProcedureCodigo: string | null;
  snapshotProcedureCategoria: string | null;
  snapshotProcedureValor: number;
  snapshotProcedureDuracaoMin: number;
  snapshotDoctorNome: string;
  snapshotDoctorCrm: string | null;
  snapshotDoctorEspecialidade: string | null;
  createdVia: z.infer<typeof createdViaEnum>;
  urgencia: boolean;
  faturamentoPendente: boolean;
  observacoes: string | null;
  rescheduledFromAppointmentId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Procedure projection. */
export interface ProcedureSummary {
  id: string;
  clinicId: string;
  codigo: string;
  descricao: string;
  categoria: string | null;
  valorPadrao: number;
  duracaoPadraoMin: number;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Computed availability slot. `startAt`/`endAt` are UTC instants (ISO) so the
 * AI / callers receive timezone-correct timestamps regardless of clinic tz.
 */
export interface Slot {
  doctorId: string;
  unitId: string | null;
  startAt: string;
  endAt: string;
  durationMin: number;
}
