import { describe, expect, it } from 'vitest';

import {
  BACKUP_EXCLUDED_SCHEMAS,
  backupConnectionEnv,
} from '../../../scripts/prod-encrypted-backup';

describe('production backup recovery contract', () => {
  it('includes Auth alongside public while excluding service-managed Storage', () => {
    expect(BACKUP_EXCLUDED_SCHEMAS).not.toContain('auth');
    expect(BACKUP_EXCLUDED_SCHEMAS).not.toContain('public');
    expect(BACKUP_EXCLUDED_SCHEMAS).toContain('storage');
  });

  it('configures a read-only, SSL-protected backup connection', () => {
    const env = backupConnectionEnv(
      'postgresql://operator:example-password@db.example.com:5432/postgres',
    );
    expect(env.PGHOST).toBe('db.example.com');
    expect(env.PGUSER).toBe('operator');
    expect(env.PGDATABASE).toBe('postgres');
    expect(env.PGOPTIONS).toContain('default_transaction_read_only=on');
    expect(env.PGSSLMODE).toBe('require');
  });
});
