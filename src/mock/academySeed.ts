// Academy seed. seedAcademyCore runs BEFORE tournaments (batches occupy courts); seedAcademyPeople runs last.
import type { DB } from './db';
import { uid } from '@/domain/fixtures';
import { addDays, ist } from '@/domain/venue';
import { sessions, type Batch, type MetricTemplate, type Metric, type Assessment, type LeadStage } from '@/domain/academy';
import type { Sport } from '@/domain/types';

const today = () => ist(new Date().toISOString()).date;
const m = (key: string, label: string, unit: Metric['unit'], method: string, higherIsBetter: boolean, validator: Metric['validator'] = 'coach'): Metric => ({ key, label, unit, method, higherIsBetter, validator });
// Proposed metric sets (docs/research/academy-assessment-and-kpis.md). Internal benchmarks, not federation standards.
const TEMPLATES: [Sport, Metric[]][] = [
  ['badminton', [m('serve', 'Serve accuracy', '%', '10 short + 10 long serves to marked zones', true), m('footwork', 'Six-corner footwork', 'sec', 'Shadow to 6 corners via base, mean of 3', false), m('rally', 'Rally consistency', 'count', 'Cooperative clear/drop rally, best of 3', true), m('smash', 'Smash/clear accuracy', '%', '10 fed shuttles to rear target zone', true), m('split', 'Split-step timing', 'score', 'Rubric 1–5, observed in fed drill', true, 'head_coach')]],
  ['football', [m('pass', 'Passing accuracy', '%', '10 passes into 2 m gate at 10 m', true), m('slalom', 'Dribble slalom', 'sec', '9 cones 2 m apart, out and back', false), m('sprint', '20 m sprint', 'sec', 'Best of 2, gates or phone timer', false), m('juggle', 'Juggling', 'count', 'Consecutive touches, best of 3', true), m('weak', 'Weaker-foot use', 'score', 'Rubric 1–5 in small-sided game', true, 'head_coach')]],
  ['pickleball', [m('serve', 'Serve depth', '%', '10 serves into back third', true), m('drop', 'Third-shot drop', '%', '10 fed drops into kitchen', true), m('dink', 'Dink rally', 'count', 'Cross-court dinks, best of 3', true), m('move', 'Court movement', 'sec', 'Baseline-to-kitchen ladder, mean of 3', false)]],
  ['box_cricket', [m('bowl', 'Bowling accuracy', '%', '12 balls into good-length box', true), m('bat', 'Batting contact', '%', '12 fed balls hit in control', true), m('throw', 'Throwing accuracy', 'count', 'Hits of 6 at stumps from 15 m', true), m('catch', 'Catching', 'count', 'Catches of 10 fixed-height feeds', true), m('run', 'Two-run shuttle', 'sec', 'Run between wickets, timed', false)]],
];
export function seedAcademyCore(db: DB) {
  const start = addDays(today(), -200);
  db.academies.push({ id: 'ac_kannuru', orgId: 'densparq', name: 'Densparq Academy Kannuru', venueId: 'v_kannuru', sports: ['badminton', 'football', 'pickleball', 'box_cricket'], programs: ['Junior', 'Performance', 'Adult'] });
  const B = (id: string, name: string, sport: Sport, program: string, ageMin: number, ageMax: number, level: Batch['level'], capacity: number, coach: string, userId: string | undefined, schedule: Batch['schedule']): Batch =>
    ({ id, academyId: 'ac_kannuru', name, sport, program, ageMin, ageMax, level, capacity, coach: { name: coach, phone: `98450${id.length}${id.slice(-4).replace(/\D/g, '1')}11`.slice(0, 10), userId }, schedule, startDate: start, active: true });
  const days = (ws: number[], s: string, min: number, court: string) => ws.map(weekday => ({ weekday, start: s, minutes: min, courtId: court }));
  db.batches.push(
    B('bt_bu10', 'Badminton U10 Foundations', 'badminton', 'Junior', 6, 10, 'beginner', 12, 'Suresh Rao', 'u_suresh', [...days([1, 3, 5], '15:00', 60, 'c1'), ...days([1, 3, 5], '15:00', 60, 'c2')]),
    B('bt_bu14', 'Badminton U14 Development', 'badminton', 'Performance', 11, 14, 'intermediate', 12, 'Suresh Rao', 'u_suresh', [...days([1, 3, 5], '16:00', 90, 'c3'), ...days([1, 3, 5], '16:00', 90, 'c4')]),
    B('bt_fu12', 'Football U12', 'football', 'Junior', 8, 12, 'beginner', 20, 'Imran Khan', undefined, [...days([2, 4, 6], '16:00', 90, 't1'), ...days([2, 4, 6], '16:00', 90, 't2')]),
    B('bt_fu16', 'Football U16 Elite', 'football', 'Performance', 13, 16, 'advanced', 18, 'Imran Khan', undefined, days([1, 3, 5], '15:30', 120, 't3')),
    B('bt_pj', 'Pickleball Juniors', 'pickleball', 'Junior', 9, 15, 'beginner', 8, 'Tara Menon', undefined, days([2, 4], '15:00', 60, 'p1')),
    B('bt_cu14', 'Box Cricket U14', 'box_cricket', 'Junior', 10, 14, 'intermediate', 14, 'Deepak Gowda', undefined, days([6], '15:00', 120, 't3')),
  );
  for (const [sport, metrics] of TEMPLATES) db.metricTemplates.push({ id: `mt_${sport}`, sport, version: 1, metrics, updatedAt: `${start}T00:00:00.000Z` } as MetricTemplate);
}

export function seedAcademyPeople(db: DB, rand: () => number) {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)], t = today(), FIRST = ['Aarav', 'Diya', 'Ishaan', 'Anika', 'Reyansh', 'Myra', 'Vihaan', 'Saanvi', 'Kabir', 'Aadhya', 'Arjun', 'Kiara', 'Dhruv', 'Navya', 'Vivaan', 'Pari'], LAST = ['Rao', 'Shetty', 'Menon', 'Nair', 'Iyer', 'Gowda', 'Reddy', 'Patel'];
  db.feePlans.push({ id: 'fp_adm', academyId: 'ac_kannuru', name: 'Admission (one-time)', kind: 'admission', amountPaise: 200000, months: 0, batchIds: db.batches.map(b => b.id) },
    ...db.batches.map(b => ({ id: `fp_m_${b.id}`, academyId: 'ac_kannuru', name: `${b.name} · monthly`, kind: 'monthly' as const, amountPaise: (b.program === 'Performance' ? 4500 : 3000) * 100, months: 1, batchIds: [b.id] })),
    { id: 'fp_term', academyId: 'ac_kannuru', name: 'Term (3 months, 10% off)', kind: 'term', amountPaise: 810000, months: 3, batchIds: ['bt_bu10', 'bt_fu12', 'bt_pj'] });
  let n = 0;
  for (const b of db.batches) {
    const size = Math.round(b.capacity * (0.6 + rand() * 0.35));
    for (let i = 0; i < size; i++, n++) {
      const age = b.ageMin + Math.floor(rand() * (b.ageMax - b.ageMin + 1)), joined = addDays(t, -10 - Math.floor(rand() * 180)), left = rand() < 0.1 ? addDays(joined, 30 + Math.floor(rand() * 90)) : undefined;
      const id = `at${n}`, name = `${pick(FIRST)} ${pick(LAST)}`, minor = age < 18;
      db.athletes.push({ id, orgId: 'densparq', name, dob: `${Number(t.slice(0, 4)) - age}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`, gender: rand() > 0.5 ? 'm' : 'f', sports: [b.sport], level: b.level,
        guardian: minor ? { name: `${pick(FIRST)} ${name.split(' ')[1]}`, phone: `97${String(31000000 + n * 7717).slice(0, 8)}`, relation: 'Parent', consentAt: `${joined}T05:00:00.000Z`, userId: n === 0 ? 'u_lakshmi' : undefined } : undefined,
        statsVisibility: 'academy', createdAt: `${joined}T05:00:00.000Z`, history: [] });
      db.enrollments.push({ id: `en${n}`, athleteId: id, batchId: b.id, start: joined, end: left, status: left && left < t ? 'left' : 'active', reason: left ? pick(['Moved city', 'Exams', 'Fees']) : undefined });
      // admission + monthly invoices
      db.invoices.push({ id: uid('iv'), athleteId: id, academyId: b.academyId, planId: 'fp_adm', period: joined.slice(0, 7), amountPaise: 200000, discountPaise: 0, scholarshipPct: 0, dueDate: joined, payments: [{ method: 'upi', amountPaise: 200000, at: `${joined}T06:00:00.000Z`, receiptNo: `ACD-${1000 + n}`, by: 'u_niko' }], refundPaise: 0, voided: false, createdAt: `${joined}T05:00:00.000Z`, remindersSent: 0 });
      const plan = db.feePlans.find(p => p.id === `fp_m_${b.id}`)!, scholar = rand() < 0.06 ? 50 : 0;
      for (let k = 3; k >= 0; k--) {
        const d = new Date(`${t}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); const period = d.toISOString().slice(0, 7);
        if (`${period}-28` < joined || (left && `${period}-01` > left)) continue;
        const inv = { id: uid('iv'), athleteId: id, academyId: b.academyId, batchId: b.id, planId: plan.id, period, amountPaise: plan.amountPaise, discountPaise: 0, scholarshipPct: scholar, discountReason: scholar ? 'Merit scholarship' : undefined, dueDate: `${period}-07`, payments: [] as never[], refundPaise: 0, voided: false, createdAt: `${period}-01T04:00:00.000Z`, remindersSent: 0 };
        const payIt = k > 0 ? rand() < 0.93 : rand() < 0.55; const due = Math.round(plan.amountPaise * (1 - scholar / 100));
        if (payIt) (inv.payments as unknown as object[]).push({ method: pick(['upi', 'upi', 'cash', 'card']), amountPaise: rand() < 0.08 ? Math.round(due / 2) : due, at: `${period}-0${3 + Math.floor(rand() * 6)}T06:00:00.000Z`, receiptNo: `ACD-${period.replace('-', '')}-${n}`, by: 'u_niko' });
        db.invoices.push(inv);
      }
      // attendance for the last 8 weeks
      for (const s of sessions(b, addDays(t, -56) > joined ? addDays(t, -56) : joined, addDays(t, -1), db.sessionChanges)) {
        if (s.status === 'cancelled' || s.status === 'holiday' || (left && s.date > left)) continue;
        if (b.schedule.length > 1 && s.courtId !== b.schedule[0].courtId) continue; // one roll-call per session, not per court
        const r = rand(); db.attendance.push({ id: `a${db.attendance.length}`, batchId: b.id, athleteId: id, date: s.date, status: r < 0.8 ? 'present' : r < 0.85 ? 'late' : r < 0.97 ? 'absent' : 'excused', by: b.coach.userId ?? 'u_niko', at: `${s.date}T12:00:00.000Z` });
      }
      // assessments: baseline at joining, then every ~8 weeks, trending better
      const tpl = db.metricTemplates.find(x => x.sport === b.sport); if (!tpl) continue;
      const base: Record<string, number> = {}; tpl.metrics.forEach(mt => { base[mt.key] = mt.unit === '%' ? 30 + rand() * 25 : mt.unit === 'sec' ? (mt.key === 'sprint' ? 4.2 : 18) + rand() * 3 : mt.unit === 'score' ? 2 + Math.floor(rand() * 2) : 5 + Math.floor(rand() * 10); });
      for (let d = joined, k = 0; d < t; d = addDays(d, 56), k++) {
        const values: Assessment['values'] = {}; tpl.metrics.forEach(mt => { const g = (rand() * 0.9 + 0.1) * k, v = mt.unit === 'score' ? Math.min(5, base[mt.key] + Math.floor(g / 2)) : mt.higherIsBetter ? base[mt.key] * (1 + 0.08 * g) : base[mt.key] * (1 - 0.03 * g); values[mt.key] = { value: Math.round(v * 10) / 10, measured: mt.unit !== 'score' }; });
        db.assessments.push({ id: uid('as'), athleteId: id, sport: b.sport, templateId: tpl.id, version: 1, date: d, kind: k ? 'periodic' : 'baseline', values, by: b.coach.userId ?? 'u_niko', byName: b.coach.name, notes: '', history: [] });
      }
      if (rand() < 0.3) for (let k = 0; k < 2 + Math.floor(rand() * 4); k++) db.athleteMatches.push({ id: uid('am'), athleteId: id, date: addDays(t, -Math.floor(rand() * 120)), event: pick(['Inter-academy friendly', 'District U14 ranking', 'Kannuru Juniors Cup']), opponent: `${pick(FIRST)} ${pick(LAST)}`, result: pick(['W', 'W', 'L', 'D'] as const), score: pick(['21-17, 21-15', '2-1', '15-21, 21-19, 21-18', '1-1']), source: 'manual', by: 'u_suresh', at: new Date().toISOString() });
    }
  }
  db.sessionChanges.push({ id: 'sc1', batchId: 'bt_bu14', date: (() => { let d = addDays(t, 2); while (new Date(`${d}T12:00:00Z`).getUTCDay() % 2 === 0) d = addDays(d, 1); return d; })(), kind: 'cancelled', reason: 'Coach at district selections', by: 'u_niko', at: new Date().toISOString() });
  const stages: LeadStage[] = ['new', 'new', 'contacted', 'contacted', 'trial_scheduled', 'trial_scheduled', 'trial_attended', 'enrolled', 'enrolled', 'lost'];
  for (let i = 0; i < 34; i++) {
    const stage = stages[i % stages.length], b = pick(db.batches), created = addDays(t, -Math.floor(rand() * 60)), path = ['new', 'contacted', 'trial_scheduled', 'trial_attended', 'enrolled'] as LeadStage[];
    const reachedIdx = stage === 'lost' ? 1 + Math.floor(rand() * 3) : path.indexOf(stage);
    db.leads.push({ id: `ld${i}`, academyId: 'ac_kannuru', name: `${pick(FIRST)} ${pick(LAST)}`, phone: `99${String(10000000 + i * 31337).slice(0, 8)}`, athleteName: pick(FIRST), age: b.ageMin + Math.floor(rand() * (b.ageMax - b.ageMin)), sport: b.sport,
      source: pick(['online', 'online', 'walk_in', 'phone', 'referral']), stage, trial: reachedIdx >= 2 ? { batchId: b.id, date: addDays(created, 4), attended: reachedIdx >= 3 ? true : undefined } : undefined,
      lostReason: stage === 'lost' ? pick(['Fees too high', 'Timing clash with school', 'Chose another academy']) : undefined, followUp: ['new', 'contacted', 'trial_attended'].includes(stage) ? addDays(t, Math.floor(rand() * 4)) : undefined, notes: '',
      createdAt: `${created}T06:00:00.000Z`, history: path.slice(0, Math.max(1, reachedIdx + 1)).map((s, k) => ({ stage: s, at: `${addDays(created, k * 2)}T06:00:00.000Z`, by: 'u_niko' })), consentWhatsapp: rand() > 0.2 });
  }
}
