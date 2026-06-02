/**
 * Clinical context — DTOs públicos + schemas Zod de input das Server Actions.
 *
 * O BACKEND é a fonte de verdade da validação (frontend é UX). Caps de
 * tamanho/formato rejeitam lixo em O(n) antes de qualquer trabalho de DB.
 *
 * Este módulo NÃO importa schema.ts (Drizzle) para não criar ciclo de import
 * (schema.ts importa os tipos `ProntuarioContent`/`Medicamento`/`MedicalDocumentContent`
 * daqui via `import type`). madge --circular ficaria vermelho num ciclo.
 */
import { z } from 'zod';

const uuid = z.string().uuid();
const FreeText = z.string().trim().max(20_000);

// --- conteúdo do prontuário (jsonb) — Regra 2 (estruturado, nunca text) ----

export const ProntuarioContentSchema = z
  .object({
    queixa_principal: FreeText.optional(),
    historia_doenca_atual: FreeText.optional(),
    exame_fisico: FreeText.optional(),
    hipotese_diagnostica: FreeText.optional(),
    conduta: FreeText.optional(),
    observacoes: FreeText.optional(),
    // template SOAP
    subjective: FreeText.optional(),
    objective: FreeText.optional(),
    assessment: FreeText.optional(),
    plan: FreeText.optional(),
  })
  .strict(); // rejeita chaves desconhecidas (anti-lixo no jsonb)
export type ProntuarioContent = z.infer<typeof ProntuarioContentSchema>;

// --- medicamento (item de prescrição) --------------------------------------

export const MedicamentoSchema = z.object({
  nome: z.string().trim().min(1).max(300),
  dosagem: z.string().trim().max(120).optional(),
  posologia: z.string().trim().max(500).optional(),
  quantidade: z.string().trim().max(120).optional(),
  via: z.string().trim().max(60).optional(),
});
export type Medicamento = z.infer<typeof MedicamentoSchema>;

// --- conteúdo por tipo de documento médico ---------------------------------

export const AtestadoContentSchema = z.object({
  descricao: z.string().trim().min(1).max(2000),
  cid: z.string().trim().max(20).optional(),
  dias: z.number().int().min(0).max(3650).optional(),
});
export const ExameContentSchema = z.object({
  exames: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  indicacaoClinica: z.string().trim().max(2000).optional(),
});
export const DeclaracaoContentSchema = z.object({
  texto: z.string().trim().min(1).max(4000),
  periodo: z.string().trim().max(200).optional(),
});
export const EncaminhamentoContentSchema = z.object({
  especialidade: z.string().trim().min(1).max(120),
  motivo: z.string().trim().min(1).max(2000),
});

export type AtestadoContent = z.infer<typeof AtestadoContentSchema>;
export type ExameContent = z.infer<typeof ExameContentSchema>;
export type DeclaracaoContent = z.infer<typeof DeclaracaoContentSchema>;
export type EncaminhamentoContent = z.infer<typeof EncaminhamentoContentSchema>;
export type MedicalDocumentContent =
  | AtestadoContent
  | ExameContent
  | DeclaracaoContent
  | EncaminhamentoContent;
export type MedicalDocumentType = 'atestado' | 'exame' | 'declaracao' | 'encaminhamento';

// --- inputs das Server Actions ---------------------------------------------

export const CreateProntuarioSchema = z.object({
  patientId: uuid,
  appointmentId: uuid.nullable().optional(),
  content: ProntuarioContentSchema.optional(),
});
export type CreateProntuarioInput = z.infer<typeof CreateProntuarioSchema>;

export const UpdateProntuarioSchema = z.object({
  content: ProntuarioContentSchema,
  expectedRowVersion: z.number().int().nonnegative(),
});
export type UpdateProntuarioInput = z.infer<typeof UpdateProntuarioSchema>;

export const SignProntuarioSchema = z
  .object({
    needsReturn: z.boolean(),
    returnDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((v) => !v.needsReturn || (v.returnDays ?? 0) > 0, {
    message: 'returnDays é obrigatório (>0) quando needsReturn é true',
    path: ['returnDays'],
  });
export type SignProntuarioInput = z.infer<typeof SignProntuarioSchema>;

export const EditSignedProntuarioSchema = z.object({
  content: ProntuarioContentSchema,
  reason: z.string().trim().min(3).max(500),
});
export type EditSignedProntuarioInput = z.infer<typeof EditSignedProntuarioSchema>;

export const CreatePrescriptionSchema = z.object({
  prontuarioId: uuid.nullable().optional(),
  patientId: uuid,
  medicamentos: z.array(MedicamentoSchema).min(1).max(50),
  observacoes: z.string().trim().max(2000).optional(),
});
export type CreatePrescriptionInput = z.infer<typeof CreatePrescriptionSchema>;

export const CreateMedicalDocumentSchema = z.discriminatedUnion('type', [
  z.object({ patientId: uuid, type: z.literal('atestado'), content: AtestadoContentSchema }),
  z.object({ patientId: uuid, type: z.literal('exame'), content: ExameContentSchema }),
  z.object({ patientId: uuid, type: z.literal('declaracao'), content: DeclaracaoContentSchema }),
  z.object({
    patientId: uuid,
    type: z.literal('encaminhamento'),
    content: EncaminhamentoContentSchema,
  }),
]);
export type CreateMedicalDocumentInput = z.infer<typeof CreateMedicalDocumentSchema>;

// --- DTOs de saída (projeções) ---------------------------------------------

// --- templates SOAP (em código, NÃO no DB — R5) ----------------------------

export interface ClinicalTemplateField {
  /** Campo do conteúdo do prontuário que esta seção edita. */
  key: keyof ProntuarioContent;
  label: string;
  placeholder?: string;
}

export interface ClinicalTemplate {
  id: string; // kebab-case, ex.: 'clinico-geral'
  nome: string; // exibido no dropdown
  especialidade: string;
  fields: ClinicalTemplateField[]; // seções ordenadas a renderizar no editor
}

export type ProntuarioStatus = 'rascunho' | 'assinado';

export interface ProntuarioSummary {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  status: ProntuarioStatus;
  version: number;
  rowVersion: number;
  needsReturn: boolean;
  returnDays: number | null;
  signedAt: string | null;
  signedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProntuarioDetail extends ProntuarioSummary {
  content: ProntuarioContent;
  signedDoctorNome: string | null;
  signedDoctorCrm: string | null;
  signedDoctorCrmUf: string | null;
  signedDoctorEspecialidade: string | null;
}

export interface PrescriptionSummary {
  id: string;
  clinicId: string;
  prontuarioId: string | null;
  patientId: string;
  doctorId: string;
  medicamentos: Medicamento[];
  observacoes: string | null;
  pdfStoragePath: string | null;
  snapshotPatientNome: string;
  snapshotDoctorNome: string;
  snapshotDoctorCrm: string;
  snapshotDoctorCrmUf: string | null;
  snapshotDoctorEspecialidade: string | null;
  createdAt: string;
}

export interface MedicalDocumentSummary {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  type: MedicalDocumentType;
  content: MedicalDocumentContent;
  pdfStoragePath: string | null;
  snapshotPatientNome: string;
  snapshotDoctorNome: string;
  snapshotDoctorCrm: string;
  snapshotDoctorCrmUf: string | null;
  snapshotDoctorEspecialidade: string | null;
  createdAt: string;
}
