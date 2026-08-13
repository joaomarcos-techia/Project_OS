/**
 * Prova externa do boundary de Storage em produção.
 *
 * Cria dois PDFs sintéticos: um no prefixo da clínica autenticada e outro sob
 * um UUID que representa outro tenant. O contrato do produto é privado por
 * padrão: a sessão do usuário não acessa a Storage API diretamente, nem o
 * próprio arquivo; o servidor autorizado emite uma signed URL curta. O cliente
 * admin existe somente para setup, signed URL server-side e cleanup exato.
 *
 * Uso:
 *   SUPABASE_PROJECT_ENV=prod
 *   pnpm exec tsx scripts/prod-storage-authorization-check.ts --confirm=PROBE_PROD_STORAGE
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { assertProdContext } from './_env';

const CONFIRMATION = 'PROBE_PROD_STORAGE';
const BUCKET = 'clinical-pdfs';
const APP_BASE_URL = 'https://app.qoro.dev';
const SIGNED_URL_TTL_SECONDS = 2;
const EXPIRY_WAIT_MS = 3_500;

type StoredSession = { access_token: string; refresh_token: string };

function confirmation(): string | undefined {
  return process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
}

function decodeSessionCookie(value: string): StoredSession {
  if (!value.startsWith('base64-')) throw new Error('[storage-probe] cookie Auth inesperado');
  const parsed = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
    throw new Error('[storage-probe] sessão Auth incompleta');
  }
  return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
}

function claims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('[storage-probe] JWT inválido');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function observeProductionPublishableKey(projectRef: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: APP_BASE_URL,
      storageState: '.playwright/.auth/user.json',
    });
    const page = await context.newPage();
    await page.goto('/consultorio', { waitUntil: 'networkidle' });
    if (/\/login(?:\?|$)/u.test(page.url())) {
      throw new Error('[storage-probe] storage state expirado');
    }
    const scriptUrls = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter(
          (entry): entry is PerformanceResourceTiming =>
            'initiatorType' in entry && entry.initiatorType === 'script',
        )
        .map((entry) => entry.name),
    );
    for (const scriptUrl of scriptUrls) {
      const script = await context.request.get(scriptUrl);
      const source = await script.text();
      if (!source.includes(`${projectRef}.supabase.co`)) continue;
      const key = source.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0];
      if (key) return key;
    }
    throw new Error('[storage-probe] publishable key PROD não observada no bundle');
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (confirmation() !== CONFIRMATION) {
    throw new Error(`[storage-probe] confirmação obrigatória: --confirm=${CONFIRMATION}`);
  }
  const { databaseUrl } = assertProdContext();
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef) || !adminSecret) {
    throw new Error('[storage-probe] configuração Supabase PROD incompleta');
  }
  const publicUrl = `https://${projectRef}.supabase.co`;
  const publishableKey = await observeProductionPublishableKey(projectRef);

  const state = JSON.parse(await readFile('.playwright/.auth/user.json', 'utf8')) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const session = decodeSessionCookie(
    state.cookies
      .filter((cookie) => cookie.name.includes('auth-token'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cookie) => cookie.value)
      .join(''),
  );
  const tokenClaims = claims(session.access_token);
  const clinicId = typeof tokenClaims.clinic_id === 'string' ? tokenClaims.clinic_id : '';
  const expectedIssuer = `${publicUrl}/auth/v1`;
  if (!/^[0-9a-f-]{36}$/iu.test(clinicId)) {
    throw new Error('[storage-probe] clinic_id da sessão inválido');
  }
  if (tokenClaims.iss !== expectedIssuer || tokenClaims.role !== 'authenticated') {
    throw new Error('[storage-probe] JWT não pertence ao projeto PROD esperado');
  }

  const admin = createClient(publicUrl, adminSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const user = createClient(publicUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  const fixtureId = randomUUID();
  const otherTenantId = randomUUID();
  const ownPath = `${clinicId}/go-live-probe/${fixtureId}.pdf`;
  const otherPath = `${otherTenantId}/go-live-probe/${fixtureId}.pdf`;
  const bytes = Buffer.from('%PDF-1.4\n% Qoro go-live synthetic fixture\n%%EOF\n', 'utf8');
  const result = {
    projectRef,
    bucketPrivate: false,
    uploads: 0,
    ownDirectDownload: 'not_tested',
    crossTenantDownload: 'not_tested',
    ownDirectSign: 'not_tested',
    crossTenantSign: 'not_tested',
    publicAccessStatus: 0,
    serverSignedOwnAccessStatus: 0,
    expiredAccessStatus: 0,
    cleanupObjects: 0,
  };

  try {
    const buckets = await admin.storage.listBuckets();
    if (buckets.error) throw buckets.error;
    const bucket = buckets.data.find((candidate) => candidate.name === BUCKET);
    if (!bucket) throw new Error(`[storage-probe] bucket ${BUCKET} ausente`);
    result.bucketPrivate = bucket.public === false;

    for (const path of [ownPath, otherPath]) {
      const uploaded = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
      result.uploads += 1;
    }

    const ownDownload = await user.storage.from(BUCKET).download(ownPath);
    result.ownDirectDownload = ownDownload.error ? 'denied' : 'allowed';
    const crossDownload = await user.storage.from(BUCKET).download(otherPath);
    result.crossTenantDownload = crossDownload.error ? 'denied' : 'allowed';

    const ownSign = await user.storage.from(BUCKET).createSignedUrl(ownPath, 60);
    result.ownDirectSign = ownSign.error ? 'denied' : 'allowed';
    const crossSign = await user.storage.from(BUCKET).createSignedUrl(otherPath, 60);
    result.crossTenantSign = crossSign.error ? 'denied' : 'allowed';

    const publicUrlForObject = admin.storage.from(BUCKET).getPublicUrl(ownPath).data.publicUrl;
    result.publicAccessStatus = (await fetch(publicUrlForObject)).status;

    const signed = await admin.storage
      .from(BUCKET)
      .createSignedUrl(ownPath, SIGNED_URL_TTL_SECONDS);
    if (signed.error) throw signed.error;
    result.serverSignedOwnAccessStatus = (await fetch(signed.data.signedUrl)).status;
    await new Promise((resolve) => setTimeout(resolve, EXPIRY_WAIT_MS));
    result.expiredAccessStatus = (await fetch(signed.data.signedUrl)).status;
  } finally {
    const cleanup = await admin.storage.from(BUCKET).remove([ownPath, otherPath]);
    if (cleanup.error) throw cleanup.error;
    result.cleanupObjects = cleanup.data?.length ?? 0;
    console.log(JSON.stringify(result));
  }

  if (!result.bucketPrivate) throw new Error('[storage-probe] FAIL: bucket público');
  if (result.uploads !== 2 || result.cleanupObjects !== 2) {
    throw new Error('[storage-probe] FAIL: setup/cleanup incompleto');
  }
  if (result.ownDirectDownload !== 'denied' || result.ownDirectSign !== 'denied') {
    throw new Error('[storage-probe] FAIL: sessao autenticada acessou Storage diretamente');
  }
  if (result.crossTenantDownload !== 'denied' || result.crossTenantSign !== 'denied') {
    throw new Error('[storage-probe] FAIL: sessão atravessou o boundary de tenant');
  }
  if (result.publicAccessStatus >= 200 && result.publicAccessStatus < 300) {
    throw new Error('[storage-probe] FAIL: objeto privado acessível publicamente');
  }
  if (result.serverSignedOwnAccessStatus !== 200) {
    throw new Error('[storage-probe] FAIL: signed URL server-side para o proprio objeto nao abriu');
  }
  if (result.expiredAccessStatus >= 200 && result.expiredAccessStatus < 300) {
    throw new Error('[storage-probe] FAIL: signed URL continuou válida após expirar');
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
