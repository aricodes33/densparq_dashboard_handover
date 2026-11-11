// Venue management domain: types + pure rules (pricing, availability, recurrence, refunds, memberships, KPIs).
// Backend ports this file as-is. Money = paise. Times = ISO UTC; all venue-local logic is IST (+05:30).
import type { ID, ISO, Sport } from './types';

// ---------- types ----------
export type BookingSource = 'walk_in' | 'phone' | 'app' | 'playo' | 'tournament';
export type BookingStatus = 'confirmed' | 'pending_payment' | 'completed' | 'cancelled' | 'no_show';
export type Band = 'off_peak' | 'standard' | 'peak';
export type DayType = 'weekday' | 'weekend' | 'holiday';
export interface VenueProfile {
  venueId: ID; open: string; close: string; slotMinutes: number; bufferMinutes: number;
  description: string; amenities: string[]; photos: string[];
  refund: { fullBeforeHours: number; partialBeforeHours: number; partialPct: number }; // else 0
  holidays: { date: string; name: string }[];
}
export interface CourtMeta { courtId: ID; surface: string; indoor: boolean; active: boolean }
export interface Customer {
  id: ID; orgId: ID; name: string; phone: string; email?: string; sports: Sport[];
  consent: { whatsapp: boolean; marketing: boolean; at?: ISO }; tags: string[]; corporate?: string;
  notes: { at: ISO; by: string; text: string }[]; createdAt: ISO;
}
export interface QuoteLine { label: string; amountPaise: number; kind: 'base' | 'contract' | 'member' | 'offer' | 'override' }
export interface Quote { lines: QuoteLine[]; basePaise: number; totalPaise: number; band: Band; memberHours: number; offerIds: ID[]; locked: boolean }
export interface Booking {
  id: ID; orgId: ID; venueId: ID; courtId: ID; customerId?: ID; customerName: string; startAt: ISO; endAt: ISO; sport: Sport;
  source: BookingSource; status: BookingStatus; quote: Quote; paidPaise: number; refundPaise: number;
  recurrenceId?: ID; groupId?: ID; membershipId?: ID; notes: string; createdAt: ISO; createdBy: ID; cancelReason?: string;
}
export interface Block { id: ID; venueId: ID; courtIds: ID[]; startAt: ISO; endAt: ISO; reason: 'maintenance' | 'private_event' | 'tournament' | 'academy'; note: string; createdBy: ID }
export interface RateRule { id: ID; venueId: ID; sport: Sport; dayType: DayType; from: string; to: string; band: Band; pricePaise: number; minPaise: number; maxPaise: number }
export interface Offer {
  id: ID; orgId: ID; name: string; code?: string; kind: 'percent' | 'flat'; value: number; stackable: boolean;
  validFrom: string; validTo: string; bands?: Band[]; sports?: Sport[]; newCustomersOnly: boolean; minHours: number; maxUses?: number; uses: number; active: boolean;
}
export interface CustomerRate { id: ID; customerId: ID; venueId?: ID; kind: 'fixed' | 'percent'; value: number; note: string; validTo?: string }
export type Tier = 'standard' | 'student' | 'family' | 'regular' | 'corporate';
export interface Plan {
  id: ID; orgId: ID; name: string; tier: Tier; period: 'monthly' | 'quarterly' | 'annual' | 'pack'; pricePaise: number;
  hours: number; walletPaise: number; discountPct: number; sports: Sport[]; peakAllowed: boolean;
  rolloverPct: number; graceDays: number; cancelNoticeHours: number; maxMembers: number; active: boolean;
}
export interface FixedSlot { courtId: ID; weekday: number; start: string; minutes: number; ratePaise: number }
export interface VMembership {
  id: ID; planId: ID; customerId: ID; memberIds: ID[]; startDate: string; endDate: string;
  status: 'active' | 'grace' | 'expired' | 'cancelled'; hoursLeft: number; walletPaise: number; autoRenew: boolean; fixedSlots: FixedSlot[];
}
export interface Ledger { id: ID; membershipId: ID; at: ISO; kind: 'enrol' | 'hours_used' | 'hours_returned' | 'wallet_used' | 'topup' | 'rollover' | 'expired' | 'adjust'; hours: number; paise: number; bookingId?: ID; note: string; by: ID }
export interface Feedback { id: ID; customerId: ID; bookingId?: ID; kind: 'feedback' | 'complaint'; rating?: number; text: string; status: 'open' | 'in_progress' | 'resolved'; resolution?: string; at: ISO }
export interface FollowUp { id: ID; customerId: ID; reason: 'inactive' | 'expiring' | 'complaint' | 'lead' | 'manual'; due: string; status: 'open' | 'done'; note: string }

// ---------- time (IST) ----------
const IST = 330 * 60000;
export const ist = (iso: ISO) => { const d = new Date(Date.parse(iso) + IST); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() }; };
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const atIST = (date: string, min: number) => new Date(Date.parse(`${date}T00:00:00Z`) - IST + min * 60000).toISOString();
export const hours = (b: { startAt: ISO; endAt: ISO }) => (Date.parse(b.endAt) - Date.parse(b.startAt)) / 3600000;
export const overlaps = (a: { startAt: ISO; endAt: ISO }, b: { startAt: ISO; endAt: ISO }) => Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
export const dayType = (date: string, p: VenueProfile): DayType => p.holidays.some(h => h.date === date) ? 'holiday' : [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 'weekend' : 'weekday';

// ---------- availability ----------
export const LIVE: BookingStatus[] = ['confirmed', 'pending_payment', 'completed'];
export interface Conflict { kind: 'booking' | 'block' | 'closed' | 'buffer'; message: string }
/** One source of truth for "can this court take this slot". Used by every booking channel. */
export function conflicts(slot: { courtId: ID; startAt: ISO; endAt: ISO; ignoreId?: ID }, p: VenueProfile, bookings: Booking[], blocks: Block[]): Conflict[] {
  const out: Conflict[] = [], s = ist(slot.startAt), e = ist(slot.endAt), buf = p.bufferMinutes * 60000;
  if (s.min < toMin(p.open) || (e.date === s.date ? e.min : 1440) > toMin(p.close)) out.push({ kind: 'closed', message: `Outside opening hours (${p.open}–${p.close})` });
  for (const b of bookings) {
    if (b.id === slot.ignoreId || b.courtId !== slot.courtId || !LIVE.includes(b.status)) continue;
    if (overlaps(slot, b)) out.push({ kind: 'booking', message: `Clashes with ${b.customerName} (${b.source.replace('_', '-')})` });
    else if (buf && overlaps({ startAt: new Date(Date.parse(slot.startAt) - buf).toISOString(), endAt: new Date(Date.parse(slot.endAt) + buf).toISOString() }, b)) out.push({ kind: 'buffer', message: `Needs a ${p.bufferMinutes}-min changeover after ${b.customerName}` });
  }
  for (const k of blocks) if (k.courtIds.includes(slot.courtId) && overlaps(slot, k)) out.push({ kind: 'block', message: `Blocked: ${k.reason.replace('_', ' ')}${k.note ? ` (${k.note})` : ''}` });
  return out;
}
export const blocking = (c: Conflict) => c.kind !== 'buffer';

// ---------- recurrence ----------
/** Weekly repeats from the first date until `until` (inclusive). Returns start dates; conflicts are checked by the caller. */
export function weekly(firstDate: string, until: string, max = 52): string[] {
  const out: string[] = []; for (let d = new Date(`${firstDate}T12:00:00Z`); d <= new Date(`${until}T12:00:00Z`) && out.length < max; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// ---------- pricing ----------
export const bandOf = (rules: RateRule[], date: string, min: number, sport: Sport, p: VenueProfile) => rules.find(r => r.sport === sport && r.dayType === dayType(date, p) && min >= toMin(r.from) && min < toMin(r.to));
export interface QuoteInput {
  venueId: ID; sport: Sport; startAt: ISO; endAt: ISO; rules: RateRule[]; profile: VenueProfile;
  contract?: CustomerRate; membership?: { m: VMembership; plan: Plan }; offers: Offer[]; code?: string; isNewCustomer: boolean;
  override?: { totalPaise: number; reason: string };
}
/** Price = base by 30-min segment → contracted rate (protected) → member hours/discount → offers (stacking rules) → manager override. */
export function quote(i: QuoteInput): Quote {
  const s = ist(i.startAt), mins = (Date.parse(i.endAt) - Date.parse(i.startAt)) / 60000, lines: QuoteLine[] = [];
  let base = 0; const bands = new Set<Band>();
  for (let m = 0; m < mins; m += 30) { const r = bandOf(i.rules, s.date, s.min + m, i.sport, i.profile); base += Math.round((r?.pricePaise ?? 0) * Math.min(30, mins - m) / 60); if (r) bands.add(r.band); }
  const band: Band = bands.has('peak') ? 'peak' : bands.has('standard') ? 'standard' : 'off_peak';
  lines.push({ label: `Court ${mins / 60} h · ${band.replace('_', '-')}`, amountPaise: base, kind: 'base' });
  let total = base, memberHours = 0, protectedRate = false;
  const c = i.contract;
  if (c && (!c.validTo || c.validTo >= s.date)) {
    const price = c.kind === 'fixed' ? Math.round(c.value * mins / 60) : Math.round(base * (1 - c.value / 100));
    if (price < total) { lines.push({ label: `Agreed rate (${c.note})`, amountPaise: price - total, kind: 'contract' }); total = price; protectedRate = true; }
  }
  const mm = i.membership;
  if (mm && mm.m.status === 'active' && mm.plan.sports.includes(i.sport) && (band !== 'peak' || mm.plan.peakAllowed)) {
    const h = Math.min(mm.m.hoursLeft, mins / 60);
    if (h > 0) { memberHours = h; const cut = Math.round(total * h / (mins / 60)); lines.push({ label: `${h} h from ${mm.plan.name}`, amountPaise: -cut, kind: 'member' }); total -= cut; protectedRate = true; }
    if (total > 0 && mm.plan.discountPct) { const d = Math.round(total * mm.plan.discountPct / 100); lines.push({ label: `Member ${mm.plan.discountPct}% off`, amountPaise: -d, kind: 'member' }); total -= d; protectedRate = true; }
  }
  const eligible = i.offers.filter(o => o.active && (!o.code || o.code === i.code?.toUpperCase()) && o.validFrom <= s.date && o.validTo >= s.date && (!o.bands || o.bands.includes(band))
    && (!o.sports || o.sports.includes(i.sport)) && (!o.newCustomersOnly || i.isNewCustomer) && mins / 60 >= o.minHours && (o.maxUses == null || o.uses < o.maxUses));
  const value = (o: Offer, on: number) => Math.min(on, o.kind === 'percent' ? Math.round(on * o.value / 100) : o.value);
  // Stacking: all stackable offers apply; otherwise only the single best non-stackable one. Offers never stack on member/contract pricing unless stackable.
  const pool = protectedRate ? eligible.filter(o => o.stackable) : eligible;
  const best = pool.filter(o => !o.stackable).sort((a, b) => value(b, total) - value(a, total))[0];
  const chosen = [...(best ? [best] : []), ...pool.filter(o => o.stackable)];
  for (const o of chosen) { const d = value(o, total); if (d > 0) { lines.push({ label: o.code ? `${o.name} (${o.code})` : o.name, amountPaise: -d, kind: 'offer' }); total -= d; } }
  if (i.override) { lines.push({ label: `Manager override: ${i.override.reason}`, amountPaise: i.override.totalPaise - total, kind: 'override' }); total = i.override.totalPaise; }
  return { lines, basePaise: base, totalPaise: Math.max(0, total), band, memberHours, offerIds: chosen.map(o => o.id), locked: true };
}

// ---------- refunds ----------
export function refundFor(b: Booking, p: VenueProfile, now = Date.now()): { paise: number; rule: string } {
  const hrs = (Date.parse(b.startAt) - now) / 3600000;
  if (hrs >= p.refund.fullBeforeHours) return { paise: b.paidPaise, rule: `Full refund (${p.refund.fullBeforeHours}+ h before)` };
  if (hrs >= p.refund.partialBeforeHours) return { paise: Math.round(b.paidPaise * p.refund.partialPct / 100), rule: `${p.refund.partialPct}% refund (${p.refund.partialBeforeHours}–${p.refund.fullBeforeHours} h before)` };
  return { paise: 0, rule: `No refund under ${p.refund.partialBeforeHours} h` };
}

// ---------- memberships ----------
export const membershipState = (m: VMembership, plan: Plan, today: string): VMembership['status'] =>
  m.status === 'cancelled' ? 'cancelled' : today <= m.endDate ? 'active' : today <= addDays(m.endDate, plan.graceDays) ? 'grace' : 'expired';
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const PERIOD_DAYS = { monthly: 30, quarterly: 91, annual: 365, pack: 90 } as const;
/** Renewal: new period starts the day after the old end (or today if lapsed); unused hours roll over by plan %. */
export function renew(m: VMembership, plan: Plan, today: string): { next: VMembership; rolled: number } {
  const start = m.endDate >= today ? addDays(m.endDate, 1) : today, rolled = Math.floor(m.hoursLeft * plan.rolloverPct / 100 * 2) / 2;
  return { next: { ...m, startDate: start, endDate: addDays(start, PERIOD_DAYS[plan.period] - 1), status: 'active', hoursLeft: plan.hours + rolled, walletPaise: m.walletPaise + plan.walletPaise }, rolled };
}

// ---------- analytics ----------
export interface Range { from: string; to: string } // inclusive IST dates
export const inRange = (iso: ISO, r: Range) => { const d = ist(iso).date; return d >= r.from && d <= r.to; };
export const days = (r: Range) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
/** Sellable court-hours: open hours × active courts × days − blocked hours. Denominator for occupancy and RevPACH. */
export function availableHours(r: Range, courts: number, p: VenueProfile, blocks: Block[]) {
  const open = (toMin(p.close) - toMin(p.open)) / 60, blocked = blocks.filter(b => inRange(b.startAt, r)).reduce((a, b) => a + hours(b) * b.courtIds.length, 0);
  return Math.max(0, open * courts * days(r) - blocked);
}
export function kpis(bk: Booking[], r: Range, avail: number) {
  // Conventions (docs/research/venue-kpi-definitions.md): no-shows occupy capacity; cancellations don't; lead time = median.
  const inR = bk.filter(b => inRange(b.startAt, r)), sold = inR.filter(b => (LIVE.includes(b.status) || b.status === 'no_show') && b.source !== 'tournament');
  const leads = sold.map(b => Math.max(0, Date.parse(b.startAt) - Date.parse(b.createdAt)) / 3600000).sort((a, b) => a - b);
  const revenue = sold.reduce((a, b) => a + b.paidPaise - b.refundPaise, 0), bookedH = sold.reduce((a, b) => a + hours(b), 0);
  const paidH = sold.filter(b => b.quote.totalPaise > 0).reduce((a, b) => a + hours(b), 0);
  return {
    revenuePaise: revenue, bookings: sold.length, bookedHours: bookedH, availableHours: avail, occupancy: avail ? bookedH / avail : 0,
    freeHours: Math.max(0, avail - bookedH), cancellations: inR.filter(b => b.status === 'cancelled').length, cancelRate: inR.length ? inR.filter(b => b.status === 'cancelled').length / inR.length : 0,
    noShows: inR.filter(b => b.status === 'no_show').length, revPACH: avail ? revenue / avail : 0, arr: paidH ? revenue / paidH : 0,
    leadTimeHrs: leads.length ? leads[Math.floor(leads.length / 2)] : 0,
  };
}
/** Weekday × hour occupancy (0..1). Cell = booked minutes ÷ (courts × 60 × number of that weekday in range). */
export function heatmap(bk: Booking[], r: Range, courts: number, p: VenueProfile) {
  const open = toMin(p.open) / 60, close = toMin(p.close) / 60, grid = Array.from({ length: 7 }, () => Array(close - open).fill(0) as number[]);
  const count = Array(7).fill(0); for (let i = 0; i < days(r); i++) count[new Date(Date.parse(`${r.from}T12:00:00Z`) + i * 86400000).getUTCDay()]++;
  for (const b of bk) {
    if (!inRange(b.startAt, r) || !LIVE.includes(b.status)) continue;
    const s = ist(b.startAt); for (let m = s.min; m < s.min + hours(b) * 60; m += 30) { const h = Math.floor(m / 60) - open; if (h >= 0 && h < grid[0].length) grid[s.weekday][h] += 30; }
  }
  return grid.map((row, wd) => row.map(v => (count[wd] ? v / (courts * 60 * count[wd]) : 0)));
}
export type Segment = 'new' | 'regular' | 'repeat' | 'inactive' | 'high_value' | 'member';
export function segments(c: Customer, bk: Booking[], isMember: boolean, topSpendPaise: number, now = Date.now()): Segment[] {
  const mine = bk.filter(b => b.customerId === c.id && LIVE.includes(b.status)), last = Math.max(0, ...mine.map(b => Date.parse(b.startAt)).filter(t => t <= now)), d30 = now - 30 * 86400000;
  const spend = mine.reduce((a, b) => a + b.paidPaise - b.refundPaise, 0), out: Segment[] = [];
  if (Date.parse(c.createdAt) > d30) out.push('new');
  if (mine.filter(b => Date.parse(b.startAt) > d30 && Date.parse(b.startAt) <= now).length >= 4) out.push('regular');
  if (mine.length >= 2) out.push('repeat');
  if (mine.length >= 2 && last < d30) out.push('inactive');
  if (spend >= topSpendPaise && spend > 0) out.push('high_value');
  if (isMember) out.push('member');
  return out;
}
/** Rules-based price suggestions per rule (recommendations only; never auto-applied, never touches contracted/member pricing). */
export function recommend(rules: RateRule[], occByRule: Map<ID, { occ: number; leadHrs: number }>) {
  return rules.flatMap(r => {
    const o = occByRule.get(r.id); if (!o) return [];
    const pct = o.occ >= 0.85 && o.leadHrs >= 48 ? 10 : o.occ >= 0.75 ? 5 : o.occ < 0.25 ? -15 : o.occ < 0.4 ? -10 : 0;
    if (!pct) return [];
    const suggested = Math.min(r.maxPaise, Math.max(r.minPaise, Math.round(r.pricePaise * (1 + pct / 100) / 5000) * 5000));
    return suggested === r.pricePaise ? [] : [{ ruleId: r.id, pct, current: r.pricePaise, suggested, occ: o.occ, leadHrs: o.leadHrs, why: pct > 0 ? `${Math.round(o.occ * 100)}% full, booked ${Math.round(o.leadHrs)} h ahead` : `Only ${Math.round(o.occ * 100)}% full` }];
  });
}
