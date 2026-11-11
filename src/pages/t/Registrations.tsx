import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRegistrations, useRegistration, useTournament, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { Btn, Chip, Drawer, Empty, ErrorState, Loading, Status, Seg, Select, Input, Confirm, Modal, Field, Textarea, fmtDT, download, human, Icon } from '@/ui/kit';
import { inr, ageOn, refundDue } from '@/domain/registration';
import type { RegStatus } from '@/domain/types';

const FILTERS: [string, string][] = [['', 'All'], ['confirmed', 'Confirmed'], ['pending_payment', 'Pending payment'], ['waitlisted', 'Waitlisted'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']];

export function Registrations() {
  const { tid } = useTid(); const t = useTournament(tid); const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '', cat = sp.get('categoryId') ?? '', q = sp.get('q') ?? '';
  const qs = '?' + new URLSearchParams(Object.entries({ status, categoryId: cat, q }).filter(([, v]) => v)).toString();
  const regs = useRegistrations(tid, qs); const [open, setOpen] = useState<string | null>(null);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const catName = (id: string) => t.data?.categories.find(c => c.id === id)?.name ?? '';
  const exportCsv = () => download(`${t.data?.slug}-entries.csv`, [['Entry', 'Category', 'Status', 'Payment', 'Paid (₹)', 'Captain phone', 'Players', 'Rules version', 'Created'], ...(regs.data ?? []).map(r => [r.entryName, catName(r.categoryId), r.status, r.payStatus, r.paidPaise / 100, r.captainPhone, r.players.map(p => p.name).join('; '), r.ackVersion ?? '', r.createdAt])]);
  return <>
    <PageHead title="Registrations" sub="Entries, rosters, documents and payments. Every status change, waiver and refund is logged with who did it and why."
      actions={<><Btn icon="download" onClick={exportCsv} disabled={!regs.data?.length}>Export CSV</Btn>{t.data && <a className="btn primary" href={`#/t/${t.data.slug}/register`} target="_blank" rel="noreferrer"><Icon name="plus" />Add entry</a>}</>} />
    <div className="row between" style={{ marginBottom: 14 }}>
      <Seg label="Status" value={status} onChange={v => set('status', v)} options={FILTERS} />
      <div className="row tight"><label><span className="sr">Category</span><Select value={cat} onChange={e => set('categoryId', e.target.value)} options={[['', 'All categories'], ...(t.data?.categories ?? []).map(c => [c.id, c.name] as [string, string])]} /></label>
        <label><span className="sr">Search</span><Input placeholder="Name or phone" value={q} onChange={e => set('q', e.target.value)} style={{ width: 200 }} /></label></div>
    </div>
    {regs.isLoading ? <Loading /> : regs.error ? <ErrorState error={regs.error} retry={regs.refetch} /> : !regs.data!.length ? <Empty icon="users" title="No entries match" body={status || cat || q ? 'Try clearing the filters.' : 'When people register, they appear here.'} /> :
      <div className="table-wrap"><table><thead><tr><th>Entry</th><th>Category</th><th>Status</th><th>Payment</th><th>Rules</th><th>Docs</th><th>Registered</th></tr></thead><tbody>
        {regs.data!.map(r => { const pendingDocs = r.documents.filter(d => d.status === 'pending').length; return <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
          <td><button type="button" className="bold" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(r.id)}>{r.entryName}</button><div className="xs muted">{r.players.length} player{r.players.length > 1 ? 's' : ''}{r.players.some(p => p.guardian) ? ' · includes minors' : ''}{r.waitlistPos ? ` · #${r.waitlistPos} on waitlist` : ''}</div></td>
          <td className="small">{catName(r.categoryId)}</td><td><Status s={r.status} /></td><td><Status s={r.payStatus} /> <span className="xs muted mono">{r.amountPaise ? inr(r.amountPaise) : ''}</span></td>
          <td>{r.needsReack ? <Chip tone="money">Re-accept v{(r.ackVersion ?? 0) + 1}</Chip> : <span className="small">v{r.ackVersion}</span>}</td>
          <td>{r.documents.length ? (pendingDocs ? <Chip tone="money">{pendingDocs} to review</Chip> : <Chip tone="good">OK</Chip>) : <span className="muted">—</span>}</td><td className="small muted mono">{fmtDT(r.createdAt)}</td></tr>; })}
      </tbody></table></div>}
    {open && <RegDrawer id={open} onClose={() => setOpen(null)} />}
  </>;
}

function RegDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { tid } = useTid(); const r = useRegistration(id); const t = useTournament(tid);
  const [act, setAct] = useState<null | { to: RegStatus; title: string; reason?: string; danger?: boolean; body?: string }>(null);
  const [refund, setRefund] = useState(false); const [waive, setWaive] = useState(false);
  const move = useAct((b: { status: RegStatus; reason?: string }) => api.post<any>(`/registrations/${id}/status`, b), (x: any) => `Moved to ${human(x.status)}${x.refundDue ? `. Refund due under policy: ${inr(x.refundDue)}` : ''}`);
  const doc = useAct((b: { docId: string; status: string }) => api.patch(`/registrations/${id}/documents/${b.docId}`, { status: b.status }), 'Document updated');
  if (r.isLoading || !t.data) return <Drawer title="Entry" onClose={onClose}><Loading /></Drawer>;
  if (r.error) return <Drawer title="Entry" onClose={onClose}><ErrorState error={r.error} /></Drawer>;
  const x = r.data!, cat = t.data.categories.find(c => c.id === x.categoryId)!, admin = can(ORGANIZER);
  const actions: { to: RegStatus; label: string; title: string; reason?: string; danger?: boolean; body?: string }[] = [
    { to: 'confirmed', label: 'Confirm', title: 'Confirm this entry?', body: x.payStatus === 'unpaid' && x.amountPaise ? 'The fee is unpaid. Confirm only if they paid another way. Otherwise use a fee waiver.' : 'They get a confirmation on WhatsApp and in the app.' },
    { to: 'pending_payment', label: 'Offer a place', title: 'Offer a place?', body: 'They get a payment link. The place is held until registration closes.' },
    { to: 'rejected', label: 'Reject', title: 'Reject this entry?', reason: 'Reason (sent to the captain)', danger: true },
    { to: 'withdrawn', label: 'Withdraw', title: 'Withdraw this entry?', reason: 'Reason', danger: true, body: x.paidPaise ? `Refund due under the policy: ${inr(refundDue(t.data, x.paidPaise, new Date()))}. Issue it with "Refund" after withdrawing.` : undefined },
  ];
  const allowed: Record<RegStatus, RegStatus[]> = { draft: ['pending_payment', 'confirmed', 'withdrawn'], pending_payment: ['confirmed', 'rejected', 'withdrawn'], waitlisted: ['pending_payment', 'confirmed', 'rejected', 'withdrawn'], confirmed: ['withdrawn', 'rejected'], rejected: ['pending_payment'], withdrawn: [] };
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{x.entryName}</h2><div className="row tight"><Status s={x.status} /><Status s={x.payStatus} /><Chip>{cat.name}</Chip></div></div>}>
    <div className="row tight">{actions.filter(a => allowed[x.status].includes(a.to)).map(a => <Btn key={a.to} size="sm" kind={a.danger ? 'danger' : a.to === 'confirmed' ? 'primary' : undefined} onClick={() => setAct(a)}>{a.label}</Btn>)}
      {admin && x.status === 'pending_payment' && <Btn size="sm" onClick={() => setWaive(true)}>Waive fee</Btn>}{x.paidPaise > 0 && <Btn size="sm" onClick={() => setRefund(true)}>Refund</Btn>}</div>
    {x.rejectReason && <div className="banner danger small">Rejected: {x.rejectReason}</div>}
    <section className="col tight"><h3>Players</h3>{x.players.map(p => { const age = ageOn(p.dob, t.data!.startDate); return <div key={p.id} className="card flat row between"><div className="col tight" style={{ gap: 0 }}><span className="bold">{p.name}{p.id === x.captainId && <span className="xs muted"> · captain</span>}</span><span className="xs muted">Age {age} · {p.phone.replace(/^(\d{2})\d+(\d{3})$/, '$1•••••$2')}</span>
      {p.guardian && <span className="xs">Guardian: {p.guardian.name} ({p.guardian.relation}) · {p.guardian.consentAt ? `consented ${fmtDT(p.guardian.consentAt)}` : <strong style={{ color: 'var(--danger-fg)' }}>no consent</strong>}</span>}</div>
      {age < 18 && <Chip tone="info">Minor · stats {p.statsVisibility}</Chip>}</div>; })}</section>
    {x.documents.length > 0 && <section className="col tight"><h3>Documents</h3>{x.documents.map(d => <div key={d.id} className="row between card flat"><span className="small"><Icon name="rules" size={15} /> {d.name} <span className="muted">({human(d.type)})</span></span>
      <span className="row tight"><Status s={d.status} />{d.status === 'pending' && <><Btn size="sm" onClick={() => doc.mutate({ docId: d.id, status: 'approved' })}>Approve</Btn><Btn size="sm" kind="danger" onClick={() => doc.mutate({ docId: d.id, status: 'rejected' })}>Reject</Btn></>}</span></div>)}</section>}
    <section className="col tight"><h3>Payments</h3>{!x.payments.length ? <span className="small muted">No payments yet{x.amountPaise ? ` · fee ${inr(x.amountPaise)}` : ' · free entry'}.</span> : x.payments.map(p => <div key={p.id} className="row between small"><span>{fmtDT(p.createdAt)} · {human(p.method)} {p.receiptNo && <span className="muted">· {p.receiptNo}</span>}</span><span className="row tight"><span className="mono bold">{inr(p.amountPaise)}</span><Status s={p.status === 'captured' ? 'paid' : p.status} /></span></div>)}
      {x.refunds.map(f => <div key={f.id} className="row between small"><span>Refund · {f.reason}</span><span className="mono">−{inr(f.amountPaise)}</span></div>)}
      {x.exceptions.map((e, i) => <div key={i} className="banner info small">Exception: {human(e.type)}. {e.reason}</div>)}</section>
    <section className="col tight"><h3>Rules accepted</h3>{x.acks.map(a => <div key={a.id} className="small">v{a.version} · {fmtDT(a.acceptedAt)}</div>)}{x.needsReack && <Chip tone="money">Must re-accept the latest version</Chip>}</section>
    <section className="col tight"><h3>History</h3>{x.audit.length ? x.audit.map(a => <div key={a.id} className="small"><span className="mono muted">{fmtDT(a.at)}</span> · {a.byName}: <strong>{a.action}</strong>{a.reason && ` (${a.reason})`}</div>) : <span className="small muted">No changes since registration.</span>}</section>
    {act && <Confirm title={act.title} body={act.body} reason={act.reason} danger={act.danger} confirm={actions.find(a => a.to === act.to)?.label} busy={move.isPending} onClose={() => setAct(null)} onConfirm={reason => move.mutate({ status: act.to, reason }, { onSuccess: () => setAct(null) })} />}
    {refund && <RefundDialog id={id} max={x.paidPaise} suggested={refundDue(t.data, x.paidPaise, new Date())} onClose={() => setRefund(false)} />}
    {waive && <WaiveDialog id={id} onClose={() => setWaive(false)} />}
  </Drawer>;
}

function RefundDialog({ id, max, suggested, onClose }: { id: string; max: number; suggested: number; onClose: () => void }) {
  const [amt, setAmt] = useState(String((suggested || max) / 100)); const [reason, setReason] = useState(''); const [tried, setTried] = useState(false);
  const go = useAct((b: object) => api.post(`/registrations/${id}/refunds`, b), 'Refund sent to Razorpay. It reaches the player in 5–7 working days.');
  const n = Number(amt) * 100, err = !(n > 0) ? 'Enter an amount' : n > max ? `At most ${inr(max)}` : '';
  return <Modal title="Refund" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => { setTried(true); if (!err && reason.trim()) go.mutate({ amountPaise: n, reason }, { onSuccess: onClose }); }}>Refund {n > 0 ? inr(n) : ''}</Btn></>}>
    <p className="muted small" style={{ margin: 0 }}>Paid: {inr(max)}. Under the refund policy: {inr(suggested)}. Any other amount is an exception and needs a reason.</p>
    <Field label="Amount (₹)" error={tried ? err : undefined}>{p => <Input {...p} type="number" value={amt} onChange={e => setAmt(e.target.value)} />}</Field>
    <Field label="Reason" error={tried && !reason.trim() ? 'A reason is required' : undefined}>{p => <Textarea {...p} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}</Field>
  </Modal>;
}
function WaiveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const go = useAct((reason: string) => api.post(`/registrations/${id}/exceptions`, { type: 'fee_waiver', reason }), 'Fee waived. Entry confirmed.');
  return <Confirm title="Waive the entry fee?" body="The entry is confirmed without payment. Revenue reports show it as waived, not paid." reason="Why (e.g. sponsored team, staff entry)" confirm="Waive & confirm" busy={go.isPending} onClose={onClose} onConfirm={r => go.mutate(r, { onSuccess: onClose })} />;
}
