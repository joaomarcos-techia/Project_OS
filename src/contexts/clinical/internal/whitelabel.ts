/**
 * White-label leve (C7) — branding da clínica para o cabeçalho dos PDFs.
 *
 * R11: branding é lido SEMPRE atual (no momento do render/regeneração), não
 * snapshot. Campos nullable caem num default neutro no render (nunca quebra).
 */
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- clinics é declarado no schema de tenancy (mesma exceção de tenantIdRef); leitura tenant-scoped via tx (RLS aplica). */
import { clinics } from '@/contexts/tenancy';
/* eslint-enable boundaries/element-types */

export interface ClinicBranding {
  nome: string;
  logoUrl: string | null;
  primaryColor: string | null;
  endereco: string | null;
  telefone: string | null;
  cnpj: string | null;
  cnes: string | null;
}

export async function loadClinicBranding(tx: Tx, clinicId: string): Promise<ClinicBranding> {
  const [row] = await tx
    .select({
      nome: clinics.nome,
      logoUrl: clinics.logoUrl,
      primaryColor: clinics.primaryColor,
      endereco: clinics.endereco,
      telefone: clinics.telefone,
      cnpj: clinics.cnpj,
      cnes: clinics.cnes,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return {
    nome: row?.nome ?? 'Clínica',
    logoUrl: row?.logoUrl ?? null,
    primaryColor: row?.primaryColor ?? null,
    endereco: row?.endereco ?? null,
    telefone: row?.telefone ?? null,
    cnpj: row?.cnpj ?? null,
    cnes: row?.cnes ?? null,
  };
}

export interface ClinicEmitente {
  nome: string;
  endereco: string | null;
  telefone: string | null;
}

/**
 * Identificação LEGAL do emitente para SNAPSHOT no ato da emissão (R8/G1 —
 * receituário de controle especial). Diferente de loadClinicBranding (R11, sempre
 * atual no render): estes campos são congelados na linha porque integram a validade
 * documental. Lê tenant-scoped via tx (RLS aplica).
 */
export async function loadClinicEmitente(tx: Tx, clinicId: string): Promise<ClinicEmitente> {
  const [row] = await tx
    .select({ nome: clinics.nome, endereco: clinics.endereco, telefone: clinics.telefone })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return {
    nome: row?.nome ?? 'Clínica',
    endereco: row?.endereco ?? null,
    telefone: row?.telefone ?? null,
  };
}
