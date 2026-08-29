import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import postgres from 'postgres';

import { assertEphemeralScratchTarget, assertLoadTestConfirmation } from './load-test-guards';

interface SeedResult {
  clinicId: string;
  patientId: string;
  doctorId: string;
  procedureId: string;
  appointments: number;
}

async function main(): Promise<void> {
  assertLoadTestConfirmation(process.env.LOAD_TEST_CONFIRM);
  const databaseUrl = process.env.DATABASE_URL;
  const sourceUrl = process.env.LOAD_TEST_SCHEMA_SOURCE;
  const resultPath = process.env.LOAD_TEST_RESULT_PATH;
  const timezone = process.env.LOAD_TEST_CLINIC_TIMEZONE;
  if (!databaseUrl || !sourceUrl || !resultPath || !timezone) {
    throw new Error('[load:seed] DATABASE_URL/source/result/timezone incompletos.');
  }
  assertEphemeralScratchTarget(databaseUrl, sourceUrl);

  const { encryptForTenant, hashForLookup, normalizePhone } = await import('@/lib/crypto');
  const sql = postgres(databaseUrl, { ssl: 'require', max: 2, prepare: false });

  const clinicId = randomUUID();
  const patientId = randomUUID();
  const doctorId = randomUUID();
  const procedureId = randomUUID();
  const phone = '+5511999990001';
  const cpf = '00000000000';

  try {
    const [cpfEncrypted, phoneEncrypted, tokenEncrypted, cpfHash, phoneHash] = await Promise.all([
      encryptForTenant(clinicId, cpf),
      encryptForTenant(clinicId, phone),
      encryptForTenant(clinicId, 'load-test-meta-token'),
      hashForLookup(cpf),
      hashForLookup(normalizePhone(phone)),
    ]);

    await sql.begin(async (tx) => {
      await tx`INSERT INTO auth.users (id) VALUES (${doctorId}::uuid)`;
      await tx`
        INSERT INTO clinics (id, slug, nome, status, timezone)
        VALUES (${clinicId}::uuid, ${`load-${clinicId.slice(0, 8)}`}, 'Clínica Load Scratch', 'active', ${timezone})
      `;
      await tx`
        INSERT INTO profiles (id, clinic_id, nome, role, ativo)
        VALUES (${doctorId}::uuid, ${clinicId}::uuid, 'Dra. Carga Sintética', 'doctor', true)
      `;
      await tx`
        INSERT INTO procedures
          (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        VALUES
          (${procedureId}::uuid, ${clinicId}::uuid, 'LOAD', 'Consulta sintética', 100, 1, true)
      `;
      await tx`
        INSERT INTO patients
          (id, clinic_id, nome, cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash)
        VALUES
          (${patientId}::uuid, ${clinicId}::uuid, 'Paciente Sintético', ${cpfEncrypted}, ${cpfHash},
           ${phoneEncrypted}, ${phoneHash})
      `;
      await tx`
        INSERT INTO patient_consents
          (patient_id, clinic_id, dados_saude, compartilhamento, cobranca_whatsapp,
           marketing, pesquisa, versao)
        VALUES
          (${patientId}::uuid, ${clinicId}::uuid, true, false, true, false, false, 1)
      `;
      await tx`
        INSERT INTO clinic_whatsapp_numbers
          (clinic_id, provider, phone_number, meta_phone_id, meta_business_id,
           token_encrypted, token_version, verified_at, active, connection_status)
        VALUES
          (${clinicId}::uuid, 'meta', '+5511999999999', 'load-meta-phone', 'load-meta-business',
           ${tokenEncrypted}, 1, now(), true, 'connected')
      `;
      await tx`
        INSERT INTO appointments
          (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
           duration_min, status, valor, snapshot_procedure_name,
           snapshot_procedure_codigo, snapshot_procedure_valor,
           snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
        SELECT gen_random_uuid(), ${clinicId}::uuid, ${doctorId}::uuid, ${patientId}::uuid,
               ${procedureId}::uuid,
               (((now() AT TIME ZONE ${timezone})::date + 1 + time '00:00'
                  + (g.i * interval '1 minute')) AT TIME ZONE ${timezone}),
               1, 'agendado', 100, 'Consulta sintética', 'LOAD', 100, 1,
               'Dra. Carga Sintética', 'attendant'
          FROM generate_series(0, 499) AS g(i)
      `;
    });

    const countRows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM appointments
       WHERE clinic_id = ${clinicId}::uuid
    `;
    const count = countRows[0]?.count ?? 0;
    const result: SeedResult = {
      clinicId,
      patientId,
      doctorId,
      procedureId,
      appointments: count,
    };
    writeFileSync(resultPath, JSON.stringify(result), { encoding: 'utf8' });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(
    `[load:seed] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
