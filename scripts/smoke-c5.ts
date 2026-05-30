/**
 * Smoke C5 — validação pós-migration 0011 (Patient + encryption + LGPD).
 *
 * Cobre os testes 5.6.x que NÃO dependem de sessão HTTP (Server Actions usam
 * requireUser/headers — validados no app, ver runbook c5-validation):
 *   5.6.1  encryption at-rest (ciphertext base64, sem plaintext)
 *   5.6.2  busca por CPF via hash
 *   5.6.3  decrypt cross-tenant falha (auth tag)
 *   5.6.4  soft delete esconde de patientsActive
 *   5.6.5  hard delete cascade (filhos somem; suppression sobrevive)
 *   5.6.6  export bundle decifrado + sem vazamento cross-tenant
 *   5.6.9  UNIQUE (clinic_id, cpf_hash) por clínica
 *
 * Injeta um SecretProvider de teste (chave/salt fixos) — não exige secrets reais.
 * Roda via tsx contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 */
import './_env';

import { randomBytes, randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import {
  encryptForTenant,
  decryptForTenant,
  hashForLookup,
  normalizeCpf,
  normalizePhone,
} from '@/lib/crypto';
import { __testing__ as cryptoTesting, type SecretProvider } from '@/lib/crypto/secret-provider';
import {
  patients,
  patientConsents,
  patientClinicalData,
  patientAddresses,
  patientEmergencyContacts,
  suppressionList,
} from '@/contexts/patient/schema';
import {
  findPatientByCpf,
  getPatientSummaryById,
  getPatientWithDecryptedFields,
  collectExportBundle,
} from '@/contexts/patient/queries';
import { hardDeletePatients } from '@/contexts/patient/internal/hard-delete';

// --- test secrets (fixed; never real) -------------------------------------
const MASTER_V1 = randomBytes(32);
const SALT = randomBytes(16);
const testProvider: SecretProvider = {
  async getMasterKey() {
    return MASTER_V1;
  },
  async getLookupSalt() {
    return SALT;
  },
};
cryptoTesting.setProvider(testProvider);

// --- harness ---------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const slugA = `c5a${Date.now().toString(36)}`.slice(0, 30);
const slugB = `c5b${Date.now().toString(36)}`.slice(0, 30);

const CPF_PLAINTEXT = '52998224725'; // valid checksum
const PHONE_PLAINTEXT = '11999998888';

interface InsertPatientArgs {
  clinicId: string;
  nome: string;
  cpf: string;
  phone?: string;
  email: string;
  withChildren?: boolean;
}

async function insertPatient(args: InsertPatientArgs): Promise<string> {
  const cpfNorm = normalizeCpf(args.cpf);
  const cpfHash = await hashForLookup(cpfNorm);
  const cpfEncrypted = await encryptForTenant(args.clinicId, cpfNorm);
  let telefoneHash: string | null = null;
  let telefoneEncrypted: string | null = null;
  if (args.phone) {
    const p = normalizePhone(args.phone);
    telefoneHash = await hashForLookup(p);
    telefoneEncrypted = await encryptForTenant(args.clinicId, p);
  }
  return withTenant(args.clinicId, async (tx) => {
    const [row] = await tx
      .insert(patients)
      .values({
        clinicId: args.clinicId,
        nome: args.nome,
        cpfEncrypted,
        cpfHash,
        telefoneEncrypted,
        telefoneHash,
        email: args.email.toLowerCase(),
      })
      .returning({ id: patients.id });
    const id = row!.id;
    if (args.withChildren) {
      await tx.insert(patientConsents).values({
        patientId: id,
        clinicId: args.clinicId,
        dadosSaude: true,
        versao: 1,
      });
      await tx.insert(patientClinicalData).values({
        patientId: id,
        clinicId: args.clinicId,
        tipoSanguineo: 'O+',
      });
      await tx.insert(patientAddresses).values({
        patientId: id,
        clinicId: args.clinicId,
        logradouroEncrypted: await encryptForTenant(args.clinicId, 'Rua Teste, 100'),
        cidade: 'São Paulo',
        estado: 'SP',
        cepEncrypted: await encryptForTenant(args.clinicId, '01000000'),
        principal: true,
      });
      await tx.insert(patientEmergencyContacts).values({
        patientId: id,
        clinicId: args.clinicId,
        nome: 'Contato',
        telefoneEncrypted: await encryptForTenant(args.clinicId, '11888887777'),
        relacao: 'mãe',
      });
    }
    return id;
  });
}

async function main(): Promise<void> {
  // Fixtures: two clinics.
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status) VALUES
      (${CLINIC_A}::uuid, ${slugA}, 'Smoke C5 A', 'active'),
      (${CLINIC_B}::uuid, ${slugB}, 'Smoke C5 B', 'active')
  `);

  let patientA = '';

  await tryStep('5.6.1 — encryption at-rest (ciphertext base64, sem plaintext)', async () => {
    patientA = await insertPatient({
      clinicId: CLINIC_A,
      nome: 'João Silva',
      cpf: CPF_PLAINTEXT,
      phone: PHONE_PLAINTEXT,
      email: 'joao@example.com',
      withChildren: true,
    });
    const rows = (await dbAdmin.execute(
      sql`SELECT cpf_encrypted, cpf_hash, telefone_encrypted FROM patients WHERE id = ${patientA}::uuid`,
    )) as unknown as Array<{ cpf_encrypted: string; cpf_hash: string; telefone_encrypted: string }>;
    const r = rows[0]!;
    assert(!r.cpf_encrypted.includes(CPF_PLAINTEXT), 'CPF plaintext vazou em cpf_encrypted');
    assert(!r.telefone_encrypted.includes(PHONE_PLAINTEXT), 'telefone plaintext vazou');
    assert(/^[A-Za-z0-9+/]+=*$/.test(r.cpf_encrypted), 'cpf_encrypted não é base64');
    assert(/^[a-f0-9]{64}$/.test(r.cpf_hash), 'cpf_hash não é HMAC hex');
    // version byte == 1
    assert(Buffer.from(r.cpf_encrypted, 'base64')[0] === 1, 'version byte != 1');
  });

  await tryStep('5.6.2 — busca por CPF via hash encontra o paciente', async () => {
    const found = await findPatientByCpf(CLINIC_A, '529.982.247-25');
    assert(found !== null && found.id === patientA, 'lookup por CPF não encontrou');
  });

  await tryStep('5.6.3 — decrypt cross-tenant falha (auth tag)', async () => {
    const dec = await getPatientWithDecryptedFields(CLINIC_A, patientA);
    assert(dec?.cpf === CPF_PLAINTEXT, 'decrypt na própria clínica falhou');
    const rows = (await dbAdmin.execute(
      sql`SELECT cpf_encrypted FROM patients WHERE id = ${patientA}::uuid`,
    )) as unknown as Array<{ cpf_encrypted: string }>;
    let threw = false;
    try {
      await decryptForTenant(CLINIC_B, rows[0]!.cpf_encrypted);
    } catch {
      threw = true;
    }
    assert(threw, 'decrypt cross-tenant NÃO falhou (HKDF/GCM quebrado)');
  });

  await tryStep('5.6.6 — export bundle decifrado + sem vazamento cross-tenant', async () => {
    const bundle = await withTenant(CLINIC_A, (tx) => collectExportBundle(tx, CLINIC_A, patientA));
    assert(bundle?.patient.cpf === CPF_PLAINTEXT, 'export não decifrou CPF');
    assert(bundle!.addresses.length === 1, 'export não trouxe endereço');
    // Clínica B não enxerga o paciente de A (RLS).
    const leak = await withTenant(CLINIC_B, (tx) => collectExportBundle(tx, CLINIC_B, patientA));
    assert(leak === null, 'VAZAMENTO: clínica B exportou paciente de A');
  });

  await tryStep('5.6.9 — UNIQUE (clinic_id, cpf_hash) por clínica', async () => {
    let dup = false;
    try {
      await insertPatient({
        clinicId: CLINIC_A,
        nome: 'Duplicado',
        cpf: CPF_PLAINTEXT,
        email: 'dup@example.com',
      });
    } catch {
      dup = true;
    }
    assert(dup, 'CPF duplicado na mesma clínica NÃO falhou');
    // Mesmo CPF em outra clínica: OK (folha de caderno).
    const inB = await insertPatient({
      clinicId: CLINIC_B,
      nome: 'João em B',
      cpf: CPF_PLAINTEXT,
      email: 'joaob@example.com',
    });
    assert(!!inB, 'mesmo CPF em outra clínica deveria ser permitido');
  });

  await tryStep('5.6.4 — soft delete esconde de patientsActive', async () => {
    await withTenant(CLINIC_A, async (tx) => {
      await tx.update(patients).set({ deletedAt: sql`now()` }).where(eq(patients.id, patientA));
    });
    const viaActive = await getPatientSummaryById(CLINIC_A, patientA);
    assert(viaActive === null, 'soft-deleted ainda aparece em getPatientSummaryById');
    const raw = (await dbAdmin.execute(
      sql`SELECT deleted_at FROM patients WHERE id = ${patientA}::uuid`,
    )) as unknown as Array<{ deleted_at: string | null }>;
    assert(raw[0]!.deleted_at !== null, 'deleted_at não foi setado');
  });

  await tryStep('5.6.5 — hard delete cascade (filhos somem; suppression sobrevive)', async () => {
    // Suppression desacoplada: sobrevive ao cascade.
    const contactHash = await hashForLookup(normalizePhone(PHONE_PLAINTEXT));
    await withTenant(CLINIC_A, async (tx) => {
      await tx
        .insert(suppressionList)
        .values({ clinicId: CLINIC_A, contactHash, channel: 'whatsapp', reason: 'patient_deleted' })
        .onConflictDoNothing();
      // Expira a janela de 30 dias.
      await tx
        .update(patients)
        .set({ deletedAt: sql`now() - interval '31 days'` })
        .where(eq(patients.id, patientA));
    });
    const deleted = await hardDeletePatients(CLINIC_A, [patientA]);
    assert(deleted === 1, 'hardDeletePatients não apagou 1 linha');

    const gone = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM patients WHERE id = ${patientA}::uuid`,
    )) as unknown as Array<{ n: number }>;
    assert(gone[0]!.n === 0, 'paciente não foi apagado');

    for (const [label, q] of [
      ['consents', sql`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = ${patientA}::uuid`],
      ['clinical', sql`SELECT count(*)::int AS n FROM patient_clinical_data WHERE patient_id = ${patientA}::uuid`],
      ['addresses', sql`SELECT count(*)::int AS n FROM patient_addresses WHERE patient_id = ${patientA}::uuid`],
      ['contacts', sql`SELECT count(*)::int AS n FROM patient_emergency_contacts WHERE patient_id = ${patientA}::uuid`],
    ] as const) {
      const r = (await dbAdmin.execute(q)) as unknown as Array<{ n: number }>;
      assert(r[0]!.n === 0, `cascade falhou: ${label} ainda tem linhas`);
    }

    const supp = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM suppression_list WHERE clinic_id = ${CLINIC_A}::uuid AND contact_hash = ${contactHash}`,
    )) as unknown as Array<{ n: number }>;
    assert(supp[0]!.n === 1, 'suppression NÃO sobreviveu ao hard delete');
  });

  // Cleanup: deletar as clínicas cascateia todo o resto (FK ON DELETE CASCADE).
  await dbAdmin.execute(
    sql`DELETE FROM clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke-c5] fatal', e);
  process.exit(1);
});
