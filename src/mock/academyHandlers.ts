// Academy mock API + public home/booking endpoints. Rules in src/domain/academy.ts; this file does access, persistence, side effects.
import { type DB, allBlocks } from './db';
import { ApiError, now, need, notFound, invalid, audit, userName, type Ctx, type Route } from './core';
import { uid } from '@/domain/fixtures';
import { addDays, ist, conflicts, blocking, atIST, toMin } from '@/domain/venue';
import {
  sessions, batchClashes, attendanceRate, ageOn, fitsBatch, netDue, paid, invStatus, monthlyInvoices, progress, cohortRank, funnel, retention, LEAD_MOVES,
  type Batch, type Athlete, type Invoice, type Assessment, type Lead, type AttStatus,
} from '@/domain/academy';
import type { Role } from '@/domain/types';

const MGR: Role[] = ['org_admin', 'branch_manager'], STAFF: Role[] = ['org_admin', 'branch_manager', 'front_desk', 'coach'], DESK: Role[] = ['org_admin', 'branch_manager', 'front_desk'];
const today = () => ist(now()).date;
const Bt = (db: DB, id: string) => db.batches.find(b => b.id === id) ?? notFound('batch');
const At = (db: DB, id: string) => db.athletes.find(a => a.id === id) ?? notFound('athlete');
const Iv = (db: DB, id: string) => db.invoices.find(i => i.id === id) ?? notFound('invoice');
const Ld = (db: DB, id: string) => db.leads.find(l => l.id === id) ?? notFound('lead');
const venueOf = (db: DB, b: Batch) => db.academies.find(a => a.id === b.academyId)!.venueId;
const holidays = (db: DB, b: Batch) => db.profiles.find(p => p.venueId === venueOf(db, b))?.holidays.map(h => h.date) ?? [];
const activeEnr = (db: DB, batchId: string) => db.enrollments.filter(e => e.batchId === batchId && e.status === 'active');
/** Coaches act only on batches they coach; other staff roles on all. */
const coachScope = (ctx: Ctx, b: Batch) => { if (ctx.role === 'coach' && b.coach.userId !== ctx.userId) throw new ApiError(403, 'forbidden', 'You can only update your own batches'); };
const athleteBatches = (db: DB, athleteId: string) => db.enrollments.filter(e => e.athleteId === athleteId).map(e => Bt(db, e.batchId));
/** Who may read an athlete: staff; the guardian linked to the athlete. Coaches: only athletes in their batches. */
function canRead(db: DB, ctx: Ctx, a: Athlete) {
  if (ctx.role === 'guardian') { if (a.guardian?.userId !== ctx.userId) throw new ApiError(403, 'forbidden', 'You can only see your own child'); return; }
  if (ctx.role === 'coach' && !athleteBatches(db, a.id).some(b => b.coach.userId === ctx.userId)) throw new ApiError(403, 'forbidden', 'Not in your batches');
  need(ctx, STAFF);
}
const log = (a: Athlete, ctx: Ctx, db: DB, change: string) => a.history.unshift({ at: now(), by: userName(db, ctx.userId), change });
const notice = (db: DB, athleteId: string, kind: DB['notices'][number]['kind'], text: string) => { const a = At(db, athleteId); db.notices.unshift({ id: uid('nt'), athleteId, kind, text, at: now(), whatsapp: !!a.guardian?.consentAt || !a.guardian }); };
const invView = (i: Invoice) => ({ ...i, netPaise: netDue(i), paidPaise: paid(i), balancePaise: Math.max(0, netDue(i) - paid(i)), status: invStatus(i, today()) });

function batchView(db: DB, b: Batch) {
  const enr = activeEnr(db, b.id), att = db.attendance.filter(a => a.batchId === b.id && a.date >= addDays(today(), -30));
  const next = sessions(b, today(), addDays(today(), 14), db.sessionChanges, holidays(db, b)).filter(s => s.status !== 'cancelled' && s.status !== 'holiday')[0];
  return { ...b, enrolled: enr.length, seats: b.capacity - enr.length, attendance30: attendanceRate(att), next, courts: [...new Set(b.schedule.map(s => db.courts.find(c => c.id === s.courtId)?.name))] };
}
function stats(db: DB, a: Athlete) {
  const out = a.sports.map(sport => {
    const t = db.metricTemplates.find(x => x.sport === sport); const list = db.assessments.filter(x => x.athleteId === a.id && x.sport === sport);
    // cohort: same sport, level, and age within the athlete's batch band
    const b = athleteBatches(db, a.id).find(x => x.sport === sport), cohort = b ? db.athletes.filter(x => x.sports.includes(sport) && x.level === a.level && fitsBatch(x, b, today())).map(x => x.id) : [];
    const latest = new Map(cohort.map(id => [id, db.assessments.filter(x => x.athleteId === id && x.sport === sport).sort((p, q) => q.date.localeCompare(p.date))[0]]).filter(([, v]) => v) as [string, Assessment][]);
    return { sport, template: t, assessments: list.sort((p, q) => q.date.localeCompare(p.date)), progress: t ? progress(t, list) : [], rank: t ? cohortRank(a.id, t, latest, cohort) : null, cohortSize: latest.size, cohortRule: b ? `${sport}, ${a.level}, age ${b.ageMin}–${b.ageMax}` : '' };
  });
  const tournament = a.playerId ? { stats: db.stats.filter(s => s.playerId === a.playerId), matches: db.matches.filter(m => db.registrations.some(r => r.playerIds.includes(a.playerId!) && (r.id === m.homeId || r.id === m.awayId)) && m.result).map(m => ({ code: m.code, date: m.startAt, result: m.result!.detail, verified: m.result!.verification === 'verified' })) } : null;
  const matches = db.athleteMatches.filter(m => m.athleteId === a.id).sort((p, q) => q.date.localeCompare(p.date));
  return { sports: out, matches, record: { played: matches.length, won: matches.filter(m => m.result === 'W').length, lost: matches.filter(m => m.result === 'L').length }, tournament };
}
function athleteView(db: DB, a: Athlete) {
  const enr = db.enrollments.filter(e => e.athleteId === a.id), att = db.attendance.filter(x => x.athleteId === a.id), inv = db.invoices.filter(i => i.athleteId === a.id && !i.voided).map(invView);
  return { ...a, age: ageOn(a.dob, today()), enrollments: enr.map(e => ({ ...e, batch: Bt(db, e.batchId).name })), attendance30: attendanceRate(att.filter(x => x.date >= addDays(today(), -30))), attendance: att.slice(-40).reverse(),
    invoices: inv.sort((p, q) => q.period.localeCompare(p.period)), balancePaise: inv.reduce((s, i) => s + i.balancePaise, 0), notices: db.notices.filter(n => n.athleteId === a.id).slice(0, 10) };
}
function overview(db: DB, academyId: string | null, from: string, to: string) {
  const bs = db.batches.filter(b => !academyId || b.academyId === academyId), ids = new Set(bs.map(b => b.id)), enr = db.enrollments.filter(e => ids.has(e.batchId));
  const active = new Set(enr.filter(e => e.status === 'active').map(e => e.athleteId)), att = db.attendance.filter(a => ids.has(a.batchId) && a.date >= from && a.date <= to);
  const inv = db.invoices.filter(i => !i.voided && (!academyId || i.academyId === academyId)).map(invView), inRange = (iso: string) => ist(iso).date >= from && ist(iso).date <= to;
  const collected = inv.flatMap(i => i.payments).filter(p => inRange(p.at)).reduce((s, p) => s + p.amountPaise, 0), outstanding = inv.filter(i => ['due', 'overdue', 'partial'].includes(i.status)).reduce((s, i) => s + i.balancePaise, 0);
  const assessed = new Set(db.assessments.filter(a => a.date >= addDays(to, -60)).map(a => a.athleteId));
  const improvements = [...active].map(id => { const a = At(db, id); return { id, name: a.name, gains: stats(db, a).sports.flatMap(s => s.progress.filter(p => p.improved && p.points.length > 1)).length }; }).sort((p, q) => q.gains - p.gains);
  const leads = db.leads.filter(l => (!academyId || l.academyId === academyId) && ist(l.createdAt).date >= from && ist(l.createdAt).date <= to);
  const byBatch = bs.map(b => { const bi = inv.filter(i => i.batchId === b.id); return { id: b.id, name: b.name, sport: b.sport, enrolled: activeEnr(db, b.id).length, capacity: b.capacity, attendance: attendanceRate(att.filter(a => a.batchId === b.id)),
    retention: retention(db.enrollments.filter(e => e.batchId === b.id), from, to), assessed: activeEnr(db, b.id).filter(e => assessed.has(e.athleteId)).length,
    collectedPaise: bi.flatMap(i => i.payments).filter(p => inRange(p.at)).reduce((s, p) => s + p.amountPaise, 0), outstandingPaise: bi.filter(i => i.status !== 'paid').reduce((s, i) => s + i.balancePaise, 0) }; });
  const dueSoon = [...active].filter(id => !assessed.has(id)).length, overdue = inv.filter(i => i.status === 'overdue');
  return { activeAthletes: active.size, batches: bs.length, seats: bs.reduce((s, b) => s + b.capacity, 0), attendance: attendanceRate(att), retention: retention(enr, from, to), collectedPaise: collected, outstandingPaise: outstanding,
    assessmentCompletion: active.size ? (active.size - dueSoon) / active.size : 0, funnel: funnel(leads), mostImproved: improvements.slice(0, 5), byBatch,
    alerts: [...(overdue.length ? [{ kind: 'money', text: `${overdue.length} fee invoices overdue (${(overdue.reduce((s, i) => s + i.balancePaise, 0) / 100).toLocaleString('en-IN')} ₹)`, to: 'payments?status=overdue' }] : []),
      ...(dueSoon ? [{ kind: 'neutral', text: `${dueSoon} athletes have no assessment in 60 days`, to: 'player-stats' }] : []),
      ...bs.filter(b => (attendanceRate(att.filter(a => a.batchId === b.id)) ?? 1) < 0.75).map(b => ({ kind: 'danger', text: `${b.name}: attendance under 75%`, to: `batches?id=${b.id}` })),
      ...(db.leads.filter(l => l.followUp && l.followUp <= today() && !['enrolled', 'lost'].includes(l.stage)).length ? [{ kind: 'neutral', text: `${db.leads.filter(l => l.followUp && l.followUp <= today() && !['enrolled', 'lost'].includes(l.stage)).length} admissions follow-ups due`, to: 'admissions' }] : [])] };
}
function enrolInto(db: DB, ctx: Ctx, a: Athlete, b: Batch, start = today()) {
  if (activeEnr(db, b.id).length >= b.capacity) throw new ApiError(409, 'full', `${b.name} is full (${b.capacity})`);
  if (db.enrollments.some(e => e.athleteId === a.id && e.batchId === b.id && e.status === 'active')) throw new ApiError(409, 'duplicate', 'Already in this batch');
  const e = { id: uid('en'), athleteId: a.id, batchId: b.id, start, status: 'active' as const }; db.enrollments.push(e);
  if (!db.invoices.some(i => i.athleteId === a.id && i.planId === 'fp_adm')) db.invoices.push({ id: uid('iv'), athleteId: a.id, academyId: b.academyId, planId: 'fp_adm', period: start.slice(0, 7), amountPaise: db.feePlans.find(p => p.id === 'fp_adm')?.amountPaise ?? 0, discountPaise: 0, scholarshipPct: 0, dueDate: addDays(start, 7), payments: [], refundPaise: 0, voided: false, createdAt: now(), remindersSent: 0 });
  log(a, ctx, db, `Enrolled in ${b.name}`); if (!a.sports.includes(b.sport)) a.sports.push(b.sport); return e;
}

export const academyRoutes: Route[] = [
  // ---- overview & reports ----
  ['GET', '/orgs/:org/academies', (p, _b, _q, _c, db) => db.academies.filter(a => a.orgId === p.org)],
  ['GET', '/orgs/:org/academy/overview', (_p, _b, q, ctx, db) => { need(ctx, [...MGR, 'front_desk']); return overview(db, q.get('academyId'), q.get('from') ?? addDays(today(), -29), q.get('to') ?? today()); }],

  // ---- batches ----
  ['GET', '/academies/:id/batches', (p, _b, _q, ctx, db) => { need(ctx, STAFF); return db.batches.filter(b => b.academyId === p.id && (ctx.role !== 'coach' || b.coach.userId === ctx.userId)).map(b => batchView(db, b)); }],
  ['POST', '/academies/:id/batches', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const x: Batch = { ...validBatch(b), id: uid('bt'), academyId: p.id, active: true };
    const cl = batchClashes(x, db.batches, db.sessionChanges, db.bookings, x.startDate > today() ? x.startDate : today());
    if (cl.length) throw new ApiError(409, 'clashes', `${cl.length} session(s) clash with court bookings or other batches`, cl.slice(0, 20));
    db.batches.push(x); audit(db, ctx, { orgId: 'densparq' }, 'batch', x.id, `created ${x.name}`); return x;
  }],
  ['PATCH', '/batches/:id', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const x = Bt(db, p.id), next: Batch = { ...x, ...validBatch({ ...x, ...b }), active: b.active ?? x.active };
    if (b.schedule) { const cl = batchClashes(next, db.batches, db.sessionChanges, db.bookings, today()); if (cl.length) throw new ApiError(409, 'clashes', `${cl.length} session(s) clash`, cl.slice(0, 20)); }
    if (b.capacity != null && b.capacity < activeEnr(db, x.id).length) invalid(`${activeEnr(db, x.id).length} athletes are enrolled. Move some first.`, 'capacity');
    Object.assign(x, next); if (b.schedule) activeEnr(db, x.id).forEach(e => notice(db, e.athleteId, 'schedule', `${x.name}: timetable changed`));
    audit(db, ctx, { orgId: 'densparq' }, 'batch', x.id, 'updated'); return x;
  }],
  ['GET', '/batches/:id', (p, _b, q, ctx, db) => {
    const b = Bt(db, p.id); need(ctx, STAFF); coachScope(ctx, b); const date = q.get('date') ?? today();
    const roster = activeEnr(db, b.id).map(e => { const a = At(db, e.athleteId); return { id: a.id, name: a.name, age: ageOn(a.dob, today()), fits: fitsBatch(a, b, today()), attendance30: attendanceRate(db.attendance.filter(x => x.athleteId === a.id && x.batchId === b.id && x.date >= addDays(today(), -30))), mark: db.attendance.find(x => x.athleteId === a.id && x.batchId === b.id && x.date === date)?.status }; });
    return { ...batchView(db, b), roster, date, sessions: sessions(b, addDays(today(), -14), addDays(today(), 28), db.sessionChanges, holidays(db, b)), changes: db.sessionChanges.filter(c => c.batchId === b.id) };
  }],
  ['POST', '/batches/:id/sessions/change', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const x = Bt(db, p.id); if (!b.reason?.trim()) invalid('Give a reason', 'reason');
    if (!sessions(x, b.date, b.date, []).length) invalid('No session on that date', 'date');
    if (b.kind === 'rescheduled') {
      const s = { courtId: b.newCourtId ?? x.schedule[0].courtId, startAt: atIST(b.newDate ?? b.date, toMin(b.newStart)), endAt: '' }; s.endAt = new Date(Date.parse(s.startAt) + x.schedule[0].minutes * 60000).toISOString();
      const cf = conflicts(s, db.profiles.find(pr => pr.venueId === venueOf(db, x))!, db.bookings, allBlocks(db).filter(k => !k.id.startsWith(`ses_${x.id}_${b.date}`))).filter(blocking);
      if (cf.length) throw new ApiError(409, 'unavailable', cf[0].message, cf);
    }
    db.sessionChanges = db.sessionChanges.filter(c => !(c.batchId === x.id && c.date === b.date));
    const c = { id: uid('sc'), batchId: x.id, date: b.date, kind: b.kind, newDate: b.newDate, newStart: b.newStart, newCourtId: b.newCourtId, reason: b.reason, by: ctx.userId, at: now() }; db.sessionChanges.push(c);
    activeEnr(db, x.id).forEach(e => notice(db, e.athleteId, 'schedule', `${x.name} on ${b.date}: ${b.kind === 'cancelled' ? 'cancelled' : `moved to ${b.newDate ?? b.date} ${b.newStart}`} (${b.reason})`));
    audit(db, ctx, { orgId: 'densparq' }, 'batch', x.id, `session ${b.date} ${b.kind}`, b.reason); return c;
  }],
  ['PUT', '/batches/:id/attendance', (p, b, _q, ctx, db) => {
    const x = Bt(db, p.id); need(ctx, STAFF); coachScope(ctx, x); if (b.date > today()) invalid('Can’t mark future sessions', 'date');
    const alerts: string[] = [];
    for (const [athleteId, status] of Object.entries(b.marks as Record<string, AttStatus>)) {
      const row = db.attendance.find(a => a.athleteId === athleteId && a.batchId === x.id && a.date === b.date);
      if (row) { if (row.status !== status) log(At(db, athleteId), ctx, db, `Attendance ${b.date}: ${row.status} → ${status}`); Object.assign(row, { status, by: ctx.userId, at: now() }); }
      else db.attendance.push({ id: uid('a'), batchId: x.id, athleteId, date: b.date, status, by: ctx.userId, at: now() });
      const last = db.attendance.filter(a => a.athleteId === athleteId && a.batchId === x.id).sort((p2, q) => q.date.localeCompare(p2.date)).slice(0, 2);
      if (last.length === 2 && last.every(a => a.status === 'absent')) { notice(db, athleteId, 'attendance', `${At(db, athleteId).name} missed 2 sessions in a row`); alerts.push(At(db, athleteId).name); }
    }
    return { saved: Object.keys(b.marks).length, alerts };
  }],

  // ---- athletes ----
  ['GET', '/orgs/:org/athletes', (p, _b, q, ctx, db) => {
    need(ctx, STAFF); const s = q.get('q')?.toLowerCase(), bid = q.get('batchId'), st = q.get('status') ?? 'active';
    return db.athletes.filter(a => a.orgId === p.org).map(a => { const enr = db.enrollments.filter(e => e.athleteId === a.id); return { ...a, age: ageOn(a.dob, today()), batches: enr.filter(e => e.status === 'active').map(e => Bt(db, e.batchId).name), batchIds: enr.filter(e => e.status === 'active').map(e => e.batchId),
      status: enr.some(e => e.status === 'active') ? 'active' : 'inactive', attendance30: attendanceRate(db.attendance.filter(x => x.athleteId === a.id && x.date >= addDays(today(), -30))), balancePaise: db.invoices.filter(i => i.athleteId === a.id && !i.voided).reduce((t, i) => t + Math.max(0, netDue(i) - paid(i)), 0) }; })
      .filter(a => (st === 'all' || a.status === st) && (!bid || a.batchIds.includes(bid)) && (!s || a.name.toLowerCase().includes(s) || a.guardian?.phone.includes(s) || a.phone?.includes(s)))
      .filter(a => ctx.role !== 'coach' || athleteBatches(db, a.id).some(b => b.coach.userId === ctx.userId)).sort((x, y) => x.name.localeCompare(y.name));
  }],
  ['POST', '/orgs/:org/athletes', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const a = validAthlete(b, p.org); db.athletes.push(a); log(a, ctx, db, 'Profile created');
    if (b.batchId) enrolInto(db, ctx, a, Bt(db, b.batchId)); return a;
  }],
  ['GET', '/athletes/:id', (p, _b, _q, ctx, db) => { const a = At(db, p.id); canRead(db, ctx, a); return athleteView(db, a); }],
  ['PATCH', '/athletes/:id', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const a = At(db, p.id), fields = ['name', 'phone', 'level', 'statsVisibility', 'guardian'] as const;
    for (const f of fields) if (b[f] !== undefined && JSON.stringify(b[f]) !== JSON.stringify(a[f])) { log(a, ctx, db, f === 'guardian' ? 'Guardian details updated' : `${f}: ${String(a[f] ?? '—')} → ${String(b[f])}`); Object.assign(a, { [f]: b[f] }); }
    if (ageOn(a.dob, today()) < 18 && !a.guardian?.consentAt) invalid('Minors need guardian consent', 'guardian'); return a;
  }],
  ['POST', '/athletes/:id/enrol', (p, b, _q, ctx, db) => { need(ctx, DESK); return enrolInto(db, ctx, At(db, p.id), Bt(db, b.batchId), b.start); }],
  ['POST', '/enrollments/:id/transfer', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const e = db.enrollments.find(x => x.id === p.id) ?? notFound('enrollment'); if (!b.reason?.trim()) invalid('Give a reason', 'reason');
    const to = Bt(db, b.batchId), a = At(db, e.athleteId), n = enrolInto(db, ctx, a, to); Object.assign(e, { status: 'transferred', end: today(), reason: b.reason }); log(a, ctx, db, `Transferred to ${to.name}: ${b.reason}`); return n;
  }],
  ['POST', '/enrollments/:id/end', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const e = db.enrollments.find(x => x.id === p.id) ?? notFound('enrollment'); if (!b.reason?.trim()) invalid('Give a reason', 'reason');
    Object.assign(e, { status: b.status === 'paused' ? 'paused' : 'left', end: b.status === 'paused' ? undefined : today(), reason: b.reason }); log(At(db, e.athleteId), ctx, db, `${b.status === 'paused' ? 'Paused' : 'Left'} ${Bt(db, e.batchId).name}: ${b.reason}`); return e;
  }],

  // ---- fees ----
  ['GET', '/orgs/:org/fees', (_p, _b, q, ctx, db) => {
    need(ctx, DESK); const st = q.get('status'), period = q.get('period');
    const list = db.invoices.filter(i => !i.voided && (!period || i.period === period)).map(i => ({ ...invView(i), athlete: At(db, i.athleteId).name, plan: db.feePlans.find(f => f.id === i.planId)?.name, batch: i.batchId ? Bt(db, i.batchId).name : '—' })).filter(i => !st || i.status === st);
    return { plans: db.feePlans, invoices: list.sort((a, b) => b.dueDate.localeCompare(a.dueDate)).slice(0, 400), totals: { outstandingPaise: list.filter(i => i.status !== 'paid').reduce((s, i) => s + i.balancePaise, 0), overdue: list.filter(i => i.status === 'overdue').length } };
  }],
  ['POST', '/academies/:id/fee-plans', (p, b, _q, ctx, db) => { need(ctx, MGR); if (!b.name?.trim() || !(b.amountPaise > 0)) invalid('Name and amount required'); const f = { id: uid('fp'), academyId: p.id, name: b.name, kind: b.kind, amountPaise: +b.amountPaise, months: +b.months || 0, batchIds: b.batchIds ?? [] }; db.feePlans.push(f); audit(db, ctx, { orgId: 'densparq' }, 'fee_plan', f.id, `created ${f.name}`); return f; }],
  ['POST', '/orgs/:org/invoices/generate', (_p, b, _q, ctx, db) => {
    need(ctx, MGR); if (!/^\d{4}-\d{2}$/.test(b.period ?? '')) invalid('Pick a month', 'period');
    const add = monthlyInvoices(b.period, db.enrollments, db.feePlans, db.batches, db.invoices).map(i => ({ ...i, id: uid('iv'), createdAt: now() })); db.invoices.push(...add); return { created: add.length };
  }],
  ['POST', '/invoices/:id/payments', (p, b, _q, ctx, db) => {
    need(ctx, ['org_admin', 'branch_manager', 'front_desk', 'guardian']); const i = Iv(db, p.id); if (ctx.role === 'guardian') canRead(db, ctx, At(db, i.athleteId));
    const bal = netDue(i) - paid(i), amt = b.amountPaise ?? bal; if (!(amt > 0) || amt > bal) invalid(`Enter up to ${bal / 100} ₹`, 'amountPaise');
    i.payments.push({ method: b.method ?? 'upi', amountPaise: amt, at: now(), receiptNo: `ACD-${Date.now().toString().slice(-6)}`, by: ctx.userId }); notice(db, i.athleteId, 'fee', `Payment received ₹${amt / 100}. Receipt ${i.payments.at(-1)!.receiptNo}`); return invView(i);
  }],
  ['POST', '/invoices/:id/adjust', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const i = Iv(db, p.id); if (!b.reason?.trim()) invalid('Discounts and scholarships need a reason', 'reason');
    if (b.scholarshipPct < 0 || b.scholarshipPct > 100) invalid('0–100%', 'scholarshipPct'); const before = { d: i.discountPaise, s: i.scholarshipPct };
    Object.assign(i, { discountPaise: Math.min(i.amountPaise, +b.discountPaise || 0), scholarshipPct: +b.scholarshipPct || 0, discountReason: b.reason }); audit(db, ctx, { orgId: 'densparq' }, 'invoice', i.id, 'discount/scholarship changed', b.reason, { before, after: { d: i.discountPaise, s: i.scholarshipPct } }); return invView(i);
  }],
  ['POST', '/invoices/:id/refund', (p, b, _q, ctx, db) => { need(ctx, MGR); const i = Iv(db, p.id); if (!b.reason?.trim()) invalid('Give a reason', 'reason'); if (!(b.amountPaise > 0) || b.amountPaise > paid(i)) invalid('More than was paid', 'amountPaise'); i.refundPaise += +b.amountPaise; audit(db, ctx, { orgId: 'densparq' }, 'invoice', i.id, `refund ₹${b.amountPaise / 100}`, b.reason); return invView(i); }],
  ['POST', '/invoices/:id/void', (p, b, _q, ctx, db) => { need(ctx, MGR); const i = Iv(db, p.id); if (paid(i) > 0) throw new ApiError(409, 'has_payments', 'Refund payments before voiding'); if (!b.reason?.trim()) invalid('Give a reason', 'reason'); i.voided = true; audit(db, ctx, { orgId: 'densparq' }, 'invoice', i.id, 'voided', b.reason); return invView(i); }],
  ['POST', '/orgs/:org/invoices/remind', (_p, _b, _q, ctx, db) => {
    need(ctx, DESK); const due = db.invoices.filter(i => ['overdue', 'due'].includes(invStatus(i, today())) && i.dueDate <= addDays(today(), 3));
    due.forEach(i => { i.remindersSent++; notice(db, i.athleteId, 'fee', `Fee reminder: ₹${(netDue(i) - paid(i)) / 100} due ${i.dueDate}`); }); return { reminded: due.length };
  }],

  // ---- stats & assessments ----
  ['GET', '/orgs/:org/metric-templates', (_p, _b, _q, _c, db) => db.metricTemplates],
  ['PUT', '/metric-templates/:id', (p, b, _q, ctx, db) => {
    need(ctx, MGR); const t = db.metricTemplates.find(x => x.id === p.id) ?? notFound('template');
    if (!b.metrics?.length || b.metrics.some((m: { key: string; label: string }) => !m.key || !m.label)) invalid('Every metric needs a key and a label', 'metrics');
    if (new Set(b.metrics.map((m: { key: string }) => m.key)).size !== b.metrics.length) invalid('Metric keys must be unique', 'metrics');
    Object.assign(t, { metrics: b.metrics, version: t.version + 1, updatedAt: now() }); audit(db, ctx, { orgId: 'densparq' }, 'metric_template', t.id, `v${t.version}`); return t; // old assessments keep their version
  }],
  ['GET', '/athletes/:id/stats', (p, _b, _q, ctx, db) => { const a = At(db, p.id); canRead(db, ctx, a); return { athlete: { id: a.id, name: a.name, level: a.level, age: ageOn(a.dob, today()), sports: a.sports, statsVisibility: a.statsVisibility }, ...stats(db, a) }; }],
  ['POST', '/athletes/:id/assessments', (p, b, _q, ctx, db) => {
    const a = At(db, p.id); need(ctx, STAFF); if (ctx.role === 'coach' && !athleteBatches(db, a.id).some(x => x.coach.userId === ctx.userId)) throw new ApiError(403, 'forbidden', 'Not in your batches');
    const t = db.metricTemplates.find(x => x.sport === b.sport) ?? notFound('template for this sport'); if (b.date > today()) invalid('Assessment date is in the future', 'date');
    const values: Assessment['values'] = {}; for (const m of t.metrics) { const v = b.values?.[m.key]; if (v?.value === '' || v?.value == null) continue; if (Number.isNaN(+v.value) || +v.value < 0) invalid(`${m.label}: enter a number`, m.key); if (m.unit === 'score' && (+v.value < 1 || +v.value > 5)) invalid(`${m.label}: 1–5`, m.key); if (m.unit === '%' && +v.value > 100) invalid(`${m.label}: max 100%`, m.key); values[m.key] = { value: +v.value, measured: m.unit === 'score' ? false : !!v.measured }; }
    if (!Object.keys(values).length) invalid('Enter at least one metric');
    const x: Assessment = { id: uid('as'), athleteId: a.id, sport: b.sport, templateId: t.id, version: t.version, date: b.date ?? today(), kind: db.assessments.some(y => y.athleteId === a.id && y.sport === b.sport) ? 'periodic' : 'baseline', values, by: ctx.userId, byName: userName(db, ctx.userId), notes: b.notes ?? '', history: [] };
    db.assessments.push(x); notice(db, a.id, 'report', `New ${b.sport.replace('_', ' ')} assessment for ${a.name} is ready`); return x;
  }],
  ['PATCH', '/assessments/:id', (p, b, _q, ctx, db) => {
    need(ctx, ['org_admin', 'branch_manager', 'coach']); const x = db.assessments.find(y => y.id === p.id) ?? notFound('assessment'); if (!b.reason?.trim()) invalid('Corrections need a reason', 'reason');
    const before = JSON.stringify(x.values); for (const [k, v] of Object.entries(b.values ?? {}) as [string, { value: number; measured: boolean }][]) x.values[k] = { value: +v.value, measured: !!v.measured };
    x.history.unshift({ at: now(), by: userName(db, ctx.userId), change: `${b.reason} (was ${before})` }); return x;
  }],
  ['POST', '/athletes/:id/matches', (p, b, _q, ctx, db) => { need(ctx, STAFF); if (!b.event?.trim() || !b.date || !['W', 'L', 'D'].includes(b.result)) invalid('Event, date and result are required'); const m = { id: uid('am'), athleteId: At(db, p.id).id, date: b.date, event: b.event, opponent: b.opponent ?? '', result: b.result, score: b.score ?? '', source: 'manual' as const, by: ctx.userId, at: now() }; db.athleteMatches.push(m); return m; }],
  ['GET', '/batches/:id/rankings', (p, _b, _q, ctx, db) => {
    need(ctx, STAFF); const b = Bt(db, p.id), t = db.metricTemplates.find(x => x.sport === b.sport); if (!t) return { rule: 'No template', rows: [] };
    const ids = activeEnr(db, b.id).map(e => e.athleteId), latest = new Map(ids.map(id => [id, db.assessments.filter(x => x.athleteId === id && x.sport === b.sport).sort((p2, q) => q.date.localeCompare(p2.date))[0]]).filter(([, v]) => v) as [string, Assessment][]);
    const rows = ids.map(id => ({ id, name: At(db, id).name, ...(cohortRank(id, t, latest, ids) ?? { rank: 0, of: 0, percentile: 0 }) })).filter(r => r.rank).sort((x, y) => x.rank - y.rank);
    return { rule: `Mean percentile across measured metrics of each athlete's latest ${b.sport.replace('_', ' ')} assessment, within ${b.name}. Estimated (rubric) values are excluded. Shown only with 5+ assessed athletes.`, rows };
  }],

  // ---- admissions CRM ----
  ['GET', '/orgs/:org/leads', (_p, _b, q, ctx, db) => { need(ctx, DESK); const r = { from: q.get('from') ?? addDays(today(), -90), to: q.get('to') ?? today() }; const list = db.leads.filter(l => ist(l.createdAt).date >= r.from && ist(l.createdAt).date <= r.to);
    const bySource = [...new Set(list.map(l => l.source))].map(s => ({ source: s, ...funnel(list.filter(l => l.source === s)) }));
    return { leads: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), funnel: funnel(list), bySource, lostReasons: Object.entries(list.filter(l => l.lostReason).reduce<Record<string, number>>((m, l) => ({ ...m, [l.lostReason!]: (m[l.lostReason!] ?? 0) + 1 }), {})) }; }],
  ['POST', '/orgs/:org/leads', (_p, b, _q, ctx, db) => { need(ctx, DESK); const l = validLead(b, 'ac_kannuru', userName(db, ctx.userId)); db.leads.push(l); return l; }],
  ['POST', '/public/academies/:id/trial', (p, b, _q, _c, db) => { const l = validLead({ ...b, source: 'online' }, p.id, 'website'); if (db.leads.some(x => x.phone === l.phone && x.athleteName === l.athleteName && !['enrolled', 'lost'].includes(x.stage))) throw new ApiError(409, 'duplicate', 'We already have this enquiry. The academy will call you.'); db.leads.push(l); return { id: l.id }; }],
  ['POST', '/leads/:id/stage', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const l = Ld(db, p.id), to = b.stage as Lead['stage'];
    if (!LEAD_MOVES[l.stage].includes(to)) throw new ApiError(409, 'bad_transition', `Can't move from ${l.stage.replace('_', ' ')} to ${to.replace('_', ' ')}`);
    if (to === 'lost' && !b.lostReason?.trim()) invalid('Why didn’t they join?', 'lostReason');
    if (to === 'trial_scheduled') { if (!b.trial?.batchId || !b.trial?.date) invalid('Pick a trial batch and date', 'trial'); if (!sessions(Bt(db, b.trial.batchId), b.trial.date, b.trial.date, db.sessionChanges).some(s => s.status === 'scheduled' || s.status === 'rescheduled')) invalid('That batch has no session on that date', 'trial'); l.trial = { batchId: b.trial.batchId, date: b.trial.date }; }
    if (to === 'trial_attended' && l.trial) l.trial.attended = true;
    Object.assign(l, { stage: to, lostReason: to === 'lost' ? b.lostReason : undefined, followUp: b.followUp ?? (to === 'trial_attended' ? addDays(today(), 2) : undefined) }); l.history.push({ stage: to, at: now(), by: userName(db, ctx.userId) }); return l;
  }],
  ['PATCH', '/leads/:id', (p, b, _q, ctx, db) => { need(ctx, DESK); const l = Ld(db, p.id); Object.assign(l, { followUp: b.followUp ?? l.followUp, notes: b.notes ?? l.notes }); return l; }],
  ['POST', '/leads/:id/enrol', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const l = Ld(db, p.id); if (l.stage !== 'trial_attended') throw new ApiError(409, 'bad_state', 'Enrol after the trial is attended');
    const a = validAthlete({ name: b.name ?? l.athleteName, dob: b.dob, gender: b.gender, sports: [l.sport], level: b.level ?? 'beginner', guardian: b.guardian ?? (l.age < 18 ? { name: l.name, phone: l.phone, relation: 'Parent', consentAt: b.consent ? now() : undefined } : undefined), phone: l.age >= 18 ? l.phone : undefined }, 'densparq');
    db.athletes.push(a); log(a, ctx, db, `Created from enquiry ${l.id}`); const e = enrolInto(db, ctx, a, Bt(db, b.batchId ?? l.trial!.batchId));
    l.stage = 'enrolled'; l.history.push({ stage: 'enrolled', at: now(), by: userName(db, ctx.userId) }); return { athlete: a, enrollment: e };
  }],

  // ---- guardian / athlete view ----
  ['GET', '/me/athletes', (_p, _b, _q, ctx, db) => db.athletes.filter(a => a.guardian?.userId === ctx.userId).map(a => ({ id: a.id, name: a.name }))],

  // ---- public home (court booking routes live in venueHandlers) ----
  ['GET', '/public/home', (_p, _b, _q, _c, db) => ({
    tournaments: db.tournaments.filter(t => t.status === 'published').map(t => ({ slug: t.slug, name: t.name, sport: t.sport, startDate: t.startDate, endDate: t.endDate, open: Date.now() <= Date.parse(t.regClosesAt) && Date.now() >= Date.parse(t.regOpensAt) })),
    academies: db.academies.map(a => ({ ...a, batches: db.batches.filter(b => b.academyId === a.id && b.active).map(b => ({ id: b.id, name: b.name, sport: b.sport, ageMin: b.ageMin, ageMax: b.ageMax, level: b.level, seats: b.capacity - activeEnr(db, b.id).length, schedule: b.schedule })) })),
    venues: db.venues.filter(v => db.profiles.some(p => p.venueId === v.id)).map(v => ({ ...v, profile: db.profiles.find(p => p.venueId === v.id), sports: [...new Set(db.courts.filter(c => c.venueId === v.id).flatMap(c => c.sports))] })),
  })],
];

function validBatch(b: any): Omit<Batch, 'id' | 'academyId' | 'active'> {
  if (!b.name?.trim()) invalid('Name the batch', 'name'); if (!(b.capacity >= 1)) invalid('Capacity must be at least 1', 'capacity');
  if (!(b.ageMax >= b.ageMin)) invalid('Max age is below min age', 'ageMax'); if (!b.coach?.name?.trim()) invalid('Add the coach name', 'coach');
  if (!b.schedule?.length) invalid('Add at least one weekly session', 'schedule'); if (b.schedule.some((s: any) => !s.courtId || !(s.minutes >= 30))) invalid('Every session needs a court and 30+ minutes', 'schedule');
  return { name: b.name.trim(), sport: b.sport, program: b.program ?? 'Junior', ageMin: +b.ageMin, ageMax: +b.ageMax, level: b.level, capacity: +b.capacity, coach: b.coach, schedule: b.schedule.map((s: any) => ({ ...s, weekday: +s.weekday, minutes: +s.minutes })), startDate: b.startDate ?? today(), endDate: b.endDate || undefined };
}
function validAthlete(b: any, org: string): Athlete {
  if (!b.name?.trim()) invalid('Enter a name', 'name'); if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dob ?? '')) invalid('Enter date of birth', 'dob');
  const minor = ageOn(b.dob, today()) < 18;
  if (minor && (!b.guardian?.name || !/^\d{10}$/.test(b.guardian?.phone ?? ''))) invalid('Under-18s need a guardian name and 10-digit mobile', 'guardian');
  if (minor && !b.guardian?.consentAt) invalid('Guardian consent is required for under-18s', 'consent');
  return { id: uid('at'), orgId: org, name: b.name.trim(), dob: b.dob, gender: b.gender ?? 'x', phone: b.phone, sports: b.sports ?? [], level: b.level ?? 'beginner', guardian: minor ? b.guardian : undefined, statsVisibility: minor ? 'private' : 'academy', createdAt: now(), history: [] };
}
function validLead(b: any, academyId: string, by: string): Lead {
  if (!b.name?.trim() || !/^\d{10}$/.test(b.phone ?? '')) invalid('Name and a 10-digit mobile are required', 'phone'); if (!b.athleteName?.trim()) invalid('Who is the trial for?', 'athleteName'); if (!(b.age >= 4 && b.age <= 70)) invalid('Enter an age', 'age');
  return { id: uid('ld'), academyId, name: b.name.trim(), phone: b.phone, athleteName: b.athleteName.trim(), age: +b.age, sport: b.sport, source: b.source ?? 'walk_in', stage: 'new', notes: b.notes ?? '', createdAt: now(), history: [{ stage: 'new', at: now(), by }], consentWhatsapp: !!b.whatsapp, followUp: today() };
}
