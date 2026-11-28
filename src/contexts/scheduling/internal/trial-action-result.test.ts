import { describe, expect, it } from 'vitest';
import { TrialAccessError } from '@/lib/trial-access/policy';
import { toActionResult } from './action-result';

describe('schedule quota feedback', () => {
  it('keeps a known quota denial out of the production exception boundary', async () => {
    const error = new TrialAccessError('resources');
    expect(
      await toActionResult(async () => {
        throw error;
      }),
    ).toEqual({ ok: false, message: error.message });
  });
  it('does not swallow an unrelated database failure', async () => {
    const error = new Error('synthetic outage');
    await expect(
      toActionResult(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
