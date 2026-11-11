import { useState } from 'react';
import { useNotifications, useAct, useTournament, useMembers } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid } from '@/ui/Page';
import { Btn, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Select, Textarea, fmtDT, human, Banner } from '@/ui/kit';

export function Messages() {
  const { tid } = useTid(); const n = useNotifications(tid); const [compose, setCompose] = useState(false);
  if (n.isLoading) return <Loading />; if (n.error) return <ErrorState error={n.error} />;
  return <>
    <PageHead title="Messages" sub="Confirmations, receipts, rule changes and schedule changes go out automatically when you act elsewhere. Every send and delivery attempt is logged here." actions={<Btn kind="primary" icon="send" onClick={() => setCompose(true)}>New announcement</Btn>} />
    <Banner tone="info" icon="whatsapp">Sent in the app to everyone, and on WhatsApp to people who opted in. WhatsApp uses approved templates from the provider; free text goes as the template body.</Banner>
    <div style={{ marginTop: 14 }}>{!n.data!.length ? <Empty icon="bell" title="Nothing sent yet" /> : <div className="table-wrap"><table><thead><tr><th>Sent</th><th>Type</th><th>Message</th><th className="num">To</th><th>Delivery</th></tr></thead><tbody>
      {n.data!.map(x => <tr key={x.id}><td className="small mono">{fmtDT(x.createdAt)}</td><td><Chip>{human(x.kind)}</Chip></td><td><span className="bold">{x.title}</span><div className="small muted">{x.body}</div></td><td className="num">{x.recipientRegIds.length}</td>
        <td className="small">{x.stats.queued ? <Chip tone="money">{x.stats.queued} queued</Chip> : <span>{x.stats.delivered} delivered · {x.stats.read} read{x.stats.failed ? <> · <span style={{ color: 'var(--danger-fg)' }}>{x.stats.failed} failed</span></> : ''}</span>}</td></tr>)}</tbody></table></div>}</div>
    {compose && <Compose tid={tid} onClose={() => setCompose(false)} />}
  </>;
}

function Compose({ tid, onClose }: { tid: string; onClose: () => void }) {
  const [f, setF] = useState({ audience: 'all', title: '', body: '' }); const [tried, setTried] = useState(false);
  const go = useAct((b: object) => api.post(`/tournaments/${tid}/notifications`, b), 'Announcement queued');
  return <Modal title="New announcement" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => { setTried(true); if (f.title && f.body) go.mutate(f, { onSuccess: onClose }); }}>Send</Btn></>}>
    <Field label="Send to">{p => <Select {...p} value={f.audience} onChange={e => setF({ ...f, audience: e.target.value })} options={[['all', 'Every active entry'], ['unpaid', 'Entries waiting on payment'], ['reack', 'Entries that must re-accept rules']]} />}</Field>
    <Field label="Title" error={tried && !f.title ? 'Add a title' : undefined}>{p => <Input {...p} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={60} />}</Field>
    <Field label="Message" hint={`${f.body.length}/500`} error={tried && !f.body ? 'Write a message' : undefined}>{p => <Textarea {...p} rows={4} maxLength={500} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />}</Field>
  </Modal>;
}

export function TSettings() {
  const { tid, org } = useTid(); const t = useTournament(tid); const m = useMembers(org);
  if (t.isLoading) return <Loading />;
  const staff = t.data!.staff;
  return <>
    <PageHead title="Settings" sub="Staff for this tournament, and the lifecycle actions." />
    <section className="card col"><h2>Tournament staff</h2>{!staff.length ? <span className="muted">Only organizers. Add referees in Setup › Prizes & staff.</span> : staff.map((s, i) => <div key={i} className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span className="bold">{m.data?.find(x => x.userId === s.userId)?.user?.name ?? s.userId}</span><Chip>{human(s.role)}</Chip></div>)}</section>
    <section className="card col" style={{ marginTop: 16 }}><h2>Privacy</h2><p className="small muted" style={{ margin: 0 }}>Players under {t.data!.registration.guardianConsentUnder} need guardian consent and their stats are private by default. Phone numbers are masked on public pages. Personal data is kept for [YOUR RETENTION PERIOD] after the event, then anonymised.</p></section>
  </>;
}
