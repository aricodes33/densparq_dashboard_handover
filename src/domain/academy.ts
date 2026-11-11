// Coaching & academy domain: types + pure rules (sessions, clashes, attendance, fees, assessments, admissions, KPIs).
// Money = paise. Dates = IST 'YYYY-MM-DD'. Times = 'HH:MM'. Backend ports this file as-is (tests: academy.test.ts).
import type { ID, ISO, Sport } from './types';
import { addDays, atIST, toMin, overlaps } from './venue';

// ---------- types ----------
export type Level = 'beginner' | 'intermediate' | 'advanced' | 'elite';
export interface Academy { id: ID; orgId: ID; name: string; venueId: ID; sports: Sport[]; programs: string[] }
export interface SlotRule { weekday: number; start: string; minutes: number; courtId: ID }
export interface Batch {
  id: ID; academyId: ID; name: string; sport: Sport; program: string; ageMin: number; ageMax: number; level: Level; capacity: number;
  coach: { name: string; phone: string; userId?: ID }; schedule: SlotRule[]; startDate: string; endDate?: string; active: boolean;
}
export interface SessionChange { id: ID; batchId: ID; date: string; kind: 'cancelled' | 'rescheduled'; newDate?: string; newStart?: string; newCourtId?: ID; reason: string; by: ID; at: ISO }
export interface Session { batchId: ID; date: string; start: string; minutes: number; courtId: ID; status: 'scheduled' | 'cancelled' | 'rescheduled' | 'holiday'; note?: string }
export interface Athlete {
  id: ID; orgId: ID; name: string; dob: string; gender: 'm' | 'f' | 'x'; phone?: string; sports: Sport[]; level: Level;
  guardian?: { name: string; phone: string; relation: string; consentAt?: ISO; userId?: ID }; statsVisibility: 'private' | 'academy' | 'public';
  playerId?: ID; // link to tournament player profile (shared stats)
  createdAt: ISO; history: { at: ISO; by: string; change: string }[];
}
export interface Enrollment { id: ID; athleteId: ID; batchId: ID; start: string; end?: string; status: 'active' | 'paused' | 'transferred' | 'left'; reason?: string }
export type AttStatus = 'present' | 'late' | 'absent' | 'excused';
export interface Attendance { id: ID; batchId: ID; athleteId: ID; date: string; status: AttStatus; by: ID; at: ISO }
export interface FeePlan { id: ID; academyId: ID; name: string; kind: 'admission' | 'monthly' | 'term' | 'package'; amountPaise: number; months: number; batchIds: ID[] }
export interface Payment { method: 'upi' | 'card' | 'cash'; amountPaise: number; at: ISO; receiptNo: string; by: ID }
export interface Invoice {
  id: ID; athleteId: ID; academyId: ID; batchId?: ID; planId: ID; period: string; amountPaise: number; discountPaise: number; scholarshipPct: number; discountReason?: string;
  dueDate: string; payments: Payment[]; refundPaise: number; voided: boolean; createdAt: ISO; remindersSent: number;
}
export interface Metric { key: string; label: string; unit: '%' | 'count' | 'sec' | 'm' | 'kmh' | 'score'; method: string; higherIsBetter: boolean; validator: 'coach' | 'head_coach' }
export interface MetricTemplate { id: ID; sport: Sport; version: number; metrics: Metric[]; updatedAt: ISO }
export interface Assessment {
  id: ID; athleteId: ID; sport: Sport; templateId: ID; version: number; date: string; kind: 'baseline' | 'periodic';
  values: Record<string, { value: number; measured: boolean }>; by: ID; byName: string; notes: string; history: { at: ISO; by: string; change: string }[];
}
export interface AthleteMatch { id: ID; athleteId: ID; date: string; event: string; opponent: string; result: 'W' | 'L' | 'D'; score: string; source: 'manual' | 'tournament'; by: ID; at: ISO }
export type LeadStage = 'new' | 'contacted' | 'trial_scheduled' | 'trial_attended' | 'enrolled' | 'lost';
export interface Lead {
  id: ID; academyId: ID; name: string; phone: string; athleteName: string; age: number; sport: Sport; source: 'online' | 'walk_in' | 'phone' | 'referral';
  stage: LeadStage; trial?: { batchId: ID; date: string; attended?: boolean }; lostReason?: string; followUp?: string; notes: string;
  createdAt: ISO; history: { stage: LeadStage; at: ISO; by: string }[]; consentWhatsapp: boolean;
}

// ---------- sessions & clashes ----------
const wd = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** Expand a batch's weekly schedule into sessions, applying cancellations, reschedules and venue holidays. */
export function sessions(b: Batch, from: string, to: string, changes: SessionChange[], holidays: string[] = []): Session[] {
  const out: Session[] = [], end = b.endDate && b.endDate < to ? b.endDate : to;
  for (let d = from < b.startDate ? b.startDate : from; d <= end; d = addDays(d, 1)) for (const r of b.schedule.filter(r => r.weekday === wd(d))) {
    const ch = changes.find(c => c.batchId === b.id && c.date === d);
    if (holidays.includes(d)) { out.push({ batchId: b.id, date: d, start: r.start, minutes: r.minutes, courtId: r.courtId, status: 'holiday' }); continue; }
    if (ch?.kind === 'cancelled') { out.push({ batchId: b.id, date: d, start: r.start, minutes: r.minutes, courtId: r.courtId, status: 'cancelled', note: ch.reason }); continue; }
    if (ch?.kind === 'rescheduled') { out.push({ batchId: b.id, date: ch.newDate ?? d, start: ch.newStart ?? r.start, minutes: r.minutes, courtId: ch.newCourtId ?? r.courtId, status: 'rescheduled', note: ch.reason }); continue; }
    out.push({ batchId: b.id, date: d, start: r.start, minutes: r.minutes, courtId: r.courtId, status: 'scheduled' });
  }
  return out.sort((a, b2) => (a.date + a.start).localeCompare(b2.date + b2.start));
}
export const sessionSpan = (s: Session) => { const startAt = atIST(s.date, toMin(s.start)); return { startAt, endAt: new Date(Date.parse(startAt) + s.minutes * 60000).toISOString() }; };
/** Court clashes for a proposed batch over the next `weeks`: against venue bookings and other batches. */
export function batchClashes(b: Batch, others: Batch[], changes: SessionChange[], bookings: { courtId: ID; startAt: ISO; endAt: ISO; customerName: string; status: string }[], from: string, weeks = 8) {
  const to = addDays(from, weeks * 7 - 1), mine = sessions(b, from, to, []), out: { date: string; start: string; courtId: ID; with: string }[] = [];
  const theirs = others.filter(o => o.id !== b.id && o.active).flatMap(o => sessions(o, from, to, changes).filter(s => s.status !== 'cancelled' && s.status !== 'holiday').map(s => ({ ...s, name: o.name })));
  for (const s of mine) {
    const span = sessionSpan(s);
    const bk = bookings.find(x => x.courtId === s.courtId && ['confirmed', 'pending_payment'].includes(x.status) && overlaps(span, x));
    const ot = theirs.find(t => t.courtId === s.courtId && overlaps(span, sessionSpan(t)));
    if (bk || ot) out.push({ date: s.date, start: s.start, courtId: s.courtId, with: bk ? `booking: ${bk.customerName}` : `batch: ${ot!.name}` });
  }
  return out;
}

// ---------- attendance ----------
/** Present + late count as attended; excused is removed from the denominator. */
export function attendanceRate(rows: Attendance[]) {
  const counted = rows.filter(r => r.status !== 'excused'); return counted.length ? counted.filter(r => r.status !== 'absent').length / counted.length : null;
}
export const ageOn = (dob: string, on: string) => { const [y, m, d] = dob.split('-').map(Number), [Y, M, D] = on.split('-').map(Number); return Y - y - (M < m || (M === m && D < d) ? 1 : 0); };
export const fitsBatch = (a: Athlete, b: Batch, on: string) => { const age = ageOn(a.dob, on); return age >= b.ageMin && age <= b.ageMax; };

// ---------- fees ----------
export const netDue = (i: Invoice) => Math.max(0, Math.round((i.amountPaise - i.discountPaise) * (1 - i.scholarshipPct / 100)));
export const paid = (i: Invoice) => i.payments.reduce((a, p) => a + p.amountPaise, 0) - i.refundPaise;
export type InvStatus = 'paid' | 'partial' | 'due' | 'overdue' | 'void' | 'refunded';
export function invStatus(i: Invoice, today: string): InvStatus {
  if (i.voided) return 'void'; const p = paid(i), n = netDue(i);
  if (i.refundPaise > 0 && p <= 0) return 'refunded'; if (p >= n) return 'paid'; if (i.dueDate < today) return 'overdue'; return p > 0 ? 'partial' : 'due';
}
/** Monthly invoices for active enrollments; idempotent per (athlete, batch, period). */
export function monthlyInvoices(period: string, enrollments: Enrollment[], plans: FeePlan[], batches: Batch[], existing: Invoice[], dueDay = 7): Omit<Invoice, 'id' | 'createdAt'>[] {
  const out: Omit<Invoice, 'id' | 'createdAt'>[] = [];
  for (const e of enrollments.filter(e => e.status === 'active' && e.start <= `${period}-31`)) {
    const b = batches.find(x => x.id === e.batchId); const plan = plans.find(p => p.kind === 'monthly' && p.batchIds.includes(e.batchId)); if (!b || !plan) continue;
    if (existing.some(i => i.athleteId === e.athleteId && i.batchId === e.batchId && i.period === period && !i.voided)) continue;
    out.push({ athleteId: e.athleteId, academyId: b.academyId, batchId: b.id, planId: plan.id, period, amountPaise: plan.amountPaise, discountPaise: 0, scholarshipPct: 0, dueDate: `${period}-${String(dueDay).padStart(2, '0')}`, payments: [], refundPaise: 0, voided: false, remindersSent: 0 });
  }
  return out;
}

// ---------- assessments & stats ----------
export interface Progress { key: string; label: string; unit: string; first?: number; last?: number; change?: number; improved?: boolean; points: { date: string; value: number; measured: boolean }[] }
export function progress(t: MetricTemplate, list: Assessment[]): Progress[] {
  const mine = [...list].sort((a, b) => a.date.localeCompare(b.date));
  return t.metrics.map(m => {
    const points = mine.filter(a => a.values[m.key]).map(a => ({ date: a.date, ...a.values[m.key] })), first = points[0]?.value, last = points.at(-1)?.value;
    const change = first != null && last != null && points.length > 1 ? last - first : undefined;
    return { key: m.key, label: m.label, unit: m.unit, first, last, change, improved: change == null || change === 0 ? undefined : m.higherIsBetter ? change > 0 : change < 0, points };
  });
}
/** Cohort = same sport + same age band (±1 yr of batch band) + same level. Rank only when cohort ≥ 5; composite = mean percentile of latest measured values. */
export function cohortRank(targetId: ID, t: MetricTemplate, latest: Map<ID, Assessment>, cohort: ID[]): { rank: number; of: number; percentile: number } | null {
  const ids = cohort.filter(id => latest.has(id)); if (ids.length < 5 || !latest.has(targetId)) return null;
  const score = (id: ID) => { const a = latest.get(id)!; const pcts = t.metrics.map(m => { const v = a.values[m.key]; if (!v?.measured) return null;
    const vals = ids.map(i => latest.get(i)!.values[m.key]).filter(x => x?.measured).map(x => x!.value); const below = vals.filter(x => (m.higherIsBetter ? x < v.value : x > v.value)).length; return below / Math.max(1, vals.length - 1); }).filter((x): x is number => x != null);
    return pcts.length ? pcts.reduce((s, x) => s + x, 0) / pcts.length : 0; };
  const sorted = ids.map(id => ({ id, s: score(id) })).sort((a, b) => b.s - a.s), rank = sorted.findIndex(x => x.id === targetId) + 1;
  return { rank, of: ids.length, percentile: Math.round(score(targetId) * 100) };
}

// ---------- admissions ----------
export const STAGES: LeadStage[] = ['new', 'contacted', 'trial_scheduled', 'trial_attended', 'enrolled', 'lost'];
export const LEAD_MOVES: Record<LeadStage, LeadStage[]> = { new: ['contacted', 'trial_scheduled', 'lost'], contacted: ['trial_scheduled', 'lost'], trial_scheduled: ['trial_attended', 'contacted', 'lost'], trial_attended: ['lost'] /* enrolment only via POST /leads/:id/enrol, which creates the athlete */, enrolled: [], lost: ['contacted'] };
const reached = (l: Lead, s: LeadStage) => l.history.some(h => h.stage === s) || l.stage === s;
export function funnel(leads: Lead[]) {
  const n = leads.length, trial = leads.filter(l => reached(l, 'trial_scheduled')).length, attended = leads.filter(l => reached(l, 'trial_attended')).length, enrolled = leads.filter(l => l.stage === 'enrolled').length;
  return { enquiries: n, trialsBooked: trial, trialsAttended: attended, enrolled, lost: leads.filter(l => l.stage === 'lost').length, enquiryToTrial: n ? trial / n : 0, trialToEnrol: attended ? enrolled / attended : 0, showRate: trial ? attended / trial : 0 };
}

// ---------- academy KPIs ----------
/** Retention = athletes active at period start who are still active at period end (left/transferred out = churned). */
export function retention(enr: Enrollment[], from: string, to: string) {
  const activeOn = (d: string) => new Set(enr.filter(e => e.start <= d && (!e.end || e.end >= d) && e.status !== 'paused').map(e => e.athleteId));
  const a = activeOn(from), b = activeOn(to); return a.size ? [...a].filter(x => b.has(x)).length / a.size : null;
}
