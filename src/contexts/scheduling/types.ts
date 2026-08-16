/**
 * Scheduling context public DTOs + Server Action input schemas.
 *
 * Wire/DB types (`AppointmentRow`, …) come from schema.ts. These are what the
 * application + internal API speak. The BACKEND is the source of truth for
 * validation (frontend is UX only) — size/format caps reject junk in O(n)
 * before any DB work. All access is Drizzle-parameterized (no interpolation).
 */
import { z } from 'zod';

import type { CreatedVia } from './events';
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

/**
 * DATA-006 — expediente como UNIDADE. A UI promete criar manhã+tarde "de uma
 * vez", mas executava duas Server Actions independentes: a manhã persistia, a
 * tarde conflitava, o operador via erro e concluía que nada foi salvo — enquanto
 * uma disponibilidade parcial já alterava os slots da agenda.
 *
 * As janelas são validadas como conjunto (ordenadas, sem sobreposição entre si)
 * antes de qualquer escrita.
 */
export const SetAvailabilityWindowsSchema = z
  .object({
    doctorId: uuid,
    unitId: uuid.nullable().optional(),
    weekday: WeekdaySchema,
    windows: z
      .array(z.object({ startTime: TimeSchema, endTime: TimeSchema }))
      .min(1, 'informe ao menos uma janela')
      .max(6, 'expediente com mais de seis janelas no mesmo dia'),
  })
  .superRefine((value, ctx) => {
    const toMin = (t: string): number => {
      const [h, m] = t.split(':');
      return Number(h) * 60 + Number(m);
    };
    const sorted = [...value.windows].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    for (const [index, window] of sorted.entries()) {
      if (toMin(window.endTime) <= toMin(window.startTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'o fim de cada janela deve ser depois do início',
          path: ['windows', index],
        });
        return;
      }
      const previous = sorted[index - 1];
      if (previous && toMin(window.startTime) < toMin(previous.endTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'as janelas do mesmo dia não podem se sobrepor',
          path: ['windows', index],
        });
        return;
      }
    }
  });
export type SetAvailabilityWindowsInput = z.input<typeof SetAvailabilityWindowsSchema>;

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

const CreateAppointmentFieldsSchema = z.object({
  doctorId: uuid,
  patientId: uuid.nullable().optional(),
  procedureId: uuid,
  unitId: uuid.nullable().optional(),
  resourceIds: z.array(uuid).max(20).optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  valorAjustado: z.boolean().optional(),
  valor: ValorSchema.optional(),
  valorAjusteMotivo: MotivoSchema.optional(),
  urgencia: z.boolean().optional(),
  observacoes: ObservacoesSchema.optional(),
});

export const CreateAppointmentSchema = CreateAppointmentFieldsSchema.refine(
  (v) => !v.valorAjustado || (v.valor != null && v.valorAjusteMotivo != null),
  {
    message: 'valor_ajustado=true exige valor E motivo',
    path: ['valorAjusteMotivo'],
  },
);
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

export const CreateWalkInSchema = z.object({
  doctorId: uuid,
  patientId: uuid.nullable().optional(),
  procedureId: uuid,
  unitId: uuid.nullable().optional(),
  resourceIds: z.array(uuid).max(20).optional(),
  urgencia: z.boolean().optional(),
  observacoes: ObservacoesSchema.optional(),
});
export type CreateWalkInInput = z.infer<typeof CreateWalkInSchema>;

const HistoricalAppointmentItemSchema = CreateAppointmentFieldsSchema.omit({
  resourceIds: true,
})
  .extend({
    historicalStatus: z.enum(['atendido', 'cancelado', 'faltou']),
    externalReference: z.string().trim().min(1).max(160).optional(),
  })
  .refine((v) => !v.valorAjustado || (v.valor != null && v.valorAjusteMotivo != null), {
    message: 'valor_ajustado=true exige valor E motivo',
    path: ['valorAjusteMotivo'],
  });

export const HistoricalAppointmentImportSchema = z.object({
  source: z.string().trim().min(2).max(160),
  justification: z.string().trim().min(5).max(1000),
  items: z.array(HistoricalAppointmentItemSchema).min(1).max(500),
});
export type HistoricalAppointmentImportInput = z.infer<typeof HistoricalAppointmentImportSchema>;
export interface HistoricalAppointmentImportResult {
  batchId: string;
  importedAppointments: number;
  appointmentIds: string[];
}

export const CreateRecurringAppointmentsSchema = z.object({
  doctorId: uuid,
  patientId: uuid.nullable().optional(),
  procedureId: uuid,
  unitId: uuid.nullable().optional(),
  resourceIds: z.array(uuid).max(20).optional(),
  firstScheduledAt: z.string().datetime({ offset: true }),
  intervalWeeks: z.number().int().min(1).max(52),
  occurrences: z.number().int().min(2).max(104),
  urgencia: z.boolean().optional(),
  observacoes: ObservacoesSchema.optional(),
});
export type CreateRecurringAppointmentsInput = z.infer<typeof CreateRecurringAppointmentsSchema>;

export const CreateWaitlistEntrySchema = z
  .object({
    patientId: uuid,
    procedureId: uuid,
    doctorId: uuid.nullable().optional(),
    priority: z.enum(['urgent', 'normal']).optional(),
    preferredFrom: z.string().datetime({ offset: true }).optional(),
    preferredUntil: z.string().datetime({ offset: true }).optional(),
    notes: ObservacoesSchema.optional(),
  })
  .refine(
    (value) =>
      !value.preferredFrom ||
      !value.preferredUntil ||
      new Date(value.preferredUntil) >= new Date(value.preferredFrom),
    { path: ['preferredUntil'], message: 'fim da preferência deve ser posterior ao início' },
  );
export type CreateWaitlistEntryInput = z.infer<typeof CreateWaitlistEntrySchema>;

export interface WaitlistEntryDTO {
  id: string;
  patientId: string;
  doctorId: string | null;
  procedureId: string;
  priority: 'urgent' | 'normal';
  status: 'waiting' | 'offered' | 'booked' | 'cancelled';
  preferredFrom: string | null;
  preferredUntil: string | null;
  offeredAppointmentId: string | null;
  /** WAIT-001 — quando a oferta foi feita (alimenta a expiração e a tela). */
  offeredAt: string | null;
  /**
   * WAIT-001 — instante da VAGA ofertada. Sem ele o atendente veria "Oferta
   * enviada" sem saber qual horário está aceitando ou recusando.
   */
  offeredScheduledAt?: string | null;
  bookedAppointmentId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RecurrenceSeriesResult {
  seriesId: string;
  appointments: AppointmentSummary[];
}

export const RescheduleSchema = z.object({
  newScheduledAt: z.string().datetime({ offset: true }),
  reason: MotivoSchema.optional(),
});
export type RescheduleInput = z.infer<typeof RescheduleSchema>;

export const ReasonSchema = MotivoSchema.optional();

export const RecoverAppointmentSchema = z
  .object({
    appointmentId: z.string().uuid(),
    kind: z.enum(['interrupt', 'exceptional_cancel', 'reopen', 'transfer']),
    reason: MotivoSchema,
    newDoctorId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'transfer' && !value.newDoctorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newDoctorId'],
        message: 'novo profissional obrigatorio para transferencia',
      });
    }
    if (value.kind !== 'transfer' && value.newDoctorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newDoctorId'],
        message: 'novo profissional permitido apenas em transferencia',
      });
    }
  });
export type RecoverAppointmentInput = z.infer<typeof RecoverAppointmentSchema>;

export const CreateDoctorAbsenceSchema = z
  .object({
    doctorId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: MotivoSchema,
    strategy: z.enum(['cancel', 'transfer']),
    replacementDoctorId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'periodo invalido' });
    }
    if (value.strategy === 'transfer' && !value.replacementDoctorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replacementDoctorId'],
        message: 'profissional substituto obrigatorio',
      });
    }
    if (value.strategy === 'cancel' && value.replacementDoctorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replacementDoctorId'],
        message: 'substituto permitido apenas na transferencia',
      });
    }
  });
export type CreateDoctorAbsenceInput = z.infer<typeof CreateDoctorAbsenceSchema>;

export interface DoctorAbsenceResult {
  id: string;
  affected: number;
  cancelled: number;
  transferred: number;
}

export interface DoctorAbsenceDTO {
  id: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  strategy: 'cancel' | 'transfer';
  replacementDoctorId: string | null;
  affectedAppointments: number;
  createdAt: string;
}

export const CreateSchedulableResourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['room', 'equipment', 'other']),
  unitId: uuid.nullable().optional(),
});
export type CreateSchedulableResourceInput = z.infer<typeof CreateSchedulableResourceSchema>;

export interface SchedulableResourceDTO {
  id: string;
  name: string;
  type: 'room' | 'equipment' | 'other';
  unitId: string | null;
  active: boolean;
}

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
  /**
   * DATA-001 — nome do profissional ATUALMENTE atribuído, resolvido por
   * `doctorId`. Preenchido só pelas leituras que descrevem o estado corrente
   * (ex.: consultas do paciente para a IA). `snapshotDoctorNome` continua sendo
   * o histórico imutável da criação; os dois coexistem de propósito.
   */
  currentDoctorNome?: string;
  snapshotDoctorCrm: string | null;
  snapshotDoctorEspecialidade: string | null;
  createdVia: CreatedVia;
  urgencia: boolean;
  faturamentoPendente: boolean;
  observacoes: string | null;
  rescheduledFromAppointmentId: string | null;
  recurrenceSeriesId: string | null;
  recurrenceOccurrence: number | null;
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
