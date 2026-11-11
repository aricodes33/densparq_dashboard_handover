// Unified bookings calendar: every channel (walk-in, phone, app, Playo, tournaments) on one court × time grid.
import { useState } from 'react';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Banner, Btn, Chip, Confirm, Drawer, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Status, Textarea, fmtDT, fmtTime, human } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { ist, toMin, addDays, type Booking, type Block, type VenueProfile } from '@/domain/venue';
import type { AuditEntry, Court } from '@/domain/types';
import { useVenue, VenuePicker, todayIST, hhmm, ampm } from './shared';
import { BookingForm, type Prefill } from './BookingForm';

const ROW = 22, STEP = 30;
const SRC: Record<string, string> = { walk_in: 'Walk-in', phone: 'Phone', app: 'App', playo: 'Playo', tournament: 'Tournament' };
type Cal = { profile: VenueProfile; courts: Court[]; bookings: Booking[]; blocks: Block[] };

export function VenueCalendar() {
  const v = useVenue(); const date = v.sp.get('d') ?? todayIST(), mode = (v.sp.get('view') ?? 'day') as 'day' | 'week';
  const from = mode === 'week' ? addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)) : date, to = mode === 'week' ? addDays(from, 6) : date;
  const cal = useGet<Cal>(v.id ? `/venues/${v.id}/calendar?from=${from}&to=${to}` : null, 20000);
  const [form, setForm] = useState<Prefill | null>(null); const [open, setOpen] = useState<string | null>(null); const [block, setBlock] = useState(false);
  const [court, setCourt] = useState('');
  if (v.list.isLoading || cal.isLoading) return <Loading rows={8} />;
  if (v.list.error || cal.error) return <ErrorState error={v.list.error ?? cal.error} />;
  if (!v.venue || !cal.data) return <Empty icon="cal" title="No venue set up" />;
  const c = cal.data, s0 = toMin(c.profile.open), s1 = toMin(c.profile.close), rows = (s1 - s0) / STEP;
  const shown = c.bookings.filter(b => b.status !== 'cancelled');
  const sum = { bookings: shown.length, revenue: shown.reduce((a, b) => a + b.quote.totalPaise, 0), unpaid: shown.filter(b => b.status === 'pending_payment').length };
  // columns: day view = courts; week view = days for one court
  const weekCourt = court || c.courts[0]?.id;
  const cols = mode === 'day' ? c.courts.map(x => ({ key: x.id, label: x.name, courtId: x.id, date })) : Array.from({ length: 7 }, (_, i) => { const d = addDays(from, i); return { key: d, label: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), courtId: weekCourt, date: d }; });
  const place = (x: { startAt: string; endAt: string }) => { const s = ist(x.startAt), e = ist(x.endAt); const st = Math.max(s0, s.min), en = Math.min(s1, e.date === s.date ? e.min : 1440); return en > st ? { row: (st - s0) / STEP + 2, span: Math.max(1, Math.round((en - st) / STEP)), date: s.date } : null; };
  return <>
    <PageHead crumbs={false} title="Bookings calendar" sub="Walk-in, phone, app, Playo and tournament bookings on one grid. A slot can only be sold once."
      actions={<>{can(['org_admin', 'branch_manager']) && <Btn onClick={() => setBlock(true)}>Block courts</Btn>}<Btn kind="lime" icon="plus" onClick={() => setForm({ date, start: hhmm(Math.max(s0, Math.ceil((ist(new Date().toISOString()).min) / 30) * 30)) })}>New booking</Btn></>} />
    <div className="row between" style={{ marginBottom: 12 }}>
      <div className="row tight"><VenuePicker v={v} />
        <Btn size="sm" icon="back" aria-label="Previous" onClick={() => v.set('d', addDays(date, mode === 'week' ? -7 : -1))} />
        <label><span className="sr">Date</span><Input type="date" value={date} onChange={e => v.set('d', e.target.value)} style={{ width: 160 }} /></label>
        <Btn size="sm" icon="chev" aria-label="Next" onClick={() => v.set('d', addDays(date, mode === 'week' ? 7 : 1))} /><Btn size="sm" onClick={() => v.set('d', '')}>Today</Btn></div>
      <div className="row tight">{mode === 'week' && <label><span className="sr">Court</span><Select value={weekCourt} onChange={e => setCourt(e.target.value)} options={c.courts.map(x => [x.id, x.name])} /></label>}
        <Seg label="View" value={mode} onChange={m => v.set('view', m === 'day' ? '' : m)} options={[['day', 'Day · all courts'], ['week', 'Week · one court']]} /></div>
    </div>
    <div className="row tight small" style={{ marginBottom: 10 }}><Chip>{sum.bookings} bookings</Chip><Chip tone="good">{inr(sum.revenue)} booked</Chip>{sum.unpaid > 0 && <Chip tone="money">{sum.unpaid} unpaid</Chip>}<span className="muted">Click an empty slot to book it.</span></div>
    <div className="cal" style={{ gridTemplateColumns: `60px repeat(${cols.length}, minmax(120px, 1fr))`, gridTemplateRows: `auto repeat(${rows}, ${ROW}px)` }} role="grid" aria-label="Bookings calendar">
      <div className="cal-h" style={{ position: 'sticky', left: 0, zIndex: 3 }} />
      {cols.map(col => <div key={col.key} className="cal-h" role="columnheader">{col.label}</div>)}
      {Array.from({ length: rows }, (_, r) => { const min = s0 + r * STEP; return [
        <div key={`t${r}`} className="cal-t" style={{ gridRow: r + 2, gridColumn: 1 }}>{min % 60 === 0 ? ampm(min) : ''}</div>,
        ...cols.map((col, ci) => <button key={`${col.key}${r}`} type="button" className="cal-cell" aria-label={`Book ${col.label} at ${ampm(min)}`} style={{ gridRow: r + 2, gridColumn: ci + 2, borderTopStyle: min % 60 ? 'dotted' : 'solid', background: 'none', borderRight: 0, borderBottom: 0, padding: 0, cursor: 'pointer' }}
          onClick={() => setForm({ courtId: col.courtId, date: col.date, start: hhmm(min) })} />),
      ]; })}
      {c.blocks.flatMap(k => cols.map((col, ci) => { const p = k.courtIds.includes(col.courtId) && place(k); return p && p.date === col.date ? <div key={`${k.id}${col.key}`} className="slotm busy" style={{ gridColumn: ci + 2, gridRow: `${p.row} / span ${p.span}`, position: 'relative', margin: 2, inset: 0 }}>{human(k.reason)}{k.note ? ` · ${k.note}` : ''}</div> : null; }))}
      {shown.flatMap(b => cols.map((col, ci) => { const p = col.courtId === b.courtId && place(b); if (!p || p.date !== col.date) return null;
        const cls = b.status === 'pending_payment' ? 'clash' : b.status === 'completed' || b.status === 'no_show' ? 'done' : '';
        return <button key={`${b.id}${col.key}`} type="button" onClick={() => setOpen(b.id)} className={`slotm ${cls}`} style={{ gridColumn: ci + 2, gridRow: `${p.row} / span ${p.span}`, position: 'relative', margin: 2, inset: 0, cursor: 'pointer' }}>
          <div className="row between nowrap"><span className="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.customerName}</span>{b.recurrenceId && <span aria-label="recurring">↻</span>}</div>
          <div className="xs">{fmtTime(b.startAt)} · {SRC[b.source]}{b.status === 'pending_payment' ? ' · unpaid' : b.status === 'no_show' ? ' · no-show' : ''}</div></button>; }))}
    </div>
    <p className="xs muted">Red outline = unpaid · grey = played · dotted = blocked (academy, maintenance, tournaments) · ↻ = repeats weekly</p>
    {form && <BookingForm venue={v.venue} org={v.org} prefill={form} onClose={() => setForm(null)} />}
    {open && <BookingDetail id={open} courts={c.courts} onClose={() => setOpen(null)} />}
    {block && <BlockDialog venueId={v.id} courts={c.courts} date={date} onClose={() => setBlock(false)} />}
  </>;
}

type Detail = Booking & { customer: { name: string; phone: string } | null; refundPolicy: { paise: number; rule: string }; history: AuditEntry[]; series: number };
function BookingDetail({ id, courts, onClose }: { id: string; courts: Court[]; onClose: () => void }) {
  const d = useGet<Detail>(`/bookings/${id}`); const [dlg, setDlg] = useState<null | 'move' | 'cancel'>(null);
  const status = useAct((s: string) => api.post(`/bookings/${id}/status`, { status: s }), 'Updated');
  if (!d.data) return <Drawer title="Booking" onClose={onClose}><Loading /></Drawer>;
  const b = d.data, upcoming = ['confirmed', 'pending_payment'].includes(b.status);
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{b.customerName}</h2><div className="row tight"><Status s={b.status} /><Chip>{SRC[b.source]}</Chip>{b.series > 1 && <Chip tone="info">1 of {b.series} weekly</Chip>}</div></div>}>
    <div className="card flat col tight"><span className="bold">{courts.find(c => c.id === b.courtId)?.name} · {fmtDT(b.startAt)}–{fmtTime(b.endAt)}</span><span className="small muted">{b.customer?.phone} · {human(b.sport)}</span></div>
    <div className="row tight">{b.status === 'pending_payment' && <Btn kind="primary" onClick={() => status.mutate('confirmed')}>Collect {inr(b.quote.totalPaise)}</Btn>}
      {b.status === 'confirmed' && Date.parse(b.startAt) < Date.now() && <Btn onClick={() => status.mutate('completed')}>Mark played</Btn>}
      {upcoming && Date.parse(b.startAt) < Date.now() + 3600000 && <Btn onClick={() => status.mutate('no_show')}>No-show</Btn>}
      {upcoming && <><Btn onClick={() => setDlg('move')}>Reschedule</Btn><Btn kind="danger" onClick={() => setDlg('cancel')}>Cancel</Btn></>}</div>
    <section className="card col tight"><h3>Price (locked at booking)</h3>{b.quote.lines.map((l, i) => <div key={i} className="row between small"><span>{l.label}</span><span className="mono">{l.amountPaise < 0 ? '−' : ''}{inr(Math.abs(l.amountPaise))}</span></div>)}
      <div className="row between bold"><span>Total</span><span className="mono">{inr(b.quote.totalPaise)}</span></div><div className="row between small"><span>Paid</span><span className="mono">{inr(b.paidPaise)}</span></div>{b.refundPaise > 0 && <div className="row between small"><span>Refunded</span><span className="mono">−{inr(b.refundPaise)}</span></div>}</section>
    {b.cancelReason && <Banner>Cancelled: {b.cancelReason}</Banner>}{b.notes && <p className="small" style={{ margin: 0 }}>{b.notes}</p>}
    <section className="col tight"><h3>History</h3>{b.history.length ? b.history.map(a => <div key={a.id} className="small"><span className="mono muted">{fmtDT(a.at)}</span> · {a.byName}: <strong>{a.action}</strong>{a.reason && ` (${a.reason})`}</div>) : <span className="small muted">No changes since booking.</span>}</section>
    {dlg === 'move' && <Move b={b} courts={courts} onClose={() => setDlg(null)} />}
    {dlg === 'cancel' && <Cancel b={b} onClose={() => setDlg(null)} />}
  </Drawer>;
}

function Move({ b, courts, onClose }: { b: Booking; courts: Court[]; onClose: () => void }) {
  const s = ist(b.startAt); const [f, setF] = useState({ courtId: b.courtId, date: s.date, start: hhmm(s.min), reason: '' });
  const go = useAct((x: object) => api.patch(`/bookings/${b.id}`, x), 'Rescheduled. The price stays as booked.');
  return <Modal title="Reschedule" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ courtId: f.courtId, startAt: new Date(`${f.date}T${f.start}:00+05:30`).toISOString(), reason: f.reason }, { onSuccess: onClose })}>Move</Btn></>}>
    <div className="grid g2"><Field label="Court">{x => <Select {...x} value={f.courtId} onChange={e => setF({ ...f, courtId: e.target.value })} options={courts.filter(c => c.sports.includes(b.sport)).map(c => [c.id, c.name])} />}</Field>
      <Field label="Date">{x => <Input {...x} type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />}</Field><Field label="Start">{x => <Input {...x} type="time" step={1800} value={f.start} onChange={e => setF({ ...f, start: e.target.value })} />}</Field></div>
    <Field label="Reason (optional)">{x => <Input {...x} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>
  </Modal>;
}
function Cancel({ b, onClose }: { b: Detail; onClose: () => void }) {
  const [amt, setAmt] = useState(String(b.refundPolicy.paise / 100)); const mgr = can(['org_admin', 'branch_manager']);
  const go = useAct((x: object) => api.post(`/bookings/${b.id}/cancel`, x), 'Cancelled. The slot is free again.');
  return <Confirm title="Cancel booking?" danger confirm="Cancel booking" reason="Reason" busy={go.isPending} onClose={onClose}
    body={<span>Policy: <strong>{b.refundPolicy.rule}</strong> → refund {inr(b.refundPolicy.paise)} of {inr(b.paidPaise)} paid.{mgr && <span style={{ display: 'block', marginTop: 10 }}><Field label="Refund amount (₹) · changing it is an audited override">{x => <Input {...x} type="number" value={amt} onChange={e => setAmt(e.target.value)} />}</Field></span>}</span>}
    onConfirm={reason => go.mutate({ reason, refundPaise: Math.round(+amt * 100) }, { onSuccess: onClose })} />;
}
function BlockDialog({ venueId, courts, date, onClose }: { venueId: string; courts: Court[]; date: string; onClose: () => void }) {
  const [f, setF] = useState({ courtIds: [] as string[], date, from: '06:00', to: '10:00', reason: 'maintenance', note: '' });
  const go = useAct((x: object) => api.post(`/venues/${venueId}/blocks`, x), 'Courts blocked');
  return <Modal title="Block courts" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.courtIds.length} loading={go.isPending} onClick={() => go.mutate({ courtIds: f.courtIds, startAt: new Date(`${f.date}T${f.from}:00+05:30`).toISOString(), endAt: new Date(`${f.date}T${f.to}:00+05:30`).toISOString(), reason: f.reason, note: f.note }, { onSuccess: onClose })}>Block</Btn></>}>
    <div className="row tight">{courts.map(c => <label key={c.id} className="check" style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10 }}><input type="checkbox" checked={f.courtIds.includes(c.id)} onChange={e => setF({ ...f, courtIds: e.target.checked ? [...f.courtIds, c.id] : f.courtIds.filter(x => x !== c.id) })} />{c.name}</label>)}</div>
    <div className="grid g3"><Field label="Date">{x => <Input {...x} type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />}</Field><Field label="From">{x => <Input {...x} type="time" step={1800} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />}</Field><Field label="To">{x => <Input {...x} type="time" step={1800} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />}</Field></div>
    <Field label="Reason">{x => <Select {...x} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} options={[['maintenance', 'Maintenance'], ['private_event', 'Private event'], ['tournament', 'Tournament'], ['academy', 'Academy']]} />}</Field>
    <Field label="Note">{x => <Textarea {...x} rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />}</Field>
    <span className="small muted">Existing bookings in the way stop the block. Move or cancel them first. Tournament holds come from the tournament fixtures.</span>
  </Modal>;
}
