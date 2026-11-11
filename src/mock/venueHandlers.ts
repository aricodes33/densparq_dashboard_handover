// Venue management mock API. Rules live in src/domain/venue.ts; this file does permissions, persistence, side effects.
import type { DB } from './db';
import { allBlocks } from './db';
import { ApiError, now, need, notFound, invalid, audit, type Ctx, type Route } from './core';
import { uid } from '@/domain/fixtures';
import {
  conflicts, blocking, quote, refundFor, weekly, atIST, toMin, ist, hours, overlaps, addDays, renew, membershipState, PERIOD_DAYS, kpis, heatmap, availableHours, segments, recommend, dayType, LIVE,
  type Booking, type Customer, type VMembership, type Range, type RateRule, type Plan, type Segment,
} from '@/domain/venue';
import type { Role } from '@/domain/types';

const OWNER: Role[] = ['org_admin'], MGR: Role[] = ['org_admin', 'branch_manager'], DESK: Role[] = ['org_admin', 'branch_manager', 'front_desk'];
const today = () => ist(now()).date;
const V = (db: DB, id: string) => db.venues.find(v => v.id === id) ?? notFound('venue');
const P = (db: DB, venueId: string) => db.profiles.find(p => p.venueId === venueId) ?? notFound('venue profile');
const B = (db: DB, id: string) => db.bookings.find(b => b.id === id) ?? notFound('booking');
const C = (db: DB, id: string) => db.customers.find(c => c.id === id) ?? notFound('customer');
const M = (db: DB, id: string) => db.vmemberships.find(m => m.id === id) ?? notFound('membership');
const planOf = (db: DB, m: VMembership) => db.plans.find(p => p.id === m.planId)!;
/** Branch-level access: owners see all venues; others only venues listed on their membership (none listed = all). */
function scope(db: DB, ctx: Ctx, venueId: string) {
  if (ctx.role === 'org_admin') return;
  const ids = db.memberships.find(m => m.userId === ctx.userId && m.role === ctx.role)?.venueIds;
  if (ids && !ids.includes(venueId)) throw new ApiError(403, 'forbidden', 'You don’t have access to this branch');
}
const activeMembership = (db: DB, customerId?: string) => db.vmemberships.find(m => m.customerId === customerId && membershipState(m, planOf(db, m), today()) === 'active');
const blocksFor = (db: DB, venueId: string) => allBlocks(db).filter(b => b.venueId === venueId);
const ledger = (db: DB, ctx: Ctx, membershipId: string, kind: DB['ledger'][number]['kind'], hrs: number, paise: number, note: string, bookingId?: string) =>
  db.ledger.unshift({ id: uid('lg'), membershipId, at: now(), kind, hours: hrs, paise, note, bookingId, by: ctx.userId });

function priceFor(db: DB, b: { venueId: string; sport: Booking['sport']; startAt: string; endAt: string; customerId?: string; code?: string; useMembership?: boolean; override?: { totalPaise: number; reason: string } }) {
  const mm = b.useMembership ? activeMembership(db, b.customerId) : undefined;
  return quote({ venueId: b.venueId, sport: b.sport, startAt: b.startAt, endAt: b.endAt, rules: db.rateRules.filter(r => r.venueId === b.venueId), profile: P(db, b.venueId), offers: db.offers, code: b.code,
    isNewCustomer: !db.bookings.some(x => x.customerId && x.customerId === b.customerId && LIVE.includes(x.status)), contract: db.customerRates.find(r => r.customerId === b.customerId && (!r.venueId || r.venueId === b.venueId)),
    membership: mm ? { m: mm, plan: planOf(db, mm) } : undefined, override: b.override });
}
function findOrCreateCustomer(db: DB, org: string, body: any): Customer {
  if (body.customerId) return C(db, body.customerId);
  const c = body.customer; if (!c?.name?.trim()) invalid('Pick a customer or enter a name', 'customer');
  if (!/^\d{10}$/.test(c.phone ?? '')) invalid('Enter a 10-digit mobile number', 'phone');
  const existing = db.customers.find(x => x.phone === c.phone); if (existing) return existing;
  const n: Customer = { id: uid('cu'), orgId: org, name: c.name.trim(), phone: c.phone, email: c.email, sports: c.sports ?? [], consent: { whatsapp: !!c.whatsapp, marketing: !!c.marketing, at: now() }, tags: [], notes: [], createdAt: now() };
  db.customers.push(n); return n;
}

/** Directory rows with derived stats + segments. "high_value" = top 10% by net spend. */
function customerRows(db: DB, org: string, f: { segment?: Segment | null; q?: string | null; sport?: string | null }) {
  const spend = (id: string) => db.bookings.filter(b => b.customerId === id && LIVE.includes(b.status)).reduce((a, b) => a + b.paidPaise - b.refundPaise, 0);
  const all = db.customers.filter(c => c.orgId === org), spends = all.map(c => spend(c.id)).sort((a, b) => b - a), top = spends[Math.floor(spends.length * 0.1)] ?? Infinity, s = f.q?.toLowerCase();
  return all.map(c => {
    const mine = db.bookings.filter(b => b.customerId === c.id && LIVE.includes(b.status)), avgH = mine.length ? mine.reduce((a, b) => a + ist(b.startAt).min / 60, 0) / mine.length : -1;
    return { ...c, bookings: mine.length, spendPaise: spend(c.id), lastAt: mine.map(b => b.startAt).filter(t => t <= now()).sort().at(-1), preferredTime: avgH < 0 ? '—' : avgH >= 17 ? 'Evening' : avgH >= 11 ? 'Daytime' : 'Morning', segments: segments(c, db.bookings, !!activeMembership(db, c.id), top) };
  }).filter(c => (!f.segment || c.segments.includes(f.segment)) && (!s || c.name.toLowerCase().includes(s) || c.phone.includes(s)) && (!f.sport || c.sports.includes(f.sport as Booking['sport']))).sort((a, b) => b.spendPaise - a.spendPaise);
}

// ---------- analytics helpers ----------
function analytics(db: DB, org: string, venueId: string | null, r: Range) {
  const venues = db.venues.filter(v => (venueId ? v.id === venueId : db.profiles.some(p => p.venueId === v.id)) && (v.orgId === org || v.isDensparq));
  const courts = db.courts.filter(c => venues.some(v => v.id === c.venueId) && db.courtMeta.find(m => m.courtId === c.id)?.active !== false);
  const bk = db.bookings.filter(b => venues.some(v => v.id === b.venueId));
  const avail = (rr: Range) => venues.reduce((a, v) => a + availableHours(rr, courts.filter(c => c.venueId === v.id).length, P(db, v.id), allBlocks(db).filter(b => b.venueId === v.id)), 0);
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1, prev = { from: addDays(r.from, -len), to: addDays(r.from, -1) };
  const inR = bk.filter(b => { const d = ist(b.startAt).date; return d >= r.from && d <= r.to; }), sold = inR.filter(b => LIVE.includes(b.status));
  const group = <K extends string>(key: (b: Booking) => K) => { const m = new Map<K, { hours: number; revenuePaise: number; bookings: number }>(); for (const b of sold) { const x = m.get(key(b)) ?? { hours: 0, revenuePaise: 0, bookings: 0 }; x.hours += hours(b); x.revenuePaise += b.paidPaise - b.refundPaise; x.bookings++; m.set(key(b), x); } return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.revenuePaise - a.revenuePaise); };
  const trend = Array.from({ length: len }, (_, i) => { const d = addDays(r.from, i), day = sold.filter(b => ist(b.startAt).date === d); return { date: d, revenuePaise: day.reduce((a, b) => a + b.paidPaise - b.refundPaise, 0), hours: day.reduce((a, b) => a + hours(b), 0) }; });
  const leadBuckets: [string, number][] = [['< 2 h', 2], ['2–24 h', 24], ['1–3 days', 72], ['3–7 days', 168], ['7+ days', Infinity]];
  const lead = leadBuckets.map(([label, max], i) => ({ label, bookings: sold.filter(b => { const h = (Date.parse(b.startAt) - Date.parse(b.createdAt)) / 3600000; return h < max && h >= (i ? leadBuckets[i - 1][1] : -Infinity); }).length }));
  const before = new Set(bk.filter(b => ist(b.startAt).date < r.from && LIVE.includes(b.status)).map(b => b.customerId)), cust = new Set(sold.map(b => b.customerId));
  const prevCust = new Set(bk.filter(b => { const d = ist(b.startAt).date; return d >= prev.from && d <= prev.to && LIVE.includes(b.status); }).map(b => b.customerId));
  const counts = new Map<string, number>(); sold.forEach(b => b.customerId && counts.set(b.customerId, (counts.get(b.customerId) ?? 0) + 1));
  const ms = db.vmemberships.map(m => ({ m, plan: planOf(db, m), st: membershipState(m, planOf(db, m), today()) }));
  const expiring = ms.filter(x => x.st === 'active' && x.m.endDate <= addDays(today(), 7));
  const ended = ms.filter(x => x.m.endDate >= r.from && x.m.endDate <= r.to);
  const offers = db.offers.map(o => { const used = sold.filter(b => b.quote.offerIds.includes(o.id)); return { id: o.id, name: o.name, code: o.code, uses: used.length, discountPaise: used.reduce((a, b) => a + b.quote.basePaise - b.quote.totalPaise, 0), revenuePaise: used.reduce((a, b) => a + b.paidPaise, 0) }; }).filter(o => o.uses);
  const heat = heatmap(bk, r, courts.filter(c => c.venueId === (venueId ?? 'v_kannuru')).length, P(db, venueId ?? 'v_kannuru'));
  const k = kpis(bk, r, avail(r)), pk = kpis(bk, prev, avail(prev));
  // alerts: cells under 20% over the range (≥ 4 weeks makes it "consistent"), memberships expiring, regulars going quiet
  const open = toMin(P(db, venueId ?? 'v_kannuru').open) / 60, WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const empty = heat.flatMap((row, wd) => row.map((v, h) => ({ wd, h: h + open, v }))).filter(c => c.v < 0.2 && !(c.h >= 15 && c.h < 18)).sort((a, b) => a.v - b.v);
  const quiet = [...prevCust].filter(id => id && !cust.has(id) && (bk.filter(b => b.customerId === id && LIVE.includes(b.status)).length >= 4));
  const alerts = [
    ...(len >= 28 && empty.length ? [{ kind: 'money', text: `${empty.length} weekly slots under 20% full, e.g. ${empty.slice(0, 3).map(c => `${WD[c.wd]} ${c.h}:00`).join(', ')}`, to: 'pricing' }] : []),
    ...(expiring.length ? [{ kind: 'neutral', text: `${expiring.length} membership${expiring.length > 1 ? 's' : ''} expire${expiring.length > 1 ? '' : 's'} in the next 7 days`, to: 'memberships' }] : []),
    ...(quiet.length ? [{ kind: 'danger', text: `${quiet.length} regular customers booked last period but not this one`, to: 'customers?segment=inactive' }] : []),
    ...(k.cancelRate > pk.cancelRate * 1.3 && k.cancelRate > 0.05 ? [{ kind: 'danger', text: `Cancellations up to ${Math.round(k.cancelRate * 100)}% (was ${Math.round(pk.cancelRate * 100)}%)`, to: 'calendar' }] : []),
  ];
  return {
    range: r, prev, kpis: k, prevKpis: pk, trend, heatmap: heat, open, bySport: group(b => b.sport), byCourt: group(b => db.courts.find(c => c.id === b.courtId)?.name ?? b.courtId), byBand: group(b => b.quote.band),
    byWeekday: group(b => WD[ist(b.startAt).weekday]), sources: group(b => b.source), lead, offers, alerts,
    customers: { active: cust.size, new: [...cust].filter(id => !before.has(id)).length, returning: [...cust].filter(id => before.has(id)).length, repeatRate: cust.size ? [...counts.values()].filter(n => n >= 2).length / cust.size : 0,
      retention: prevCust.size ? [...prevCust].filter(id => cust.has(id)).length / prevCust.size : 0 },
    memberships: { active: ms.filter(x => x.st === 'active').length, grace: ms.filter(x => x.st === 'grace').length, expiring: expiring.length,
      renewalRate: ended.length ? ended.filter(x => db.ledger.some(l => l.membershipId === x.m.id && l.kind === 'rollover')).length / ended.length : 0,
      revenuePaise: db.ledger.filter(l => l.kind === 'enrol' && ist(l.at).date >= r.from && ist(l.at).date <= r.to).reduce((a, l) => a + l.paise, 0),
      utilisation: ms.filter(x => x.st === 'active' && x.plan.hours).reduce((a, x, _, arr) => a + (1 - x.m.hoursLeft / x.plan.hours) / arr.length, 0) },
  };
}

export const venueRoutes: Route[] = [
  // ---- setup ----
  ['GET', '/orgs/:org/venue-setup', (p, _b, _q, ctx, db) => db.venues.filter(v => (v.orgId === p.org || v.isDensparq) && db.profiles.some(x => x.venueId === v.id)).filter(v => { try { scope(db, ctx, v.id); return true; } catch { return false; } })
    .map(v => ({ ...v, profile: P(db, v.id), courts: db.courts.filter(c => c.venueId === v.id).map(c => ({ ...c, ...db.courtMeta.find(m => m.courtId === c.id) })) }))],
  ['POST', '/orgs/:org/venues', (p, b, _q, ctx, db) => {
    need(ctx, OWNER); if (!b.name?.trim()) invalid('Name the branch', 'name');
    const v = { id: uid('v'), orgId: p.org, name: b.name.trim(), address: b.address ?? '', isDensparq: false }; db.venues.push(v);
    db.profiles.push({ venueId: v.id, open: '06:00', close: '22:00', slotMinutes: 60, bufferMinutes: 0, description: '', amenities: [], photos: [], refund: { fullBeforeHours: 24, partialBeforeHours: 6, partialPct: 50 }, holidays: [] });
    audit(db, ctx, { orgId: p.org }, 'venue', v.id, 'branch created'); return v;
  }],
  ['PUT', '/venues/:id/profile', (p, b, _q, ctx, db) => {
    need(ctx, MGR); scope(db, ctx, p.id); const pr = P(db, p.id);
    if (b.close && b.open && toMin(b.close) <= toMin(b.open)) invalid('Closing time must be after opening time', 'close');
    if (b.refund && b.refund.partialBeforeHours > b.refund.fullBeforeHours) invalid('Partial-refund window must be shorter than the full-refund window', 'refund');
    Object.assign(pr, b, { venueId: pr.venueId }); if (b.name || b.address) Object.assign(V(db, p.id), { name: b.name ?? V(db, p.id).name, address: b.address ?? V(db, p.id).address });
    audit(db, ctx, { orgId: V(db, p.id).orgId ?? 'densparq' }, 'venue', p.id, 'profile updated'); return pr;
  }],
  ['POST', '/venues/:id/courts', (p, b, _q, ctx, db) => {
    need(ctx, MGR); scope(db, ctx, p.id); if (!b.name?.trim()) invalid('Name the court', 'name'); if (!b.sports?.length) invalid('Pick at least one sport', 'sports');
    const c = { id: uid('ct'), venueId: p.id, name: b.name.trim(), sports: b.sports }; db.courts.push(c); db.courtMeta.push({ courtId: c.id, surface: b.surface ?? '', indoor: !!b.indoor, active: true }); return c;
  }],
  ['PATCH', '/courts/:id', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const c = db.courts.find(x => x.id === p.id) ?? notFound('court'); scope(db, ctx, c.venueId);
    Object.assign(c, { name: b.name ?? c.name, sports: b.sports ?? c.sports }); const m = db.courtMeta.find(x => x.courtId === c.id)!; Object.assign(m, { surface: b.surface ?? m.surface, indoor: b.indoor ?? m.indoor, active: b.active ?? m.active }); return { ...c, ...m };
  }],

  // ---- bookings ----
  ['GET', '/venues/:id/calendar', (p, _b, q, ctx, db) => {
    scope(db, ctx, p.id); const from = q.get('from') ?? today(), to = q.get('to') ?? from, win = { startAt: atIST(from, 0), endAt: atIST(addDays(to, 1), 0) };
    return { profile: P(db, p.id), courts: db.courts.filter(c => c.venueId === p.id && db.courtMeta.find(m => m.courtId === c.id)?.active !== false),
      bookings: db.bookings.filter(b => b.venueId === p.id && overlaps(b, win)), blocks: blocksFor(db, p.id).filter(b => overlaps(b, win)) };
  }],
  ['POST', '/venues/:id/quote', (p, b, _q, ctx, db) => {
    scope(db, ctx, p.id); const startAt = atIST(b.date, toMin(b.start)), endAt = new Date(Date.parse(startAt) + b.minutes * 60000).toISOString(), blocks = blocksFor(db, p.id);
    return { quote: priceFor(db, { venueId: p.id, sport: b.sport, startAt, endAt, customerId: b.customerId, code: b.code, useMembership: b.useMembership, override: b.override }),
      conflicts: (b.courtIds as string[]).flatMap(courtId => conflicts({ courtId, startAt, endAt, ignoreId: b.ignoreId }, P(db, p.id), db.bookings, blocks).map(c => ({ ...c, courtId }))),
      membership: b.customerId ? activeMembership(db, b.customerId) ?? null : null };
  }],
  ['POST', '/venues/:id/bookings', (p, b, _q, ctx, db) => {
    need(ctx, DESK); scope(db, ctx, p.id);
    if (!b.courtIds?.length) invalid('Pick at least one court', 'courtIds'); if (!(b.minutes >= 30)) invalid('Minimum 30 minutes', 'minutes');
    if (b.override) { need(ctx, MGR); if (!b.override.reason?.trim()) invalid('Overrides need a reason', 'override'); }
    const cu = findOrCreateCustomer(db, V(db, p.id).orgId ?? 'densparq', b), dates = weekly(b.date, b.repeatUntil ?? b.date), recurrenceId = dates.length > 1 ? uid('rec') : undefined, groupId = b.courtIds.length > 1 ? uid('grp') : undefined;
    const created: Booking[] = [], skipped: { date: string; courtId: string; reason: string }[] = [], blocks = blocksFor(db, p.id);
    for (const date of dates) for (const courtId of b.courtIds as string[]) {
      const startAt = atIST(date, toMin(b.start)), endAt = new Date(Date.parse(startAt) + b.minutes * 60000).toISOString();
      const cf = conflicts({ courtId, startAt, endAt }, P(db, p.id), db.bookings, blocks).filter(blocking);
      if (cf.length) { skipped.push({ date, courtId, reason: cf[0].message }); continue; }
      const q = priceFor(db, { venueId: p.id, sport: b.sport, startAt, endAt, customerId: cu.id, code: b.code, useMembership: b.useMembership, override: b.override });
      const mm = q.memberHours ? activeMembership(db, cu.id) : undefined;
      const bk: Booking = { id: uid('bk'), orgId: cu.orgId, venueId: p.id, courtId, customerId: cu.id, customerName: cu.name, startAt, endAt, sport: b.sport, source: b.source ?? 'walk_in',
        status: b.paid || q.totalPaise === 0 ? 'confirmed' : 'pending_payment', quote: q, paidPaise: b.paid ? q.totalPaise : 0, refundPaise: 0, recurrenceId, groupId, membershipId: mm?.id, notes: b.notes ?? '', createdAt: now(), createdBy: ctx.userId };
      if (mm) { mm.hoursLeft -= q.memberHours; ledger(db, ctx, mm.id, 'hours_used', -q.memberHours, 0, `${db.courts.find(c => c.id === courtId)?.name} ${date} ${b.start}`, bk.id); }
      q.offerIds.forEach(id => { const o = db.offers.find(x => x.id === id); if (o) o.uses++; });
      db.bookings.push(bk); created.push(bk);
    }
    if (!created.length) throw new ApiError(409, 'unavailable', skipped[0]?.reason ?? 'No slot available', skipped);
    audit(db, ctx, { orgId: cu.orgId }, 'booking', created[0].id, `created ${created.length} booking(s)`, b.override?.reason, { skipped: skipped.length });
    return { created, skipped };
  }],
  ['GET', '/bookings/:id', (p, _b, _q, ctx, db) => { const b = B(db, p.id); scope(db, ctx, b.venueId); return { ...b, customer: b.customerId ? C(db, b.customerId) : null, refundPolicy: refundFor(b, P(db, b.venueId)), history: db.audit.filter(a => a.entityId === b.id), series: b.recurrenceId ? db.bookings.filter(x => x.recurrenceId === b.recurrenceId).length : 1 }; }],
  ['PATCH', '/bookings/:id', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const bk = B(db, p.id); scope(db, ctx, bk.venueId);
    if (!['confirmed', 'pending_payment'].includes(bk.status)) throw new ApiError(409, 'bad_state', 'Only upcoming bookings can be moved');
    const before = { courtId: bk.courtId, startAt: bk.startAt, endAt: bk.endAt }, dur = Date.parse(bk.endAt) - Date.parse(bk.startAt);
    const next = { courtId: b.courtId ?? bk.courtId, startAt: b.startAt ?? bk.startAt, endAt: b.startAt ? new Date(Date.parse(b.startAt) + dur).toISOString() : bk.endAt };
    const cf = conflicts({ ...next, ignoreId: bk.id }, P(db, bk.venueId), db.bookings, blocksFor(db, bk.venueId)).filter(blocking);
    if (cf.length) throw new ApiError(409, 'unavailable', cf[0].message, cf);
    Object.assign(bk, next, { notes: b.notes ?? bk.notes }); // price stays locked at the confirmed quote
    audit(db, ctx, { orgId: bk.orgId }, 'booking', bk.id, 'rescheduled', b.reason, { before, after: next }); return bk;
  }],
  ['POST', '/bookings/:id/cancel', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const bk = B(db, p.id); scope(db, ctx, bk.venueId);
    if (!['confirmed', 'pending_payment'].includes(bk.status)) throw new ApiError(409, 'bad_state', 'This booking can’t be cancelled');
    if (!b.reason?.trim()) invalid('Give a reason', 'reason');
    const pol = refundFor(bk, P(db, bk.venueId)), refund = b.refundPaise ?? pol.paise;
    if (refund !== pol.paise) need(ctx, MGR); if (refund > bk.paidPaise) invalid('Refund is more than was paid', 'refundPaise');
    const mm = bk.membershipId ? M(db, bk.membershipId) : undefined;
    if (mm && bk.quote.memberHours && (Date.parse(bk.startAt) - Date.now()) / 3600000 >= planOf(db, mm).cancelNoticeHours) { mm.hoursLeft += bk.quote.memberHours; ledger(db, ctx, mm.id, 'hours_returned', bk.quote.memberHours, 0, 'Cancelled in time', bk.id); }
    Object.assign(bk, { status: 'cancelled', refundPaise: refund, cancelReason: b.reason });
    audit(db, ctx, { orgId: bk.orgId }, 'booking', bk.id, `cancelled · refund ₹${refund / 100}`, refund !== pol.paise ? `${b.reason} (override of policy: ${pol.rule})` : b.reason); return bk;
  }],
  ['POST', '/bookings/:id/status', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const bk = B(db, p.id); scope(db, ctx, bk.venueId);
    const ok: Record<string, Booking['status'][]> = { confirmed: ['pending_payment'], completed: ['confirmed'], no_show: ['confirmed', 'pending_payment'] };
    if (!ok[b.status]?.includes(bk.status)) throw new ApiError(409, 'bad_transition', `Can't go from ${bk.status} to ${b.status}`);
    if (b.status === 'confirmed') bk.paidPaise = bk.quote.totalPaise; bk.status = b.status;
    audit(db, ctx, { orgId: bk.orgId }, 'booking', bk.id, b.status === 'confirmed' ? 'payment collected' : `marked ${b.status}`); return bk;
  }],
  ['POST', '/venues/:id/blocks', (p, b, _q, ctx, db) => {
    need(ctx, MGR); scope(db, ctx, p.id); if (!b.courtIds?.length) invalid('Pick courts', 'courtIds');
    if (!(Date.parse(b.endAt) > Date.parse(b.startAt))) invalid('End must be after start', 'endAt');
    const hit = db.bookings.filter(x => x.venueId === p.id && b.courtIds.includes(x.courtId) && ['confirmed', 'pending_payment'].includes(x.status) && overlaps(x, b));
    if (hit.length) throw new ApiError(409, 'has_bookings', `${hit.length} booking(s) in the way. Move or cancel them first.`, hit.map(x => ({ id: x.id, customerName: x.customerName, startAt: x.startAt })));
    const k = { id: uid('blk'), venueId: p.id, courtIds: b.courtIds, startAt: b.startAt, endAt: b.endAt, reason: b.reason, note: b.note ?? '', createdBy: ctx.userId };
    db.blocks.push(k); audit(db, ctx, { orgId: V(db, p.id).orgId ?? 'densparq' }, 'block', k.id, `blocked ${b.courtIds.length} court(s)`, b.note); return k;
  }],
  ['DELETE', '/blocks/:id', (p, _b, _q, ctx, db) => { need(ctx, MGR); const k = db.blocks.find(x => x.id === p.id) ?? notFound('block (tournament holds are released from the tournament)'); scope(db, ctx, k.venueId); db.blocks = db.blocks.filter(x => x !== k); return { ok: true }; }],

  // ---- pricing ----
  ['GET', '/orgs/:org/pricing', (_p, _b, q, _c, db) => { const v = q.get('venueId') ?? 'v_kannuru'; return { rules: db.rateRules.filter(r => r.venueId === v), offers: db.offers, holidays: P(db, v).holidays,
    contracts: db.customerRates.map(r => ({ ...r, customerName: C(db, r.customerId).name })), history: db.audit.filter(a => ['rate_rule', 'offer', 'customer_rate'].includes(a.entity)).slice(0, 50) }; }],
  ['POST', '/venues/:id/rate-rules', (p, b, _q, ctx, db) => { need(ctx, MGR); scope(db, ctx, p.id); const r = { ...validRule(db, b, p.id), id: uid('rr'), venueId: p.id }; db.rateRules.push(r); audit(db, ctx, { orgId: 'densparq' }, 'rate_rule', r.id, `added ₹${r.pricePaise / 100}/h ${r.sport} ${r.dayType} ${r.from}–${r.to}`); return r; }],
  ['PUT', '/rate-rules/:id', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const r = db.rateRules.find(x => x.id === p.id) ?? notFound('rate rule'); scope(db, ctx, r.venueId);
    const before = { ...r }; Object.assign(r, validRule(db, { ...r, ...b }, r.venueId, r.id));
    audit(db, ctx, { orgId: 'densparq' }, 'rate_rule', r.id, `₹${before.pricePaise / 100} → ₹${r.pricePaise / 100}/h ${r.sport} ${r.dayType} ${r.from}–${r.to}`, b.reason, { before, after: { ...r } }); return r;
  }],
  ['DELETE', '/rate-rules/:id', (p, _b, _q, ctx, db) => { need(ctx, MGR); const r = db.rateRules.find(x => x.id === p.id) ?? notFound('rate rule'); db.rateRules = db.rateRules.filter(x => x !== r); audit(db, ctx, { orgId: 'densparq' }, 'rate_rule', r.id, `removed ${r.sport} ${r.dayType} ${r.from}–${r.to}`); return { ok: true }; }],
  ['POST', '/orgs/:org/offers', (p, b, _q, ctx, db) => { need(ctx, MGR); const o = { ...validOffer(db, b), id: uid('of'), orgId: p.org, uses: 0 }; db.offers.push(o); audit(db, ctx, { orgId: p.org }, 'offer', o.id, `created ${o.name}`); return o; }],
  ['PATCH', '/offers/:id', (p, b, _q, ctx, db) => { need(ctx, MGR); const o = db.offers.find(x => x.id === p.id) ?? notFound('offer'); Object.assign(o, validOffer(db, { ...o, ...b }, o.id)); audit(db, ctx, { orgId: o.orgId }, 'offer', o.id, b.active === false ? 'paused' : 'updated'); return o; }],
  ['POST', '/customer-rates', (_p, b, _q, ctx, db) => {
    need(ctx, MGR); C(db, b.customerId); if (!(b.value > 0)) invalid('Enter a rate', 'value'); if (b.kind === 'percent' && b.value >= 100) invalid('Percent must be under 100', 'value'); if (!b.note?.trim()) invalid('Say what this rate is for', 'note');
    const r = { id: uid('cr'), customerId: b.customerId, venueId: b.venueId || undefined, kind: b.kind, value: +b.value, note: b.note, validTo: b.validTo || undefined }; db.customerRates = db.customerRates.filter(x => x.customerId !== b.customerId || x.venueId !== r.venueId); db.customerRates.push(r);
    audit(db, ctx, { orgId: 'densparq' }, 'customer_rate', r.id, `agreed rate for ${C(db, b.customerId).name}`, b.note); return r;
  }],
  ['DELETE', '/customer-rates/:id', (p, _b, _q, ctx, db) => { need(ctx, MGR); db.customerRates = db.customerRates.filter(x => x.id !== p.id); audit(db, ctx, { orgId: 'densparq' }, 'customer_rate', p.id, 'removed agreed rate'); return { ok: true }; }],
  ['GET', '/venues/:id/recommendations', (p, _b, _q, ctx, db) => {
    need(ctx, MGR); const pr = P(db, p.id), from = addDays(today(), -28), rules = db.rateRules.filter(r => r.venueId === p.id), stats = new Map<string, { occ: number; leadHrs: number }>();
    for (const r of rules) {
      const courts = db.courts.filter(c => c.venueId === p.id && c.sports.includes(r.sport)).length; if (!courts) continue;
      let availH = 0; for (let i = 0; i < 28; i++) { const d = addDays(from, i); if (dayType(d, pr) === r.dayType) availH += (toMin(r.to) - toMin(r.from)) / 60 * courts; }
      const hit = db.bookings.filter(b => { const s = ist(b.startAt); return b.venueId === p.id && b.sport === r.sport && LIVE.includes(b.status) && s.date >= from && s.date < today() && dayType(s.date, pr) === r.dayType && s.min >= toMin(r.from) && s.min < toMin(r.to); });
      const blocked = allBlocks(db).filter(k => k.venueId === p.id && ist(k.startAt).date >= from && dayType(ist(k.startAt).date, pr) === r.dayType).reduce((a, k) => { const s = ist(k.startAt), e = s.min + hours(k) * 60; return a + Math.max(0, Math.min(e, toMin(r.to)) - Math.max(s.min, toMin(r.from))) / 60 * k.courtIds.filter(id => db.courts.find(c => c.id === id)?.sports.includes(r.sport)).length; }, 0);
      const leads = hit.map(b => (Date.parse(b.startAt) - Date.parse(b.createdAt)) / 3600000).sort((a, b) => a - b);
      if (availH - blocked > 0) stats.set(r.id, { occ: hit.reduce((a, b) => a + hours(b), 0) / (availH - blocked), leadHrs: leads[Math.floor(leads.length / 2)] ?? 0 });
    }
    return recommend(rules, stats).map(x => ({ ...x, rule: rules.find(r => r.id === x.ruleId) }));
  }],

  // ---- CRM ----
  ['GET', '/orgs/:org/customers', (p, _b, q, _c, db) => customerRows(db, p.org, { segment: q.get('segment') as Segment | null, q: q.get('q'), sport: q.get('sport') })],
  ['POST', '/orgs/:org/customers', (p, b, _q, ctx, db) => { need(ctx, DESK); if (db.customers.some(c => c.phone === b.phone)) throw new ApiError(409, 'duplicate', 'A customer with this phone already exists'); const c = findOrCreateCustomer(db, p.org, { customer: b }); audit(db, ctx, { orgId: p.org }, 'customer', c.id, 'created'); return c; }],
  ['GET', '/customers/:id', (p, _b, _q, _c, db) => { const c = C(db, p.id); return { ...c, bookings: db.bookings.filter(b => b.customerId === c.id).sort((a, b) => b.startAt.localeCompare(a.startAt)), memberships: db.vmemberships.filter(m => m.customerId === c.id).map(m => ({ ...m, plan: planOf(db, m), status: membershipState(m, planOf(db, m), today()) })),
    feedback: db.feedback.filter(f => f.customerId === c.id), followUps: db.followUps.filter(f => f.customerId === c.id), rate: db.customerRates.find(r => r.customerId === c.id), history: db.audit.filter(a => a.entityId === c.id) }; }],
  ['PATCH', '/customers/:id', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const c = C(db, p.id), before = { ...c.consent };
    if (b.phone && !/^\d{10}$/.test(b.phone)) invalid('10-digit mobile number', 'phone');
    Object.assign(c, { name: b.name ?? c.name, email: b.email ?? c.email, phone: b.phone ?? c.phone, sports: b.sports ?? c.sports, tags: b.tags ?? c.tags, corporate: b.corporate ?? c.corporate });
    if (b.consent) c.consent = { ...b.consent, at: now() };
    audit(db, ctx, { orgId: c.orgId }, 'customer', c.id, b.consent ? 'consent changed' : 'profile updated', undefined, b.consent ? { before, after: c.consent } : undefined); return c;
  }],
  ['POST', '/customers/:id/notes', (p, b, _q, ctx, db) => { need(ctx, DESK); if (!b.text?.trim()) invalid('Write a note', 'text'); const c = C(db, p.id); c.notes.unshift({ at: now(), by: ctx.userId, text: b.text.trim() }); return c; }],
  ['GET', '/orgs/:org/feedback', (_p, _b, _q, _c, db) => db.feedback.map(f => ({ ...f, customerName: C(db, f.customerId).name })).sort((a, b) => b.at.localeCompare(a.at))],
  ['POST', '/customers/:id/feedback', (p, b, _q, ctx, db) => { need(ctx, DESK); if (!b.text?.trim()) invalid('Describe the feedback', 'text'); const f = { id: uid('fb'), customerId: C(db, p.id).id, bookingId: b.bookingId, kind: b.kind, rating: b.rating, text: b.text, status: 'open' as const, at: now() }; db.feedback.unshift(f);
    if (f.kind === 'complaint') db.followUps.push({ id: uid('fu'), customerId: p.id, reason: 'complaint', due: addDays(today(), 1), status: 'open', note: `Resolve: ${f.text.slice(0, 60)}` }); return f; }],
  ['PATCH', '/feedback/:id', (p, b, _q, ctx, db) => { need(ctx, DESK); const f = db.feedback.find(x => x.id === p.id) ?? notFound('feedback'); if (b.status === 'resolved' && !(b.resolution ?? f.resolution)?.trim()) invalid('Say how it was resolved', 'resolution'); Object.assign(f, { status: b.status ?? f.status, resolution: b.resolution ?? f.resolution }); return f; }],
  ['GET', '/orgs/:org/followups', (_p, _b, _q, _c, db) => db.followUps.map(f => ({ ...f, customerName: C(db, f.customerId).name, phone: C(db, f.customerId).phone })).sort((a, b) => a.due.localeCompare(b.due))],
  ['POST', '/orgs/:org/followups/generate', (p, _b, _q, ctx, db) => {
    need(ctx, DESK); let added = 0; const has = (cid: string, reason: string) => db.followUps.some(f => f.customerId === cid && f.reason === reason && f.status === 'open');
    for (const c of db.customers.filter(c => c.orgId === p.org)) if (segments(c, db.bookings, false, Infinity).includes('inactive') && !has(c.id, 'inactive')) { db.followUps.push({ id: uid('fu'), customerId: c.id, reason: 'inactive', due: today(), status: 'open', note: 'No booking in 30+ days. Offer a slot.' }); added++; }
    for (const m of db.vmemberships) if (membershipState(m, planOf(db, m), today()) === 'active' && m.endDate <= addDays(today(), 7) && !has(m.customerId, 'expiring')) { db.followUps.push({ id: uid('fu'), customerId: m.customerId, reason: 'expiring', due: today(), status: 'open', note: `${planOf(db, m).name} ends ${m.endDate}` }); added++; }
    return { added }; // idempotent: re-running adds nothing new
  }],
  ['PATCH', '/followups/:id', (p, b, _q, ctx, db) => { need(ctx, DESK); const f = db.followUps.find(x => x.id === p.id) ?? notFound('follow-up'); Object.assign(f, { status: b.status ?? f.status, note: b.note ?? f.note, due: b.due ?? f.due }); return f; }],
  ['POST', '/orgs/:org/campaigns', (p, b, _q, ctx, db) => {
    need(ctx, MGR); if (!b.title?.trim() || !b.body?.trim()) invalid('Add a title and a message');
    const list = customerRows(db, p.org, { segment: b.segment || null });
    const ok = list.filter(c => c.consent.marketing && c.consent.whatsapp); // opt-in is enforced here, not in the UI
    audit(db, ctx, { orgId: p.org }, 'campaign', uid('cmp'), `sent "${b.title}" to ${ok.length}`, `segment ${b.segment || 'all'}; ${list.length - ok.length} skipped (no consent)`);
    return { sent: ok.length, skipped: list.length - ok.length };
  }],

  // ---- memberships ----
  ['GET', '/orgs/:org/plans', (p, _b, _q, _c, db) => db.plans.filter(x => x.orgId === p.org).map(x => ({ ...x, members: db.vmemberships.filter(m => m.planId === x.id && membershipState(m, x, today()) === 'active').length }))],
  ['POST', '/orgs/:org/plans', (p, b, _q, ctx, db) => { need(ctx, OWNER); const x: Plan = { ...validPlan(b), id: uid('pl'), orgId: p.org, active: true }; db.plans.push(x); audit(db, ctx, { orgId: p.org }, 'plan', x.id, `created ${x.name}`); return x; }],
  ['PATCH', '/plans/:id', (p, b, _q, ctx, db) => { need(ctx, OWNER); const x = db.plans.find(y => y.id === p.id) ?? notFound('plan'); const before = { ...x }; Object.assign(x, validPlan({ ...x, ...b })); audit(db, ctx, { orgId: x.orgId }, 'plan', x.id, 'updated (existing members keep their terms until renewal)', undefined, { before, after: { ...x } }); return x; }],
  ['GET', '/orgs/:org/memberships', (_p, _b, q, _c, db) => db.vmemberships.map(m => { const plan = planOf(db, m); return { ...m, status: membershipState(m, plan, today()), plan, customerName: C(db, m.customerId).name, usedPct: plan.hours ? 1 - m.hoursLeft / (plan.hours || 1) : 0 }; })
    .filter(m => !q.get('status') || m.status === q.get('status')).sort((a, b) => a.endDate.localeCompare(b.endDate))],
  ['POST', '/orgs/:org/memberships', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const plan = db.plans.find(x => x.id === b.planId && x.active) ?? notFound('plan'), cu = C(db, b.customerId);
    if (activeMembership(db, cu.id)) throw new ApiError(409, 'already_member', `${cu.name} already has an active membership`);
    if ((b.memberIds?.length ?? 0) + 1 > plan.maxMembers) invalid(`This plan covers up to ${plan.maxMembers} people`, 'memberIds');
    const start = b.startDate ?? today(), m: VMembership = { id: uid('ms'), planId: plan.id, customerId: cu.id, memberIds: b.memberIds ?? [], startDate: start, endDate: addDays(start, PERIOD_DAYS[plan.period] - 1), status: 'active', hoursLeft: plan.hours, walletPaise: plan.walletPaise, autoRenew: !!b.autoRenew, fixedSlots: [] };
    db.vmemberships.push(m); ledger(db, ctx, m.id, 'enrol', plan.hours, plan.pricePaise, `Enrolled in ${plan.name}`); audit(db, ctx, { orgId: p.org }, 'membership', m.id, `enrolled ${cu.name} in ${plan.name}`); return m;
  }],
  ['GET', '/vmemberships/:id', (p, _b, _q, _c, db) => { const m = M(db, p.id), plan = planOf(db, m); return { ...m, plan, status: membershipState(m, plan, today()), customer: C(db, m.customerId), ledger: db.ledger.filter(l => l.membershipId === m.id), bookings: db.bookings.filter(b => b.membershipId === m.id) }; }],
  ['POST', '/vmemberships/:id/renew', (p, _b, _q, ctx, db) => {
    need(ctx, DESK); const m = M(db, p.id), plan = planOf(db, m); if (m.status === 'cancelled') throw new ApiError(409, 'bad_state', 'Cancelled memberships can’t be renewed. Enrol again.');
    const { next, rolled } = renew(m, plan, today()); const expired = m.hoursLeft - rolled; Object.assign(m, next);
    if (expired > 0) ledger(db, ctx, m.id, 'expired', -expired, 0, `${expired} unused h lapsed (${100 - plan.rolloverPct}% of balance)`);
    ledger(db, ctx, m.id, 'rollover', rolled, 0, `${rolled} h rolled over`); ledger(db, ctx, m.id, 'enrol', plan.hours, plan.pricePaise, `Renewed ${plan.name} to ${m.endDate}`); return m;
  }],
  ['POST', '/vmemberships/:id/cancel', (p, b, _q, ctx, db) => { need(ctx, MGR); if (!b.reason?.trim()) invalid('Give a reason', 'reason'); const m = M(db, p.id); m.status = 'cancelled'; m.autoRenew = false; audit(db, ctx, { orgId: 'densparq' }, 'membership', m.id, 'cancelled', b.reason); return m; }],
  ['POST', '/vmemberships/:id/adjust', (p, b, _q, ctx, db) => { need(ctx, MGR); if (!b.note?.trim()) invalid('Adjustments need a reason', 'note'); const m = M(db, p.id); m.hoursLeft = Math.max(0, m.hoursLeft + (+b.hours || 0)); m.walletPaise = Math.max(0, m.walletPaise + (+b.paise || 0)); ledger(db, ctx, m.id, b.paise > 0 ? 'topup' : 'adjust', +b.hours || 0, +b.paise || 0, b.note); return m; }],
  ['PUT', '/vmemberships/:id/fixed-slots', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const m = M(db, p.id), cu = C(db, m.customerId), created: Booking[] = [], skipped: { date: string; courtId: string; reason: string }[] = [];
    m.fixedSlots = b.slots;
    for (const s of m.fixedSlots) {
      const court = db.courts.find(c => c.id === s.courtId) ?? notFound('court'), pr = P(db, court.venueId);
      let first = today(); while (new Date(`${first}T12:00:00Z`).getUTCDay() !== s.weekday) first = addDays(first, 1);
      for (const date of weekly(first, addDays(first, 21))) { // next 4 weeks; a nightly job keeps the window rolling
        const startAt = atIST(date, toMin(s.start)), endAt = new Date(Date.parse(startAt) + s.minutes * 60000).toISOString();
        if (db.bookings.some(x => x.membershipId === m.id && x.startAt === startAt && x.courtId === s.courtId)) continue;
        const cf = conflicts({ courtId: s.courtId, startAt, endAt }, pr, db.bookings, blocksFor(db, court.venueId)).filter(blocking); if (cf.length) { skipped.push({ date, courtId: s.courtId, reason: cf[0].message }); continue; }
        const q = priceFor(db, { venueId: court.venueId, sport: court.sports[0], startAt, endAt, customerId: cu.id, override: { totalPaise: Math.round(s.ratePaise * s.minutes / 60), reason: 'Fixed-slot member rate' } });
        const bk: Booking = { id: uid('bk'), orgId: cu.orgId, venueId: court.venueId, courtId: s.courtId, customerId: cu.id, customerName: cu.name, startAt, endAt, sport: court.sports[0], source: 'phone', status: 'pending_payment', quote: q, paidPaise: 0, refundPaise: 0, membershipId: m.id, notes: 'Fixed slot', createdAt: now(), createdBy: ctx.userId };
        db.bookings.push(bk); created.push(bk);
      }
    }
    audit(db, ctx, { orgId: cu.orgId }, 'membership', m.id, `fixed slots saved · ${created.length} booked, ${skipped.length} skipped`); return { created: created.length, skipped };
  }],

  // ---- analytics ----
  ['GET', '/orgs/:org/analytics', (p, _b, q, ctx, db) => { need(ctx, MGR); const v = q.get('venueId') || null; if (v) scope(db, ctx, v); return analytics(db, p.org, v, { from: q.get('from') ?? addDays(today(), -29), to: q.get('to') ?? today() }); }],
  ['GET', '/orgs/:org/analytics/bookings', (_p, _b, q, ctx, db) => {
    need(ctx, MGR); const f = (k: string) => q.get(k);
    return db.bookings.filter(b => { const s = ist(b.startAt); return (!f('venueId') || b.venueId === f('venueId')) && s.date >= (f('from') ?? '') && s.date <= (f('to') ?? '9999') && (f('weekday') == null || s.weekday === +f('weekday')!) && (f('hour') == null || Math.floor(s.min / 60) === +f('hour')!)
      && (!f('sport') || b.sport === f('sport')) && (!f('source') || b.source === f('source')) && (!f('status') || b.status === f('status')); }).slice(0, 500);
  }],

  // ---- public court booking (no login) ----
  ['GET', '/public/venues/:id/slots', (p, _b, q, _c, db) => {
    const date = q.get('date') ?? today(), sport = q.get('sport') as Booking['sport'], pr = db.profiles.find(x => x.venueId === p.id) ?? notFound('venue'), blocks = allBlocks(db), nowMs = Date.now();
    const courts = db.courts.filter(c => c.venueId === p.id && c.sports.includes(sport) && db.courtMeta.find(m => m.courtId === c.id)?.active !== false);
    const slots = []; for (let m = toMin(pr.open); m + 60 <= toMin(pr.close); m += 60) { const startAt = atIST(date, m), endAt = atIST(date, m + 60); if (Date.parse(startAt) < nowMs) continue;
      const free = courts.filter(c => !conflicts({ courtId: c.id, startAt, endAt }, pr, db.bookings, blocks).some(blocking));
      if (free.length) slots.push({ start: `${String(m / 60).padStart(2, '0')}:00`, courts: free.map(c => ({ id: c.id, name: c.name })), pricePaise: quote({ venueId: p.id, sport, startAt, endAt, rules: db.rateRules.filter(r => r.venueId === p.id), profile: pr, offers: [], isNewCustomer: false }).totalPaise }); }
    return slots;
  }],
  ['POST', '/public/venues/:id/bookings', (p, b, _q, _c, db) => {
    if (!b.name?.trim() || !/^\d{10}$/.test(b.phone ?? '')) invalid('Name and a 10-digit mobile number are required');
    const pr = db.profiles.find(x => x.venueId === p.id) ?? notFound('venue'), startAt = atIST(b.date, toMin(b.start)), endAt = new Date(Date.parse(startAt) + (b.minutes ?? 60) * 60000).toISOString();
    if (Date.parse(startAt) < Date.now()) invalid('That time has passed'); const cf = conflicts({ courtId: b.courtId, startAt, endAt }, pr, db.bookings, allBlocks(db)).filter(blocking);
    if (cf.length) throw new ApiError(409, 'unavailable', 'Someone just took that slot. Pick another.', cf);
    let cu = db.customers.find(c => c.phone === b.phone); if (!cu) { cu = { id: uid('cu'), orgId: 'densparq', name: b.name.trim(), phone: b.phone, sports: [b.sport], consent: { whatsapp: !!b.whatsapp, marketing: false, at: now() }, tags: [], notes: [], createdAt: now() }; db.customers.push(cu); }
    const q = quote({ venueId: p.id, sport: b.sport, startAt, endAt, rules: db.rateRules.filter(r => r.venueId === p.id), profile: pr, offers: db.offers, code: b.code, isNewCustomer: !db.bookings.some(x => x.customerId === cu!.id && LIVE.includes(x.status)), contract: db.customerRates.find(r => r.customerId === cu!.id) });
    const bk: Booking = { id: uid('bk'), orgId: 'densparq', venueId: p.id, courtId: b.courtId, customerId: cu.id, customerName: cu.name, startAt, endAt, sport: b.sport, source: 'app', status: 'pending_payment', quote: q, paidPaise: 0, refundPaise: 0, notes: 'Online booking', createdAt: now(), createdBy: 'public' };
    db.bookings.push(bk); return { id: bk.id, totalPaise: q.totalPaise, lines: q.lines };
  }],
  ['POST', '/public/bookings/:id/pay', (p, _b, _q, _c, db) => { const bk = db.bookings.find(x => x.id === p.id) ?? notFound('booking'); if (bk.status !== 'pending_payment') throw new ApiError(409, 'bad_state', 'Already paid'); Object.assign(bk, { status: 'confirmed', paidPaise: bk.quote.totalPaise }); return { status: bk.status, receipt: `DSQ-B-${Date.now().toString().slice(-6)}` }; }],
];

function validRule(db: DB, b: RateRule, venueId: string, selfId?: string): Omit<RateRule, 'id' | 'venueId'> {
  if (toMin(b.to) <= toMin(b.from)) invalid('“To” must be after “From”', 'to');
  if (!(b.minPaise <= b.pricePaise && b.pricePaise <= b.maxPaise)) invalid('Price must sit between the min and max guardrails', 'pricePaise');
  const clash = db.rateRules.find(r => r.id !== selfId && r.venueId === venueId && r.sport === b.sport && r.dayType === b.dayType && toMin(r.from) < toMin(b.to) && toMin(b.from) < toMin(r.to));
  if (clash) invalid(`Overlaps the ${clash.from}–${clash.to} rule`, 'from');
  return { sport: b.sport, dayType: b.dayType, from: b.from, to: b.to, band: b.band, pricePaise: +b.pricePaise, minPaise: +b.minPaise, maxPaise: +b.maxPaise };
}
function validOffer(db: DB, b: any, selfId?: string) {
  if (!b.name?.trim()) invalid('Name the offer', 'name'); if (!(b.value > 0)) invalid('Enter a discount', 'value'); if (b.kind === 'percent' && b.value > 90) invalid('At most 90% off', 'value');
  if (b.validTo < b.validFrom) invalid('Ends before it starts', 'validTo');
  const code = b.code?.trim().toUpperCase() || undefined; if (code && db.offers.some(o => o.code === code && o.id !== selfId)) invalid('Code already in use', 'code');
  return { name: b.name.trim(), code, kind: b.kind, value: +b.value, stackable: !!b.stackable, validFrom: b.validFrom, validTo: b.validTo, bands: b.bands?.length ? b.bands : undefined, sports: b.sports?.length ? b.sports : undefined, newCustomersOnly: !!b.newCustomersOnly, minHours: +b.minHours || 0, maxUses: b.maxUses ? +b.maxUses : undefined, active: b.active ?? true };
}
function validPlan(b: any): Omit<Plan, 'id' | 'orgId' | 'active'> & { active?: boolean } {
  if (!b.name?.trim()) invalid('Name the plan', 'name'); if (!(b.pricePaise > 0)) invalid('Set a price', 'pricePaise'); if (!b.sports?.length) invalid('Pick sports', 'sports');
  if (!(+b.hours > 0 || +b.discountPct > 0 || +b.walletPaise > 0)) invalid('A plan needs hours, a discount or wallet credit', 'hours');
  return { name: b.name.trim(), tier: b.tier, period: b.period, pricePaise: +b.pricePaise, hours: +b.hours || 0, walletPaise: +b.walletPaise || 0, discountPct: +b.discountPct || 0, sports: b.sports, peakAllowed: !!b.peakAllowed, rolloverPct: +b.rolloverPct || 0, graceDays: +b.graceDays || 0, cancelNoticeHours: +b.cancelNoticeHours || 0, maxMembers: Math.max(1, +b.maxMembers || 1), active: b.active };
}
