// Public court booking: sport → date → free slot → details → pay. Uses the same availability + pricing rules as the desk.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { Banner, Btn, Check, Field, Icon, Input, Loading, Seg, Toasts } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { SPORT_LABEL } from '@/domain/scoring';
import { addDays } from '@/domain/venue';
import type { Sport } from '@/domain/types';
import { todayIST, ampm } from '@/pages/venue/shared';
import type { PublicHome } from './Home';

type Slot = { start: string; courts: { id: string; name: string }[]; pricePaise: number };
export function BookCourt() {
  const h = useGet<PublicHome>('/public/home'); const v = h.data?.venues[0];
  const [sport, setSport] = useState<Sport>('badminton'); const [date, setDate] = useState(todayIST()); const [pick, setPick] = useState<{ start: string; courtId: string; court: string; price: number } | null>(null);
  const [f, setF] = useState({ name: '', phone: '', whatsapp: true }); const [done, setDone] = useState<{ id: string; totalPaise: number } | null>(null); const [paid, setPaid] = useState<string | null>(null);
  const slots = useGet<Slot[]>(v ? `/public/venues/${v.id}/slots?date=${date}&sport=${sport}` : null);
  const book = useAct((b: object) => api.post<{ id: string; totalPaise: number }>(`/public/venues/${v!.id}/bookings`, b)); const pay = useAct((id: string) => api.post<{ receipt: string }>(`/public/bookings/${id}/pay`));
  if (!v) return <div className="pub"><Loading /></div>;
  const err = !f.name.trim() ? 'Enter your name' : !/^\d{10}$/.test(f.phone) ? 'Enter a 10-digit mobile' : '';
  return <div className="pub" style={{ maxWidth: 720 }}><Link to="/" className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />Home</Link>
    <h1 style={{ margin: '10px 0 4px' }}>Book a court</h1><p className="muted" style={{ marginTop: 0 }}>Quickly find and reserve a court. No calls, no waiting. {v.name}, {v.address}.</p>
    {paid ? <Banner tone="good" icon="check">Court booked and paid. Receipt {paid}. Your confirmation is on its way{f.whatsapp ? ' on WhatsApp' : ''}.</Banner> : done ? <section className="card col">
      <h2>Pay {inr(done.totalPaise)}</h2><span className="muted small">{SPORT_LABEL[sport]} · {pick?.court} · {date} {pick && ampm(+pick.start.slice(0, 2) * 60)}. Held for you for 10 minutes.</span>
      <Btn kind="lime" size="lg" loading={pay.isPending} onClick={() => pay.mutate(done.id, { onSuccess: r => setPaid(r.receipt) })}>Pay with UPI</Btn><span className="xs muted">Payments are processed by Razorpay (simulated in this demo).</span></section> : <div className="col loose">
      <Seg label="Sport" value={sport} onChange={x => { setSport(x); setPick(null); }} options={v.sports.filter(s => s !== 'lagori').map(s => [s, SPORT_LABEL[s]])} />
      <div className="row tight" role="group" aria-label="Date">{Array.from({ length: 7 }, (_, i) => addDays(todayIST(), i)).map(d => <Btn key={d} size="sm" kind={d === date ? 'primary' : undefined} aria-pressed={d === date} onClick={() => { setDate(d); setPick(null); }}>{i0(d)}</Btn>)}</div>
      {!slots.data ? <Loading rows={3} /> : !slots.data.length ? <Banner>No {SPORT_LABEL[sport].toLowerCase()} courts free on this day. Pick another date.</Banner> :
        <div className="grid g4" style={{ gap: 8 }}>{slots.data.map(s => <button key={s.start} type="button" className="card col tight" aria-pressed={pick?.start === s.start} onClick={() => setPick({ start: s.start, courtId: s.courts[0].id, court: s.courts[0].name, price: s.pricePaise })}
          style={{ cursor: 'pointer', padding: 12, borderColor: pick?.start === s.start ? 'var(--text)' : undefined, background: pick?.start === s.start ? 'var(--lime-soft)' : undefined }}><span className="bold">{ampm(+s.start.slice(0, 2) * 60)}</span><span className="xs muted">{inr(s.pricePaise)} · {s.courts.length} court{s.courts.length > 1 ? 's' : ''} free</span></button>)}</div>}
      {pick && <section className="card col"><h3>{ampm(+pick.start.slice(0, 2) * 60)} · {pick.court} · {inr(pick.price)}</h3>
        <div className="grid g2"><Field label="Your name">{x => <Input {...x} autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Mobile">{x => <Input {...x} inputMode="numeric" autoComplete="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field></div>
        <Check label="Send my confirmation on WhatsApp" checked={f.whatsapp} onChange={e => setF({ ...f, whatsapp: e.target.checked })} />
        <Btn kind="primary" size="lg" disabled={!!err} loading={book.isPending} onClick={() => book.mutate({ courtId: pick.courtId, date, start: pick.start, minutes: 60, sport, ...f }, { onSuccess: setDone, onError: () => slots.refetch() })}>{err || 'Continue to payment'}</Btn></section>}
    </div>}<Toasts /></div>;
}
const i0 = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
