import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';
import { vercelBypassHeaders } from './vercel-bypass';

const authStatePath = path.join('.playwright', '.auth', 'user.json');

async function existingAuthState(): Promise<string | undefined> {
  try {
    await access(authStatePath);
    return authStatePath;
  } catch {
    return undefined;
  }
}

export default async function setupAuthenticatedE2E(): Promise<void> {
  if (!hasE2ECredentials()) {
    throw new Error('E2E_AUTH_REUSE=1 requires E2E_USER_EMAIL and E2E_USER_PASSWORD.');
  }

  const baseUrl = process.env.E2E_BASE_URL;
  if (!baseUrl) {
    throw new Error('E2E_AUTH_REUSE=1 requires E2E_BASE_URL.');
  }

  await mkdir(path.dirname(authStatePath), { recursive: true });
  const browser = await chromium.launch();
  try {
    const storageState = await existingAuthState();
    const context = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: vercelBypassHeaders(),
      ...(storageState ? { storageState } : {}),
    });
    try {
      const page = await context.newPage();
      await authenticate(page);
      await context.storageState({ path: authStatePath });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
