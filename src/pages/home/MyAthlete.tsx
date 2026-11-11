// Parent / athlete read-only progress: attendance, fees (pay), messages, stats. Only the logged-in guardian's children.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api, getSession } from '@/api/client';
import { Btn, Chip, Empty, ErrorState, Icon, Loading, Select, Toasts, fmtDT } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { AthleteStats } from '@/pages/academy/Stats';
import { pct } from '@/pages/academy/shared';

type V = { name: string; age: number; enrollments: { id: string; batch: string; status: string }[]; attendance30: number | null; invoices: { id: string; period: string; status: string; balancePaise: number }[]; balancePaise: number; notices: { id: string; text: string; at: string }[] };
export function MyAthlete() {
  const kids = useGet<{ id: string; name: string }[]>('/me/athletes'); const [sel, setSel] = useState(''); const id = sel || kids.data?.[0]?.id;
  const a = useGet<V>(id ? `/athletes/${id}` : null); const pay = useAct((iid: string) => api.post(`/invoices/${iid}/payments`, { method: 'upi' }), 'Paid. Receipt sent.');
  if (getSession().role !== 'guardian') return <div className="pub"><Empty icon="shield" title="For parents and athletes" body="Switch the demo persona to “Lakshmi · Parent” on the home page." action={<Link className="btn" to="/">Home</Link>} /></div>;
  if (!kids.data) return <div className="pub"><Loading /></div>;
  if (!kids.data.length) return <div className="pub"><Empty title="No athlete linked to your account" body="Ask the academy to link your mobile number to your child's profile." /></div>;
  return <div className="pub" style={{ maxWidth: 900 }}><Link to="/" className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />Home</Link>
    <div className="row between" style={{ margin: '10px 0 16px' }}><h1>{a.data?.name ?? '…'}</h1>{kids.data.length > 1 && <Select value={id} onChange={e => setSel(e.target.value)} options={kids.data.map(k => [k.id, k.name])} aria-label="Child" />}</div>
    {a.error ? <ErrorState error={a.error} /> : !a.data ? <Loading /> : <div className="col loose">
      <div className="grid g3"><div className="card stat"><span className="l">Attendance (30 days)</span><span className="v">{pct(a.data.attendance30)}</span></div>
        <div className="card stat"><span className="l">Fees due</span><span className="v" style={{ fontSize: 24 }}>{inr(a.data.balancePaise)}</span></div>
        <div className="card stat"><span className="l">Batches</span><span className="small">{a.data.enrollments.filter(e => e.status === 'active').map(e => e.batch).join(', ')}</span></div></div>
      {a.data.invoices.filter(i => i.balancePaise > 0).map(i => <div key={i.id} className="card row between"><span><span className="bold">{i.period}</span> <Chip tone={i.status === 'overdue' ? 'danger' : 'money'}>{i.status}</Chip></span><Btn kind="primary" loading={pay.isPending} onClick={() => pay.mutate(i.id)}>Pay {inr(i.balancePaise)}</Btn></div>)}
      {a.data.notices.length > 0 && <section className="card col tight"><h3>Messages from the academy</h3>{a.data.notices.map(n => <div key={n.id} className="small"><span className="mono muted">{fmtDT(n.at)}</span> · {n.text}</div>)}</section>}
      <AthleteStats id={id!} />
    </div>}<Toasts /></div>;
}
