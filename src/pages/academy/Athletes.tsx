// Athletes: directory, profile drawer (enrollments, transfer, attendance, fees, guardian/consent, change history), add athlete.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Banner, Btn, Check, Chip, Confirm, Drawer, Empty, ErrorState, Field, Input, Loading, Modal, Select, Status, fmtDT, fmtDate, human, download } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { SPORT_LABEL } from '@/domain/scoring';
import type { Athlete, Enrollment, Attendance, Batch } from '@/domain/academy';
import { useAcademy, pct } from './shared';

type Row = Athlete & { age: number; batches: string[]; status: string; attendance30: number | null; balancePaise: number };
type Detail = Athlete & { age: number; enrollments: (Enrollment & { batch: string })[]; attendance30: number | null; attendance: Attendance[]; invoices: { id: string; period: string; status: string; netPaise: number; balancePaise: number }[]; balancePaise: number; notices: { id: string; text: string; at: string }[] };

export function Athletes() {
  const { org, academy } = useAcademy(); const [sp, setSp] = useSearchParams(); const q = sp.get('q') ?? '', st = sp.get('status') ?? 'active', bid = sp.get('batchId') ?? '';
  const l = useGet<Row[]>(`/orgs/${org}/athletes?${new URLSearchParams({ q, status: st, ...(bid ? { batchId: bid } : {}) })}`); const batches = useGet<Batch[]>(academy ? `/academies/${academy.id}/batches` : null);
  const [open, setOpen] = useState<string | null>(sp.get('id')); const [add, setAdd] = useState(false);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  return <>
    <PageHead crumbs={false} title="Athletes" sub="Profiles, enrolments and attendance. Under-18s are visible only to staff and their guardian." actions={can(['org_admin', 'branch_manager', 'front_desk']) && <Btn kind="lime" icon="plus" onClick={() => setAdd(true)}>Add athlete</Btn>} />
    <div className="row between" style={{ marginBottom: 12 }}><div className="row tight">
      <label><span className="sr">Status</span><Select value={st} onChange={e => set('status', e.target.value)} options={[['active', 'Active'], ['inactive', 'Left / paused'], ['all', 'All']]} /></label>
      <label><span className="sr">Batch</span><Select value={bid} onChange={e => set('batchId', e.target.value)} options={[['', 'All batches'], ...(batches.data ?? []).map(b => [b.id, b.name] as [string, string])]} /></label>
      <label><span className="sr">Search</span><Input placeholder="Name or guardian phone" value={q} onChange={e => set('q', e.target.value)} style={{ width: 220 }} /></label></div>
      <Btn icon="download" disabled={!l.data?.length} onClick={() => download('athletes.csv', [['Name', 'Age', 'Batches', 'Attendance 30d', 'Balance ₹', 'Guardian', 'Guardian phone'], ...l.data!.map(a => [a.name, a.age, a.batches.join('; '), pct(a.attendance30), a.balancePaise / 100, a.guardian?.name ?? '', a.guardian?.phone ?? ''])])}>Export</Btn></div>
    {!l.data ? (l.error ? <ErrorState error={l.error} /> : <Loading />) : !l.data.length ? <Empty icon="users" title="No athletes match" /> :
      <div className="table-wrap"><table><thead><tr><th>Athlete</th><th>Batches</th><th className="num">Age</th><th>Attendance (30 d)</th><th className="num">Fees due</th></tr></thead><tbody>
        {l.data.map(a => <tr key={a.id} className="click" onClick={() => setOpen(a.id)}><td><button type="button" className="bold" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setOpen(a.id)}>{a.name}</button><div className="xs muted">{a.sports.map(s => SPORT_LABEL[s]).join(', ')} · {human(a.level)}{a.guardian ? ` · guardian ${a.guardian.name}` : ''}</div></td>
          <td className="small">{a.batches.join(', ') || '—'}</td><td className="num">{a.age}</td><td>{a.attendance30 == null ? '—' : <Chip tone={a.attendance30 < 0.75 ? 'danger' : 'good'}>{pct(a.attendance30)}</Chip>}</td><td className="num mono">{a.balancePaise ? <Chip tone="money">{inr(a.balancePaise)}</Chip> : '—'}</td></tr>)}</tbody></table></div>}
    {open && <AthleteDrawer id={open} org={org} batches={batches.data ?? []} onClose={() => setOpen(null)} />}
    {add && <AddAthlete org={org} batches={batches.data ?? []} onClose={() => setAdd(false)} />}
  </>;
}

function AthleteDrawer({ id, org, batches, onClose }: { id: string; org: string; batches: Batch[]; onClose: () => void }) {
  const d = useGet<Detail>(`/athletes/${id}`); const [move, setMove] = useState<Enrollment | null>(null); const [end, setEnd] = useState<Enrollment | null>(null); const [enrol, setEnrol] = useState(false);
  const patch = useAct((b: object) => api.patch(`/athletes/${id}`, b), 'Saved. Change recorded in history.');
  if (!d.data) return <Drawer title="Athlete" onClose={onClose}><Loading /></Drawer>;
  const a = d.data, desk = can(['org_admin', 'branch_manager', 'front_desk']);
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{a.name}</h2><div className="row tight"><Chip>{a.age} yrs</Chip><Chip>{human(a.level)}</Chip>{a.guardian && <Chip tone="info">Minor · guardian-managed</Chip>}</div></div>}>
    <div className="row tight"><Link className="btn sm primary" to={`/o/${org}/academy/player-stats?athlete=${a.id}`}>Player stats</Link>{desk && <Btn size="sm" onClick={() => setEnrol(true)}>Enrol in batch</Btn>}</div>
    <div className="grid g3"><div className="stat"><span className="l">Attendance 30 d</span><span className="v">{pct(a.attendance30)}</span></div><div className="stat"><span className="l">Fees due</span><span className="v" style={{ fontSize: 22 }}>{inr(a.balancePaise)}</span></div><div className="stat"><span className="l">Since</span><span className="v" style={{ fontSize: 18 }}>{fmtDate(a.createdAt)}</span></div></div>
    {a.guardian && <section className="card flat col tight"><h3>Guardian</h3><span className="small">{a.guardian.name} ({a.guardian.relation}) · {a.guardian.phone}</span><span className="xs muted">{a.guardian.consentAt ? `Consent given ${fmtDT(a.guardian.consentAt)}` : 'No consent on file'}</span>
      {desk && <Field label="Who can see stats">{x => <Select {...x} value={a.statsVisibility} onChange={e => patch.mutate({ statsVisibility: e.target.value })} options={[['private', 'Guardian and staff only'], ['academy', 'Academy (batch rankings)'], ['public', 'Public profile']]} />}</Field>}</section>}
    <section className="col tight"><h3>Batches</h3>{a.enrollments.map(e => <div key={e.id} className="row between card flat"><span className="col tight" style={{ gap: 0 }}><span className="bold">{e.batch}</span><span className="xs muted">{fmtDate(e.start)}{e.end ? ` – ${fmtDate(e.end)}` : ''}{e.reason ? ` · ${e.reason}` : ''}</span></span>
      <span className="row tight"><Status s={e.status === 'active' ? 'confirmed' : e.status === 'paused' ? 'paused' : 'withdrawn'} />{desk && e.status === 'active' && <><Btn size="sm" onClick={() => setMove(e)}>Transfer</Btn><Btn size="sm" kind="ghost" onClick={() => setEnd(e)}>End</Btn></>}</span></div>)}</section>
    <section className="col tight"><h3>Fees</h3>{a.invoices.slice(0, 6).map(i => <div key={i.id} className="row between small"><span>{i.period}</span><span className="row tight"><span className="mono">{inr(i.netPaise)}</span><Status s={i.status === 'paid' ? 'paid' : i.status === 'overdue' ? 'rejected' : i.status === 'partial' ? 'partially_refunded' : 'pending'} /></span></div>)}</section>
    <section className="col tight"><h3>Recent attendance</h3><div className="row tight">{a.attendance.slice(0, 20).map(x => <span key={x.id} title={`${x.date}: ${x.status}`} aria-label={`${x.date} ${x.status}`} style={{ width: 14, height: 14, borderRadius: 4, background: x.status === 'present' ? 'var(--lime)' : x.status === 'late' ? 'var(--lime-soft)' : x.status === 'excused' ? 'var(--soft)' : 'var(--danger-fg)', border: '1px solid var(--line)' }} />)}</div><span className="xs muted">Newest first · lime = present, pale = late, grey = excused, red = absent</span></section>
    {a.notices.length > 0 && <section className="col tight"><h3>Messages to family</h3>{a.notices.map(n => <div key={n.id} className="small"><span className="mono muted">{fmtDT(n.at)}</span> · {n.text}</div>)}</section>}
    <section className="col tight"><h3>Change history</h3>{a.history.length ? a.history.map((h, i) => <div key={i} className="small"><span className="mono muted">{fmtDT(h.at)}</span> · {h.by}: {h.change}</div>) : <span className="small muted">No changes.</span>}</section>
    {move && <Pick title="Transfer to batch" batches={batches.filter(b => b.id !== move.batchId)} reason onClose={() => setMove(null)} url={`/enrollments/${move.id}/transfer`} msg="Transferred" />}
    {enrol && <Pick title="Enrol in batch" batches={batches} onClose={() => setEnrol(false)} url={`/athletes/${id}/enrol`} msg="Enrolled. Admission fee added if this is their first batch." />}
    {end && <EndDialog e={end} onClose={() => setEnd(null)} />}
  </Drawer>;
}
function Pick({ title, batches, reason, url, msg, onClose }: { title: string; batches: Batch[]; reason?: boolean; url: string; msg: string; onClose: () => void }) {
  const [f, setF] = useState({ batchId: batches[0]?.id ?? '', reason: '' }); const go = useAct((b: object) => api.post(url, b), msg);
  return <Modal title={title} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.batchId || (reason && !f.reason.trim())} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Save</Btn></>}>
    <Field label="Batch">{x => <Select {...x} value={f.batchId} onChange={e => setF({ ...f, batchId: e.target.value })} options={batches.map(b => [b.id, `${b.name} (age ${b.ageMin}–${b.ageMax})`])} />}</Field>
    {reason && <Field label="Reason">{x => <Input {...x} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>}</Modal>;
}
function EndDialog({ e, onClose }: { e: Enrollment; onClose: () => void }) {
  const [pause, setPause] = useState(false); const go = useAct((b: object) => api.post(`/enrollments/${e.id}/end`, b), 'Updated');
  return <Confirm title="End or pause enrolment?" reason="Reason" confirm={pause ? 'Pause' : 'End enrolment'} danger={!pause} body={<Check label="Pause instead (keeps their place, no invoices)" checked={pause} onChange={x => setPause(x.target.checked)} />} busy={go.isPending} onClose={onClose} onConfirm={reason => go.mutate({ reason, status: pause ? 'paused' : 'left' }, { onSuccess: onClose })} />;
}
function AddAthlete({ org, batches, onClose }: { org: string; batches: Batch[]; onClose: () => void }) {
  const [f, setF] = useState({ name: '', dob: '', gender: 'm', level: 'beginner', batchId: '', gName: '', gPhone: '', consent: false });
  const age = f.dob ? new Date().getFullYear() - Number(f.dob.slice(0, 4)) : 99, minor = age < 18, b = batches.find(x => x.id === f.batchId);
  const go = useAct((x: object) => api.post(`/orgs/${org}/athletes`, x), 'Athlete added');
  return <Modal title="Add athlete" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ name: f.name, dob: f.dob, gender: f.gender, level: f.level, sports: b ? [b.sport] : [], batchId: f.batchId || undefined, guardian: minor ? { name: f.gName, phone: f.gPhone, relation: 'Parent', consentAt: f.consent ? new Date().toISOString() : undefined } : undefined }, { onSuccess: onClose })}>Add</Btn></>}>
    <div className="grid g2"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Date of birth">{x => <Input {...x} type="date" value={f.dob} onChange={e => setF({ ...f, dob: e.target.value })} />}</Field>
      <Field label="Level">{x => <Select {...x} value={f.level} onChange={e => setF({ ...f, level: e.target.value })} options={[['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced'], ['elite', 'Elite']]} />}</Field>
      <Field label="Batch (optional)">{x => <Select {...x} value={f.batchId} onChange={e => setF({ ...f, batchId: e.target.value })} options={[['', 'Not yet'], ...batches.map(z => [z.id, `${z.name} (${z.ageMin}–${z.ageMax})`] as [string, string])]} />}</Field></div>
    {b && f.dob && (age < b.ageMin || age > b.ageMax) && <Banner tone="money">Age {age} is outside this batch's {b.ageMin}–{b.ageMax} band.</Banner>}
    {minor && <><div className="grid g2"><Field label="Guardian name">{x => <Input {...x} value={f.gName} onChange={e => setF({ ...f, gName: e.target.value })} />}</Field><Field label="Guardian mobile">{x => <Input {...x} inputMode="numeric" value={f.gPhone} onChange={e => setF({ ...f, gPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field></div>
      <Check label="Guardian consents to the academy storing and processing this child's data (DPDP)" checked={f.consent} onChange={e => setF({ ...f, consent: e.target.checked })} /></>}</Modal>;
}
