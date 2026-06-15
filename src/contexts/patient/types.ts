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

export type Channel = z.infer<typeof ChannelSchema>;
export type ConsentType = z.infer<typeof ConsentTypeSchema>;

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
});
export type CreatePatientInput = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = z.object({
  nome: NomeSchema.optional(),
  cpf: CpfSchema.optional(),
  telefone: TelefoneSchema.nullable().optional(),
  email: EmailSchema.optional(),
  dataNascimento: z.string().date().nullable().optional(),
  sexo: SexoSchema.nullable().optional(),
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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Fully decrypted patient — produced ONLY by getPatientWithDecryptedFields. */
export interface DecryptedPatient extends PatientSummary {
  cpf: string;
  telefone: string | null;
}
