import { describe, expect, it } from 'vitest';
import { quote, conflicts, refundFor, renew, kpis, type RateRule, type VenueProfile, type Booking, type Offer, type Plan, type VMembership } from './venue';

const P: VenueProfile = { venueId: 'v', open: '06:00', close: '23:00', slotMinutes: 60, bufferMinutes: 0, description: '', amenities: [], photos: [], refund: { fullBeforeHours: 24, partialBeforeHours: 6, partialPct: 50 }, holidays: [] };
const R = (from: string, to: string, band: RateRule['band'], rs: number): RateRule => ({ id: from, venueId: 'v', sport: 'badminton', dayType: 'weekday', from, to, band, pricePaise: rs * 100, minPaise: 0, maxPaise: 1e9 });
const rules = [R('06:00', '18:00', 'off_peak', 400), R('18:00', '23:00', 'peak', 800)];
const wed = (h: string) => new Date(`2026-11-11T${h}:00+05:30`).toISOString(); // a Wednesday
const base = { venueId: 'v', sport: 'badminton' as const, rules, profile: P, offers: [] as Offer[], isNewCustomer: false };
const off = (o: Partial<Offer>): Offer => ({ id: o.name ?? 'o', orgId: 'x', name: 'o', kind: 'percent', value: 10, stackable: false, validFrom: '2026-01-01', validTo: '2026-12-31', newCustomersOnly: false, minHours: 0, uses: 0, active: true, ...o });
const bk = (s: string, e: string, extra: Partial<Booking> = {}): Booking => ({ id: s, orgId: 'x', venueId: 'v', courtId: 'c1', customerName: 'A', startAt: wed(s), endAt: wed(e), sport: 'badminton', source: 'app', status: 'confirmed', quote: { lines: [], basePaise: 0, totalPaise: 80000, band: 'peak', memberHours: 0, offerIds: [], locked: true }, paidPaise: 80000, refundPaise: 0, notes: '', createdAt: wed('08:00'), createdBy: 'u', ...extra });

describe('quote', () => {
  it('prices a slot that straddles two bands by 30-min segment', () => expect(quote({ ...base, startAt: wed('17:00'), endAt: wed('19:00') }).totalPaise).toBe(40000 + 80000));
  it('uses only the best non-stackable offer, plus stackable ones', () => {
    const q = quote({ ...base, startAt: wed('18:00'), endAt: wed('19:00'), offers: [off({ name: 'a', value: 10 }), off({ name: 'b', value: 20 }), off({ name: 's', kind: 'flat', value: 5000, stackable: true })] });
    expect(q.offerIds).toEqual(['b', 's']); expect(q.totalPaise).toBe(80000 * 0.8 - 5000);
  });
  it('protects a contracted rate from non-stackable offers', () => {
    const q = quote({ ...base, startAt: wed('18:00'), endAt: wed('19:00'), offers: [off({ value: 50 })], contract: { id: 'c', customerId: 'u', kind: 'fixed', value: 60000, note: 'corp' } });
    expect(q.totalPaise).toBe(60000); expect(q.offerIds).toEqual([]);
  });
  it('uses member hours, but not at peak when the plan excludes peak', () => {
    const plan = { sports: ['badminton'], peakAllowed: false, discountPct: 0, name: 'P' } as Plan, m = { status: 'active', hoursLeft: 5 } as VMembership;
    expect(quote({ ...base, startAt: wed('10:00'), endAt: wed('11:00'), membership: { m, plan } }).totalPaise).toBe(0);
    expect(quote({ ...base, startAt: wed('19:00'), endAt: wed('20:00'), membership: { m, plan } }).totalPaise).toBe(80000);
  });
});
describe('availability + refunds + renewal + kpis', () => {
  it('flags overlaps, ignores cancelled bookings and closed hours', () => {
    const list = [bk('18:00', '19:00'), bk('19:00', '20:00', { id: 'x', status: 'cancelled' })];
    expect(conflicts({ courtId: 'c1', startAt: wed('18:30'), endAt: wed('19:30') }, P, list, []).map(c => c.kind)).toEqual(['booking']);
    expect(conflicts({ courtId: 'c1', startAt: wed('19:00'), endAt: wed('20:00') }, P, list, [])).toEqual([]);
    expect(conflicts({ courtId: 'c1', startAt: wed('05:00'), endAt: wed('06:00') }, P, [], [])[0].kind).toBe('closed');
  });
  it('refunds by notice period', () => {
    const b = bk('18:00', '19:00'), at = (h: number) => Date.parse(b.startAt) - h * 3600000;
    expect([30, 10, 2].map(h => refundFor(b, P, at(h)).paise)).toEqual([80000, 40000, 0]);
  });
  it('renews from the old end date and rolls over 25% of unused hours', () => {
    const { next, rolled } = renew({ endDate: '2026-11-30', hoursLeft: 4, walletPaise: 0 } as VMembership, { rolloverPct: 25, hours: 8, period: 'monthly', walletPaise: 0 } as Plan, '2026-11-20');
    expect([next.startDate, rolled, next.hoursLeft]).toEqual(['2026-12-01', 1, 9]);
  });
  it('counts no-shows as occupied, not cancellations', () => {
    const k = kpis([bk('18:00', '19:00'), bk('19:00', '20:00', { status: 'no_show' }), bk('20:00', '21:00', { status: 'cancelled' })], { from: '2026-11-11', to: '2026-11-11' }, 10);
    expect([k.bookedHours, k.cancellations, k.occupancy]).toEqual([2, 1, 0.2]);
  });
});
