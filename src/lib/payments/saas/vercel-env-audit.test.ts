import { describe, expect, it } from 'vitest';
import {
  billingEnvironmentName,
  effectiveVercelVariable,
  sanitizedVercelVariables,
} from '../../../../scripts/abacatepay-vercel-env-audit';

describe('read-only Vercel billing metadata audit', () => {
  const branch = 'feat/billing-abacatepay-20261107';
  const sample = {
    id: 'general',
    key: 'ABACATEPAY_API_KEY',
    type: 'encrypted',
    target: ['preview'],
    gitBranch: null,
    updatedAt: 1,
    value: 'secret-must-never-be-persisted',
    createdBy: 'private-actor',
  };
  it('strips secret and unrelated response fields before any report is built', () => {
    const rows = sanitizedVercelVariables({ envs: [sample], token: 'another-secret' });
    expect(JSON.stringify(rows)).not.toContain(sample.value);
    expect(rows[0]).not.toHaveProperty('createdBy');
    expect(JSON.stringify(rows)).not.toContain('another-secret');
  });
  it('chooses branch Preview configuration over a more recently changed general key', () => {
    const rows = sanitizedVercelVariables({
      envs: [
        { ...sample, updatedAt: 20 },
        { ...sample, id: 'specific', gitBranch: branch, updatedAt: 10 },
      ],
    });
    expect(effectiveVercelVariable(rows, sample.key, 'preview', branch)).toEqual({
      status: 'configured',
      scope: 'branch',
      ids: ['specific'],
      updatedAt: 10,
    });
  });
  it('never treats a different branch key as effective or copies Preview presence to Production', () => {
    const rows = sanitizedVercelVariables({ envs: [{ ...sample, gitBranch: 'unrelated-ui' }] });
    expect(effectiveVercelVariable(rows, sample.key, 'preview', branch).status).toBe('absent');
    expect(effectiveVercelVariable(rows, sample.key, 'production', branch).status).toBe('absent');
  });
  it('reports conflicting metadata explicitly rather than silently choosing an arbitrary key', () => {
    const rows = sanitizedVercelVariables({ envs: [sample, { ...sample, id: 'duplicate' }] });
    expect(effectiveVercelVariable(rows, sample.key, 'preview', branch).status).toBe('ambiguous');
  });
  it('falls back to the general declaration for Development and Preview when no override exists', () => {
    const rows = sanitizedVercelVariables({
      envs: [{ ...sample, target: ['preview', 'development'] }],
    });
    expect(effectiveVercelVariable(rows, sample.key, 'development', branch)).toMatchObject({
      status: 'configured',
      scope: 'general',
      ids: ['general'],
    });
    expect(effectiveVercelVariable(rows, sample.key, 'preview', branch)).toMatchObject({
      status: 'configured',
      scope: 'general',
    });
  });
  it('finds unknown AbacatePay aliases for review without assuming they are consumed', () => {
    expect(billingEnvironmentName('NEXT_PUBLIC_ABACATEPAY_API_KEY')).toBe(true);
    expect(billingEnvironmentName('ABACATEPAY_ENV')).toBe(true);
    expect(billingEnvironmentName('GEMINI_API_KEY')).toBe(false);
  });
});
