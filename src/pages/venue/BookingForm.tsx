// Create a booking: one form for walk-in, phone and online; single, group (several courts) or weekly recurring. Live price + clash preview.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAct, useGet } from '@/api/hooks';
import { can } from '@/ui/Page';
import { Banner, Btn, Check, Chip, Drawer, Field, Input, Select, Textarea } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { SPORT_LABEL } from '@/domain/scoring';
import type { Quote, Customer, Conflict, VMembership } from '@/domain/venue';
import type { Sport } from '@/domain/types';
import type { VenueFull } from './shared';

export interface Prefill { courtId?: string; date: string; start: string }
export function BookingForm({ venue, org, prefill, onClose }: { venue: VenueFull; org: string; prefill: Prefill; onClose: () => void }) {
  const customers = useGet<Customer[]>(`/orgs/${org}/customers`);
  const first = venue.courts.find(c => c.id === prefill.courtId) ?? venue.courts[0];
  const [f, setF] = useState({ courtIds: first ? [first.id] : [], sport: (first?.sports[0] ?? 'badminton') as Sport, date: prefill.date, start: prefill.start, minutes: 60, source: 'walk_in', customerId: '', name: '', phone: '', whatsapp: true,
    repeat: false, repeatUntil: '', code: '', useMembership: true, paid: false, overrideOn: false, override: '', reason: '', notes: '' });
  const [q, setQ] = useState(''); const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const body = { courtIds: f.courtIds, sport: f.sport, date: f.date, start: f.start, minutes: f.minutes, customerId: f.customerId || undefined, code: f.code || undefined, useMembership: f.useMembership,
    override: f.overrideOn && f.override !== '' ? { totalPaise: Math.round(+f.override * 100), reason: f.reason } : undefined };
  const [debounced, setDebounced] = useState(body); useEffect(() => { const t = setTimeout(() => setDebounced(body), 250); return () => clearTimeout(t); }, [JSON.stringify(body)]);
  const preview = useQuery({ queryKey: ['quote', venue.id, debounced], enabled: debounced.courtIds.length > 0, queryFn: () => api.post<{ quote: Quote; conflicts: (Conflict & { courtId: string })[]; membership: VMembership | null }>(`/venues/${venue.id}/quote`, debounced) });
  const save = useAct((b: object) => api.post<{ created: unknown[]; skipped: { date: string; reason: string }[] }>(`/venues/${venue.id}/bookings`, b), r => `Booked ${r.created.length}${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0].reason})` : ''}`);
  const matches = (customers.data ?? []).filter(c => q && (c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))).slice(0, 6);
  const chosen = customers.data?.find(c => c.id === f.customerId), courtsForSport = venue.courts.filter(c => c.sports.includes(f.sport) && c.active);
  const err = !f.customerId && (!f.name.trim() || !/^\d{10}$/.test(f.phone)) ? 'Pick a customer, or enter a name and a 10-digit mobile' : !f.courtIds.length ? 'Pick a court' : f.repeat && !f.repeatUntil ? 'Pick a repeat end date' : f.overrideOn && !f.reason.trim() ? 'Overrides need a reason' : '';
  const [tried, setTried] = useState(false);
  const submit = () => { setTried(true); if (err) return; save.mutate({ ...body, source: f.source, repeatUntil: f.repeat ? f.repeatUntil : undefined, paid: f.paid, notes: f.notes, customer: f.customerId ? undefined : { name: f.name, phone: f.phone, whatsapp: f.whatsapp, sports: [f.sport] } }, { onSuccess: onClose }); };
  const p = preview.data, hard = (p?.conflicts ?? []).filter(c => c.kind !== 'buffer');
  return <Drawer title="New booking" onClose={onClose}>
    <fieldset className="col"><legend className="label">Customer</legend>
      {chosen ? <div className="row between card flat"><span className="col tight" style={{ gap: 0 }}><span className="bold">{chosen.name}</span><span className="xs muted">{chosen.phone}{p?.membership ? ' · member' : ''}</span></span><Btn size="sm" onClick={() => set({ customerId: '' })}>Change</Btn></div> : <>
        <Field label="Search existing" hint="Name or phone">{x => <Input {...x} value={q} onChange={e => setQ(e.target.value)} />}</Field>
        {matches.map(c => <button key={c.id} type="button" className="row between card flat" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { set({ customerId: c.id }); setQ(''); }}><span className="bold">{c.name}</span><span className="xs muted">{c.phone}</span></button>)}
        <div className="grid g2"><Field label="Or new: name">{x => <Input {...x} value={f.name} onChange={e => set({ name: e.target.value })} />}</Field><Field label="Mobile">{x => <Input {...x} inputMode="numeric" value={f.phone} onChange={e => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field></div>
        <Check label="Customer agrees to WhatsApp confirmations" checked={f.whatsapp} onChange={e => set({ whatsapp: e.target.checked })} /></>}
    </fieldset>
    <div className="grid g2">
      <Field label="Sport">{x => <Select {...x} value={f.sport} onChange={e => { const s = e.target.value as Sport; set({ sport: s, courtIds: venue.courts.filter(c => c.sports.includes(s)).slice(0, 1).map(c => c.id) }); }} options={[...new Set(venue.courts.flatMap(c => c.sports))].map(s => [s, SPORT_LABEL[s]])} />}</Field>
      <Field label="Source">{x => <Select {...x} value={f.source} onChange={e => set({ source: e.target.value })} options={[['walk_in', 'Walk-in'], ['phone', 'Phone'], ['app', 'Online / app'], ['playo', 'Playo']]} />}</Field>
      <Field label="Date">{x => <Input {...x} type="date" value={f.date} onChange={e => set({ date: e.target.value })} />}</Field>
      <Field label="Start">{x => <Input {...x} type="time" step={1800} value={f.start} onChange={e => set({ start: e.target.value })} />}</Field>
      <Field label="Duration">{x => <Select {...x} value={String(f.minutes)} onChange={e => set({ minutes: +e.target.value })} options={[['30', '30 min'], ['60', '1 h'], ['90', '1.5 h'], ['120', '2 h'], ['180', '3 h']]} />}</Field>
      <Field label="Offer code (optional)">{x => <Input {...x} value={f.code} onChange={e => set({ code: e.target.value.toUpperCase() })} />}</Field>
    </div>
    <fieldset className="col tight"><legend className="label">Courts {f.courtIds.length > 1 && <Chip tone="info">Group booking · {f.courtIds.length} courts</Chip>}</legend>
      <div className="row tight">{courtsForSport.map(c => <label key={c.id} className="check" style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10 }}><input type="checkbox" checked={f.courtIds.includes(c.id)} onChange={e => set({ courtIds: e.target.checked ? [...f.courtIds, c.id] : f.courtIds.filter(x => x !== c.id) })} />{c.name}</label>)}</div></fieldset>
    <Check label="Repeat weekly" checked={f.repeat} onChange={e => set({ repeat: e.target.checked })} />
    {f.repeat && <Field label="Repeat until" hint="Weeks that clash are skipped and listed">{x => <Input {...x} type="date" min={f.date} value={f.repeatUntil} onChange={e => set({ repeatUntil: e.target.value })} />}</Field>}
    {p?.membership && <Check label="Use membership hours" hint={`${p.membership.hoursLeft} h left`} checked={f.useMembership} onChange={e => set({ useMembership: e.target.checked })} />}
    {can(['org_admin', 'branch_manager']) && <><Check label="Manager price override" checked={f.overrideOn} onChange={e => set({ overrideOn: e.target.checked })} />
      {f.overrideOn && <div className="grid g2"><Field label="Total (₹)">{x => <Input {...x} type="number" value={f.override} onChange={e => set({ override: e.target.value })} />}</Field><Field label="Reason (audited)">{x => <Input {...x} value={f.reason} onChange={e => set({ reason: e.target.value })} />}</Field></div>}</>}
    <section className="card col tight" aria-live="polite"><h3>Price {f.courtIds.length > 1 || f.repeat ? 'per booking' : ''}</h3>
      {!p ? <span className="muted small">Calculating…</span> : <>{p.quote.lines.map((l, i) => <div key={i} className="row between small"><span>{l.label}</span><span className="mono">{l.amountPaise < 0 ? '−' : ''}{inr(Math.abs(l.amountPaise))}</span></div>)}
        <div className="row between bold" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}><span>Total</span><span className="mono">{inr(p.quote.totalPaise)}</span></div></>}
      {hard.map((c, i) => <Banner key={i} tone="danger">{venue.courts.find(x => x.id === c.courtId)?.name}: {c.message}{f.repeat ? ' (this date will be skipped)' : ''}</Banner>)}
    </section>
    <Check label="Payment collected now (cash / UPI at desk)" checked={f.paid} onChange={e => set({ paid: e.target.checked })} />
    <Field label="Notes">{x => <Textarea {...x} rows={2} value={f.notes} onChange={e => set({ notes: e.target.value })} />}</Field>
    {tried && err && <span className="err small" role="alert">{err}</span>}
    <div className="row" style={{ justifyContent: 'flex-end' }}><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={save.isPending} disabled={!!hard.length && !f.repeat} onClick={submit}>Book{p ? ` · ${inr(p.quote.totalPaise)}` : ''}</Btn></div>
  </Drawer>;
}
