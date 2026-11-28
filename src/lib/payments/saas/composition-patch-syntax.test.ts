import { describe, expect, it } from 'vitest';
import { assertCompositionPatchSyntax } from '../../../../scripts/security/composition-patch-syntax';

describe('composition patch syntax gate', () => {
  it('accepts a complete typed SQL template followed by the payment proof', () => {
    expect(() =>
      assertCompositionPatchSyntax(
        'fixture.ts',
        'const rows = sql<{ id: string }[]>`SELECT id FROM subscriptions`;\nassert.ok(rows);',
      ),
    ).not.toThrow();
  });
  it('rejects the observed patch insertion inside an unfinished SQL template', () => {
    expect(() =>
      assertCompositionPatchSyntax(
        'fixture.ts',
        'const query = sql`UPDATE subscriptions SET status=active\nconst [sub] = sql<{id:string}[]>`SELECT id`;\nWHERE true`;',
      ),
    ).toThrow('invalid TypeScript syntax');
  });
  it('does not mistake this syntax gate for a typecheck', () => {
    expect(() =>
      assertCompositionPatchSyntax('fixture.ts', 'const amount: number = "invalid";'),
    ).not.toThrow();
  });
});
