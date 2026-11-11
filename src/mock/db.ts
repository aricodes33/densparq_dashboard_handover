// In-browser mock database + seed. Mirrors docs/schema.sql. Persisted to localStorage so demos survive reloads.
import { defaultScoring, summarize } from '@/domain/scoring';
import { generateFixtures, schedule, uid, type Busy } from '@/domain/fixtures';
import { LIVE, type VenueProfile, type CourtMeta, type Customer, type Booking, type Block, type RateRule, type Offer, type CustomerRate, type Plan, type VMembership, type Ledger, type Feedback, type FollowUp } from '@/domain/venue';
import { seedVenue } from './venueSeed';
import { seedAcademyCore, seedAcademyPeople } from './academySeed';
import { sessions, sessionSpan, type Academy, type Batch, type SessionChange, type Athlete, type Enrollment, type Attendance, type FeePlan, type Invoice, type MetricTemplate, type Assessment, type AthleteMatch, type Lead } from '@/domain/academy';
import type {
  AuditEntry, Category, Court, FormatConfig, Match, Membership, Notification, Organization, Player, Registration,
  RuleAck, RuleSection, RuleVersion, ScoreEvent, Sport, StandingOverride, PlayerStat, Tournament, User, Venue, VenueHold, Payment, Refund, Role,
} from '@/domain/types';

export interface DB {
  orgs: Organization[]; users: User[]; memberships: Membership[]; venues: Venue[]; courts: Court[];
  tournaments: Tournament[]; rules: RuleVersion[]; acks: RuleAck[]; players: Player[]; registrations: Registration[];
  payments: Payment[]; refunds: Refund[]; matches: Match[]; events: ScoreEvent[]; overrides: StandingOverride[];
  stats: PlayerStat[]; notifications: Notification[]; holds: VenueHold[]; audit: AuditEntry[]; templates: { id: string; name: string; sport: Sport | 'any'; sections: RuleSection[] }[];
  // venue management (src/domain/venue.ts)
  profiles: VenueProfile[]; courtMeta: CourtMeta[]; customers: Customer[]; bookings: Booking[]; blocks: Block[]; rateRules: RateRule[];
  offers: Offer[]; customerRates: CustomerRate[]; plans: Plan[]; vmemberships: VMembership[]; ledger: Ledger[]; feedback: Feedback[]; followUps: FollowUp[];
  // academy (src/domain/academy.ts)
  academies: Academy[]; batches: Batch[]; sessionChanges: SessionChange[]; athletes: Athlete[]; enrollments: Enrollment[]; attendance: Attendance[]; feePlans: FeePlan[]; invoices: Invoice[];
  metricTemplates: MetricTemplate[]; assessments: Assessment[]; athleteMatches: AthleteMatch[]; leads: Lead[]; notices: { id: string; athleteId: string; kind: 'attendance' | 'fee' | 'schedule' | 'report'; text: string; at: string; whatsapp: boolean }[];
}
const KEY = 'dsq-mock-db-v4';
let rng = 7;
const rand = () => { rng = (rng * 16807) % 2147483647; return (rng - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const NOW = new Date();
const iso = (d: Date) => d.toISOString();
const day = (offset: number) => { const d = new Date(NOW); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const at = (offsetDays: number, hhmm = '09:00') => new Date(`${day(offsetDays)}T${hhmm}:00+05:30`).toISOString();

export const SECTION_TITLES: [RuleSection['key'], string][] = [
  ['eligibility', 'Eligibility'], ['roster', 'Roster limits'], ['match_format', 'Match format'], ['scoring', 'Scoring'],
  ['points', 'Points'], ['tie_breakers', 'Tie-breakers'], ['fouls', 'Fouls'], ['penalties', 'Penalties'],
  ['protests', 'Protests'], ['walkovers', 'Walkovers'], ['cancellations', 'Cancellations'], ['refunds', 'Refunds'],
];
export const blankSections = (): RuleSection[] => SECTION_TITLES.map(([key, title]) => ({ key, title, html: '' }));

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Sneha', 'Karthik', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Priya', 'Nikhil', 'Kavya', 'Rahul', 'Ayesha', 'Farhan', 'Isha', 'Manoj', 'Sana', 'Deepak', 'Tara', 'Varun', 'Neha', 'Siddharth', 'Pooja', 'Aditya', 'Riya', 'Kiran', 'Lakshmi', 'Imran', 'Zoya'];
const LAST = ['K', 'R', 'S', 'M', 'P', 'N', 'T', 'B', 'G', 'V', 'J', 'A'];
const TEAMS = ['Yelahanka Strikers', 'Kannuru Kings', 'Hebbal Hawks', 'Jakkur Jaguars', 'Bagalur Bulls', 'Thanisandra Titans', 'Hennur Hurricanes', 'Devanahalli Dragons', 'Sahakar Smashers', 'Airport Road Aces', 'Kogilu Comets', 'Rajanukunte Rangers'];

function mkPlayer(db: DB, minor = false): Player {
  const dob = minor ? `${2012 + Math.floor(rand() * 2)}-0${1 + Math.floor(rand() * 8)}-1${Math.floor(rand() * 9)}` : `${1988 + Math.floor(rand() * 16)}-0${1 + Math.floor(rand() * 8)}-2${Math.floor(rand() * 8)}`;
  const p: Player = { id: uid('p'), name: `${pick(FIRST)} ${pick(LAST)}`, phone: `9${Math.floor(100000000 + rand() * 899999999)}`, dob, gender: rand() > 0.5 ? 'm' : 'f', statsVisibility: minor ? 'private' : 'public',
    guardian: minor ? { name: `${pick(FIRST)} ${pick(LAST)}`, phone: `98${Math.floor(10000000 + rand() * 89999999)}`, relation: 'Parent', consentAt: at(-6) } : undefined };
  db.players.push(p); return p;
}

const fmt = (type: FormatConfig['type'], groups = 1, q = 2, seeding: FormatConfig['seeding'] = 'random'): FormatConfig => ({ type, groups, qualifiersPerGroup: q, legs: 1, seeding, thirdPlace: false });

interface Spec {
  id: string; orgId: string; name: string; slug: string; sport: Sport; status: Tournament['status']; venueId: string | null; venueText?: string;
  start: number; end: number; courts: string[]; cats: Omit<Category, 'id' | 'tournamentId'>[]; entries: number[]; fixtures?: boolean; played?: number; liveOne?: boolean; minors?: boolean;
  description: string; matchMinutes: number;
}

function seedTournament(db: DB, s: Spec) {
  const t: Tournament = {
    id: s.id, orgId: s.orgId, slug: s.slug, name: s.name, sport: s.sport, status: s.status, venueId: s.venueId, venueText: s.venueText,
    organizerName: db.orgs.find(o => o.id === s.orgId)!.name, startDate: day(s.start), endDate: day(s.end),
    regOpensAt: at(s.start - 21), regClosesAt: at(s.start - 3, '23:59'), rosterCutoffAt: at(s.start - 2, '23:59'),
    contact: { name: 'Niko', phone: '9845012345', email: 'events@densparq.in' }, description: s.description,
    prizes: [{ place: 'Winner', description: 'Trophy + cash', amountPaise: 1500000 }, { place: 'Runner-up', description: 'Medals', amountPaise: 500000 }],
    courtIds: s.courts, categories: [],
    schedule: { matchMinutes: s.matchMinutes, bufferMinutes: 10, minRestMinutes: 20, dayStart: '07:00', dayEnd: '22:00', createVenueHolds: !!s.venueId && db.venues.find(v => v.id === s.venueId)!.isDensparq },
    registration: { requiredDocs: s.minors ? ['age_proof'] : [], guardianConsentUnder: 18, waitlist: true, allowLate: false, refundPolicy: 'percent_until_close', refundPercent: 80, duplicateCheck: 'phone' },
    scoring: defaultScoring(s.sport), staff: [{ userId: 'u_kiran', role: 'referee' }, { userId: 'u_divya', role: 'referee' }, { userId: 'u_asha', role: 'registration_manager' }],
    createdAt: at(s.start - 30), updatedAt: at(-1), publishedAt: s.status === 'published' ? at(s.start - 22) : undefined,
  };
  t.categories = s.cats.map((c, i) => ({ ...c, id: `${s.id}_c${i + 1}`, tournamentId: s.id }));
  db.tournaments.push(t);
  // rules v1 published (+ v2 draft for the first tournament)
  const sections = blankSections().map(x => ({ ...x, html: RULE_TEXT[x.key]?.(t) ?? '' }));
  if (s.status !== 'draft') db.rules.push({ id: `${s.id}_r1`, tournamentId: s.id, version: 1, status: 'published', sections, attachments: [], material: true, changeSummary: 'First publication', authorId: 'u_niko', authorName: 'Niko', createdAt: at(s.start - 25), publishedAt: at(s.start - 22) });
  else db.rules.push({ id: `${s.id}_r1`, tournamentId: s.id, version: 1, status: 'draft', sections, attachments: [], material: true, changeSummary: '', authorId: 'u_niko', authorName: 'Niko', createdAt: at(-2) });
  // registrations
  t.categories.forEach((cat, ci) => {
    const n = s.entries[ci] ?? 0;
    for (let i = 0; i < n; i++) {
      const size = cat.eventType === 'singles' ? 1 : cat.eventType === 'doubles' ? 2 : cat.rosterMin + 1;
      const ps = Array.from({ length: size }, () => mkPlayer(db, !!cat.maxAge && cat.maxAge < 18));
      const overCap = i >= cat.capacity;
      const status: Registration['status'] = overCap ? 'waitlisted' : i % 9 === 7 && !s.fixtures ? 'pending_payment' : i % 13 === 11 && !s.fixtures ? 'withdrawn' : 'confirmed';
      const paid = status === 'confirmed' ? cat.feePaise : 0;
      const r: Registration = {
        id: uid('r'), tournamentId: t.id, categoryId: cat.id, entryName: cat.eventType === 'team' ? TEAMS[i % TEAMS.length] : ps.map(p => p.name).join(' / '),
        captainId: ps[0].id, captainPhone: ps[0].phone, playerIds: ps.map(p => p.id), status, payStatus: status === 'confirmed' ? (cat.feePaise ? 'paid' : 'waived') : status === 'withdrawn' ? 'refunded' : 'unpaid',
        amountPaise: cat.feePaise, paidPaise: paid, ackVersion: 1, needsReack: false, exceptions: [], seed: cat.format.seeding === 'seeded' ? i + 1 : undefined,
        waitlistPos: overCap ? i - cat.capacity + 1 : undefined, createdAt: at(s.start - 20 + (i % 15)), confirmedAt: status === 'confirmed' ? at(s.start - 19 + (i % 15)) : undefined,
        documents: s.minors ? ps.map(p => ({ id: uid('d'), type: 'age_proof', name: `${p.name.split(' ')[0]}-birth-cert.pdf`, status: i % 4 === 2 ? 'pending' : 'approved', playerId: p.id })) : [],
      };
      db.registrations.push(r);
      if (paid) db.payments.push({ id: uid('pay'), registrationId: r.id, amountPaise: paid, method: i % 3 ? 'upi' : 'card', status: 'captured', gatewayRef: `pay_${uid('').slice(1)}`, receiptNo: `DSQ-${s.id.toUpperCase()}-${1000 + i}`, createdAt: r.confirmedAt! });
      db.acks.push({ id: uid('ack'), registrationId: r.id, ruleVersionId: `${s.id}_r1`, version: 1, userId: r.captainId, acceptedAt: r.createdAt });
    }
    if (!s.fixtures) return;
    const entries = db.registrations.filter(r => r.categoryId === cat.id && r.status === 'confirmed');
    const ms = generateFixtures(t.id, cat, entries, s.matchMinutes, rand);
    const busy = busyOf(db, s.courts, s.id);
    schedule(ms, db.courts.filter(c => s.courts.includes(c.id)), t.schedule, t.startDate, t.endDate, busy);
    ms.forEach(m => { m.published = true; m.fixturesVersion = 1; m.refereeIds = [rand() > 0.5 ? 'u_kiran' : 'u_divya']; });
    db.matches.push(...ms);
    // play the first N group/league matches with event streams so stats + standings have data
    const playable = ms.filter(m => m.stage !== 'knockout' && m.homeId && m.awayId).slice(0, s.played ?? 0);
    playable.forEach((m, i) => playMatch(db, t, m, i === playable.length - 1 && s.liveOne));
  });
  if (t.schedule.createVenueHolds) {
    const ms = db.matches.filter(m => m.tournamentId === t.id && m.startAt);
    for (const cId of s.courts) for (const dayKey of [...new Set(ms.filter(m => m.courtId === cId).map(m => m.startAt!.slice(0, 10)))]) { // one hold per court per day, like syncHolds
      const mine = ms.filter(m => m.courtId === cId && m.startAt!.slice(0, 10) === dayKey).map(m => Date.parse(m.startAt!));
      db.holds.push({ id: uid('h'), tournamentId: t.id, courtId: cId, startAt: new Date(Math.min(...mine) - 30 * 60000).toISOString(), endAt: new Date(Math.max(...mine) + (s.matchMinutes + 10) * 60000).toISOString(), type: 'event', playoStatus: cId.endsWith('1') ? 'blocked' : 'block_todo', note: `${t.name} · includes 30 min setup` });
    }
  }
}

function playMatch(db: DB, t: Tournament, m: Match, leaveLive?: boolean) {
  const evts: ScoreEvent[] = []; let seq = 0; const start = m.startAt ? Date.parse(m.startAt) : Date.now();
  const push = (type: string, payload: Record<string, unknown>, mins = seq) => evts.push({ id: uid('e'), matchId: m.id, seq: ++seq, clientId: uid('c'), type, payload, by: m.refereeIds[0], at: new Date(start + mins * 30000).toISOString() });
  const side = () => (rand() > 0.48 ? 'home' : 'away');
  const cfg = t.scoring, stopAt = leaveLive ? 0.55 : 1;
  const done = () => summarize(t.sport, evts, cfg).finished;
  if (t.sport === 'badminton' || t.sport === 'pickleball' || t.sport === 'frisbee') { let k = 0; while (!done() && k++ < 200 && (!leaveLive || k < 18)) push('point', { side: side() }); if (t.sport === 'frisbee' && !leaveLive) push('spirit', { home: 10 + Math.floor(rand() * 5), away: 10 + Math.floor(rand() * 5) }); }
  if (t.sport === 'lagori') { for (let r = 0; r < (leaveLive ? 2 : 3); r++) { push('round_start', {}); for (let k = 0; k < 4 + Math.floor(rand() * 4); k++) push('action', { side: side(), key: pick(cfg.lagori!.actions).key }); if (!leaveLive || r === 0) push('round_end', {}); } }
  if (t.sport === 'football') { push('period', { period: 'H1' }); for (let k = 0; k < Math.floor(rand() * 5); k++) push('goal', { side: side(), minute: 3 + k * 7 }); if (!leaveLive) { push('period', { period: 'HT' }); push('period', { period: 'H2' }); push('goal', { side: side(), minute: 31 }); push('period', { period: 'FT' }); push('period', { period: 'END' }); } }
  if (t.sport === 'box_cricket') { push('toss', { batting: 'home' }); let k = 0; while (!done() && k++ < 90 && (!leaveLive || k < 40)) push('ball', rand() > 0.9 ? { runs: 0, wicket: true } : rand() > 0.93 ? { runs: 0, extra: 'wd' } : { runs: pick([0, 1, 1, 2, 4, 6, 1, 0]) }); }
  void stopAt;
  db.events.push(...evts);
  if (leaveLive) { m.status = 'live'; m.startedAt = new Date(start).toISOString(); return; }
  const s = summarize(t.sport, evts, cfg);
  m.status = 'completed'; m.startedAt = new Date(start).toISOString(); m.endedAt = new Date(start + seq * 30000).toISOString();
  m.result = { homeScore: s.home, awayScore: s.away, detail: s.detail, isDraw: s.isDraw, winnerId: s.winner === 'home' ? m.homeId : s.winner === 'away' ? m.awayId : undefined, verification: 'verified', submittedBy: m.refereeIds[0], submittedAt: m.endedAt, verifiedBy: 'u_niko', verifiedAt: m.endedAt, source: 'live' };
  // Player stats: auto-attributed per sport (top-level counters only)
  const reg = (id?: string) => db.registrations.find(r => r.id === id);
  for (const [sd, rid] of [['home', m.homeId], ['away', m.awayId]] as const) {
    const r = reg(rid); if (!r) continue;
    const scored = sd === 'home' ? s.home : s.away;
    const key = t.sport === 'football' ? 'goals' : t.sport === 'box_cricket' ? 'runs' : t.sport === 'lagori' ? 'points' : t.sport === 'frisbee' ? 'points' : 'games_won';
    db.stats.push({ id: uid('st'), tournamentId: t.id, matchId: m.id, playerId: pick(r.playerIds), regId: r.id, key, value: scored, verified: true, source: 'auto', by: 'system', at: m.endedAt! });
  }
  // Leave the last completed match as "submitted" to demo the verify step
}

const RULE_TEXT: Partial<Record<RuleSection['key'], (t: Tournament) => string>> = {
  eligibility: t => `<p>Open to all players registered on Densparq. Age is taken on <strong>${t.startDate}</strong>. Players under 18 need guardian consent.</p>`,
  roster: () => '<p>Roster edits are allowed until the roster cutoff. Substitutes must be on the roster before the match starts.</p>',
  match_format: t => `<p>Matches are scheduled for <strong>${t.schedule.matchMinutes} minutes</strong> with a ${t.schedule.bufferMinutes}-minute changeover.</p>`,
  scoring: () => '<p>Scores are recorded live by the assigned referee and confirmed by both captains.</p>',
  points: t => `<p>Win ${t.scoring.points.win} · Draw ${t.scoring.points.draw} · Loss ${t.scoring.points.loss}.</p>`,
  tie_breakers: t => `<ol>${t.scoring.tieBreakers.map(x => `<li>${x.replace(/_/g, ' ')}</li>`).join('')}</ol>`,
  walkovers: () => '<p>A team not ready 10 minutes after the scheduled start forfeits the match.</p>',
  protests: () => '<p>Protests must be lodged with the tournament director within 15 minutes of the final whistle, with a ₹500 deposit.</p>',
  refunds: t => `<p>Withdrawals before registration closes receive ${t.registration.refundPercent}% of the entry fee. No refunds after close.</p>`,
};

export function seed(): DB {
  rng = 7;
  const db: DB = { orgs: [], users: [], memberships: [], venues: [], courts: [], tournaments: [], rules: [], acks: [], players: [], registrations: [], payments: [], refunds: [], matches: [], events: [], overrides: [], stats: [], notifications: [], holds: [], audit: [], templates: [],
    profiles: [], courtMeta: [], customers: [], bookings: [], blocks: [], rateRules: [], offers: [], customerRates: [], plans: [], vmemberships: [], ledger: [], feedback: [], followUps: [],
    academies: [], batches: [], sessionChanges: [], athletes: [], enrollments: [], attendance: [], feePlans: [], invoices: [], metricTemplates: [], assessments: [], athleteMatches: [], leads: [], notices: [] };
  db.orgs.push({ id: 'densparq', name: 'Densparq Kannuru', slug: 'densparq', kind: 'venue' }, { id: 'rvce', name: 'RVCE Sports Council', slug: 'rvce', kind: 'college' });
  db.users.push({ id: 'u_niko', name: 'Niko', phone: '9845012345', email: 'niko@densparq.in' }, { id: 'u_asha', name: 'Asha (registrations)', phone: '9845000001' }, { id: 'u_kiran', name: 'Kiran (referee)', phone: '9845000002' }, { id: 'u_divya', name: 'Divya (referee)', phone: '9845000003' }, { id: 'u_cap', name: 'Rohan K (captain)', phone: '9886012210' }, { id: 'u_meera', name: 'Meera (branch manager)', phone: '9845000004' }, { id: 'u_ravi', name: 'Ravi (front desk)', phone: '9845000005' }, { id: 'u_suresh', name: 'Suresh Rao (coach)', phone: '9845000006' }, { id: 'u_lakshmi', name: 'Lakshmi (parent)', phone: '9845000007' });
  const roles: [string, string, Role][] = [['u_niko', 'densparq', 'org_admin'], ['u_niko', 'rvce', 'org_admin'], ['u_asha', 'densparq', 'registration_manager'], ['u_kiran', 'densparq', 'referee'], ['u_divya', 'densparq', 'referee'], ['u_kiran', 'rvce', 'referee']];
  roles.forEach(([userId, orgId, role]) => db.memberships.push({ id: uid('mem'), userId, orgId, role }));
  db.memberships.push({ id: uid('mem'), userId: 'u_suresh', orgId: 'densparq', role: 'coach' }, { id: uid('mem'), userId: 'u_meera', orgId: 'densparq', role: 'branch_manager', venueIds: ['v_kannuru'] }, { id: uid('mem'), userId: 'u_ravi', orgId: 'densparq', role: 'front_desk', venueIds: ['v_kannuru'] });
  db.venues.push({ id: 'v_kannuru', orgId: 'densparq', name: 'Densparq Kannuru', address: 'Yelahanka Main Rd, Kannuru, Bengaluru', isDensparq: true }, { id: 'v_rvce', orgId: 'rvce', name: 'RVCE Main Ground', address: 'Mysore Rd, Bengaluru', isDensparq: false });
  const C = (id: string, name: string, sports: Sport[], space?: string, venueId = 'v_kannuru') => db.courts.push({ id, venueId, name, sports, densparqSpaceId: space });
  C('t1', 'Turf 1', ['football', 'lagori', 'frisbee'], 't1'); C('t2', 'Turf 2', ['football', 'box_cricket', 'lagori', 'frisbee'], 't2'); C('t3', 'Turf 3', ['football', 'box_cricket', 'lagori', 'frisbee'], 't3');
  ['1', '2', '3', '4'].forEach(n => C(`c${n}`, `Badminton ${n}`, ['badminton'], `c${n}`)); C('p1', 'Pickleball 1', ['pickleball'], 'p1'); C('p2', 'Pickleball 2', ['pickleball'], 'p2');
  C('g1', 'Ground A', ['frisbee', 'football'], undefined, 'v_rvce'); C('g2', 'Ground B', ['frisbee', 'football'], undefined, 'v_rvce');
  // The academy 3–6 pm hold from the operator dashboard blocks every Densparq court daily.
  seedAcademyCore(db); // batches occupy courts; tournaments and bookings route around their sessions

  const cat = (name: string, eventType: Category['eventType'], capacity: number, fee: number, format: FormatConfig, extra: Partial<Category> = {}): Omit<Category, 'id' | 'tournamentId'> =>
    ({ name, eventType, gender: 'open', skill: 'any', capacity, feePaise: fee * 100, rosterMin: eventType === 'team' ? 5 : 1, rosterMax: eventType === 'team' ? 10 : 2, format, ...extra });

  seedTournament(db, { id: 'lagori', orgId: 'densparq', name: 'DSL Lagori Open 2026', slug: 'dsl-lagori-open-2026', sport: 'lagori', status: 'published', venueId: 'v_kannuru', start: 0, end: 0, courts: ['t1', 't2', 't3'],
    cats: [cat('Open teams', 'team', 8, 1200, fmt('group_knockout', 2, 2), { rosterMin: 6, rosterMax: 9 })], entries: [8], fixtures: true, played: 7, liveOne: true, matchMinutes: 30,
    description: 'Bengaluru’s first open Lagori championship. Two groups of four, top two go through to the semi-finals.' });
  seedTournament(db, { id: 'smash', orgId: 'densparq', name: 'Kannuru Smash Open', slug: 'kannuru-smash-open', sport: 'badminton', status: 'published', venueId: 'v_kannuru', start: 21, end: 22, courts: ['c1', 'c2', 'c3', 'c4'], minors: true,
    cats: [cat("Men's singles", 'singles', 16, 499, fmt('knockout', 1, 1, 'seeded'), { gender: 'men', skill: 'intermediate' }), cat('Mixed doubles', 'doubles', 12, 799, fmt('group_knockout', 3, 2), { gender: 'mixed' }), cat('Under-15 singles', 'singles', 8, 299, fmt('round_robin'), { maxAge: 15 })],
    entries: [13, 9, 10], matchMinutes: 40, description: 'Two-day open badminton tournament across all four Densparq courts. Seeded men’s singles, mixed doubles groups and an under-15 round robin.' });
  seedTournament(db, { id: 'cricket', orgId: 'densparq', name: 'Corporate Box Cricket Cup', slug: 'corporate-box-cricket-cup', sport: 'box_cricket', status: 'published', venueId: 'v_kannuru', start: 1, end: 1, courts: ['t2', 't3'],
    cats: [cat('Corporate 8s', 'team', 8, 6000, fmt('knockout'), { rosterMin: 8, rosterMax: 11 })], entries: [8], fixtures: true, played: 0, matchMinutes: 50,
    description: 'Eight company teams, straight knockout, 6 overs a side on Turf 2 + 3.' });
  seedTournament(db, { id: 'sevens', orgId: 'densparq', name: 'Weekend 7s League', slug: 'weekend-7s-league', sport: 'football', status: 'published', venueId: 'v_kannuru', start: -1, end: 6, courts: ['t1'],
    cats: [cat('Open 7-a-side', 'team', 6, 3500, fmt('league'), { rosterMin: 7, rosterMax: 12 })], entries: [6], fixtures: true, played: 4, matchMinutes: 50,
    description: 'A one-week 7-a-side league on Turf 1. Every team plays every other team once.' });
  seedTournament(db, { id: 'pickle', orgId: 'densparq', name: 'Pickleball Doubles Night', slug: 'pickleball-doubles-night', sport: 'pickleball', status: 'published', venueId: 'v_kannuru', start: 0, end: 0, courts: ['p1', 'p2'],
    cats: [cat('Open doubles', 'doubles', 6, 600, fmt('round_robin'))], entries: [5], fixtures: true, played: 3, matchMinutes: 25,
    description: 'Round-robin doubles under the lights.' });
  seedTournament(db, { id: 'hat', orgId: 'rvce', name: 'RVCE Ultimate Hat 2026', slug: 'rvce-ultimate-hat', sport: 'frisbee', status: 'published', venueId: 'v_rvce', start: 2, end: 2, courts: ['g1', 'g2'],
    cats: [cat('Mixed hat teams', 'team', 6, 400, fmt('round_robin'), { gender: 'mixed', rosterMin: 7, rosterMax: 12 })], entries: [6], fixtures: true, played: 0, matchMinutes: 60,
    description: 'A one-day hat tournament: teams are drawn from everyone who signs up.' });
  seedTournament(db, { id: 'draft7', orgId: 'densparq', name: 'Kannuru Juniors Football Fest', slug: 'kannuru-juniors-football', sport: 'football', status: 'draft', venueId: 'v_kannuru', start: 35, end: 36, courts: ['t1', 't2', 't3'],
    cats: [cat('Under-12', 'team', 8, 1500, fmt('group_knockout', 2, 2), { maxAge: 12, rosterMin: 7, rosterMax: 10 })], entries: [0], matchMinutes: 30, minors: true,
    description: 'Draft. Setup is incomplete.' });

  // Smash Open: v2 draft with a material change (demo of versioning)
  const v1 = db.rules.find(r => r.id === 'smash_r1')!;
  db.rules.push({ ...v1, id: 'smash_r2', version: 2, status: 'draft', changeSummary: 'Shuttle changed to feather for MS semi-finals onwards', material: true, createdAt: at(-1), publishedAt: undefined,
    sections: v1.sections.map(s => s.key === 'match_format' ? { ...s, html: s.html + '<p><strong>New:</strong> feather shuttles from the men’s singles semi-finals onwards.</p>' } : s) });
  // Leave one Lagori result submitted, not verified, and one disputed
  const lag = db.matches.filter(m => m.tournamentId === 'lagori' && m.status === 'completed');
  if (lag[5]?.result) lag[5].result.verification = 'submitted';
  if (lag[4]?.result) { lag[4].result.verification = 'disputed'; lag[4].result.disputeReason = 'Captain says one Lagori restore was counted twice in round 2.'; }
  db.templates.push({ id: 'tpl_racket', name: 'Racket sports standard rules', sport: 'any', sections: blankSections().map(s => ({ ...s, html: RULE_TEXT[s.key]?.(db.tournaments[1]) ?? '' })) });
  db.notifications.push({ id: uid('n'), tournamentId: 'lagori', kind: 'fixtures_published', title: 'Fixtures are out', body: 'Your group fixtures for DSL Lagori Open are published.', recipientRegIds: db.registrations.filter(r => r.tournamentId === 'lagori').map(r => r.id), channels: ['in_app', 'whatsapp'], createdAt: at(-2), by: 'u_niko', stats: { queued: 0, delivered: 15, read: 11, failed: 1 } });
  db.audit.push({ id: uid('a'), orgId: 'densparq', tournamentId: 'lagori', entity: 'fixtures', entityId: 'lagori', action: 'published', by: 'u_niko', byName: 'Niko', at: at(-2) });
  seedVenue(db, rand, at); // after tournaments, so bookings route around tournament holds
  seedAcademyPeople(db, rand);
  return db;
}

let cache: DB | null = null;
export function getDB(): DB {
  if (cache) return cache;
  try { const raw = localStorage.getItem(KEY); if (raw) return (cache = JSON.parse(raw) as DB); } catch { /* private mode */ }
  cache = seed(); saveDB(); return cache;
}
export function saveDB() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* quota / private mode */ } }
export function resetDB() { cache = seed(); saveDB(); }
export { iso, NOW };

/** Academy batch sessions as venue blocks (cancelled/holiday sessions free the court). Window: −90..+120 days. */
const academyBlocks = (db: DB): Block[] => { const t = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), from = new Date(Date.parse(t) - 90 * 864e5).toISOString().slice(0, 10), to = new Date(Date.parse(t) + 120 * 864e5).toISOString().slice(0, 10);
  return db.batches.filter(b => b.active).flatMap(b => sessions(b, from, to, db.sessionChanges).filter(s => s.status === 'scheduled' || s.status === 'rescheduled')
    .map(s => ({ id: `ses_${b.id}_${s.date}_${s.courtId}`, venueId: db.academies.find(a => a.id === b.academyId)?.venueId ?? '', courtIds: [s.courtId], ...sessionSpan(s), reason: 'academy' as const, note: b.name, createdBy: 'academy' }))); };
/** Every block on the venue calendar: manual blocks + academy sessions + tournament event holds. */
export const allBlocks = (db: DB): Block[] => [...db.blocks, ...academyBlocks(db), ...db.holds.filter(h => h.playoStatus === 'block_todo' || h.playoStatus === 'blocked').map(h => ({ id: h.id, venueId: db.courts.find(c => c.id === h.courtId)?.venueId ?? '', courtIds: [h.courtId], startAt: h.startAt, endAt: h.endAt, reason: 'tournament' as const, note: h.note, createdBy: 'system', tournamentId: h.tournamentId }))];
/** Court time a tournament must schedule around: blocks, other tournaments' holds and live venue bookings. */
export const busyOf = (db: DB, courtIds: string[], exceptTournamentId?: string): Busy[] => [
  ...allBlocks(db).filter(b => (b as { tournamentId?: string }).tournamentId !== exceptTournamentId).flatMap(b => b.courtIds.filter(c => courtIds.includes(c)).map(c => ({ courtId: c, start: Date.parse(b.startAt), end: Date.parse(b.endAt), label: b.note || b.reason }))),
  ...db.bookings.filter(b => courtIds.includes(b.courtId) && LIVE.includes(b.status) && b.source !== 'tournament').map(b => ({ courtId: b.courtId, start: Date.parse(b.startAt), end: Date.parse(b.endAt), label: `Booking: ${b.customerName}` })),
];
