/**
 * Backfill da cifra de PII de negócio (A8 / ADR-044): clinics.cnpj +
 * billing_customers.document. Roda ENTRE a 0048 e a 0049. A 0049 tem guard que
 * aborta se este backfill não tiver rodado.
 *
 * Salt HKDF: `clinics.cnpj` usa o id da própria clínica; `billing_customers` usa
 * o clinic_id da linha. A chave vive na app → script, não migration.
 *
 * Uso:
 *   pnpm tsx --conditions=react-server scripts/encrypt-business-pii.ts --dry-run
 *   pnpm db:encrypt-business-pii
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { encryptForTenant, hashForLookup } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_PROD = process.argv.includes('--prod');
if (!ALLOW_PROD) assertDevContext();

async function backfillClinics(): Promise<void> {
  const rows = (await dbAdmin.execute(
    sql`SELECT id, cnpj FROM clinics WHERE cnpj IS NOT NULL AND cnpj_encrypted IS NULL`,
  )) as unknown as Array<{ id: string; cnpj: string }>;
  if (rows.length === 0) return console.log('  clinics: 0 pendentes');
  if (DRY_RUN) return console.log(`  clinics: ${rows.length} cnpj a cifrar (dry-run)`);
  for (const r of rows) {
    const enc = await encryptForTenant(r.id, r.cnpj);
    const hash = await hashForLookup(r.cnpj);
    await dbAdmin.execute(
      sql`UPDATE clinics SET cnpj_encrypted = ${enc}, cnpj_hash = ${hash} WHERE id = ${r.id}`,
    );
  }
  console.log(`  clinics: ${rows.length} cnpj cifrados`);
}

async function backfillBillingCustomers(): Promise<void> {
  const rows = (await dbAdmin.execute(
    sql`SELECT id, clinic_id, document FROM billing_customers WHERE document IS NOT NULL AND document_encrypted IS NULL`,
  )) as unknown as Array<{ id: string; clinic_id: string; document: string }>;
  if (rows.length === 0) return console.log('  billing_customers: 0 pendentes');
  if (DRY_RUN)
    return console.log(`  billing_customers: ${rows.length} document a cifrar (dry-run)`);
  for (const r of rows) {
    const enc = await encryptForTenant(r.clinic_id, r.document);
    await dbAdmin.execute(
      sql`UPDATE billing_customers SET document_encrypted = ${enc} WHERE id = ${r.id}`,
    );
  }
  console.log(`  billing_customers: ${rows.length} document cifrados`);
}

async function main(): Promise<void> {
  console.log(
    `[encrypt-business-pii] ${DRY_RUN ? 'DRY-RUN' : 'APLICANDO'}${ALLOW_PROD ? ' (PROD)' : ''}`,
  );
  await backfillClinics();
  await backfillBillingCustomers();
  console.log('[encrypt-business-pii] concluído.');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[encrypt-business-pii] FALHOU:', e);
  process.exit(1);
});
