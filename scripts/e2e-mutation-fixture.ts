/**
 * Fixture descartável para os E2E que alteram dados.
 *
 * Só opera quando E2E_MUTATION=1, usando a conta definida em E2E_USER_EMAIL.
 * A trava de ambiente local fica no playwright.config.ts; esta camada também
 * exige o contexto dev antes de tocar no banco. Os únicos registros removidos
 * são os criados com o marcador da execução salvo em e2e/.mutation-fixture.json.
 */
import './_env';

import { createHash, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';

import {
  mutationFixturePath,
  readMutationFixture,
  type MutationFixture,
} from '../e2e/mutation-fixture';
import { assertDevContext } from './_env';

const CLINICAL_PDF_BUCKET = 'clinical-pdfs';

type ProfileRow = { clinicId: string; role: string };
type IdRow = { id: string };
type ClinicalArtifactRow = { id: string; pdfStoragePath: string | null };

const [command] = process.argv.slice(2);

if (command !== 'setup' && command !== 'cleanup') {
  throw new Error('Uso: pnpm exec tsx scripts/e2e-mutation-fixture.ts <setup|cleanup>');
}

assertMutationE2EEnabled();
assertDevContext();

try {
  if (command === 'setup') {
    await cleanupFixtureIfPresent();
    await setupFixture();
  } else {
    await cleanupFixtureIfPresent();
  }
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}

function assertMutationE2EEnabled(): void {
  if (process.env.E2E_MUTATION !== '1') {
    throw new Error('[e2e] E2E_MUTATION=1 é obrigatório para criar fixtures mutáveis.');
  }
  if (!process.env.E2E_USER_EMAIL) {
    throw new Error(
      '[e2e] E2E_USER_EMAIL é obrigatório para localizar a clínica de desenvolvimento.',
    );
  }
}

async function setupFixture(): Promise<void> {
  const email = requiredE2EUserEmail();
  const profiles = rows<ProfileRow>(
    await dbAdmin.execute(sql`
      SELECT p.clinic_id::text AS "clinicId", p.role::text AS role
      FROM public.profiles p
      INNER JOIN auth.users u ON u.id = p.id
      WHERE lower(u.email) = lower(${email})
        AND p.ativo = true
        AND p.deleted_at IS NULL
      LIMIT 1
    `),
  );
  const profile = profiles[0];
  if (!profile?.clinicId) {
    throw new Error('[e2e] Nenhum perfil ativo encontrado para a conta de teste configurada.');
  }
  if (profile.role === 'super_admin') {
    throw new Error('[e2e] Uma conta super_admin não pode ser usada nos cenários mutáveis.');
  }

  const runId = randomUUID().replace(/-/g, '').slice(0, 12);
  const doctorPassword = `${randomUUID()}Aa1!`;
  const fixture: MutationFixture = {
    version: 1,
    runId,
    clinicId: profile.clinicId,
    patientName: `[E2E] Paciente ${runId}`,
    patientEmail: `e2e-patient-${runId}@example.test`,
    patientCpf: cpfForRun(runId),
    appointmentDate: futureDate(7),
    doctorName: `[E2E] Profissional ${runId}`,
    doctorEmail: `e2e-doctor-${runId}@example.test`,
    doctorPassword,
    procedureName: `[E2E] Consulta ${runId}`,
    procedureCode: `E2E-${runId}`,
    paymentDescription: `[E2E] Recebimento ${runId}`,
    paymentAmount: '123.45',
  };

  // Persiste os identificadores textuais ANTES das inserções. Se o setup cair no
  // meio, a próxima execução ainda conhece exatamente o que pode limpar.
  await writeFixture(fixture);

  const admin = createAdminClient();
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email: fixture.doctorEmail,
    password: doctorPassword,
    email_confirm: true,
  });
  if (createUserError || !createdUser.user) {
    throw createUserError ?? new Error('Não foi possível criar o profissional E2E.');
  }

  const doctorId = createdUser.user.id;
  await writeFixture({ ...fixture, doctorId });
  await dbAdmin.execute(sql`
    INSERT INTO public.profiles (
      id, clinic_id, nome, role, ativo, invite_accepted_at, crm, crm_uf, especialidade
    )
    VALUES (
      ${doctorId}::uuid,
      ${fixture.clinicId}::uuid,
      ${fixture.doctorName},
      'doctor'::public.role_enum,
      true,
      now(),
      ${`E2E${runId}`},
      'SP',
      'Medicina de teste'
    )
  `);

  const availabilityRows = rows<IdRow>(
    await dbAdmin.execute(sql`
      INSERT INTO public.doctor_availability (
        clinic_id, doctor_id, weekday, start_time, end_time
      )
      SELECT c.id,
             ${doctorId}::uuid,
             extract(dow FROM now() AT TIME ZONE c.timezone)::int,
             '00:00'::time,
             '23:59'::time
      FROM public.clinics c
      WHERE c.id = ${fixture.clinicId}::uuid
      RETURNING id::text AS id
    `),
  );
  const doctorAvailabilityId = availabilityRows[0]?.id;
  if (!doctorAvailabilityId) {
    throw new Error('Não foi possível criar a disponibilidade do profissional E2E.');
  }
  await writeFixture({ ...fixture, doctorId, doctorAvailabilityId });

  const procedureRows = rows<IdRow>(
    await dbAdmin.execute(sql`
      INSERT INTO public.procedures (
        clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo
      ) VALUES (
        ${fixture.clinicId}::uuid,
        ${fixture.procedureCode},
        ${fixture.procedureName},
        'e2e',
        123.45,
        30,
        true
      )
      RETURNING id::text AS id
    `),
  );
  const procedureId = procedureRows[0]?.id;
  if (!procedureId) throw new Error('Não foi possível criar o procedimento E2E.');

  const paymentRows = rows<IdRow>(
    await dbAdmin.execute(sql`
      INSERT INTO public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
      VALUES (
        ${fixture.clinicId}::uuid,
        'receber'::public.lancamento_tipo,
        ${fixture.paymentDescription},
        ${fixture.paymentAmount}::numeric,
        'pendente'::public.lancamento_status,
        'manual'::public.lancamento_created_via
      )
      RETURNING id::text AS id
    `),
  );
  const paymentId = paymentRows[0]?.id;
  if (!paymentId) throw new Error('Não foi possível criar o recebimento E2E.');

  await writeFixture({
    ...fixture,
    doctorId,
    doctorAvailabilityId,
    procedureId,
    paymentId,
  });
  console.log(`[e2e] fixture pronta para a clínica ${fixture.clinicId} (run=${fixture.runId}).`);
}

function requiredE2EUserEmail(): string {
  const email = process.env.E2E_USER_EMAIL;
  if (!email) throw new Error('[e2e] E2E_USER_EMAIL é obrigatório.');
  return email;
}

async function cleanupFixtureIfPresent(): Promise<void> {
  let fixture: MutationFixture;
  try {
    fixture = await readMutationFixture();
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }

  const psychiatryPatientName = `[E2E] Psiquiatria ${fixture.runId}`;

  const patientRows = rows<IdRow>(
    await dbAdmin.execute(sql`
      SELECT id::text AS id
      FROM public.patients
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND nome IN (${fixture.patientName}, ${psychiatryPatientName})
    `),
  );
  const patientIds = patientRows.map((row) => row.id);
  const appointmentRows =
    patientIds.length === 0
      ? []
      : rows<IdRow>(
          await dbAdmin.execute(sql`
            SELECT id::text AS id
            FROM public.appointments
            WHERE clinic_id = ${fixture.clinicId}::uuid
              AND patient_id IN (${sql.join(
                patientIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})
          `),
        );
  const prontuarioRows =
    patientIds.length === 0
      ? []
      : rows<IdRow>(
          await dbAdmin.execute(sql`
            SELECT id::text AS id
            FROM public.prontuarios
            WHERE clinic_id = ${fixture.clinicId}::uuid
              AND patient_id IN (${sql.join(
                patientIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})
          `),
        );
  const prescriptionRows =
    patientIds.length === 0
      ? []
      : rows<ClinicalArtifactRow>(
          await dbAdmin.execute(sql`
            SELECT id::text AS id, pdf_storage_path AS "pdfStoragePath"
            FROM public.prescriptions
            WHERE clinic_id = ${fixture.clinicId}::uuid
              AND patient_id IN (${sql.join(
                patientIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})
          `),
        );
  const medicalDocumentRows =
    patientIds.length === 0
      ? []
      : rows<ClinicalArtifactRow>(
          await dbAdmin.execute(sql`
            SELECT id::text AS id, pdf_storage_path AS "pdfStoragePath"
            FROM public.medical_documents
            WHERE clinic_id = ${fixture.clinicId}::uuid
              AND patient_id IN (${sql.join(
                patientIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})
          `),
        );
  const resourceIds = [
    fixture.paymentId,
    ...patientIds,
    ...appointmentRows.map((row) => row.id),
    ...prontuarioRows.map((row) => row.id),
    ...prescriptionRows.map((row) => row.id),
    ...medicalDocumentRows.map((row) => row.id),
  ].filter((id): id is string => Boolean(id));

  const storagePaths = [...prescriptionRows, ...medicalDocumentRows]
    .map((row) => row.pdfStoragePath)
    .filter((path): path is string => Boolean(path));
  if (storagePaths.length > 0) {
    const storage = createAdminClient().storage.from(CLINICAL_PDF_BUCKET);
    for (const path of storagePaths) {
      const readback = await storage.download(path);
      if (readback.error) {
        throw new Error(`[e2e] PDF clínico não persistiu antes do cleanup: ${path}`);
      }
    }
    const { error } = await storage.remove(storagePaths);
    if (error) throw new Error(`[e2e] Falha ao remover PDFs clínicos: ${error.message}`);
    for (const path of storagePaths) {
      const readback = await storage.download(path);
      if (!readback.error) throw new Error(`[e2e] PDF clínico persistiu após cleanup: ${path}`);
    }
  }

  // Impede que um evento de teste pendente seja processado após remover sua entidade.
  for (const id of resourceIds) {
    await dbAdmin.execute(sql`
      DELETE FROM public.outbox
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND payload::text LIKE ${`%${id}%`}
    `);
  }

  if (fixture.paymentId) {
    await dbAdmin.execute(sql`
      DELETE FROM public.payment_proofs WHERE lancamento_id = ${fixture.paymentId}::uuid
    `);
    await dbAdmin.execute(sql`
      DELETE FROM public.payment_transactions WHERE lancamento_id = ${fixture.paymentId}::uuid
    `);
  }
  await dbAdmin.execute(sql`
    DELETE FROM public.lancamentos
    WHERE clinic_id = ${fixture.clinicId}::uuid
      AND descricao = ${fixture.paymentDescription}
  `);

  for (const id of resourceIds) {
    await dbAdmin.execute(sql`
      DELETE FROM public.idempotency_keys
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND response::text LIKE ${`%${id}%`}
    `);
    await dbAdmin.execute(sql`
      DELETE FROM public.audit_events
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND resource_id = ${id}
    `);
  }

  if (patientIds.length > 0) {
    await dbAdmin.execute(sql`
      DELETE FROM public.prescriptions
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND patient_id IN (${sql.join(
          patientIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `);
    await dbAdmin.execute(sql`
      DELETE FROM public.medical_documents
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND patient_id IN (${sql.join(
          patientIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `);
    await dbAdmin.execute(sql`
      DELETE FROM public.prontuarios
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND patient_id IN (${sql.join(
          patientIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `);
    await dbAdmin.execute(sql`
      DELETE FROM public.appointments
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND patient_id IN (${sql.join(
          patientIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `);
  }
  await dbAdmin.execute(sql`
    DELETE FROM public.patients
    WHERE clinic_id = ${fixture.clinicId}::uuid
      AND nome IN (${fixture.patientName}, ${psychiatryPatientName})
  `);
  await dbAdmin.execute(sql`
    DELETE FROM public.procedures
    WHERE clinic_id = ${fixture.clinicId}::uuid
      AND codigo = ${fixture.procedureCode}
  `);

  if (fixture.doctorId) {
    await dbAdmin.execute(sql`
      DELETE FROM public.doctor_availability
      WHERE clinic_id = ${fixture.clinicId}::uuid
        AND doctor_id = ${fixture.doctorId}::uuid
    `);
    await dbAdmin.execute(sql`DELETE FROM public.profiles WHERE id = ${fixture.doctorId}::uuid`);
    const { error } = await createAdminClient().auth.admin.deleteUser(fixture.doctorId);
    if (error) throw error;
  }

  const [remaining] = rows<{ total: number }>(
    await dbAdmin.execute(sql`
      SELECT (
        (SELECT count(*) FROM public.patients
          WHERE clinic_id = ${fixture.clinicId}::uuid
            AND nome IN (${fixture.patientName}, ${psychiatryPatientName}))
        + (SELECT count(*) FROM public.prescriptions
          WHERE clinic_id = ${fixture.clinicId}::uuid
            AND snapshot_patient_nome IN (${fixture.patientName}, ${psychiatryPatientName}))
        + (SELECT count(*) FROM public.medical_documents
          WHERE clinic_id = ${fixture.clinicId}::uuid
            AND snapshot_patient_nome IN (${fixture.patientName}, ${psychiatryPatientName}))
        + (SELECT count(*) FROM public.procedures
          WHERE clinic_id = ${fixture.clinicId}::uuid AND codigo = ${fixture.procedureCode})
        + (SELECT count(*) FROM public.lancamentos
          WHERE clinic_id = ${fixture.clinicId}::uuid AND descricao = ${fixture.paymentDescription})
        + (SELECT count(*) FROM public.doctor_availability
          WHERE clinic_id = ${fixture.clinicId}::uuid
            AND doctor_id = ${fixture.doctorId ?? null}::uuid)
        + (SELECT count(*) FROM public.profiles WHERE id = ${fixture.doctorId ?? null}::uuid)
      )::int AS total
    `),
  );
  if (remaining?.total !== 0) {
    throw new Error(`[e2e] Cleanup tenant-scoped deixou ${remaining?.total ?? -1} resíduo(s).`);
  }

  await unlink(mutationFixturePath);
  console.log(`[e2e] fixture removida (run=${fixture.runId}).`);
}

async function writeFixture(fixture: MutationFixture): Promise<void> {
  await writeFile(mutationFixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  throw new Error('[e2e] Formato inesperado de resultado do banco.');
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cpfForRun(runId: string): string {
  const source = createHash('sha256').update(runId).digest();
  const digits = Array.from(source.subarray(0, 9), (byte) => byte % 10);
  const first = cpfDigit(digits, 10);
  const second = cpfDigit([...digits, first], 11);
  return [...digits, first, second].join('');
}

function cpfDigit(digits: number[], startWeight: number): number {
  const sum = digits.reduce((total, digit, index) => total + digit * (startWeight - index), 0);
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}
