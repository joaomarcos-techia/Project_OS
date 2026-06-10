/**
 * `pnpm wa:connect` — conecta um número WhatsApp a uma clínica em DEV.
 *
 * Ferramenta de operador (sem sessão super_admin) — usa `dbAdmin` (service_role)
 * + `encryptForTenant` para gravar o número/token. Em produção o caminho é a
 * Server Action `connectWhatsappNumber` (super_admin + audit). Aqui é só para
 * exercitar webhook/sender contra qoro-dev.
 *
 *   pnpm wa:connect --clinic <uuid> --phone <e164> --meta-phone-id <id> \
 *     --token <token> [--business-id <id>] [--provider meta|zapi]
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  assertDevContext();
  const clinicId = arg('clinic');
  const phone = arg('phone');
  const metaPhoneId = arg('meta-phone-id');
  const token = arg('token');
  const businessId = arg('business-id') ?? null;
  const provider = arg('provider') ?? 'meta';

  if (!clinicId || !phone || !metaPhoneId || !token) {
    console.error(
      'uso: pnpm wa:connect --clinic <uuid> --phone <e164> --meta-phone-id <id> --token <token> [--business-id <id>] [--provider meta|zapi]',
    );
    process.exit(1);
  }

  const tokenEncrypted = await encryptForTenant(clinicId, token);
  await dbAdmin.execute(
    sql`UPDATE clinic_whatsapp_numbers SET active = false, updated_at = now() WHERE clinic_id = ${clinicId} AND active = true`,
  );
  const rows = await dbAdmin.execute<{ id: string }>(sql`
    INSERT INTO clinic_whatsapp_numbers
      (clinic_id, provider, phone_number, meta_phone_id, meta_business_id, token_encrypted, verified_at, active)
    VALUES (${clinicId}, ${provider}::messaging_provider, ${phone}, ${metaPhoneId}, ${businessId}, ${tokenEncrypted}, now(), true)
    RETURNING id
  `);
  console.log(
    `[wa:connect] conectado: id=${rows[0]?.id} clinic=${clinicId} meta_phone_id=${metaPhoneId} provider=${provider}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[wa:connect] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
