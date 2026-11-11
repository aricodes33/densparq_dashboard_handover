import { describe, expect, it } from 'vitest';
import { journey, type JourneyInput } from './journey';

const base: JourneyInput = { setupIssues: [], rulesPublished: true, published: true, archived: false, finished: false, regOpensAt: '2026-11-01T00:00:00Z', regClosesAt: '2026-11-20T00:00:00Z', now: Date.parse('2026-11-25T00:00:00Z'),
  entries: { confirmed: 16, pending: 0, capacity: 16 }, categories: 1, categoriesWithPublishedFixtures: 1, matches: { total: 15, finished: 15, unverified: 0 } };
const now = (i: Partial<JourneyInput>) => journey({ ...base, ...i }).find(s => s.status === 'now')?.key;

describe('tournament journey', () => {
  it('starts at setup and points at the first failing step', () => {
    const j = journey({ ...base, setupIssues: [{ label: 'Courts assigned', step: 6 }], rulesPublished: false, published: false, categoriesWithPublishedFixtures: 0, matches: { total: 0, finished: 0, unverified: 0 } });
    expect(j[0]).toMatchObject({ status: 'now', cta: { to: 'setup?step=6' } }); expect(j.slice(1).every(s => s.status === 'later')).toBe(true);
  });
  it('walks the stages in order', () => {
    expect(now({ rulesPublished: false })).toBe('rules');
    expect(now({ published: false })).toBe('publish');
    expect(now({ categoriesWithPublishedFixtures: 0, now: Date.parse('2026-11-10T00:00:00Z') })).toBe('entries'); // registration still open
    expect(now({ categoriesWithPublishedFixtures: 0 })).toBe('fixtures');
    expect(now({ matches: { total: 15, finished: 15, unverified: 2 } })).toBe('play');
    expect(now({})).toBe('finish');
    expect(now({ finished: true })).toBeUndefined();
  });
});
