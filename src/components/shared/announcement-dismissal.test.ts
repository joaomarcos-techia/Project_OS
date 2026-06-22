import { describe, expect, it } from 'vitest';

import { addSeen, parseSeen, shouldShowAnnouncement } from './announcement-dismissal';

describe('announcement dismissal (pop-up único)', () => {
  it('mostra quando ainda não foi visto', () => {
    expect(shouldShowAnnouncement('a', [])).toBe(true);
    expect(shouldShowAnnouncement('a', ['b'])).toBe(true);
  });
  it('não mostra quando já foi visto', () => {
    expect(shouldShowAnnouncement('a', ['a'])).toBe(false);
  });
  it('id vazio nunca mostra', () => {
    expect(shouldShowAnnouncement('', [])).toBe(false);
  });
  it('addSeen é idempotente e capa o histórico em 50', () => {
    expect(addSeen([], 'a')).toEqual(['a']);
    expect(addSeen(['a'], 'a')).toEqual(['a']);
    const many = Array.from({ length: 60 }, (_, i) => `id${i}`);
    const out = addSeen(many, 'novo');
    expect(out.length).toBe(50);
    expect(out[out.length - 1]).toBe('novo');
  });
  it('parseSeen tolera null/lixo/JSON inválido', () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen('not-json')).toEqual([]);
    expect(parseSeen('{"a":1}')).toEqual([]);
    expect(parseSeen('["a","b",1]')).toEqual(['a', 'b']);
  });
});
