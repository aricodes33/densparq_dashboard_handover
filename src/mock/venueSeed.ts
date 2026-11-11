// Venue management seed: ~60 days of history + 14 days ahead, priced by the real quote engine.
import { allBlocks, type DB } from './db';
import { uid } from '@/domain/fixtures';
import { conflicts, blocking, quote, ist, refundFor, addDays, type Booking, type BookingSource, type Plan, type RateRule, type VenueProfile } from '@/domain/venue';
import type { Sport } from '@/domain/types';

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Sneha', 'Karthik', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Priya', 'Nikhil', 'Kavya', 'Rahul', 'Ayesha', 'Farhan', 'Isha', 'Manoj', 'Sana', 'Deepak', 'Tara', 'Varun', 'Neha'];
const LAST = ['Kumar', 'Rao', 'Shetty', 'Menon', 'Patel', 'Nair', 'Iyer', 'Reddy', 'Gowda', 'Joshi'];
const COURT_SPORT: Record<string, Sport> = { t1: 'football', t2: 'box_cricket', t3: 'football', c1: 'badminton', c2: 'badminton', c3: 'badminton', c4: 'badminton', p1: 'pickleball', p2: 'pickleball', g1: 'frisbee', g2: 'football' };
const PRICE: Record<string, [number, number, number]> = { football: [999, 1199, 1499], box_cricket: [999, 1199, 1499], badminton: [400, 500, 700], pickleball: [500, 600, 800], frisbee: [800, 900, 1100], lagori: [800, 900, 1100] };

export function seedVenue(db: DB, rand: () => number, at: (d: number, hhmm?: string) => string) {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)], today = at(0).slice(0, 10);
  const prof = (venueId: string, close: string): VenueProfile => ({ venueId, open: '06:00', close, slotMinutes: 60, bufferMinutes: 0, description: '', amenities: ['Parking', 'Changing rooms', 'Drinking water', 'Floodlights', 'Café'], photos: [],
    refund: { fullBeforeHours: 24, partialBeforeHours: 6, partialPct: 50 }, holidays: [{ date: addDays(today, 12), name: 'Kannada Rajyotsava (observed)' }] });
  db.profiles.push({ ...prof('v_kannuru', '23:00'), description: 'Three FIFA-grade turfs, four wooden badminton courts and two pickleball courts on Yelahanka Main Road.' }, { ...prof('v_rvce', '21:00'), description: 'Two natural-grass grounds inside the RVCE campus.' });
  db.courts.forEach(c => db.courtMeta.push({ courtId: c.id, surface: c.id.startsWith('t') ? 'Artificial turf' : c.id.startsWith('c') ? 'Wooden (synthetic mat)' : c.id.startsWith('p') ? 'Acrylic hard court' : 'Natural grass', indoor: /^[cp]/.test(c.id), active: true }));
  // rate rules: weekday off-peak 6–16, standard 16–18, peak 18–close; weekend/holiday standard 6–16, peak 16–close
  for (const v of ['v_kannuru', 'v_rvce']) for (const sport of Object.keys(PRICE) as Sport[]) {
    const [off, std, peak] = PRICE[sport], close = v === 'v_kannuru' ? '23:00' : '21:00';
    const r = (dayType: RateRule['dayType'], from: string, to: string, band: RateRule['band'], p: number) => db.rateRules.push({ id: uid('rr'), venueId: v, sport, dayType, from, to, band, pricePaise: p * 100, minPaise: Math.round(p * 70) * 100 / 100, maxPaise: Math.round(p * 130) * 100 / 100 });
    r('weekday', '06:00', '16:00', 'off_peak', off); r('weekday', '16:00', '18:00', 'standard', std); r('weekday', '18:00', close, 'peak', peak);
    for (const dt of ['weekend', 'holiday'] as const) { r(dt, '06:00', '16:00', 'standard', std); r(dt, '16:00', close, 'peak', peak); }
  }
  db.offers.push(
    { id: 'of_first', orgId: 'densparq', name: 'First game 20% off', kind: 'percent', value: 20, stackable: false, validFrom: addDays(today, -90), validTo: addDays(today, 90), newCustomersOnly: true, minHours: 1, uses: 41, active: true },
    { id: 'of_morning', orgId: 'densparq', name: 'Early bird', code: 'MORNING15', kind: 'percent', value: 15, stackable: false, bands: ['off_peak'], validFrom: addDays(today, -60), validTo: addDays(today, 60), newCustomersOnly: false, minHours: 1, uses: 128, active: true },
    { id: 'of_flat', orgId: 'densparq', name: 'Weekday ₹200 off 2 h+', code: 'TWOHOURS', kind: 'flat', value: 20000, stackable: false, validFrom: addDays(today, -30), validTo: addDays(today, 30), newCustomersOnly: false, minHours: 2, uses: 17, maxUses: 100, active: true },
    { id: 'of_diwali', orgId: 'densparq', name: 'Diwali week', code: 'DIWALI10', kind: 'percent', value: 10, stackable: true, validFrom: addDays(today, -25), validTo: addDays(today, -18), newCustomersOnly: false, minHours: 1, uses: 63, active: false });
  for (let i = 0; i < 90; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`, corp = i % 30 === 3 ? pick(['Infosys Sports Club', 'Wipro Wellness', 'Bosch Ballers']) : undefined;
    db.customers.push({ id: `cu${i}`, orgId: 'densparq', name, phone: `98${String(45000000 + i * 7919).slice(0, 8)}`, email: i % 3 ? `${name.split(' ')[0].toLowerCase()}${i}@mail.in` : undefined,
      sports: [pick(['football', 'badminton', 'pickleball', 'box_cricket'] as Sport[])], consent: { whatsapp: rand() > 0.2, marketing: rand() > 0.45, at: at(-80) }, tags: corp ? ['corporate'] : [], corporate: corp, notes: [], createdAt: at(-Math.floor(rand() * 120)) });
  }
  db.customerRates.push({ id: 'cr1', customerId: 'cu3', venueId: 'v_kannuru', kind: 'fixed', value: 120000, note: 'Infosys corporate, turf', validTo: addDays(today, 180) }, { id: 'cr2', customerId: 'cu7', kind: 'percent', value: 10, note: 'Regular since 2024' });
  const plan = (id: string, name: string, tier: Plan['tier'], period: Plan['period'], price: number, hours: number, discountPct: number, sports: Sport[], peakAllowed: boolean, maxMembers = 1, walletPaise = 0): Plan =>
    ({ id, orgId: 'densparq', name, tier, period, pricePaise: price * 100, hours, walletPaise, discountPct, sports, peakAllowed, rolloverPct: 25, graceDays: 7, cancelNoticeHours: 12, maxMembers, active: true });
  db.plans.push(plan('pl_reg', 'Regular Monthly', 'regular', 'monthly', 4000, 8, 10, ['badminton', 'pickleball'], false), plan('pl_stu', 'Student Quarterly', 'student', 'quarterly', 6000, 20, 15, ['badminton', 'pickleball', 'football'], false),
    plan('pl_fam', 'Family Annual', 'family', 'annual', 40000, 120, 10, ['badminton', 'pickleball', 'football'], true, 4), plan('pl_corp', 'Corporate Quarterly', 'corporate', 'quarterly', 25000, 60, 0, ['football', 'box_cricket'], true, 20),
    plan('pl_pack', '10-hour pack', 'standard', 'pack', 6500, 10, 0, ['badminton', 'pickleball'], true, 1, 50000));
  // ms2 is a quarterly plan ending in ~5 days (renewal + follow-up demo); customers cu80+ stop booking 5 weeks ago (inactive demo)
  for (let i = 0; i < 18; i++) {
    const p = db.plans[i % db.plans.length], start = i === 2 ? addDays(today, -85) : addDays(today, -Math.floor(rand() * 80) - (i < 4 ? 70 : 0)), end = addDays(start, { monthly: 29, quarterly: 90, annual: 364, pack: 89 }[p.period]);
    const status = end >= today ? 'active' : end >= addDays(today, -p.graceDays) ? 'grace' : 'expired';
    db.vmemberships.push({ id: `ms${i}`, planId: p.id, customerId: `cu${i * 4 + 1}`, memberIds: [], startDate: start, endDate: end, status, hoursLeft: Math.max(0, p.hours - Math.floor(rand() * p.hours)), walletPaise: p.walletPaise, autoRenew: i % 3 === 0,
      fixedSlots: i === 1 ? [{ courtId: 'c2', weekday: 2, start: '19:00', minutes: 60, ratePaise: 60000 }] : i === 3 ? [{ courtId: 't1', weekday: 4, start: '20:00', minutes: 60, ratePaise: 120000 }] : [] });
    db.ledger.push({ id: uid('lg'), membershipId: `ms${i}`, at: `${start}T04:30:00.000Z`, kind: 'enrol', hours: p.hours, paise: p.pricePaise, note: `Enrolled in ${p.name}`, by: 'u_niko' });
  }
  // bookings: demand by band, regulars weighted, sources mixed; tournament holds and blocks respected via conflicts()
  const regulars = db.customers.slice(0, 25), srcs: BookingSource[] = ['app', 'app', 'app', 'playo', 'playo', 'walk_in', 'phone'], blocks = allBlocks(db);
  for (const c of db.courts) {
    const p = db.profiles.find(x => x.venueId === c.venueId)!, sport = COURT_SPORT[c.id], close = parseInt(p.close);
    for (let d = -60; d <= 14; d++) for (let h = 6; h < close; h++) {
      const startAt = at(d, `${String(h).padStart(2, '0')}:00`), dt = ist(startAt), wkend = [0, 6].includes(dt.weekday);
      const demand = (h >= 18 ? 0.72 : h >= 16 ? 0.5 : h < 9 ? 0.35 : 0.18) + (wkend ? 0.15 : 0) - (d > 0 ? d * 0.04 : 0);
      if (rand() > demand) continue;
      const mins = /^[tg]/.test(c.id) && rand() < 0.3 ? 120 : 60, endAt = new Date(Date.parse(startAt) + mins * 60000).toISOString();
      if (conflicts({ courtId: c.id, startAt, endAt }, p, db.bookings, blocks).some(blocking)) continue;
      const cu = rand() < 0.6 ? pick(regulars) : pick(d > -35 ? db.customers.slice(0, 80) : db.customers), lead = Math.min(240, -Math.log(1 - rand()) * (h >= 18 ? 60 : 20));
      const q = quote({ venueId: c.venueId, sport, startAt, endAt, rules: db.rateRules.filter(r => r.venueId === c.venueId), profile: p, offers: db.offers, code: rand() < 0.08 ? 'MORNING15' : undefined, isNewCustomer: false, contract: db.customerRates.find(r => r.customerId === cu.id) });
      const past = d < 0 || (d === 0 && h < new Date().getHours()), r = rand();
      const status: Booking['status'] = past ? (r < 0.06 ? 'cancelled' : r < 0.1 ? 'no_show' : 'completed') : r < 0.05 ? 'cancelled' : r < 0.15 ? 'pending_payment' : 'confirmed';
      const b: Booking = { id: uid('bk'), orgId: 'densparq', venueId: c.venueId, courtId: c.id, customerId: cu.id, customerName: cu.name, startAt, endAt, sport, source: pick(srcs), status, quote: q,
        paidPaise: status === 'pending_payment' ? 0 : q.totalPaise, refundPaise: 0, notes: '', createdAt: new Date(Date.parse(startAt) - lead * 3600000).toISOString(), createdBy: 'u_niko' };
      if (status === 'cancelled') { b.cancelReason = pick(['Team short of players', 'Rain', 'Clash with work']); b.refundPaise = refundFor(b, p, Date.parse(startAt) - (rand() * 40) * 3600000).paise; }
      db.bookings.push(b);
    }
  }
  db.feedback.push({ id: 'fb1', customerId: 'cu2', kind: 'complaint', text: 'Floodlight on Turf 2 flickered for 20 minutes.', status: 'open', at: at(-2) }, { id: 'fb2', customerId: 'cu5', kind: 'feedback', rating: 5, text: 'Courts were spotless.', status: 'resolved', at: at(-6) },
    { id: 'fb3', customerId: 'cu9', kind: 'complaint', text: 'Charged peak rate at 5:30 pm on a weekday.', status: 'in_progress', resolution: 'Checking rate rules', at: at(-1) }, { id: 'fb4', customerId: 'cu12', kind: 'feedback', rating: 3, text: 'Parking was full.', status: 'open', at: at(-4) });
  db.followUps.push({ id: 'fu1', customerId: 'cu2', reason: 'complaint', due: today, status: 'open', note: 'Call back about the floodlight complaint' });
}
