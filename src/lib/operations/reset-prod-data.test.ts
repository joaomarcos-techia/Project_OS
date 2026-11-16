import { describe, expect, it } from 'vitest';

import {
  RESET_CONFIRMATION,
  TRANSIENT_TABLES,
  assertApplyArgs,
  isPreservedSuperAdmin,
  parseResetArgs,
} from '../../../scripts/reset-prod-data';

const USER_ID = '5d7da268-292b-4035-9fc0-972232dd7234';

describe('reset-prod-data guards', () => {
  it('defaults to dry-run and requires the exact preserved user id', () => {
    expect(parseResetArgs(['--preserve-user-id', USER_ID])).toEqual({
      apply: false,
      confirmation: null,
      preserveUserId: USER_ID,
      help: false,
    });
  });

  it('rejects apply without the exact destructive confirmation', () => {
    const args = parseResetArgs(['--apply', '--preserve-user-id', USER_ID]);

    expect(() => assertApplyArgs(args)).toThrow(`--confirm=${RESET_CONFIRMATION}`);
  });

  it('accepts apply only with the confirmation phrase and a UUID', () => {
    const args = parseResetArgs([
      '--apply',
      `--confirm=${RESET_CONFIRMATION}`,
      `--preserve-user-id=${USER_ID}`,
    ]);

    expect(() => assertApplyArgs(args)).not.toThrow();
  });

  it('keeps the platform trail: super_admin_actions is never in the delete list (ADR-075)', () => {
    // With the append-only barrier applied, deleting it would abort the whole reset; without
    // the barrier, it would erase the record of what support did, including this reset.
    expect(TRANSIENT_TABLES).not.toContain('super_admin_actions');
  });

  it('refuses any profile that is not an active platform super-admin', () => {
    expect(
      isPreservedSuperAdmin({ id: USER_ID, role: 'owner', clinicId: null, deletedAt: null }),
    ).toBe(false);
    expect(
      isPreservedSuperAdmin({
        id: USER_ID,
        role: 'super_admin',
        clinicId: '3a0d5404-da94-4cc6-a30c-18dbd909ba1d',
        deletedAt: null,
      }),
    ).toBe(false);
    expect(
      isPreservedSuperAdmin({ id: USER_ID, role: 'super_admin', clinicId: null, deletedAt: null }),
    ).toBe(true);
  });
});
