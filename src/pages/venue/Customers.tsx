// CRM: directory with segments, customer profile, follow-up queue, feedback log, opt-in campaigns.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can } from '@/ui/Page';
import { Banner, Btn, Check, Chip, Drawer, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Status, Textarea, fmtDT, fmtDate, human, download } from '@/ui/kit';
import { inr } from '@/domain/registration';
import type { Customer, Booking, Feedback, FollowUp, Segment, VMembership, Plan, CustomerRate } from '@/domain/venue';

type Row = Customer & { bookings: number; spendPaise: number; lastAt?: string; preferredTime: string; segments: Segment[] };
const SEGS: [string, string][] = [['', 'All'], ['regular', 'Regulars'], ['repeat', 'Repeat'], ['new', 'New'], ['inactive', 'Inactive'], ['high_value', 'High value'], ['member', 'Members']];

export function Customers() {
  const { org } = useTid(); const [sp, setSp] = useSearchParams(); const tab = (sp.get('tab') ?? 'directory') as 'directory' | 'followups' | 'feedback' | 'campaign';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  return <>
    <PageHead crumbs={false} title="Customers" sub="Who plays, how often, and who needs a nudge. Messages only go to people who opted in." />
    <Seg label="Section" value={tab} onChange={t => set('tab', t === 'directory' ? '' : t)} options={[['directory', 'Directory'], ['followups', 'Follow-ups'], ['feedback', 'Feedback'], ['campaign', 'Campaign']]} />
    <div style={{ marginTop: 16 }}>{tab === 'directory' ? <Directory org={org} sp={sp} set={set} /> : tab === 'followups' ? <FollowUps org={org} /> : tab === 'feedback' ? <FeedbackLog org={org} /> : <Campaign org={org} />}</div>
  </>;
}

function Directory({ org, sp, set }: { org: string; sp: URLSearchParams; set: (k: string, v: string) => void }) {
  const seg = sp.get('segment') ?? '', q = sp.get('q') ?? '', list = useGet<Row[]>(`/orgs/${org}/customers?${new URLSearchParams(Object.entries({ segment: seg, q }).filter(([, v]) => v))}`);
  const [open, setOpen] = useState<string | null>(null); const [add, setAdd] = useState(false);
  return <>
    <div className="row between" style={{ marginBottom: 12 }}><Seg label="Segment" value={seg} onChange={v => set('segment', v)} options={SEGS} />
      <div className="row tight"><label><span className="sr">Search</span><Input placeholder="Name or phone" value={q} onChange={e => set('q', e.target.value)} style={{ width: 200 }} /></label>
        <Btn icon="download" disabled={!list.data?.length} onClick={() => download('customers.csv', [['Name', 'Phone', 'Bookings', 'Spend ₹', 'Last booking', 'Segments', 'WhatsApp opt-in'], ...list.data!.map(c => [c.name, c.phone, c.bookings, c.spendPaise / 100, c.lastAt ?? '', c.segments.join(' '), c.consent.whatsapp ? 'yes' : 'no'])])}>Export</Btn>
        <Btn kind="primary" icon="plus" onClick={() => setAdd(true)}>Add customer</Btn></div></div>
    {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : !list.data!.length ? <Empty icon="users" title="No customers match" /> :
      <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Segments</th><th className="num">Bookings</th><th className="num">Spend</th><th>Last played</th><th>Usually</th><th>Consent</th></tr></thead><tbody>
        {list.data!.map(c => <tr key={c.id} className="click" onClick={() => setOpen(c.id)}><td><button type="button" className="bold" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setOpen(c.id)}>{c.name}</button><div className="xs muted">{c.phone}{c.corporate ? ` · ${c.corporate}` : ''}</div></td>
          <td><div className="row tight">{c.segments.map(s => <Chip key={s} tone={s === 'inactive' ? 'money' : s === 'high_value' ? 'ink' : s === 'member' ? 'good' : 'neutral'}>{human(s)}</Chip>)}</div></td>
          <td className="num">{c.bookings}</td><td className="num mono">{inr(c.spendPaise)}</td><td className="small">{c.lastAt ? fmtDate(c.lastAt) : '—'}</td><td className="small">{c.preferredTime}</td><td>{c.consent.whatsapp ? <Chip tone="good">WhatsApp</Chip> : <Chip>No messages</Chip>}</td></tr>)}
      </tbody></table></div>}
    {open && <CustomerDrawer id={open} onClose={() => setOpen(null)} />}
    {add && <AddCustomer org={org} onClose={() => setAdd(false)} />}
  </>;
}

type Detail = Customer & { bookings: Booking[]; memberships: (VMembership & { plan: Plan })[]; feedback: Feedback[]; followUps: FollowUp[]; rate?: CustomerRate };
function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useGet<Detail>(`/customers/${id}`); const [note, setNote] = useState(''); const [fb, setFb] = useState(false);
  const patch = useAct((b: object) => api.patch(`/customers/${id}`, b), 'Saved'); const addNote = useAct((text: string) => api.post(`/customers/${id}/notes`, { text }), 'Note added');
  if (!d.data) return <Drawer title="Customer" onClose={onClose}><Loading /></Drawer>;
  const c = d.data, live = c.bookings.filter(b => b.status !== 'cancelled'), spend = live.reduce((a, b) => a + b.paidPaise - b.refundPaise, 0);
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{c.name}</h2><span className="small muted">{c.phone}{c.email ? ` · ${c.email}` : ''}{c.corporate ? ` · ${c.corporate}` : ''}</span></div>}>
    <div className="grid g3"><div className="stat"><span className="l">Bookings</span><span className="v">{live.length}</span></div><div className="stat"><span className="l">Spend</span><span className="v" style={{ fontSize: 22 }}>{inr(spend)}</span></div><div className="stat"><span className="l">Cancelled</span><span className="v">{c.bookings.length - live.length}</span></div></div>
    <fieldset className="card flat col tight"><legend className="label">Consent (DPDP)</legend>
      <Check label="WhatsApp booking updates" checked={c.consent.whatsapp} onChange={e => patch.mutate({ consent: { ...c.consent, whatsapp: e.target.checked } })} />
      <Check label="Offers and campaigns" checked={c.consent.marketing} onChange={e => patch.mutate({ consent: { ...c.consent, marketing: e.target.checked } })} />
      {c.consent.at && <span className="xs muted">Last changed {fmtDT(c.consent.at)}</span>}</fieldset>
    {c.memberships.map(m => <div key={m.id} className="card flat row between"><span className="col tight" style={{ gap: 0 }}><span className="bold">{m.plan.name}</span><span className="xs muted">{m.hoursLeft} h left · ends {fmtDate(m.endDate)}</span></span><Status s={m.status} /></div>)}
    {c.rate && <Banner tone="info" icon="shield">Agreed rate: {c.rate.kind === 'fixed' ? `${inr(c.rate.value)}/h` : `${c.rate.value}% off`} ({c.rate.note}). Protected from dynamic pricing.</Banner>}
    <section className="col tight"><h3>Notes</h3><div className="row nowrap"><label className="grow"><span className="sr">New note</span><Input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note for the desk" /></label><Btn disabled={!note.trim()} onClick={() => addNote.mutate(note, { onSuccess: () => setNote('') })}>Add</Btn></div>
      {c.notes.map((n, i) => <div key={i} className="small"><span className="muted mono">{fmtDT(n.at)}</span> · {n.text}</div>)}</section>
    <section className="col tight"><div className="row between"><h3>Feedback</h3><Btn size="sm" onClick={() => setFb(true)}>Log feedback</Btn></div>{c.feedback.map(f => <div key={f.id} className="small row between"><span>{human(f.kind)}: {f.text}</span><Status s={f.status === 'resolved' ? 'completed' : f.status === 'open' ? 'pending' : 'submitted'} /></div>)}</section>
    <section className="col tight"><h3>Bookings</h3><div className="table-wrap" style={{ maxHeight: 260 }}><table><tbody>{c.bookings.slice(0, 40).map(b => <tr key={b.id}><td className="small mono">{fmtDT(b.startAt)}</td><td className="small">{human(b.sport)}</td><td><Status s={b.status} /></td><td className="num mono small">{inr(b.quote.totalPaise)}</td></tr>)}</tbody></table></div></section>
    {fb && <FeedbackDialog id={id} onClose={() => setFb(false)} />}
  </Drawer>;
}

function FeedbackDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'feedback', rating: '5', text: '' }); const go = useAct((b: object) => api.post(`/customers/${id}/feedback`, b), 'Logged. Complaints get a follow-up for tomorrow.');
  return <Modal title="Log feedback" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.text.trim()} loading={go.isPending} onClick={() => go.mutate({ ...f, rating: f.kind === 'feedback' ? +f.rating : undefined }, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g2"><Field label="Type">{x => <Select {...x} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} options={[['feedback', 'Feedback'], ['complaint', 'Complaint']]} />}</Field>{f.kind === 'feedback' && <Field label="Rating">{x => <Select {...x} value={f.rating} onChange={e => setF({ ...f, rating: e.target.value })} options={[['5', '5 · great'], ['4', '4'], ['3', '3'], ['2', '2'], ['1', '1 · poor']]} />}</Field>}</div>
    <Field label="What they said">{x => <Textarea {...x} rows={3} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} />}</Field></Modal>;
}
function AddCustomer({ org, onClose }: { org: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', whatsapp: true, marketing: false }); const go = useAct((b: object) => api.post(`/orgs/${org}/customers`, b), 'Customer added');
  const err = !f.name.trim() ? 'Enter a name' : !/^\d{10}$/.test(f.phone) ? '10-digit mobile' : '';
  return <Modal title="Add customer" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!!err} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Add</Btn></>}>
    <Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field>
    <div className="grid g2"><Field label="Mobile" error={f.phone && err === '10-digit mobile' ? err : undefined}>{x => <Input {...x} inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field><Field label="Email (optional)">{x => <Input {...x} type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}</Field></div>
    <Check label="Agrees to WhatsApp booking updates" checked={f.whatsapp} onChange={e => setF({ ...f, whatsapp: e.target.checked })} /><Check label="Agrees to offers and campaigns" checked={f.marketing} onChange={e => setF({ ...f, marketing: e.target.checked })} /></Modal>;
}

function FollowUps({ org }: { org: string }) {
  const l = useGet<(FollowUp & { customerName: string; phone: string })[]>(`/orgs/${org}/followups`);
  const gen = useAct(() => api.post<{ added: number }>(`/orgs/${org}/followups/generate`), r => r.added ? `${r.added} follow-ups added` : 'Nothing new. The queue is up to date.');
  const done = useAct((id: string) => api.patch(`/followups/${id}`, { status: 'done' }), 'Done');
  const open = (l.data ?? []).filter(f => f.status === 'open');
  return <><div className="row between" style={{ marginBottom: 12 }}><span className="muted small">Inactive regulars, expiring memberships and open complaints. Safe to regenerate; it never duplicates.</span><Btn onClick={() => gen.mutate(undefined)} loading={gen.isPending}>Find people to follow up</Btn></div>
    {l.isLoading ? <Loading /> : !open.length ? <Empty icon="check" title="Queue is clear" /> : <div className="table-wrap"><table><thead><tr><th>Due</th><th>Customer</th><th>Why</th><th>Note</th><th /></tr></thead><tbody>
      {open.map(f => <tr key={f.id}><td className="small mono">{fmtDate(f.due)}</td><td><span className="bold">{f.customerName}</span><div className="xs muted">{f.phone}</div></td><td><Chip tone={f.reason === 'complaint' ? 'danger' : f.reason === 'expiring' ? 'money' : 'neutral'}>{human(f.reason)}</Chip></td><td className="small">{f.note}</td><td className="num"><Btn size="sm" onClick={() => done.mutate(f.id)}>Done</Btn></td></tr>)}</tbody></table></div>}</>;
}
function FeedbackLog({ org }: { org: string }) {
  const l = useGet<(Feedback & { customerName: string })[]>(`/orgs/${org}/feedback`); const [res, setRes] = useState<Feedback | null>(null); const [text, setText] = useState('');
  const upd = useAct((b: { id: string; status: string; resolution?: string }) => api.patch(`/feedback/${b.id}`, b), 'Updated');
  return l.isLoading ? <Loading /> : !l.data?.length ? <Empty title="No feedback yet" /> : <><div className="table-wrap"><table><thead><tr><th>When</th><th>Customer</th><th>Type</th><th>What</th><th>Status</th><th /></tr></thead><tbody>
    {l.data.map(f => <tr key={f.id}><td className="small mono">{fmtDate(f.at)}</td><td className="bold">{f.customerName}</td><td><Chip tone={f.kind === 'complaint' ? 'danger' : 'neutral'}>{human(f.kind)}{f.rating ? ` · ${f.rating}/5` : ''}</Chip></td><td className="small">{f.text}{f.resolution && <div className="xs muted">→ {f.resolution}</div>}</td><td><Status s={f.status === 'resolved' ? 'completed' : f.status === 'open' ? 'pending' : 'submitted'} /></td>
      <td className="num">{f.status !== 'resolved' && <Btn size="sm" onClick={() => { setRes(f); setText(f.resolution ?? ''); }}>Resolve</Btn>}</td></tr>)}</tbody></table></div>
    {res && <Modal title="Resolve" onClose={() => setRes(null)} footer={<><Btn onClick={() => setRes(null)}>Cancel</Btn><Btn kind="primary" disabled={!text.trim()} onClick={() => upd.mutate({ id: res.id, status: 'resolved', resolution: text }, { onSuccess: () => setRes(null) })}>Mark resolved</Btn></>}>
      <p className="small" style={{ margin: 0 }}>{res.text}</p><Field label="How it was resolved">{x => <Textarea {...x} rows={3} value={text} onChange={e => setText(e.target.value)} />}</Field></Modal>}</>;
}
function Campaign({ org }: { org: string }) {
  const [f, setF] = useState({ segment: 'inactive', title: '', body: '' }); const [out, setOut] = useState<{ sent: number; skipped: number } | null>(null);
  const go = useAct((b: object) => api.post<{ sent: number; skipped: number }>(`/orgs/${org}/campaigns`, b), r => `Queued for ${r.sent} customers`);
  if (!can(['org_admin', 'branch_manager'])) return <Empty icon="shield" title="Managers send campaigns" />;
  return <div className="col" style={{ maxWidth: 560 }}>
    <Field label="Send to">{x => <Select {...x} value={f.segment} onChange={e => setF({ ...f, segment: e.target.value })} options={SEGS.map(([v, l]) => [v, v ? l : 'Everyone'])} />}</Field>
    <Field label="Title">{x => <Input {...x} maxLength={60} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />}</Field>
    <Field label="Message" hint={`${f.body.length}/500 · sent as an approved WhatsApp template`}>{x => <Textarea {...x} rows={4} maxLength={500} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />}</Field>
    <Btn kind="primary" icon="send" disabled={!f.title || !f.body} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: setOut })}>Send</Btn>
    {out && <Banner tone="good" icon="check">Sent to {out.sent}. {out.skipped} skipped because they haven't opted in to offers.</Banner>}
  </div>;
}
