import { describe, expect, it } from 'vitest';
import { sessions, batchClashes, attendanceRate, invStatus, netDue, monthlyInvoices, progress, cohortRank, funnel, retention, type Batch, type Invoice, type MetricTemplate, type Assessment, type Lead } from './academy';

const B: Batch = { id: 'b', academyId: 'a', name: 'U12', sport: 'badminton', program: 'Junior', ageMin: 9, ageMax: 12, level: 'beginner', capacity: 12, coach: { name: 'S', phone: '9' }, schedule: [{ weekday: 1, start: '16:00', minutes: 60, courtId: 'c1' }, { weekday: 3, start: '16:00', minutes: 60, courtId: 'c1' }], startDate: '2026-11-01', active: true };
const inv = (p: Partial<Invoice>): Invoice => ({ id: 'i', athleteId: 'x', academyId: 'a', planId: 'p', period: '2026-11', amountPaise: 300000, discountPaise: 0, scholarshipPct: 0, dueDate: '2026-11-07', payments: [], refundPaise: 0, voided: false, createdAt: '', remindersSent: 0, ...p });
const T: MetricTemplate = { id: 't', sport: 'badminton', version: 1, updatedAt: '', metrics: [{ key: 'serve', label: 'Serve', unit: '%', method: '', higherIsBetter: true, validator: 'coach' }, { key: 'shuttle', label: 'Shuttle run', unit: 'sec', method: '', higherIsBetter: false, validator: 'coach' }] };
const A = (id: string, date: string, serve: number, shuttle: number): Assessment => ({ id: id + date, athleteId: id, sport: 'badminton', templateId: 't', version: 1, date, kind: 'periodic', values: { serve: { value: serve, measured: true }, shuttle: { value: shuttle, measured: true } }, by: 'c', byName: 'c', notes: '', history: [] });

describe('academy domain', () => {
  it('expands Mon/Wed sessions and applies cancellations, reschedules and holidays', () => {
    const s = sessions(B, '2026-11-02', '2026-11-11', [{ id: 'x', batchId: 'b', date: '2026-11-04', kind: 'cancelled', reason: 'rain', by: '', at: '' }, { id: 'y', batchId: 'b', date: '2026-11-09', kind: 'rescheduled', newStart: '17:00', reason: 'event', by: '', at: '' }], ['2026-11-11']);
    expect(s.map(x => `${x.date} ${x.start} ${x.status}`)).toEqual(['2026-11-02 16:00 scheduled', '2026-11-04 16:00 cancelled', '2026-11-09 17:00 rescheduled', '2026-11-11 16:00 holiday']);
  });
  it('flags clashes with venue bookings and other batches', () => {
    const c = batchClashes(B, [{ ...B, id: 'o', name: 'Other', schedule: [{ weekday: 3, start: '16:30', minutes: 60, courtId: 'c1' }] }], [],
      [{ courtId: 'c1', startAt: new Date('2026-11-02T16:00:00+05:30').toISOString(), endAt: new Date('2026-11-02T17:00:00+05:30').toISOString(), customerName: 'Rao', status: 'confirmed' }], '2026-11-02', 1);
    expect(c.map(x => x.with)).toEqual(['booking: Rao', 'batch: Other']);
  });
  it('attendance: late counts, excused is ignored', () => expect(attendanceRate(['present', 'late', 'absent', 'excused'].map(status => ({ status } as never)))).toBeCloseTo(2 / 3));
  it('fees: scholarship after discount; status by payment and due date', () => {
    expect(netDue(inv({ discountPaise: 50000, scholarshipPct: 50 }))).toBe(125000);
    expect([invStatus(inv({}), '2026-11-05'), invStatus(inv({}), '2026-11-08'), invStatus(inv({ payments: [{ method: 'upi', amountPaise: 100000, at: '', receiptNo: '', by: '' }] }), '2026-11-05'), invStatus(inv({ payments: [{ method: 'upi', amountPaise: 300000, at: '', receiptNo: '', by: '' }] }), '2026-11-30')]).toEqual(['due', 'overdue', 'partial', 'paid']);
  });
  it('monthly invoices are idempotent', () => {
    const e = [{ id: 'e', athleteId: 'x', batchId: 'b', start: '2026-10-01', status: 'active' as const }], p = [{ id: 'p', academyId: 'a', name: 'M', kind: 'monthly' as const, amountPaise: 1, months: 1, batchIds: ['b'] }];
    expect(monthlyInvoices('2026-11', e, p, [B], []).length).toBe(1); expect(monthlyInvoices('2026-11', e, p, [B], [inv({ batchId: 'b' })]).length).toBe(0);
  });
  it('progress respects higher/lower-is-better', () => {
    const pr = progress(T, [A('x', '2026-09-01', 40, 20), A('x', '2026-11-01', 55, 18)]);
    expect(pr.map(p => [p.change, p.improved])).toEqual([[15, true], [-2, true]]);
  });
  it('ranks only inside a cohort of 5+', () => {
    const latest = new Map(['a', 'b', 'c', 'd', 'e'].map((id, i) => [id, A(id, '2026-11-01', 40 + i * 5, 20 - i)]));
    expect(cohortRank('e', T, latest, ['a', 'b', 'c', 'd', 'e'])).toEqual({ rank: 1, of: 5, percentile: 100 });
    expect(cohortRank('e', T, latest, ['a', 'b', 'c', 'e'])).toBeNull();
  });
  it('funnel and retention', () => {
    const L = (stage: Lead['stage'], hist: Lead['stage'][] = []) => ({ stage, history: hist.map(s => ({ stage: s, at: '', by: '' })) } as Lead);
    const f = funnel([L('new'), L('lost', ['trial_scheduled']), L('enrolled', ['trial_scheduled', 'trial_attended']), L('trial_attended', ['trial_scheduled'])]);
    expect([f.enquiryToTrial, f.trialToEnrol]).toEqual([0.75, 0.5]);
    expect(retention([{ id: '1', athleteId: 'a', batchId: 'b', start: '2026-01-01', status: 'active' }, { id: '2', athleteId: 'b', batchId: 'b', start: '2026-01-01', end: '2026-06-01', status: 'left' }], '2026-03-01', '2026-09-01')).toBe(0.5);
  });
});
