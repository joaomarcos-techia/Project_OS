/** Read-only TISS inputs; both SQL orders run and roll back on loopback only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { startScratchSchema } from './scratch-schema';
import { loadTissProofInputs } from './abacatepay-tiss-input';

const proof = await loadTissProofInputs();
const source = proof.sources;
const tissHead = proof.head;
const candidate = await readFile(
  'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
  'utf8',
);
const cluster = await startScratchSchema({ port: 55494 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const checks: { name: string; status: 'PASS'; fingerprint?: string }[] = [];
class RollbackProof extends Error {}
type ScratchTransaction = Parameters<Parameters<typeof cluster.sql.begin>[1]>[0];
async function fingerprint(tx: ScratchTransaction, scope: 'billing' | 'tiss') {
  const rows =
    await tx`SELECT n.nspname schema,c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced,
    (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) constraints,
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r'
      AND ((${scope}='billing' AND (n.nspname='billing_gateway' OR (n.nspname='public' AND c.relname IN ('subscriptions','invoices','payment_attempts','prices','plans'))))
        OR (${scope}='tiss' AND n.nspname='public' AND (left(c.relname,3)='hi_' OR left(c.relname,5)='tiss_' OR c.relname IN ('appointments','lancamentos'))))
    ORDER BY n.nspname,c.relname`;
  const indexes = await tx`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
    WHERE (${scope}='billing' AND (schemaname='billing_gateway' OR tablename IN ('subscriptions','invoices','payment_attempts','prices','plans')))
      OR (${scope}='tiss' AND schemaname='public' AND (left(tablename,3)='hi_' OR left(tablename,5)='tiss_' OR tablename IN ('appointments','lancamentos')))
    ORDER BY schemaname,tablename,indexname`;
  const triggers = await tx`SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) definition,
      pg_get_functiondef(t.tgfoid) function_definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND ((${scope}='billing' AND (n.nspname='billing_gateway' OR c.relname IN ('subscriptions','invoices')))
      OR (${scope}='tiss' AND n.nspname='public' AND (left(c.relname,3)='hi_' OR c.relname IN ('appointments','lancamentos'))))
    ORDER BY n.nspname,c.relname,t.tgname`;
  const catalog =
    scope === 'billing'
      ? await tx`SELECT
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM public.plans p) plans,
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM public.prices p) prices`
      : [];
  return createHash('sha256')
    .update(JSON.stringify({ rows, indexes, triggers, catalog }))
    .digest('hex');
}

async function seedExisting(tx: ScratchTransaction, legacy: boolean, trial = false) {
  const clinicId = randomUUID(),
    ownerId = randomUUID(),
    patientId = randomUUID();
  const procedureId = randomUUID(),
    appointmentId = randomUUID();
  await tx`INSERT INTO auth.users(id,email) VALUES(${ownerId}::uuid,${`${ownerId}@example.invalid`})`;
  await tx`INSERT INTO public.clinics(id,slug,nome,status)
    VALUES(${clinicId}::uuid,${`composition-${clinicId.slice(0, 8)}`},'Synthetic composition clinic','active')`;
  await tx`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
    VALUES(${ownerId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true,now())`;
  const [catalog] = await tx`SELECT p.id plan_id,pr.id price_id,pr.amount FROM public.plans p
    JOIN public.prices pr ON pr.plan_id=p.id WHERE p.code=${legacy ? 'solo' : 'clinica_2026_2'}
    AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL LIMIT 1`;
  assert.ok(catalog);
  const [subscription] = await tx`INSERT INTO public.subscriptions
    (clinic_id,plan_id,price_id,billing_status,billing_provider,trial_ends_at,enforce_trial_deadline)
    VALUES(${clinicId}::uuid,${catalog.plan_id}::uuid,${catalog.price_id}::uuid,${trial ? 'trial' : 'active'},
      ${legacy ? 'asaas' : 'abacatepay'},now()+interval '14 days',true) RETURNING id`;
  assert.ok(subscription);
  if (!trial) {
    const [invoice] = await tx`INSERT INTO public.invoices
      (clinic_id,subscription_id,total_amount,status,due_date,period_start,period_end,paid_at,payment_method)
      VALUES(${clinicId}::uuid,${subscription.id}::uuid,${catalog.amount},'paid',current_date,
        current_date,current_date+30,now(),'CARD') RETURNING id`;
    assert.ok(invoice);
    await tx`UPDATE public.trial_access_policies SET released_at=now(),released_by_invoice_id=${invoice.id}::uuid
      WHERE clinic_id=${clinicId}::uuid`;
  }
  await tx`INSERT INTO public.patients(id,clinic_id,nome,cpf_encrypted,cpf_hash)
    VALUES(${patientId}::uuid,${clinicId}::uuid,'Synthetic patient','synthetic-ciphertext',${randomUUID()})`;
  await tx`INSERT INTO public.procedures(id,clinic_id,codigo,descricao,valor_padrao,duracao_padrao_min,ativo)
    VALUES(${procedureId}::uuid,${clinicId}::uuid,'SYN','Synthetic visit',150,30,true)`;
  await tx`INSERT INTO public.appointments(id,clinic_id,doctor_id,patient_id,procedure_id,scheduled_at,duration_min,
      status,valor,snapshot_procedure_name,snapshot_procedure_valor,snapshot_procedure_duracao_min,snapshot_doctor_nome,created_via)
    VALUES(${appointmentId}::uuid,${clinicId}::uuid,${ownerId}::uuid,${patientId}::uuid,${procedureId}::uuid,
      now()+interval '1 day',30,'agendado',150,'Synthetic visit',150,30,'Synthetic owner','attendant')`;
  await tx`INSERT INTO public.lancamentos(clinic_id,tipo,descricao,valor,status,due_date,patient_id,appointment_id,created_via)
    VALUES(${clinicId}::uuid,'receber','Synthetic existing receivable',150,'pendente',current_date,
      ${patientId}::uuid,${appointmentId}::uuid,'manual')`;
  return { clinicId, ownerId, patientId, procedureId, appointmentId };
}
type Fixture = Awaited<ReturnType<typeof seedExisting>>;
async function preservedData(tx: ScratchTransaction) {
  return tx`SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions s) subscriptions,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.invoices i) invoices,
    (SELECT jsonb_agg(to_jsonb(a)-'billing_mode' ORDER BY a.id) FROM public.appointments a) appointments,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.lancamentos l) receivables`;
}
async function rejectsSql(
  tx: ScratchTransaction,
  run: (nested: ScratchTransaction) => Promise<unknown>,
  code: string,
) {
  await assert.rejects(
    tx.savepoint(async (nested) => await run(nested)),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error);
      assert.equal(error.code, code);
      return true;
    },
  );
}
async function sharedTableChecks(
  tx: ScratchTransaction,
  f: Fixture,
  other: Fixture,
  order: string,
) {
  const passed = (name: string) => checks.push({ name: `${order}: ${name}`, status: 'PASS' });
  const triggers = await tx`SELECT c.relname||'.'||t.tgname name FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('appointments','lancamentos')`;
  for (const name of [
    'appointments.trial_appointments',
    'appointments.appointments_billing_mode_guard',
    'lancamentos.trial_financial_entries',
    'lancamentos.lancamentos_convenio_patient_guard',
  ]) {
    assert.ok(
      triggers.some((row) => row.name === name),
      `Missing ${name}`,
    );
  }
  passed('trial and insurance guards coexist');
  const [existing] =
    await tx`SELECT billing_mode FROM public.appointments WHERE id=${f.appointmentId}::uuid`;
  assert.equal(existing?.billing_mode, 'particular');
  passed('existing private appointment remains private');
  await tx`INSERT INTO public.hi_clinic_settings(clinic_id,enabled,enabled_at,enabled_by,provider_kind,cnes_status)
    VALUES(${f.clinicId}::uuid,true,now(),${f.ownerId}::uuid,'PJ','none_declared')`;
  const [insurer] = await tx`INSERT INTO public.hi_insurers
    (clinic_id,name,registro_ans,provider_id_kind,provider_id_value,status,created_by)
    VALUES(${f.clinicId}::uuid,'Synthetic insurer','123456','codigoPrestadorNaOperadora','TEST','active',${f.ownerId}::uuid) RETURNING id`;
  assert.ok(insurer);
  const appointmentId = randomUUID();
  await tx`INSERT INTO public.appointments(id,clinic_id,doctor_id,patient_id,procedure_id,scheduled_at,duration_min,
      status,valor,snapshot_procedure_name,snapshot_procedure_valor,snapshot_procedure_duracao_min,snapshot_doctor_nome,created_via,billing_mode)
    VALUES(${appointmentId}::uuid,${f.clinicId}::uuid,${f.ownerId}::uuid,${f.patientId}::uuid,${f.procedureId}::uuid,
      now()+interval '2 days',30,'agendado',150,'Synthetic visit',150,30,'Synthetic owner','attendant','convenio')`;
  const usage = () => tx`SELECT metric,consumed FROM public.trial_resource_usage
    WHERE clinic_id=${f.clinicId}::uuid ORDER BY metric`;
  const before = await usage();
  await rejectsSql(
    tx,
    (nested) => nested`INSERT INTO public.lancamentos
    (clinic_id,tipo,descricao,valor,status,due_date,patient_id,appointment_id,created_via)
    VALUES(${f.clinicId}::uuid,'receber','Synthetic forbidden full charge',150,'pendente',current_date,
      ${f.patientId}::uuid,${appointmentId}::uuid,'manual')`,
    '23514',
  );
  assert.deepEqual(await usage(), before);
  passed(
    proof.lastIndex >= 151
      ? 'insurance full charge refused even for a verified paid contract'
      : 'insurance full charge refused without consuming trial quota',
  );
  const [coverage] = await tx`INSERT INTO public.hi_appointment_coverages
    (clinic_id,appointment_id,patient_id,insurer_id,created_via,created_by)
    VALUES(${f.clinicId}::uuid,${appointmentId}::uuid,${f.patientId}::uuid,${insurer.id}::uuid,'user',${f.ownerId}::uuid) RETURNING id`;
  assert.ok(coverage);
  await tx`UPDATE public.appointments SET status='atendido' WHERE id=${appointmentId}::uuid`;
  await rejectsSql(
    tx,
    (nested) => nested`UPDATE public.hi_appointment_coverages SET expected_value_cents=17000
    WHERE id=${coverage.id}::uuid`,
    '55000',
  );
  passed('0149 keeps completed coverage frozen without an open gap');
  await tx`INSERT INTO public.hi_billing_gaps(clinic_id,appointment_id,coverage_id,reason,owner,recovery,detected_by)
    VALUES(${f.clinicId}::uuid,${appointmentId}::uuid,${coverage.id}::uuid,'coverage_incomplete','recepcao','human','reconcile')`;
  await tx`SELECT set_config('app.current_user',${f.ownerId},true)`;
  await tx`UPDATE public.hi_appointment_coverages SET expected_value_cents=17000,
    correction_note='Synthetic administrative correction',corrected_by=${f.ownerId}::uuid WHERE id=${coverage.id}::uuid`;
  const [corrected] =
    await tx`SELECT expected_value_cents::int amount,corrected_at IS NOT NULL stamped
    FROM public.hi_appointment_coverages WHERE id=${coverage.id}::uuid`;
  assert.deepEqual(corrected, { amount: 17000, stamped: true });
  passed('0149 correction needs an open gap and stamps the authenticated actor');
  await rejectsSql(
    tx,
    (nested) => nested`INSERT INTO public.hi_billing_gaps
    (clinic_id,appointment_id,reason,owner,recovery,detected_by)
    VALUES(${f.clinicId}::uuid,${appointmentId}::uuid,'coverage_missing','recepcao','human','reconcile')`,
    '23505',
  );
  passed('0149 duplicate gap is refused');
  await tx.savepoint(async (scoped) => {
    await scoped`SET LOCAL ROLE authenticated`;
    await scoped`SELECT set_config('app.current_clinic',${other.clinicId},true),
      set_config('request.jwt.claim.sub',${other.ownerId},true)`;
    const [row] =
      await scoped`SELECT count(*)::int n FROM public.hi_billing_gaps WHERE clinic_id=${f.clinicId}::uuid`;
    assert.equal(row?.n, 0);
    await rejectsSql(
      scoped,
      (nested) => nested`SELECT * FROM billing_gateway.renewal_api_readbacks`,
      '42501',
    );
    await scoped`RESET ROLE`;
  });
  passed('tenant cannot read another clinic gap or private recovery provenance');
}
async function premiumChecks(tx: ScratchTransaction, trial: Fixture, paid: Fixture, order: string) {
  const passed = (name: string) => checks.push({ name: `${order}: 0151 ${name}`, status: 'PASS' });
  for (const feature of ['patient_charges', 'ai_agents', 'health_insurance']) {
    const [denied] =
      await tx`SELECT public.qoro_premium_denial_for(${trial.clinicId}::uuid,${feature}) reason`;
    assert.equal(denied?.reason, 'trial');
    const [allowed] =
      await tx`SELECT public.qoro_premium_denial_for(${paid.clinicId}::uuid,${feature}) reason`;
    assert.equal(allowed?.reason, null);
  }
  passed('all three commercial decisions distinguish trial and verified paid contract');
  const [before] =
    await tx`SELECT count(*)::int n FROM public.hi_clinic_settings WHERE clinic_id=${trial.clinicId}::uuid`;
  await rejectsSql(
    tx,
    (nested) => nested`INSERT INTO public.hi_clinic_settings
    (clinic_id,enabled,enabled_at,enabled_by,provider_kind,cnes_status)
    VALUES(${trial.clinicId}::uuid,true,now(),${trial.ownerId}::uuid,'PJ','none_declared')`,
    '23514',
  );
  const [after] =
    await tx`SELECT count(*)::int n FROM public.hi_clinic_settings WHERE clinic_id=${trial.clinicId}::uuid`;
  assert.deepEqual(after, before);
  passed('trial cannot enable TISS by direct SQL and leaves no setting');
  await rejectsSql(
    tx,
    (nested) => nested`UPDATE public.appointments SET billing_mode='convenio'
    WHERE id=${trial.appointmentId}::uuid`,
    '23514',
  );
  passed('trial cannot convert an appointment to insurance');
  try {
    await tx.savepoint(async (nested) => {
      await nested`UPDATE public.subscriptions SET billing_status='active' WHERE clinic_id=${trial.clinicId}::uuid`;
      const [row] =
        await nested`SELECT public.qoro_premium_denial_for(${trial.clinicId}::uuid,'ai_agents') reason`;
      assert.equal(row?.reason, 'payment_pending');
      throw new RollbackProof();
    });
  } catch (error) {
    if (!(error instanceof RollbackProof)) throw error;
  }
  passed('an active status without invoice release cannot bypass commercial denial');
  await tx.savepoint(async (scoped) => {
    await scoped`SET LOCAL ROLE authenticated`;
    await scoped`SELECT set_config('app.current_clinic',${paid.clinicId},true)`;
    const [row] =
      await scoped`SELECT public.qoro_premium_denial(${paid.clinicId}::uuid,'patient_charges') reason`;
    assert.equal(row?.reason, null);
    await rejectsSql(
      scoped,
      (nested) =>
        nested`SELECT public.qoro_premium_denial(${trial.clinicId}::uuid,'patient_charges')`,
      '42501',
    );
    await rejectsSql(
      scoped,
      (nested) =>
        nested`SELECT public.qoro_premium_denial_for(${paid.clinicId}::uuid,'patient_charges')`,
      '42501',
    );
    await scoped`RESET ROLE`;
  });
  passed('session wrapper is tenant-bound and core is not callable by authenticated');
  await tx.savepoint(async (scoped) => {
    await scoped`SET LOCAL ROLE anon`;
    await rejectsSql(
      scoped,
      (nested) =>
        nested`SELECT public.qoro_premium_denial(${paid.clinicId}::uuid,'patient_charges')`,
      '42501',
    );
    await scoped`RESET ROLE`;
  });
  passed('anonymous role cannot inspect commercial access');
}
let failure: unknown;
try {
  for (const order of ['financial_then_tiss', 'tiss_then_financial'] as const) {
    try {
      await cluster.sql.begin(async (tx) => {
        await seedExisting(tx, true);
        const current = await seedExisting(tx, false);
        const trial = await seedExisting(tx, false, true);
        const existingData = await preservedData(tx);
        if (order === 'financial_then_tiss') await tx.unsafe(candidate);
        else for (const migration of source) await tx.unsafe(migration.body);
        const scope = order === 'financial_then_tiss' ? 'billing' : 'tiss';
        const before = await fingerprint(tx, scope);
        if (order === 'financial_then_tiss')
          for (const migration of source) await tx.unsafe(migration.body);
        else await tx.unsafe(candidate);
        assert.equal(await fingerprint(tx, scope), before, 'Unrelated schema/catalog changed');
        const [row] =
          await tx`SELECT to_regclass('billing_gateway.renewal_api_readbacks') IS NOT NULL recovery,
          to_regclass('public.hi_guides') IS NOT NULL guides,
          (SELECT relforcerowsecurity FROM pg_class WHERE oid='billing_gateway.renewal_api_readbacks'::regclass) forced_rls,
          has_table_privilege('service_role','billing_gateway.renewal_api_readbacks','DELETE') service_delete`;
        assert.deepEqual(row, {
          recovery: true,
          guides: true,
          forced_rls: true,
          service_delete: false,
        });
        checks.push({ name: order, status: 'PASS', fingerprint: before });
        assert.deepEqual(
          await preservedData(tx),
          existingData,
          'Existing financial data changed during DDL',
        );
        checks.push({
          name: `${order}: legacy and AbacatePay contracts invoices and private receivables preserved`,
          status: 'PASS',
        });
        if (proof.lastIndex >= 151) {
          await premiumChecks(tx, trial, current, order);
          // 0151 intentionally forbids operational TISS in trial; exercise the
          // existing coverage/receivable protections with the verified paid fixture.
          await sharedTableChecks(tx, current, trial, order);
        } else await sharedTableChecks(tx, trial, current, order);
        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }
    const [rolledBack] =
      await cluster.sql`SELECT to_regclass('billing_gateway.renewal_api_readbacks') IS NULL recovery,
      to_regclass('public.hi_guides') IS NULL guides`;
    assert.deepEqual(rolledBack, { recovery: true, guides: true });
    checks.push({ name: `${order}_rollback`, status: 'PASS' });
  }
  checks.push({ name: 'common_journal_identity_order_and_readonly_tiss_inputs', status: 'PASS' });
} catch (error) {
  failure = error;
} finally {
  await mkdir('dist', { recursive: true });
  await writeFile(
    `dist/abacatepay-tiss-${String(proof.lastIndex).padStart(4, '0')}-schema-db.json`,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'loopback_synthetic_pinned_tiss_sql_and_data',
        status: failure ? 'FAIL' : 'PASS',
        tissHead,
        sourceAccess: proof.sourceAccess,
        composedJournalEntries: proof.ordered,
        excludedUncommittedMigrations:
          'All SQL after the pinned commit, including uncommitted changes',
        financialBase: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
          windowsHide: true,
        }).trim(),
        tissSources: source.map(({ idx, when, tag, sha256 }) => ({ idx, when, tag, sha256 })),
        candidateSha256: createHash('sha256').update(candidate).digest('hex'),
        checks,
        remoteWrites: 0,
        otherWorktreeWrites: 0,
        billingDataCoverage:
          'SQL composition, shared triggers, trial guards, financial-row preservation and RLS; not the full TISS application',
      },
      null,
      2,
    ),
  );
  await cluster.stop();
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    status: 'PASS',
    checks: checks.length,
    remoteWrites: 0,
    otherWorktreeWrites: 0,
  }),
);
