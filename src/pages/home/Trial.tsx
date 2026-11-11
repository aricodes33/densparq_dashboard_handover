// Public academy trial enquiry → creates a lead in Admissions.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { Banner, Btn, Check, Chip, Field, Icon, Input, Loading, Select, Toasts, human } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { Sport } from '@/domain/types';
import type { PublicHome } from './Home';

export function Trial() {
  const h = useGet<PublicHome>('/public/home'); const a = h.data?.academies[0];
  const [f, setF] = useState({ name: '', phone: '', athleteName: '', age: 10, sport: 'badminton' as Sport, whatsapp: true }); const [sent, setSent] = useState(false);
  const go = useAct((b: object) => api.post(`/public/academies/${a!.id}/trial`, b));
  if (!a) return <div className="pub"><Loading /></div>;
  const fits = a.batches.filter(b => b.sport === f.sport && f.age >= b.ageMin && f.age <= b.ageMax);
  const err = !f.name.trim() ? 'Enter your name' : !/^\d{10}$/.test(f.phone) ? 'Enter a 10-digit mobile' : !f.athleteName.trim() ? 'Who is the trial for?' : '';
  return <div className="pub" style={{ maxWidth: 720 }}><Link to="/" className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />Home</Link>
    <h1 style={{ margin: '10px 0 4px' }}>Book a free trial</h1><p className="muted" style={{ marginTop: 0 }}>{a.name}. Tell us who the trial is for. The academy calls you within one working day to set the date.</p>
    {sent ? <Banner tone="good" icon="check">Thanks, {f.name.split(' ')[0]}. We've got your enquiry for {f.athleteName}. Expect a call from the academy within one working day.</Banner> : <div className="col loose">
      <div className="grid g2"><Field label="Sport">{x => <Select {...x} value={f.sport} onChange={e => setF({ ...f, sport: e.target.value as Sport })} options={[...new Set(a.batches.map(b => b.sport))].map(s => [s, SPORT_LABEL[s]])} />}</Field>
        <Field label="Athlete's age">{x => <Input {...x} type="number" min={4} max={70} value={f.age} onChange={e => setF({ ...f, age: +e.target.value })} />}</Field></div>
      <section className="col tight"><span className="label">Batches that fit</span>{fits.length ? fits.map(b => <div key={b.id} className="card flat row between"><span className="col tight" style={{ gap: 0 }}><span className="bold">{b.name}</span><span className="xs muted">Age {b.ageMin}–{b.ageMax} · {human(b.level)}</span></span><Chip tone={b.seats > 0 ? 'good' : 'money'}>{b.seats > 0 ? `${b.seats} seats` : 'Waitlist'}</Chip></div>) : <span className="small muted">No batch for this age yet. Send the enquiry anyway; we'll tell you when one opens.</span>}</section>
      <div className="grid g2"><Field label="Your name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Mobile">{x => <Input {...x} inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field>
        <Field label="Athlete's name">{x => <Input {...x} value={f.athleteName} onChange={e => setF({ ...f, athleteName: e.target.value })} />}</Field></div>
      <Check label="OK to contact me on WhatsApp" checked={f.whatsapp} onChange={e => setF({ ...f, whatsapp: e.target.checked })} />
      <Btn kind="lime" size="lg" disabled={!!err} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: () => setSent(true) })}>{err || 'Request a trial'}</Btn></div>}<Toasts /></div>;
}
