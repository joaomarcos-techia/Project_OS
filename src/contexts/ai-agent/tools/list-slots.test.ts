import { describe, expect, it } from 'vitest';

import { normalizeSlotWindow } from './list-slots';

const now = new Date('2026-08-13T22:24:18.000Z');

describe('normalizeSlotWindow', () => {
  it('rejeita uma janela inteiramente passada', () => {
    expect(
      normalizeSlotWindow(
        new Date('2026-07-31T12:00:00.000Z'),
        new Date('2026-07-31T15:00:00.000Z'),
        now,
      ),
    ).toBeNull();
  });

  it('corta o início de uma janela que começou no passado', () => {
    const window = normalizeSlotWindow(
      new Date('2026-08-13T20:00:00.000Z'),
      new Date('2026-08-14T12:00:00.000Z'),
      now,
    );
    expect(window?.from.toISOString()).toBe('2026-08-13T22:24:18.000Z');
    expect(window?.to.toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });
});
