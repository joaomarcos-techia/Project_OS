/** Read-only availability check; it does not authenticate or record page content. */
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.QORO_ENV_PATH ?? '.env.local' });

const targets = [
  'https://project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app/oferta-preview',
  'https://landing-page-git-preview-pricing-05406a-clinic-os-v2-s-projects.vercel.app/precos-preview',
];

async function main(): Promise<void> {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  for (const target of targets) {
    const response = await fetch(target, {
      ...(bypass ? { headers: { 'x-vercel-protection-bypass': bypass } } : {}),
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    const redirect = location ? new URL(location, target) : null;
    console.log(
      `${new URL(target).hostname}: HTTP ${response.status}, redirect=${redirect ? `${redirect.hostname}${redirect.pathname}` : 'none'}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'Preview probe failed');
  process.exitCode = 1;
});
