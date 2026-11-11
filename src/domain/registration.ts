// Registration, rules-acknowledgement and match-status state machines. docs/business-rules.md §2–3, §5
import type { Category, MatchStatus, Player, RegStatus, Registration, Tournament } from './types';

export const REG_TRANSITIONS: Record<RegStatus, RegStatus[]> = {
  draft: ['pending_payment', 'confirmed', 'waitlisted', 'withdrawn'],
  pending_payment: ['confirmed', 'waitlisted', 'rejected', 'withdrawn'],
  waitlisted: ['pending_payment', 'confirmed', 'rejected', 'withdrawn'],
  confirmed: ['withdrawn', 'rejected'],
  rejected: ['pending_payment'],
  withdrawn: [],
};
export const canMove = (from: RegStatus, to: RegStatus) => REG_TRANSITIONS[from].includes(to);

export const MATCH_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  scheduled: ['live', 'postponed', 'walkover', 'abandoned'],
  postponed: ['scheduled', 'abandoned', 'walkover'],
  live: ['paused', 'completed', 'abandoned'],
  paused: ['live', 'abandoned', 'completed'],
  completed: [], abandoned: ['scheduled'], walkover: [],
};

export function ageOn(dob: string, onDate: string) {
  const d = new Date(dob), o = new Date(onDate);
  return o.getFullYear() - d.getFullYear() - (o < new Date(o.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
}

export interface EligibilityIssue { playerId?: string; field: string; message: string; blocking: boolean }
/** Validates one entry against its category. Blocking issues prevent submit; others need organizer review. */
export function checkEntry(t: Tournament, cat: Category, players: Player[], existing: Registration[], captainPhone: string): EligibilityIssue[] {
  const out: EligibilityIssue[] = [];
  const size = cat.eventType === 'singles' ? 1 : cat.eventType === 'doubles' ? 2 : cat.rosterMin;
  if (players.length < size) out.push({ field: 'roster', message: `Needs at least ${size} player${size > 1 ? 's' : ''}`, blocking: true });
  if (cat.eventType === 'team' && players.length > cat.rosterMax) out.push({ field: 'roster', message: `At most ${cat.rosterMax} players`, blocking: true });
  for (const p of players) {
    const age = ageOn(p.dob, t.startDate);
    if (cat.minAge != null && age < cat.minAge) out.push({ playerId: p.id, field: 'dob', message: `${p.name} is ${age}; minimum is ${cat.minAge}`, blocking: true });
    if (cat.maxAge != null && age > cat.maxAge) out.push({ playerId: p.id, field: 'dob', message: `${p.name} is ${age}; maximum is ${cat.maxAge}`, blocking: true });
    if (age < t.registration.guardianConsentUnder && !p.guardian?.consentAt) out.push({ playerId: p.id, field: 'guardian', message: `${p.name} is under ${t.registration.guardianConsentUnder}: guardian consent required`, blocking: true });
    if (cat.gender === 'men' && p.gender !== 'm') out.push({ playerId: p.id, field: 'gender', message: `${p.name}: men's category`, blocking: false });
    if (cat.gender === 'women' && p.gender !== 'f') out.push({ playerId: p.id, field: 'gender', message: `${p.name}: women's category`, blocking: false });
  }
  if (t.registration.duplicateCheck === 'phone') {
    const active = existing.filter(r => r.categoryId === cat.id && !['withdrawn', 'rejected'].includes(r.status));
    if (active.some(r => r.captainPhone === captainPhone)) out.push({ field: 'phone', message: 'This phone already has an entry in this category', blocking: true });
  }
  return out;
}

/** Status a new, complete entry lands in. Capacity counts confirmed + pending_payment. */
export function initialStatus(cat: Category, regs: Registration[], waitlist: boolean): RegStatus | 'full' {
  const held = regs.filter(r => r.categoryId === cat.id && (r.status === 'confirmed' || r.status === 'pending_payment')).length;
  if (held >= cat.capacity) return waitlist ? 'waitlisted' : 'full';
  return cat.feePaise > 0 ? 'pending_payment' : 'confirmed';
}

/** Refund owed on withdrawal, per policy. */
export function refundDue(t: Tournament, paidPaise: number, at: Date): number {
  const beforeClose = at <= new Date(t.regClosesAt), p = t.registration;
  if (!beforeClose || p.refundPolicy === 'none') return 0;
  return p.refundPolicy === 'full_until_close' ? paidPaise : Math.round(paidPaise * (p.refundPercent ?? 0) / 100);
}

export const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
