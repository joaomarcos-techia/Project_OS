import { z } from 'zod';

/**
 * Perfil editável da clínica (Configurações › Perfil). SÓ os campos de
 * identidade/branding do documento — NUNCA status/plan/slug/timezone (esses são
 * lifecycle/billing, mutáveis apenas por super_admin). Ver ADR-028 (white-label
 * só no PDF) e o achado S5 (clinics UPDATE = super_admin via RLS → escrita
 * tenant-facing roteia por dbAdmin+audit no core, com colunas fixas).
 *
 * `primaryColor` NÃO é editável pelo tenant (decisão de produto: sem escolha de
 * cor na UI). A coluna `clinics.primary_color` continua existindo (seed/admin) e
 * o PDF a consome com default neutro — só não há mais o seletor no Perfil.
 */
const opt = (max: number) => z.string().trim().max(max).optional();

export const ClinicProfileSchema = z.object({
  nome: z.string().trim().min(1).max(160),
  endereco: opt(240),
  telefone: opt(40),
  cnpj: opt(20),
  cnes: opt(20),
  // logo: white-label do PDF (ADR-028). Vazio → limpa (null).
  logoUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
});
export type ClinicProfileInput = z.infer<typeof ClinicProfileSchema>;

export interface ClinicProfile {
  nome: string;
  endereco: string | null;
  telefone: string | null;
  cnpj: string | null;
  cnes: string | null;
  logoUrl: string | null;
}
