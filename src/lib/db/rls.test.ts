import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy, normalizeAndAssertIdent, setUpdatedAtTrigger } from './rls';

describe('rls — normalizeAndAssertIdent (D23 + D30)', () => {
  it('lowercases input before validation', () => {
    expect(normalizeAndAssertIdent('table', 'Clinic_Units')).toBe('clinic_units');
    expect(normalizeAndAssertIdent('table', 'CLINICS')).toBe('clinics');
  });

  it('trims whitespace before validation', () => {
    expect(normalizeAndAssertIdent('table', '  clinic_units  ')).toBe('clinic_units');
    expect(normalizeAndAssertIdent('column', '\tclinic_id\n')).toBe('clinic_id');
  });

  it('rejects SQL injection attempts via table name', () => {
    expect(() => normalizeAndAssertIdent('table', 'clinic_units; DROP TABLE x; --')).toThrow(
      /invalid table identifier/,
    );
    expect(() => normalizeAndAssertIdent('table', 'clinic_units" OR 1=1; --')).toThrow(
      /invalid table identifier/,
    );
  });

  it('rejects names starting with digits', () => {
    expect(() => normalizeAndAssertIdent('table', '1clinics')).toThrow(/invalid table identifier/);
  });

  it('rejects names with hyphens (Postgres needs quoting)', () => {
    expect(() => normalizeAndAssertIdent('table', 'clinic-units')).toThrow(
      /invalid table identifier/,
    );
  });

  it('rejects empty string', () => {
    expect(() => normalizeAndAssertIdent('table', '')).toThrow(/invalid table identifier/);
  });

  it('accepts underscore prefix (matches _reserved_slugs)', () => {
    expect(normalizeAndAssertIdent('table', '_reserved_slugs')).toBe('_reserved_slugs');
  });
});

describe('rls — defaultTenantPolicy (D2 + D5 + D22 + D27 + D28 + D33)', () => {
  it('emits the GENERATED_BY fingerprint as first line', () => {
    const sql = defaultTenantPolicy('clinic_units');
    expect(sql.startsWith('-- GENERATED_BY: defaultTenantPolicy(v1)')).toBe(true);
  });

  it('ENABLE + FORCE RLS on the target table (D5)', () => {
    const sql = defaultTenantPolicy('clinic_units');
    expect(sql).toContain('ALTER TABLE clinic_units ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE clinic_units FORCE  ROW LEVEL SECURITY;');
  });

  it('emits dual-context predicate (GUC OR JWT) plus super_admin (D22)', () => {
    const sql = defaultTenantPolicy('clinic_units');
    expect(sql).toContain("current_setting('app.current_clinic', true)");
    expect(sql).toContain('current_clinic_id()');
    expect(sql).toContain('is_super_admin()');
  });

  it('mirrors USING in WITH CHECK (writes share isolation predicate)', () => {
    const sql = defaultTenantPolicy('clinic_units');
    const usingMatches = sql.match(/USING \(/g) ?? [];
    const checkMatches = sql.match(/WITH CHECK \(/g) ?? [];
    expect(usingMatches).toHaveLength(1);
    expect(checkMatches).toHaveLength(1);
  });

  it('does NOT enforce role-based predicate (D27 — RLS is not RBAC)', () => {
    const sql = defaultTenantPolicy('clinic_units');
    expect(sql).not.toMatch(/role\s+IN\s*\(\s*'gestor'/);
    expect(sql).not.toMatch(/role\s+=\s*'gestor'/);
    expect(sql).not.toMatch(/role\s+=\s*'owner'/);
    expect(sql).not.toMatch(/role\s+=\s*'doctor'/);
  });

  it('does NOT use TO authenticated (D25 — keeps policy role-agnostic)', () => {
    const sql = defaultTenantPolicy('clinic_units');
    expect(sql).not.toContain('TO authenticated');
    expect(sql).not.toContain('TO anon');
  });

  it('uses default tenant column clinic_id when not overridden', () => {
    const sql = defaultTenantPolicy('appointments');
    expect(sql).toContain('clinic_id::text =');
  });

  it('respects custom tenantColumn (used by clinics where the column is `id`)', () => {
    const sql = defaultTenantPolicy('clinics', { tenantColumn: 'id' });
    expect(sql).toContain('id::text = current_setting');
    expect(sql).not.toMatch(/clinic_id::text/);
  });

  it('respects custom policyName', () => {
    const sql = defaultTenantPolicy('clinic_units', { policyName: 'clinic_units_custom_x' });
    expect(sql).toContain('CREATE POLICY clinic_units_custom_x ON clinic_units');
  });

  it('normalizes table name via lowercase before SQL generation (D23)', () => {
    const lower = defaultTenantPolicy('clinic_units');
    const mixed = defaultTenantPolicy('Clinic_Units');
    expect(mixed).toBe(lower);
  });

  it('normalizes whitespace via trim before SQL generation (D30)', () => {
    const clean = defaultTenantPolicy('clinic_units');
    const padded = defaultTenantPolicy('  clinic_units  ');
    expect(padded).toBe(clean);
  });

  it('rejects SQL injection via table name', () => {
    expect(() => defaultTenantPolicy('clinic_units; DROP TABLE x; --')).toThrow(
      /invalid table identifier/,
    );
  });

  it('rejects SQL injection via tenantColumn', () => {
    expect(() =>
      defaultTenantPolicy('clinic_units', { tenantColumn: "1; DROP TABLE x; --" }),
    ).toThrow(/invalid column identifier/);
  });

  it('rejects SQL injection via policyName', () => {
    expect(() => defaultTenantPolicy('clinic_units', { policyName: 'x; DROP' })).toThrow(
      /invalid policy identifier/,
    );
  });
});

describe('rls — setUpdatedAtTrigger', () => {
  it('emits a trigger calling the shared set_updated_at function', () => {
    const sql = setUpdatedAtTrigger('clinics');
    expect(sql).toBe(
      'CREATE TRIGGER trg_clinics_updated_at BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    );
  });

  it('rejects invalid identifiers', () => {
    expect(() => setUpdatedAtTrigger('clinics; DROP --')).toThrow(/invalid table identifier/);
  });

  it('normalizes input (D23 + D30)', () => {
    expect(setUpdatedAtTrigger('  CLINICS  ')).toBe(setUpdatedAtTrigger('clinics'));
  });
});
