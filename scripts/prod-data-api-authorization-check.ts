/**
 * Prova externa do boundary Supabase Data API em produção.
 *
 * Um usuário autenticado não pode contornar Server Actions, permissões,
 * idempotência e auditoria chamando PostgREST diretamente. O probe tenta
 * criar/alterar/apagar apenas um paciente sintético, de UUID aleatório e com
 * marcador fixo. Cleanup administrativo exato roda em `finally` mesmo quando o
 * gate falha.
 *
 * Requer opt-in duplo:
 *   SUPABASE_PROJECT_ENV=prod
 *   --confirm=PROBE_PROD_DATA_API
 * e E2E_USER_EMAIL/E2E_USER_PASSWORD de uma conta explicitamente descartável.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { assertProdContext } from './_env';

const CONFIRMATION = 'PROBE_PROD_DATA_API';
const MARKER = '[GO-LIVE] Data API authorization probe';

type ProbeResult = {
  projectRef: string;
  role: string;
  aal: string;
  clinicsStatus: number;
  clinicsCode: string | null;
  visibleClinicRows: number;
  insertStatus: number;
  insertCode: string | null;
  updateStatus: number;
  updateRows: number;
  deleteStatus: number;
  deleteRows: number;
  cleanupRows: number;
};

function confirmation(): string | undefined {
  return process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
}

function projectRefFromDatabaseUrl(databaseUrl: string): string {
  const username = decodeURIComponent(new URL(databaseUrl).username);
  const projectRef = username.split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
    throw new Error('[data-api-probe] não foi possível derivar o project ref do banco PROD');
  }
  return projectRef;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('[data-api-probe] access token malformado');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function decodeSessionCookie(value: string): { access_token: string } {
  if (!value.startsWith('base64-')) {
    throw new Error('[data-api-probe] formato inesperado do cookie Auth');
  }
  const parsed = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
  };
  if (typeof parsed.access_token !== 'string') {
    throw new Error('[data-api-probe] access token ausente no cookie Auth');
  }
  return { access_token: parsed.access_token };
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function main(): Promise<void> {
  if (confirmation() !== CONFIRMATION) {
    throw new Error(`[data-api-probe] confirmação obrigatória: --confirm=${CONFIRMATION}`);
  }
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('[data-api-probe] E2E_USER_EMAIL/E2E_USER_PASSWORD são obrigatórios');
  }

  const { databaseUrl } = assertProdContext();
  const projectRef = projectRefFromDatabaseUrl(databaseUrl);
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!adminSecret) {
    throw new Error('[data-api-probe] SUPABASE_SECRET_KEY_PROD é obrigatória para o cleanup');
  }
  const admin = createClient(`https://${projectRef}.supabase.co`, adminSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const patientId = randomUUID();
  let clinicId = '';
  let fixtureMayExist = false;
  const result: ProbeResult = {
    projectRef,
    role: '',
    aal: '',
    clinicsStatus: 0,
    clinicsCode: null,
    visibleClinicRows: -1,
    insertStatus: 0,
    insertCode: null,
    updateStatus: 0,
    updateRows: -1,
    deleteStatus: 0,
    deleteRows: -1,
    cleanupRows: 0,
  };

  try {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: 'https://app.qoro.dev' });
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });

      // O login é uma Server Action, portanto a chave pública não passa pelo
      // browser nessa requisição. /consultorio carrega o cliente Realtime; a
      // chave publishable já é pública nesse chunk. Mantemos o valor somente em
      // memória e exigimos que o mesmo chunk contenha a URL do projeto PROD.
      await page.goto('/consultorio', { waitUntil: 'networkidle' });
      const scriptUrls = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .filter(
            (entry): entry is PerformanceResourceTiming =>
              'initiatorType' in entry && entry.initiatorType === 'script',
          )
          .map((entry) => entry.name),
      );
      let apiKey = '';
      for (const scriptUrl of scriptUrls) {
        const script = await context.request.get(scriptUrl);
        const source = await script.text();
        if (!source.includes(`${projectRef}.supabase.co`)) continue;
        apiKey = source.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? '';
        if (apiKey) break;
      }
      if (!apiKey) throw new Error('[data-api-probe] publishable key não observada no login');

      const cookies = (await context.cookies())
        .filter((cookie) => cookie.name.includes('auth-token'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const session = decodeSessionCookie(cookies.map((cookie) => cookie.value).join(''));
      const claims = decodeJwtPayload(session.access_token);
      clinicId = typeof claims.clinic_id === 'string' ? claims.clinic_id : '';
      result.role = typeof claims.role === 'string' ? claims.role : '';
      result.aal = typeof claims.aal === 'string' ? claims.aal : '';
      const expectedIssuer = `https://${projectRef}.supabase.co/auth/v1`;
      if (!clinicId || claims.iss !== expectedIssuer || result.role !== 'authenticated') {
        throw new Error('[data-api-probe] JWT não pertence ao tenant/projeto PROD esperado');
      }

      const baseUrl = `https://${projectRef}.supabase.co/rest/v1`;
      const headers = {
        apikey: apiKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      };
      const clinicsResponse = await fetch(`${baseUrl}/clinics?select=id`, { headers });
      const clinicsBody = await responseBody(clinicsResponse);
      result.clinicsStatus = clinicsResponse.status;
      result.clinicsCode =
        clinicsResponse.ok || !clinicsBody || typeof clinicsBody !== 'object'
          ? null
          : String(Reflect.get(clinicsBody, 'code') ?? 'unknown');
      result.visibleClinicRows = Array.isArray(clinicsBody) ? clinicsBody.length : -1;

      const insertResponse = await fetch(`${baseUrl}/patients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: patientId,
          clinic_id: clinicId,
          nome: MARKER,
          cpf_encrypted: 'fixture-non-pii',
          cpf_hash: randomBytes(32).toString('hex'),
        }),
      });
      result.insertStatus = insertResponse.status;
      const insertBody = await responseBody(insertResponse);
      fixtureMayExist = insertResponse.ok;
      result.insertCode =
        insertResponse.ok || !insertBody || typeof insertBody !== 'object'
          ? null
          : String(Reflect.get(insertBody, 'code') ?? 'unknown');

      const updateResponse = await fetch(`${baseUrl}/patients?id=eq.${patientId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ nome: `${MARKER} updated` }),
      });
      result.updateStatus = updateResponse.status;
      const updateBody = await responseBody(updateResponse);
      result.updateRows = Array.isArray(updateBody) ? updateBody.length : -1;

      const deleteResponse = await fetch(`${baseUrl}/patients?id=eq.${patientId}`, {
        method: 'DELETE',
        headers,
      });
      result.deleteStatus = deleteResponse.status;
      const deleteBody = await responseBody(deleteResponse);
      result.deleteRows = Array.isArray(deleteBody) ? deleteBody.length : -1;
      if (deleteResponse.ok && result.deleteRows === 1) fixtureMayExist = false;
    } finally {
      await browser.close();
    }
  } finally {
    // Data API desabilitada nega o INSERT e, portanto, não há fixture para
    // remover. O cliente admin só é usado se a resposta indicar que a linha
    // pode ter sido criada; assim o próprio cleanup não depende de uma API que
    // o gate espera encontrar desligada.
    if (clinicId && fixtureMayExist) {
      const { data: cleaned, error: cleanupError } = await admin
        .from('patients')
        .delete()
        .eq('id', patientId)
        .eq('clinic_id', clinicId)
        .like('nome', `${MARKER}%`)
        .select('id');
      if (cleanupError) {
        throw new Error(`[data-api-probe] cleanup falhou: ${cleanupError.code}`);
      }
      result.cleanupRows = cleaned?.length ?? 0;
    }
    console.log(JSON.stringify(result));
  }

  const writeStatuses = [result.insertStatus, result.updateStatus, result.deleteStatus];
  if (writeStatuses.some((status) => status >= 200 && status < 300)) {
    throw new Error(
      '[data-api-probe] FAIL: Data API aceitou mutação direta e contornou a camada de aplicação',
    );
  }
  if (
    result.visibleClinicRows !== -1 ||
    result.clinicsStatus < 400 ||
    result.clinicsStatus >= 500 ||
    writeStatuses.some((status) => status < 400 || status >= 500)
  ) {
    throw new Error(
      '[data-api-probe] INCONCLUSIVO: resposta não prova que a Data API está desabilitada',
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
