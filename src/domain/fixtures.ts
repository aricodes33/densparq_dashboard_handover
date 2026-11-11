// Fixture generation, scheduling and clash detection. Pure functions: the backend should port these as-is
// (see docs/business-rules.md §4). No I/O, no Date.now().
import type { Category, Clash, Court, ID, Match, ScheduleConfig, Slot, Registration } from './types';

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const GROUPS = 'ABCDEFGHIJKLMNOP';

/** Circle method. Returns rounds of [home, away]; null = bye (pair is dropped). */
export function roundRobin<T>(entries: T[], legs: 1 | 2 = 1): [T, T][][] {
  const list: (T | null)[] = [...entries];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds: [T, T][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a !== null && b !== null) round.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop()!); // rotate all but the first
  }
  return legs === 2 ? [...rounds, ...rounds.map(rd => rd.map(([a, b]) => [b, a] as [T, T]))] : rounds;
}

/** Snake draw: seeds 1..n spread so top seeds land in different groups. */
export function groupDraw<T>(seeded: T[], groups: number): T[][] {
  const out: T[][] = Array.from({ length: groups }, () => []);
  seeded.forEach((e, i) => { const row = Math.floor(i / groups), col = i % groups; out[row % 2 ? groups - 1 - col : col].push(e); });
  return out;
}

/** Standard bracket order for size n (power of 2): seed positions, e.g. 8 -> [1,8,4,5,2,7,3,6]. */
export function bracketOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) { const m = order.length * 2 + 1; order = order.flatMap(s => [s, m - s]); }
  return order;
}
const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
const ROUND_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Round of 16', 32: 'Round of 32' };

/** Knockout bracket from ordered slots (index 0 = seed 1). Byes go to top seeds. */
export function knockout(tournamentId: ID, cat: Category, slots: Slot[], durationMin: number, startRound = 1, thirdPlace = false): Match[] {
  const size = nextPow2(slots.length), order = bracketOrder(size), matches: Match[] = [];
  const at = (seed: number): Slot => slots[seed - 1] ?? { kind: 'bye' };
  let prev: Match[] = [];
  for (let s = size, r = startRound; s >= 2; s /= 2, r++) {
    const cur: Match[] = [];
    for (let i = 0; i < s / 2; i++) {
      const home: Slot = prev.length ? { kind: 'winner', matchId: prev[i * 2].id } : at(order[i * 2]);
      const away: Slot = prev.length ? { kind: 'winner', matchId: prev[i * 2 + 1].id } : at(order[i * 2 + 1]);
      const label = ROUND_NAMES[s] ?? `Round ${r}`;
      cur.push(mk(tournamentId, cat, durationMin, { stage: 'knockout', round: r, roundName: label, home, away, code: s === 2 ? 'F' : `${({ 4: 'SF', 8: 'QF' } as Record<number, string>)[s] ?? `R${s}-`}${i + 1}` }));
    }
    matches.push(...cur); prev = cur;
  }
  if (thirdPlace && size >= 4) {
    const semis = matches.filter(m => m.roundName === 'Semi-final');
    matches.push(mk(tournamentId, cat, durationMin, { stage: 'knockout', round: matches[matches.length - 1].round, roundName: 'Third place', code: '3P', home: { kind: 'loser', matchId: semis[0].id }, away: { kind: 'loser', matchId: semis[1].id } }));
  }
  return resolveByes(matches);
}

/** A first-round match against a bye is a walkover; the entry advances immediately. */
function resolveByes(ms: Match[]): Match[] {
  for (const m of ms) {
    if (m.round !== ms[0].round || m.stage !== 'knockout') continue;
    const hb = m.home.kind === 'bye', ab = m.away.kind === 'bye';
    if (hb !== ab) {
      const adv = hb ? m.away : m.home;
      m.status = 'walkover';
      m.result = { homeScore: 0, awayScore: 0, detail: 'Bye', isDraw: false, winnerId: adv.kind === 'entry' ? adv.regId : undefined, verification: 'verified', submittedBy: 'system', submittedAt: '', source: 'manual' };
      for (const n of ms) for (const side of ['home', 'away'] as const) {
        const sl = n[side]; if (sl.kind === 'winner' && sl.matchId === m.id) n[side] = adv;
      }
    }
  }
  for (const m of ms) { if (m.home.kind === 'entry') m.homeId = m.home.regId; if (m.away.kind === 'entry') m.awayId = m.away.regId; }
  return ms;
}

function mk(tournamentId: ID, cat: Category, durationMin: number, p: Partial<Match> & Pick<Match, 'stage' | 'round' | 'roundName' | 'home' | 'away' | 'code'>): Match {
  return { id: uid('m'), tournamentId, categoryId: cat.id, durationMin, status: 'scheduled', refereeIds: [], fixturesVersion: 0, published: false, ...p,
    homeId: p.home.kind === 'entry' ? p.home.regId : undefined, awayId: p.away.kind === 'entry' ? p.away.regId : undefined };
}

/** Generate all matches for a category from confirmed entries (ordered by seed when seeding = 'seeded'). */
export function generateFixtures(tournamentId: ID, cat: Category, entries: Registration[], durationMin: number, rand: () => number = Math.random): Match[] {
  const f = cat.format;
  const ordered = f.seeding === 'seeded' ? [...entries].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999)) : shuffle(entries, rand);
  const slots = ordered.map<Slot>(e => ({ kind: 'entry', regId: e.id }));
  if (f.type === 'knockout') return knockout(tournamentId, cat, slots, durationMin, 1, f.thirdPlace);
  if (f.type === 'custom') return []; // custom formats: organizer adds matches manually
  const groups = f.type === 'group_knockout' ? groupDraw(slots, Math.max(1, f.groups)) : [slots];
  const out: Match[] = [];
  groups.forEach((g, gi) => {
    const gName = f.type === 'group_knockout' ? GROUPS[gi] : undefined;
    roundRobin(g, f.legs).forEach((round, ri) => round.forEach(([h, a], mi) => out.push(mk(tournamentId, cat, durationMin, {
      stage: gName ? 'group' : 'league', group: gName, round: ri + 1, roundName: `Round ${ri + 1}`,
      code: `${gName ?? 'L'}-R${ri + 1}-M${mi + 1}`, home: h, away: a,
    }))));
  });
  if (f.type === 'group_knockout') {
    // Cross-over: A1 v B2, B1 v A2 ... qualifiers ordered rank-major so group winners are top seeds.
    const q: Slot[] = [];
    for (let rank = 1; rank <= f.qualifiersPerGroup; rank++) {
      const gs = groups.map((_, gi) => GROUPS[gi]);
      (rank % 2 ? gs : [...gs].reverse()).forEach(g => q.push({ kind: 'group', group: g, rank }));
    }
    const lastRound = Math.max(...out.map(m => m.round), 0);
    out.push(...knockout(tournamentId, cat, q, durationMin, lastRound + 1, f.thirdPlace));
  }
  return out;
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b;
}

// ---------- scheduling ----------
export interface Busy { courtId: ID; start: number; end: number; label: string }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const IST = 330; // minutes; venue-local day window is evaluated in IST

/** Greedy scheduler: earliest court-slot per match in round order, respecting day window, buffers, rest gaps and busy blocks. */
export function schedule(matches: Match[], courts: Court[], cfg: ScheduleConfig, startDate: string, endDate: string, busy: Busy[] = []): Match[] {
  const dayStart = toMin(cfg.dayStart), dayEnd = toMin(cfg.dayEnd), step = 15;
  const occupied: Busy[] = [...busy];
  const teamFree = new Map<ID | string, number>(); // key -> earliest ms it can play again
  const d0 = Date.parse(`${startDate}T00:00:00Z`) - IST * 60000, d1 = Date.parse(`${endDate}T00:00:00Z`) - IST * 60000;
  const sorted = [...matches].sort((a, b) => a.round - b.round || (a.stage === 'knockout' ? 1 : 0) - (b.stage === 'knockout' ? 1 : 0));
  let floor = 0; // knockout rounds start after every earlier-round match has ended
  const roundEnd = new Map<number, number>();
  for (const m of sorted) {
    if (m.status === 'walkover' && m.result?.detail === 'Bye') continue;
    const len = (m.durationMin + cfg.bufferMinutes) * 60000;
    const keys = [m.homeId ?? slotKey(m.home), m.awayId ?? slotKey(m.away)];
    const mustAfter = Math.max(...keys.map(k => teamFree.get(k) ?? 0), m.stage === 'knockout' ? (roundEnd.get(m.round - 1) ?? floor) : 0);
    let placed = false;
    for (let day = d0; day <= d1 && !placed; day += 86400000) {
      for (let t = dayStart; t + m.durationMin <= dayEnd && !placed; t += step) {
        const s = day + t * 60000; if (s < mustAfter) continue;
        for (const c of courts) {
          if (occupied.some(b => b.courtId === c.id && s < b.end && s + len > b.start)) continue;
          m.courtId = c.id; m.startAt = new Date(s).toISOString();
          occupied.push({ courtId: c.id, start: s, end: s + len, label: m.code });
          keys.forEach(k => teamFree.set(k, s + len + cfg.minRestMinutes * 60000));
          roundEnd.set(m.round, Math.max(roundEnd.get(m.round) ?? 0, s + len));
          floor = Math.max(floor, s + len); placed = true; break;
        }
      }
    }
    if (!placed) { m.courtId = undefined; m.startAt = undefined; }
  }
  return matches;
}
const slotKey = (s: Slot) => s.kind === 'entry' ? s.regId : s.kind === 'group' ? `${s.group}${s.rank}` : s.kind === 'bye' ? `bye_${Math.random()}` : `${s.kind}:${s.matchId}`;

/** Every clash the UI must show before publish. Publishing is blocked while any court/team overlap remains. */
export function detectClashes(matches: Match[], cfg: ScheduleConfig, busy: Busy[] = []): Clash[] {
  const out: Clash[] = [];
  const live = matches.filter(m => !['abandoned', 'walkover', 'postponed'].includes(m.status));
  const span = (m: Match) => { const s = Date.parse(m.startAt!); return [s, s + (m.durationMin + cfg.bufferMinutes) * 60000] as const; };
  for (const m of live) {
    if (!m.startAt || !m.courtId) { out.push({ matchId: m.id, kind: 'unscheduled', message: `${m.code} has no court or time` }); continue; }
    const [s, e] = span(m);
    const local = ((new Date(s).getUTCHours() * 60 + new Date(s).getUTCMinutes() + IST) % 1440);
    if (local < toMin(cfg.dayStart) || local + m.durationMin > toMin(cfg.dayEnd)) out.push({ matchId: m.id, kind: 'outside_window', message: `${m.code} is outside ${cfg.dayStart}–${cfg.dayEnd}` });
    for (const b of busy) if (b.courtId === m.courtId && s < b.end && e > b.start) out.push({ matchId: m.id, kind: 'venue_busy', message: `${m.code} overlaps ${b.label}` });
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j]; if (!a.startAt || !b.startAt) continue;
    const [as, ae] = span(a), [bs, be] = span(b);
    if (a.courtId === b.courtId && as < be && bs < ae) out.push({ matchId: a.id, otherId: b.id, kind: 'court_overlap', message: `${a.code} and ${b.code} share a court at the same time` });
    const shared = [a.homeId, a.awayId].filter(x => x && (x === b.homeId || x === b.awayId));
    if (shared.length) {
      const rest = cfg.minRestMinutes * 60000;
      if (as < be && bs < ae) out.push({ matchId: a.id, otherId: b.id, kind: 'team_overlap', message: `${a.code} and ${b.code} need the same entry at once` });
      else if (Math.min(Math.abs(bs - ae), Math.abs(as - be)) < rest) out.push({ matchId: a.id, otherId: b.id, kind: 'rest_gap', message: `Under ${cfg.minRestMinutes} min rest between ${a.code} and ${b.code}` });
    }
  }
  return out;
}
export const blockingClash = (c: Clash) => c.kind === 'court_overlap' || c.kind === 'team_overlap' || c.kind === 'venue_busy';
