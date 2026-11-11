// Memberships & packages: members, plans, renewals, usage ledger, fixed-slot subscriptions.
import { useState } from 'react';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can } from '@/ui/Page';
import { Bar, Banner, Btn, Check, Chip, Drawer, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Status, fmtDate, fmtDT, human, Confirm } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { SPORT_LABEL } from '@/domain/scoring';
import { addDays, type Plan, type VMembership, type Ledger, type Customer, type FixedSlot } from '@/domain/venue';
import type { Sport } from '@/domain/types';
import { useVenue, todayIST } from './shared';

type MRow = VMembership & { plan: Plan; customerName: string; usedPct: number };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Memberships() {
  const { org } = useTid(); const [tab, setTab] = useState<'members' | 'plans' | 'renewals'>('members');
  const ms = useGet<MRow[]>(`/orgs/${org}/memberships`); const plans = useGet<(Plan & { members: number })[]>(`/orgs/${org}/plans`);
  const [open, setOpen] = useState<string | null>(null); const [enrol, setEnrol] = useState(false); const [edit, setEdit] = useState<Partial<Plan> | null>(null); const [st, setSt] = useState('');
  const renew = useAct((id: string) => api.post(`/vmemberships/${id}/renew`), 'Renewed. Unused hours rolled over per plan.');
  if (ms.isLoading || plans.isLoading) return <Loading rows={6} />; if (ms.error) return <ErrorState error={ms.error} />;
  const due = ms.data!.filter(m => m.status === 'grace' || (m.status === 'active' && m.endDate <= addDays(todayIST(), 14)));
  return <>
    <PageHead crumbs={false} title="Memberships & packages" sub="Recurring revenue and loyalty. Member prices and fixed slots are locked for the term, so plan or price changes apply only from the next renewal."
      actions={<Btn kind="lime" icon="plus" onClick={() => setEnrol(true)}>Enrol member</Btn>} />
    <div className="grid g4" style={{ marginBottom: 16 }}>{(['active', 'grace', 'expired', 'cancelled'] as const).map(s => <div key={s} className="card stat"><span className="l">{human(s)}</span><span className="v">{ms.data!.filter(m => m.status === s).length}</span></div>)}</div>
    <Seg label="Section" value={tab} onChange={setTab} options={[['members', 'Members'], ['plans', 'Plans'], ['renewals', `Renewals due (${due.length})`]]} />
    <div style={{ marginTop: 14 }}>
      {tab === 'members' && <><div style={{ marginBottom: 10 }}><Seg label="Status" value={st} onChange={setSt} options={[['', 'All'], ['active', 'Active'], ['grace', 'Grace'], ['expired', 'Expired']]} /></div>
        <MemberTable rows={ms.data!.filter(m => !st || m.status === st)} onOpen={setOpen} /></>}
      {tab === 'renewals' && (!due.length ? <Empty icon="check" title="No renewals due in 14 days" /> : <div className="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Ends</th><th>Hours left</th><th /></tr></thead><tbody>
        {due.map(m => <tr key={m.id}><td className="bold">{m.customerName}</td><td>{m.plan.name}</td><td><span className="mono small">{fmtDate(m.endDate)}</span> {m.status === 'grace' && <Chip tone="money">Grace</Chip>}{m.autoRenew && <Chip tone="good">Auto-renew</Chip>}</td><td>{m.hoursLeft} h <span className="xs muted">({Math.floor(m.hoursLeft * m.plan.rolloverPct / 100 * 2) / 2} roll over)</span></td>
          <td className="num"><Btn size="sm" kind="primary" loading={renew.isPending && renew.variables === m.id} onClick={() => renew.mutate(m.id)}>Renew · {inr(m.plan.pricePaise)}</Btn></td></tr>)}</tbody></table></div>)}
      {tab === 'plans' && <><div className="grid g3">{plans.data!.map(p => <article key={p.id} className="card col tight">
        <div className="row between"><Chip tone="ink">{human(p.tier)}</Chip><span className="xs muted">{p.members} active</span></div><h3>{p.name}</h3>
        <span className="display bold" style={{ fontSize: 24 }}>{inr(p.pricePaise)}<span className="small muted"> / {p.period === 'pack' ? 'pack' : p.period.replace('ly', '')}</span></span>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.hours > 0 && <li>{p.hours} court-hours</li>}{p.discountPct > 0 && <li>{p.discountPct}% off extra bookings</li>}{p.walletPaise > 0 && <li>{inr(p.walletPaise)} wallet credit</li>}
          <li>{p.sports.map(s => SPORT_LABEL[s]).join(', ')}{p.peakAllowed ? '' : ' · off-peak only'}</li><li>{p.rolloverPct}% rollover · {p.graceDays}-day grace · cancel {p.cancelNoticeHours} h ahead</li>{p.maxMembers > 1 && <li>Up to {p.maxMembers} people</li>}</ul>
        {can(['org_admin']) && <Btn size="sm" onClick={() => setEdit(p)}>Edit</Btn>}</article>)}</div>
        {can(['org_admin']) && <Btn icon="plus" onClick={() => setEdit({})} style={{ marginTop: 14 }}>New plan</Btn>}</>}
    </div>
    {open && <MemberDrawer id={open} onClose={() => setOpen(null)} />}
    {enrol && <Enrol org={org} plans={plans.data!.filter(p => p.active)} onClose={() => setEnrol(false)} />}
    {edit && <PlanEditor org={org} plan={edit} onClose={() => setEdit(null)} />}
  </>;
}

const MemberTable = ({ rows, onOpen }: { rows: MRow[]; onOpen: (id: string) => void }) => !rows.length ? <Empty icon="users" title="No members here" /> :
  <div className="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Ends</th><th style={{ minWidth: 140 }}>Hours used</th><th>Fixed slot</th></tr></thead><tbody>{rows.map(m => <tr key={m.id} className="click" onClick={() => onOpen(m.id)}>
    <td><button type="button" className="bold" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => onOpen(m.id)}>{m.customerName}</button></td><td className="small">{m.plan.name}</td><td><Status s={m.status} /></td><td className="small mono">{fmtDate(m.endDate)}</td>
    <td>{m.plan.hours ? <div className="col tight"><Bar pct={m.usedPct * 100} label="Hours used" /><span className="xs muted">{m.hoursLeft} of {m.plan.hours} h left</span></div> : '—'}</td><td className="small">{m.fixedSlots.map(s => `${WD[s.weekday]} ${s.start}`).join(', ') || '—'}</td></tr>)}</tbody></table></div>;

type MDetail = VMembership & { plan: Plan; customer: Customer; ledger: Ledger[] };
function MemberDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useGet<MDetail>(`/vmemberships/${id}`); const [dlg, setDlg] = useState<null | 'adjust' | 'cancel' | 'slots'>(null);
  const renew = useAct(() => api.post(`/vmemberships/${id}/renew`), 'Renewed'); const cancel = useAct((reason: string) => api.post(`/vmemberships/${id}/cancel`, { reason }), 'Cancelled. Auto-renew is off.');
  if (!d.data) return <Drawer title="Member" onClose={onClose}><Loading /></Drawer>;
  const m = d.data, mgr = can(['org_admin', 'branch_manager']);
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{m.customer.name}</h2><div className="row tight"><Chip tone="ink">{m.plan.name}</Chip><Status s={m.status} /></div></div>}>
    <div className="grid g3"><div className="stat"><span className="l">Hours left</span><span className="v">{m.hoursLeft}</span></div><div className="stat"><span className="l">Wallet</span><span className="v" style={{ fontSize: 22 }}>{inr(m.walletPaise)}</span></div><div className="stat"><span className="l">Ends</span><span className="v" style={{ fontSize: 20 }}>{fmtDate(m.endDate)}</span></div></div>
    <div className="row tight">{m.status !== 'cancelled' && <Btn kind="primary" onClick={() => renew.mutate(undefined)} loading={renew.isPending}>Renew</Btn>}{mgr && <><Btn onClick={() => setDlg('slots')}>Fixed slots</Btn><Btn onClick={() => setDlg('adjust')}>Adjust / top up</Btn>{m.status !== 'cancelled' && <Btn kind="danger" onClick={() => setDlg('cancel')}>Cancel</Btn>}</>}</div>
    {m.fixedSlots.length > 0 && <Banner tone="info" icon="cal">Fixed slot{m.fixedSlots.length > 1 ? 's' : ''}: {m.fixedSlots.map(s => `${WD[s.weekday]} ${s.start} · ${inr(s.ratePaise)}/h agreed`).join('; ')}. Booked 4 weeks ahead on a rolling basis.</Banner>}
    <section className="col tight"><h3>Usage ledger</h3><div className="table-wrap"><table><thead><tr><th>When</th><th>Entry</th><th className="num">Hours</th><th className="num">₹</th></tr></thead><tbody>
      {m.ledger.map(l => <tr key={l.id}><td className="small mono">{fmtDT(l.at)}</td><td className="small"><Chip>{human(l.kind)}</Chip> {l.note}</td><td className="num mono">{l.hours > 0 ? '+' : ''}{l.hours || ''}</td><td className="num mono">{l.paise ? inr(l.paise) : ''}</td></tr>)}</tbody></table></div></section>
    {dlg === 'cancel' && <Confirm title="Cancel membership?" danger reason="Reason" confirm="Cancel membership" body="Remaining hours stay usable until the end date. It will not renew." busy={cancel.isPending} onClose={() => setDlg(null)} onConfirm={r => cancel.mutate(r, { onSuccess: () => setDlg(null) })} />}
    {dlg === 'adjust' && <Adjust id={id} onClose={() => setDlg(null)} />}
    {dlg === 'slots' && <FixedSlots m={m} onClose={() => setDlg(null)} />}
  </Drawer>;
}
function Adjust({ id, onClose }: { id: string; onClose: () => void }) {
  const [f, setF] = useState({ hours: '0', rupees: '0', note: '' }); const go = useAct((b: object) => api.post(`/vmemberships/${id}/adjust`, b), 'Ledger updated');
  return <Modal title="Adjust hours or wallet" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.note.trim()} loading={go.isPending} onClick={() => go.mutate({ hours: +f.hours, paise: Math.round(+f.rupees * 100), note: f.note }, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g2"><Field label="Hours (+/−)">{x => <Input {...x} type="number" step={0.5} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} />}</Field><Field label="Wallet ₹ (+ top-up / − correction)">{x => <Input {...x} type="number" value={f.rupees} onChange={e => setF({ ...f, rupees: e.target.value })} />}</Field></div>
    <Field label="Reason (audited)">{x => <Input {...x} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />}</Field></Modal>;
}
function FixedSlots({ m, onClose }: { m: MDetail; onClose: () => void }) {
  const v = useVenue(); const courts = v.list.data?.flatMap(x => x.courts) ?? [];
  const [slots, setSlots] = useState<FixedSlot[]>(m.fixedSlots.length ? m.fixedSlots : [{ courtId: courts[0]?.id ?? '', weekday: 2, start: '19:00', minutes: 60, ratePaise: 60000 }]);
  const go = useAct((b: object) => api.put<{ created: number; skipped: { date: string; reason: string }[] }>(`/vmemberships/${m.id}/fixed-slots`, b), r => `${r.created} weeks booked${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0].reason})` : ''}`);
  const up = (i: number, p: Partial<FixedSlot>) => setSlots(s => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return <Modal title="Fixed weekly slots" wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ slots }, { onSuccess: onClose })}>Save & book 4 weeks</Btn></>}>
    <p className="small muted" style={{ margin: 0 }}>The agreed rate is locked for the membership term and never changed by pricing rules.</p>
    {slots.map((s, i) => <div key={i} className="row nowrap" style={{ alignItems: 'flex-end' }}>
      <Field label="Court">{x => <Select {...x} value={s.courtId} onChange={e => up(i, { courtId: e.target.value })} options={courts.map(c => [c.id, c.name])} />}</Field>
      <Field label="Day">{x => <Select {...x} value={String(s.weekday)} onChange={e => up(i, { weekday: +e.target.value })} options={WD.map((d, n) => [String(n), d])} />}</Field>
      <Field label="Start">{x => <Input {...x} type="time" step={1800} value={s.start} onChange={e => up(i, { start: e.target.value })} />}</Field>
      <Field label="Minutes">{x => <Input {...x} type="number" step={30} value={s.minutes} onChange={e => up(i, { minutes: +e.target.value })} />}</Field>
      <Field label="₹ / hour">{x => <Input {...x} type="number" value={s.ratePaise / 100} onChange={e => up(i, { ratePaise: Math.round(+e.target.value * 100) })} />}</Field>
      <Btn kind="ghost" icon="x" aria-label="Remove slot" onClick={() => setSlots(slots.filter((_, j) => j !== i))} /></div>)}
    <Btn size="sm" icon="plus" onClick={() => setSlots([...slots, { ...slots[0] ?? { courtId: courts[0]?.id ?? '', start: '19:00', minutes: 60, ratePaise: 60000 }, weekday: 3 }])}>Add slot</Btn></Modal>;
}
function Enrol({ org, plans, onClose }: { org: string; plans: Plan[]; onClose: () => void }) {
  const cs = useGet<Customer[]>(`/orgs/${org}/customers`); const [q, setQ] = useState('');
  const [f, setF] = useState({ planId: plans[0]?.id ?? '', customerId: '', startDate: todayIST(), autoRenew: true });
  const go = useAct((b: object) => api.post(`/orgs/${org}/memberships`, b), 'Enrolled. Payment recorded in the ledger.');
  const plan = plans.find(p => p.id === f.planId), hits = (cs.data ?? []).filter(c => q && (c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))).slice(0, 5), who = cs.data?.find(c => c.id === f.customerId);
  return <Modal title="Enrol member" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.customerId || !plan} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Enrol{plan ? ` · ${inr(plan.pricePaise)}` : ''}</Btn></>}>
    <Field label="Plan">{x => <Select {...x} value={f.planId} onChange={e => setF({ ...f, planId: e.target.value })} options={plans.map(p => [p.id, `${p.name} · ${inr(p.pricePaise)}`])} />}</Field>
    {who ? <div className="row between card flat"><span className="bold">{who.name}</span><Btn size="sm" onClick={() => setF({ ...f, customerId: '' })}>Change</Btn></div> : <><Field label="Customer" hint="Search by name or phone">{x => <Input {...x} value={q} onChange={e => setQ(e.target.value)} />}</Field>
      {hits.map(c => <button key={c.id} type="button" className="row between card flat" style={{ cursor: 'pointer' }} onClick={() => setF({ ...f, customerId: c.id })}><span className="bold">{c.name}</span><span className="xs muted">{c.phone}</span></button>)}</>}
    <div className="grid g2"><Field label="Starts">{x => <Input {...x} type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />}</Field><Check label="Auto-renew" checked={f.autoRenew} onChange={e => setF({ ...f, autoRenew: e.target.checked })} /></div></Modal>;
}
function PlanEditor({ org, plan, onClose }: { org: string; plan: Partial<Plan>; onClose: () => void }) {
  const [f, setF] = useState({ name: '', tier: 'standard', period: 'monthly', rupees: 0, hours: 0, discountPct: 0, walletRupees: 0, sports: ['badminton'] as Sport[], peakAllowed: false, rolloverPct: 25, graceDays: 7, cancelNoticeHours: 12, maxMembers: 1, active: true, ...plan, ...(plan.pricePaise ? { rupees: plan.pricePaise / 100, walletRupees: (plan.walletPaise ?? 0) / 100 } : {}) });
  const go = useAct((b: object) => plan.id ? api.patch(`/plans/${plan.id}`, b) : api.post(`/orgs/${org}/plans`, b), plan.id ? 'Plan saved. Current members keep their terms until renewal.' : 'Plan created');
  const n = (k: keyof typeof f, label: string) => <Field label={label}>{x => <Input {...x} type="number" value={f[k] as number} onChange={e => setF({ ...f, [k]: +e.target.value })} />}</Field>;
  return <Modal title={plan.id ? `Edit ${plan.name}` : 'New plan'} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ ...f, pricePaise: f.rupees * 100, walletPaise: f.walletRupees * 100 }, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g3"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label="Tier">{x => <Select {...x} value={f.tier} onChange={e => setF({ ...f, tier: e.target.value as Plan['tier'] })} options={[['standard', 'Standard'], ['student', 'Student'], ['family', 'Family'], ['regular', 'Regular player'], ['corporate', 'Corporate']]} />}</Field>
      <Field label="Period">{x => <Select {...x} value={f.period} onChange={e => setF({ ...f, period: e.target.value as Plan['period'] })} options={[['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annual', 'Annual'], ['pack', 'Pack (90-day validity)']]} />}</Field>
      {n('rupees', 'Price ₹')}{n('hours', 'Court-hours included')}{n('discountPct', '% off extra bookings')}{n('walletRupees', 'Wallet credit ₹')}{n('rolloverPct', 'Rollover % of unused hours')}{n('graceDays', 'Grace days after expiry')}{n('cancelNoticeHours', 'Cancel notice (h) to get hours back')}{n('maxMembers', 'People covered')}</div>
    <fieldset className="row tight"><legend className="label">Sports</legend>{(Object.keys(SPORT_LABEL) as Sport[]).map(s => <label key={s} className="check" style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10 }}><input type="checkbox" checked={f.sports.includes(s)} onChange={e => setF({ ...f, sports: e.target.checked ? [...f.sports, s] : f.sports.filter(x => x !== s) })} />{SPORT_LABEL[s]}</label>)}</fieldset>
    <Check label="Hours usable at peak times" checked={f.peakAllowed} onChange={e => setF({ ...f, peakAllowed: e.target.checked })} />
    {plan.id && <Check label="On sale" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />}</Modal>;
}
