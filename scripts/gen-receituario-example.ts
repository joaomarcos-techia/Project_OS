/**
 * Gera um PDF-exemplo do Receituário de Controle Especial para REVISÃO VISUAL
 * humana do layout regulado (2 vias na mesma A4). NÃO roda no CI — é uma
 * ferramenta de inspeção manual.
 *
 *   pnpm gen:receituario
 *
 * Saída: docs/examples/receituario-controle-especial.pdf
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { renderReceituarioControleEspecialPDF } from '../src/lib/pdf/receituario-controle-especial';
import type { PdfBranding, PdfDoctor } from '../src/lib/pdf/types';

const branding: PdfBranding = {
  nome: 'Clínica Exemplo',
  logoUrl: null,
  primaryColor: '#0F766E',
  endereco: 'Av. Paulista, 1000 — Sala 50',
  telefone: '(11) 4000-0000',
  cnpj: '00.000.000/0001-00',
  cnes: '1234567',
};
const doctor: PdfDoctor = {
  nome: 'Dra. Ana Souza',
  crm: '123456',
  crmUf: 'SP',
  especialidade: 'Psiquiatria',
};

async function main(): Promise<void> {
  const buf = await renderReceituarioControleEspecialPDF(
    {
      patientNome: 'João da Silva',
      patientEndereco: 'Rua das Flores, 50, Apto 12 — São Paulo/SP — CEP 01000-000',
      emitenteNome: branding.nome,
      emitenteEndereco: branding.endereco,
      emitenteTelefone: branding.telefone,
      medicamentos: [
        {
          nome: 'Sertralina',
          dosagem: '50mg',
          posologia: '1 comprimido pela manhã',
          quantidade: '30',
        },
        { nome: 'Clonazepam', dosagem: '2mg', posologia: '1 comprimido à noite', quantidade: '60' },
      ],
      observacoes: 'Uso contínuo. Retornar em 30 dias.',
      issuedAt: new Date().toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    branding,
    doctor,
  );

  const outDir = path.resolve(process.cwd(), 'docs/examples');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'receituario-controle-especial.pdf');
  writeFileSync(outPath, buf);
  console.log(`[gen-receituario-example] ${outPath} (${buf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
