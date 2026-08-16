/**
 * Patient context public DTOs. Input shapes for Server Actions and the
 * decrypted detail shape returned at the single decryption point.
 *
 * The wire/DB types (`PatientRow`, …) come from schema.ts. These DTOs are what
 * the application + UI speak; encrypted/hash columns never appear here as
 * plaintext except inside DecryptedPatient (the controlled decrypt boundary).
 */
import { z } from 'zod';

export const SexoSchema = z.enum(['M', 'F', 'O', 'N']);
export const AddressTipoSchema = z.enum(['residencial', 'comercial', 'alternativo']);
export const ChannelSchema = z.enum(['whatsapp', 'email', 'sms']);
export const ConsentTypeSchema = z.enum([
  'dados_saude',
  'compartilhamento',
  'cobranca_whatsapp',
  'marketing',
  'pesquisa',
]);

export const RecordPatientDeathSchema = z.object({
  deceasedAt: z.string().date(),
  reason: z.string().trim().min(3).max(500),
});
export const LgpdRequestIdSchema = z.string().uuid();
export const LgpdOperationalReasonSchema = z.string().trim().min(3).max(500);
export const LgpdNotificationChannelSchema = z.enum(['email', 'whatsapp', 'phone', 'in_person']);
export type LgpdNotificationChannel = z.infer<typeof LgpdNotificationChannelSchema>;

export type Channel = z.infer<typeof ChannelSchema>;
export type ConsentType = z.infer<typeof ConsentTypeSchema>;
export type RecordPatientDeathInput = z.infer<typeof RecordPatientDeathSchema>;

export const PatientRelationshipTypeSchema = z.enum([
  'mae',
  'pai',
  'tutor_legal',
  'responsavel',
  'outro',
]);
export const PatientGuardianInputSchema = z.object({
  responsiblePatientId: z.string().uuid(),
  relationshipType: PatientRelationshipTypeSchema,
  legalGuardian: z.boolean(),
  financialResponsible: z.boolean(),
  canManageAppointments: z.boolean(),
});
export const LinkPatientRelationshipSchema = PatientGuardianInputSchema.extend({
  dependentPatientId: z.string().uuid(),
});
export const MergePatientsSchema = z
  .object({
    sourcePatientId: z.string().uuid(),
    targetPatientId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.sourcePatientId !== value.targetPatientId, {
    message: 'Os cadastros de origem e destino devem ser diferentes.',
  });
export type PatientRelationshipType = z.infer<typeof PatientRelationshipTypeSchema>;
export type PatientGuardianInput = z.infer<typeof PatientGuardianInputSchema>;
export type LinkPatientRelationshipInput = z.infer<typeof LinkPatientRelationshipSchema>;
export type MergePatientsInput = z.infer<typeof MergePatientsSchema>;

// Validação de entrada — o BACKEND é a fonte da verdade (o frontend é só UX).
// Limites de tamanho + classes de caractere rejeitam input gigante/inválido em
// O(n) ANTES de qualquer crypto/normalização/DB (defesa contra DoS por payload
// monstro). Injeção SQL é impossível independentemente: todo acesso é via
// Drizzle parametrizado (.values()/eq()/set_config($1)) — nunca interpolação.
const NomeSchema = z.string().trim().min(1).max(120);
// CPF: só dígitos e máscara (.-/espaço); 11 dígitos → no máx 14 chars com máscara.
const CpfSchema = z
  .string()
  .trim()
  .min(11)
  .max(14)
  .regex(/^[\d.\-\s]+$/, 'CPF deve conter apenas números');
// Telefone: dígitos + ( ) - + espaço; teto generoso (DDI/DDD/ramal).
const TelefoneSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .regex(/^[\d()\-\s+]+$/, 'Telefone deve conter apenas números');
const EmailSchema = z.string().trim().toLowerCase().email().max(120);

/**
 * Endereço do paciente (C7 — exigido pelo Receituário de Controle Especial,
 * Portaria 344/98). `logradouro` e `cep` são cifrados per-tenant no core; `cidade`,
 * `estado` (UF) e `complemento` são plaintext. Opcional em ambos os fluxos.
 */
export const PatientAddressInputSchema = z.object({
  logradouro: z.string().trim().min(1).max(300),
  complemento: z.string().trim().max(120).optional(),
  cidade: z.string().trim().min(1).max(120),
  estado: z.string().trim().length(2).toUpperCase(), // UF
  cep: z.string().trim().min(1).max(20),
});
export type PatientAddressInput = z.infer<typeof PatientAddressInputSchema>;

export const CreatePatientSchema = z.object({
  nome: NomeSchema,
  cpf: CpfSchema,
  telefone: TelefoneSchema.optional(),
  // C12 (ADR-023): opcional — paciente criado pelo AI Agent não tem e-mail.
  // Validação IDÊNTICA nos dois caminhos (Server Action + agente): quem manda
  // e-mail valida o formato; quem não manda grava NULL (índice único é parcial).
  email: EmailSchema.optional(),
  dataNascimento: z.string().date().optional(),
  sexo: SexoSchema.optional(),
  endereco: PatientAddressInputSchema.optional(),
  guardian: PatientGuardianInputSchema.optional(),
});
export type CreatePatientInput = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = z.object({
  /**
   * DATA-002 — `updatedAt` lido pelo formulário, devolvido no submit e
   * conferido no `WHERE`. Reusa a coluna que já existe: nenhuma migration.
   * Opcional para não quebrar callers programáticos (agente, importação), que
   * não têm "estado na tela" a proteger.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
  nome: NomeSchema.optional(),
  cpf: CpfSchema.optional(),
  telefone: TelefoneSchema.nullable().optional(),
  email: EmailSchema.optional(),
  dataNascimento: z.string().date().nullable().optional(),
  sexo: SexoSchema.nullable().optional(),
  endereco: PatientAddressInputSchema.optional(),
});
export type UpdatePatientInput = z.infer<typeof UpdatePatientSchema>;

export const ConsentInputSchema = z.object({
  dadosSaude: z.boolean(),
  compartilhamento: z.boolean(),
  cobrancaWhatsapp: z.boolean(),
  marketing: z.boolean(),
  pesquisa: z.boolean(),
});
export type ConsentInput = z.infer<typeof ConsentInputSchema>;

/** Non-sensitive patient projection (lists, audit before/after, events). */
export interface PatientSummary {
  id: string;
  clinicId: string;
  nome: string;
  /** C12: opcional — paciente criado pelo AI Agent não tem e-mail. */
  email: string | null;
  dataNascimento: string | null;
  sexo: 'M' | 'F' | 'O' | 'N' | null;
  obitoEm: string | null;
  mergedIntoPatientId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Fully decrypted patient — produced ONLY by getPatientWithDecryptedFields. */
export interface DecryptedPatient extends PatientSummary {
  cpf: string;
  telefone: string | null;
}

/**
 * Contato p/ mensagens PROATIVAS (C14). Único shape que sai do Patient com o
 * telefone em claro fora do detalhe — produzido só por getProactiveContact, que
 * já agrega consent (cobrança) + suppression p/ a política do C14 decidir.
 */
export interface ProactiveContact {
  nome: string;
  /** Telefone decifrado (dígitos) ou null se o paciente não tem telefone. */
  phone: string | null;
  /** Paciente falecido nunca recebe comunicacao proativa. */
  deceased: boolean;
  /** Opt-in vigente p/ cobrança via WhatsApp (LGPD — dunning exige). */
  cobrancaWhatsapp: boolean;
  /** Consentimento mais recente revogado. */
  consentRevoked: boolean;
  /** Telefone na suppression_list (canal whatsapp). */
  suppressedWhatsapp: boolean;
  /** Supressões específicas; `all` bloqueia qualquer finalidade. */
  suppressedWhatsappPurposes: Array<'all' | 'billing' | 'reminder' | 'followup' | 'marketing'>;
}

export interface PatientRelationshipDTO {
  id: string;
  responsiblePatientId: string;
  responsibleName: string;
  dependentPatientId: string;
  dependentName: string;
  relationshipType: PatientRelationshipType;
  legalGuardian: boolean;
  financialResponsible: boolean;
  canManageAppointments: boolean;
}
