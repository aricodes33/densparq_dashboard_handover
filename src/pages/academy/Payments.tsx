// Fees: dues table (status filters), record payment, discount/scholarship, refund, void, generate month, reminders, plans.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Btn, Chip, Confirm, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Stat, download, fmtDate, human } from '@/ui/kit';
import { inr } from '@/domain/registration';
import type { FeePlan } from '@/domain/academy';
import { todayIST } from '@/pages/venue/shared';
import { useAcademy } from './shared';

type Inv = { id: string; athlete: string; plan?: string; batch: string; period: string; dueDate: string; netPaise: number; paidPaise: number; balancePaise: number; status: string; scholarshipPct: number; discountPaise: number; discountReason?: string; remindersSent: number };
const TONE: Record<string, 'good' | 'money' | 'danger' | 'neutral' | 'info'> = { paid: 'good', partial: 'info', due: 'money', overdue: 'danger', refunded: 'neutral', void: 'neutral' };

export function Payments() {
  const { org, academy } = useAcademy(); const [sp, setSp] = useSearchParams(); const st = sp.get('status') ?? '', [tab, setTab] = useState<'dues' | 'plans'>('dues');
  const f = useGet<{ plans: FeePlan[]; invoices: Inv[]; totals: { outstandingPaise: number; overdue: number } }>(`/orgs/${org}/fees${st ? `?status=${st}` : ''}`);
  const [pay, setPay] = useState<Inv | null>(null); const [adj, setAdj] = useState<Inv | null>(null); const [refund, setRefund] = useState<Inv | null>(null); const [gen, setGen] = useState(false); const [plan, setPlan] = useState(false);
  const remind = useAct(() => api.post<{ reminded: number }>(`/orgs/${org}/invoices/remind`), r => `Reminders sent for ${r.reminded} invoices (in-app + WhatsApp where consented)`);
  const mgr = can(['org_admin', 'branch_manager']);
  if (!f.data) return f.error ? <ErrorState error={f.error} /> : <Loading />;
  return <>
    <PageHead crumbs={false} title="Fees & payments" sub="Admission, monthly and term fees. Scholarships and discounts need a reason; every change is logged."
      actions={<><Btn onClick={() => remind.mutate(undefined)} loading={remind.isPending}>Send reminders</Btn>{mgr && <Btn kind="lime" onClick={() => setGen(true)}>Create month's invoices</Btn>}</>} />
    <div className="grid g4" style={{ marginBottom: 16 }}><Stat l="Outstanding" v={inr(f.data.totals.outstandingPaise)} tone="money" /><Stat l="Overdue invoices" v={f.data.totals.overdue} tone={f.data.totals.overdue ? 'danger' : undefined} /></div>
    <Seg label="Section" value={tab} onChange={setTab} options={[['dues', 'Invoices'], ['plans', 'Fee plans']]} />
    <div style={{ marginTop: 14 }}>{tab === 'dues' ? <>
      <div className="row between" style={{ marginBottom: 10 }}><Seg label="Status" value={st} onChange={v => setSp(v ? { status: v } : {})} options={[['', 'All'], ['overdue', 'Overdue'], ['due', 'Due'], ['partial', 'Part paid'], ['paid', 'Paid']]} />
        <Btn icon="download" onClick={() => download('academy-fees.csv', [['Athlete', 'Batch', 'Plan', 'Period', 'Due', 'Net ₹', 'Paid ₹', 'Balance ₹', 'Status'], ...f.data!.invoices.map(i => [i.athlete, i.batch, i.plan ?? '', i.period, i.dueDate, i.netPaise / 100, i.paidPaise / 100, i.balancePaise / 100, i.status])])}>Export</Btn></div>
      {!f.data.invoices.length ? <Empty icon="check" title="Nothing here" /> : <div className="table-wrap"><table><thead><tr><th>Athlete</th><th>For</th><th>Due</th><th className="num">Amount</th><th className="num">Balance</th><th>Status</th><th /></tr></thead><tbody>
        {f.data.invoices.map(i => <tr key={i.id}><td className="bold">{i.athlete}</td><td className="small">{i.plan}<div className="xs muted">{i.period}{i.scholarshipPct ? ` · ${i.scholarshipPct}% scholarship` : ''}{i.discountPaise ? ` · ${inr(i.discountPaise)} off` : ''}</div></td><td className="small mono">{fmtDate(i.dueDate)}</td>
          <td className="num mono">{inr(i.netPaise)}</td><td className="num mono">{i.balancePaise ? inr(i.balancePaise) : '—'}</td><td><Chip tone={TONE[i.status]}>{human(i.status)}</Chip>{i.remindersSent > 0 && <span className="xs muted"> · {i.remindersSent} reminder{i.remindersSent > 1 ? 's' : ''}</span>}</td>
          <td className="num"><div className="row tight" style={{ justifyContent: 'flex-end' }}>{i.balancePaise > 0 && <Btn size="sm" kind="primary" onClick={() => setPay(i)}>Record payment</Btn>}{mgr && i.status !== 'paid' && <Btn size="sm" onClick={() => setAdj(i)}>Discount</Btn>}{mgr && i.paidPaise > 0 && <Btn size="sm" kind="ghost" onClick={() => setRefund(i)}>Refund</Btn>}</div></td></tr>)}</tbody></table></div>}
    </> : <><div className="grid g3">{f.data.plans.map(p => <div key={p.id} className="card col tight"><Chip tone="ink">{human(p.kind)}</Chip><span className="bold">{p.name}</span><span className="display bold" style={{ fontSize: 22 }}>{inr(p.amountPaise)}</span><span className="xs muted">{p.months ? `${p.months} month${p.months > 1 ? 's' : ''}` : 'One-time'} · {p.batchIds.length} batches</span></div>)}</div>
      {mgr && <Btn icon="plus" style={{ marginTop: 12 }} onClick={() => setPlan(true)}>New fee plan</Btn>}</>}</div>
    {pay && <PayDialog i={pay} onClose={() => setPay(null)} />}
    {adj && <AdjustDialog i={adj} onClose={() => setAdj(null)} />}
    {refund && <RefundDialog i={refund} onClose={() => setRefund(null)} />}
    {gen && <GenDialog org={org} onClose={() => setGen(false)} />}
    {plan && academy && <PlanDialog academyId={academy.id} onClose={() => setPlan(false)} />}
  </>;
}
function PayDialog({ i, onClose }: { i: Inv; onClose: () => void }) {
  const [f, setF] = useState({ method: 'upi', amount: i.balancePaise / 100 }); const go = useAct((b: object) => api.post(`/invoices/${i.id}/payments`, b), 'Payment recorded. Receipt sent to the family.');
  return <Modal title={`Payment · ${i.athlete}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ method: f.method, amountPaise: Math.round(f.amount * 100) }, { onSuccess: onClose })}>Record {inr(f.amount * 100)}</Btn></>}>
    <div className="grid g2"><Field label="Method">{x => <Select {...x} value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={[['upi', 'UPI'], ['cash', 'Cash'], ['card', 'Card']]} />}</Field><Field label={`Amount ₹ (balance ${inr(i.balancePaise)})`}>{x => <Input {...x} type="number" value={f.amount} onChange={e => setF({ ...f, amount: +e.target.value })} />}</Field></div></Modal>;
}
function AdjustDialog({ i, onClose }: { i: Inv; onClose: () => void }) {
  const [f, setF] = useState({ discount: i.discountPaise / 100, scholarshipPct: i.scholarshipPct, reason: i.discountReason ?? '' }); const go = useAct((b: object) => api.post(`/invoices/${i.id}/adjust`, b), 'Updated');
  return <Modal title="Discount or scholarship" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.reason.trim()} loading={go.isPending} onClick={() => go.mutate({ discountPaise: Math.round(f.discount * 100), scholarshipPct: f.scholarshipPct, reason: f.reason }, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g2"><Field label="Discount ₹">{x => <Input {...x} type="number" value={f.discount} onChange={e => setF({ ...f, discount: +e.target.value })} />}</Field><Field label="Scholarship %" hint="Applied after the discount">{x => <Input {...x} type="number" min={0} max={100} value={f.scholarshipPct} onChange={e => setF({ ...f, scholarshipPct: +e.target.value })} />}</Field></div>
    <Field label="Reason (audited)">{x => <Input {...x} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field></Modal>;
}
function RefundDialog({ i, onClose }: { i: Inv; onClose: () => void }) {
  const [amt, setAmt] = useState(i.paidPaise / 100); const go = useAct((b: object) => api.post(`/invoices/${i.id}/refund`, b), 'Refund recorded');
  return <Confirm title="Refund" reason="Reason" confirm="Refund" danger busy={go.isPending} onClose={onClose} body={<Field label={`Amount ₹ (paid ${inr(i.paidPaise)})`}>{x => <Input {...x} type="number" value={amt} onChange={e => setAmt(+e.target.value)} />}</Field>} onConfirm={reason => go.mutate({ amountPaise: Math.round(amt * 100), reason }, { onSuccess: onClose })} />;
}
function GenDialog({ org, onClose }: { org: string; onClose: () => void }) {
  const [period, setPeriod] = useState(todayIST().slice(0, 7)); const go = useAct((b: object) => api.post<{ created: number }>(`/orgs/${org}/invoices/generate`, b), r => r.created ? `${r.created} invoices created` : 'Nothing new. This month is already invoiced.');
  return <Modal title="Create monthly invoices" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ period }, { onSuccess: onClose })}>Create</Btn></>}>
    <Field label="Month" hint="One invoice per active enrolment. Safe to run twice: existing invoices are skipped.">{x => <Input {...x} type="month" value={period} onChange={e => setPeriod(e.target.value)} />}</Field></Modal>;
}
function PlanDialog({ academyId, onClose }: { academyId: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'monthly', amount: 3000, months: 1 }); const go = useAct((b: object) => api.post(`/academies/${academyId}/fee-plans`, b), 'Fee plan created');
  return <Modal title="New fee plan" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.name} loading={go.isPending} onClick={() => go.mutate({ name: f.name, kind: f.kind, amountPaise: f.amount * 100, months: f.months }, { onSuccess: onClose })}>Create</Btn></>}>
    <div className="grid g2"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Type">{x => <Select {...x} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} options={[['admission', 'Admission'], ['monthly', 'Monthly'], ['term', 'Term'], ['package', 'Training package']]} />}</Field>
      <Field label="Amount ₹">{x => <Input {...x} type="number" value={f.amount} onChange={e => setF({ ...f, amount: +e.target.value })} />}</Field><Field label="Months covered">{x => <Input {...x} type="number" value={f.months} onChange={e => setF({ ...f, months: +e.target.value })} />}</Field></div></Modal>;
}
