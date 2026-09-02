import { describe, expect, it } from 'vitest';

import { nextConfig } from '../../../next.config';

import { CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT, CLINIC_LOGO_MAX_BYTES } from './clinic-logo-policy';

describe('política de upload do logo da clínica', () => {
  it('configura a Server Action acima do arquivo e abaixo do teto da Vercel', () => {
    const actionBodyLimitBytes = 4.25 * 1024 * 1024;
    const vercelFunctionLimitBytes = 4.5 * 1024 * 1024;

    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(
      CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT,
    );
    expect(CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT).toBe('4.25mb');
    expect(CLINIC_LOGO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(actionBodyLimitBytes).toBeGreaterThan(CLINIC_LOGO_MAX_BYTES);
    expect(actionBodyLimitBytes).toBeLessThan(vercelFunctionLimitBytes);
  });
});
