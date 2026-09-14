/**
 * `pnpm tsx scripts/seed-super-admin-mfa.ts`
 *
 * Faz o enrollment de TOTP do super_admin de TESTE, sem passo manual.
 *
 * ===================================================================
 * Por que este script existe
 * ===================================================================
 * `seed-super-admin.ts` cria o usuário e imprime "escaneie o QR num
 * autenticador". Isso funciona para uma pessoa e não funciona para um E2E: o
 * teste precisa gerar códigos TOTP, e para isso precisa do segredo.
 *
 * A saída fácil seria guardar o segredo no `.env.local`. Não é o que fazemos —
 * um segredo de segundo fator num arquivo deixa de ser segundo fator. O E2E lê o
 * segredo de `auth.mfa_factors` no banco de DEV na hora de rodar, e isso não
 * adiciona exposição nenhuma: quem roda o teste já tem o `DATABASE_URL` de
 * admin, que é muito mais poderoso que um código de seis dígitos.
 *
 * Este script só resolve o enrollment, usando a API PÚBLICA (`mfa.enroll` +
 * `mfa.challengeAndVerify`) — nunca escrevendo no schema interno do Supabase.
 *
 * ===================================================================
 * Recusas
 * ===================================================================
 * - `assertDevContext` já impede apontar para produção;
 * - o e-mail precisa vir de `SUPER_ADMIN_EMAIL_DEV` (o alias promove; ver
 *   `src/lib/env-aliases.ts`). Rodar isto contra a conta pessoal do fundador
 *   seria trocar o MFA dela — por isso o script EXIGE o alias de dev e recusa
 *   cair no nome canônico.
 *
 * O segredo NUNCA é impresso. O script diz apenas que o fator ficou verificado.
 */
import { assertDevContext } from './_env';

import { createHmac } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { markMfaEnrolledForUser } from '@/lib/auth/tenant-context';

const { databaseUrl } = assertDevContext();
console.log(`[seed-mfa] target: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);

const email = process.env.SUPER_ADMIN_EMAIL_DEV;
const password = process.env.SUPER_ADMIN_PASSWORD_DEV;

if (!email || !password) {
  console.error(
    '[seed-mfa] SUPER_ADMIN_EMAIL_DEV e SUPER_ADMIN_PASSWORD_DEV são obrigatórios.\n' +
      '           O script recusa o nome canônico de propósito: ele faria o enrollment\n' +
      '           na conta de produção/pessoal, trocando o MFA de alguém.',
  );
  process.exit(1);
}

/* ---------------------------------------------------------------------
 * TOTP — RFC 6238. Mesma implementação de `e2e/production-mfa-lifecycle.spec.ts`;
 * copiada em vez de importada porque um script não deve depender de um spec.
 * ------------------------------------------------------------------ */

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Secret TOTP em Base32 inválido.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1)! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !publishable) {
  console.error('[seed-mfa] NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY ausentes.');
  process.exit(1);
}

// Cliente ANÔNIMO de propósito: o enrollment é operação DO USUÁRIO, e a API de
// admin não a oferece. É também o que garante que este script exercita o mesmo
// caminho que uma pessoa exercitaria na tela.
const supabase = createClient(supabaseUrl, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) {
  console.error(`[seed-mfa] login falhou: ${signInError.message}`);
  process.exit(1);
}

const { data: fatores, error: listError } = await supabase.auth.mfa.listFactors();
if (listError) {
  console.error(`[seed-mfa] não consegui listar fatores: ${listError.message}`);
  process.exit(1);
}
const verificado = fatores.totp.find((f) => f.status === 'verified');
if (verificado) {
  // Idempotente: rodar de novo não troca o fator de quem já tem. Trocar exigiria
  // `seed-super-admin.ts --reset-mfa` antes, que é uma decisão explícita.
  //
  // Mas a marca no profile é RECONCILIADA mesmo assim: é o caso de uma conta que
  // ficou com fator verificado e `mfa_enrolled_at` nulo — exatamente o que a
  // primeira versão deste script produziu. Rodar de novo conserta.
  const { data: atual } = await supabase.auth.getUser();
  if (atual.user) await markMfaEnrolledForUser(atual.user.id, true);
  console.log(`[seed-mfa] já existe fator TOTP verificado (${verificado.id}).`);
  console.log('[seed-mfa] profiles.mfa_enrolled_at reconciliado. Nada mais a fazer.');
  process.exit(0);
}

const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  friendlyName: `e2e-${Date.now()}`,
});
if (enrollError || !enrolled) {
  console.error(`[seed-mfa] enroll falhou: ${enrollError?.message ?? 'sem retorno'}`);
  process.exit(1);
}

// O segredo existe aqui só para produzir o primeiro código. Não é impresso, não
// é gravado em arquivo, não vai para log. Quem precisar dele depois lê de
// `auth.mfa_factors` com a credencial de admin do banco.
const code = totp(enrolled.totp.secret);
const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
  factorId: enrolled.id,
  code,
});
if (verifyError) {
  console.error(`[seed-mfa] verificação falhou: ${verifyError.message}`);
  process.exit(1);
}

/* ---------------------------------------------------------------------
 * `profiles.mfa_enrolled_at` — a OUTRA metade do enrollment.
 *
 * O fator vive no Supabase (`auth.mfa_factors`); a marca vive no nosso
 * `profiles`, e é ELA que o `postLoginRedirect` consulta. Fazer só a primeira
 * metade deixa a conta num estado incoerente: tem fator verificado e mesmo
 * assim é mandada para o enrollment forçado a cada login.
 *
 * Descoberto sondando o Preview logo depois da primeira versão deste script —
 * o login caiu em `/account/security?force=1` com o fator já existindo. A
 * `verifyEnrollAction` da tela faz as duas metades; um script que faz só uma
 * não reproduz o enrollment, reproduz metade dele.
 * ------------------------------------------------------------------ */
const { data: sessao } = await supabase.auth.getUser();
if (!sessao.user) {
  console.error('[seed-mfa] sessão sumiu antes de marcar o profile.');
  process.exit(1);
}
await markMfaEnrolledForUser(sessao.user.id, true);

console.log(`[seed-mfa] fator TOTP verificado (${enrolled.id}).`);
console.log('[seed-mfa] profiles.mfa_enrolled_at marcado.');
console.log('[seed-mfa] ✅ done. O segredo NÃO foi impresso — o E2E o lê de auth.mfa_factors.');
