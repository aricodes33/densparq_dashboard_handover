// Admissions CRM: pipeline board by stage, lead drawer (move stage, schedule trial, enrol), conversion report.
import { useState } from 'react';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead } from '@/ui/Page';
import { Bar, Btn, Check, Chip, Drawer, Field, Input, Loading, Modal, Seg, Select, Stat, Textarea, ErrorState, fmtDate, fmtDT, human } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import { LEAD_MOVES, STAGES, type Lead, type Batch, type funnel } from '@/domain/academy';
import type { Sport } from '@/domain/types';
import { todayIST } from '@/pages/venue/shared';
import { useAcademy, pct } from './shared';

type F = ReturnType<typeof funnel>;
export function Admissions() {
  const { org, academy } = useAcademy(); const [tab, setTab] = useState<'pipeline' | 'report'>('pipeline'); const d = useGet<{ leads: Lead[]; funnel: F; bySource: (F & { source: string })[]; lostReasons: [string, number][] }>(`/orgs/${org}/leads`);
  const bs = useGet<Batch[]>(academy ? `/academies/${academy.id}/batches` : null); const [open, setOpen] = useState<Lead | null>(null); const [add, setAdd] = useState(false);
  if (!d.data) return d.error ? <ErrorState error={d.error} /> : <Loading />;
  const x = d.data, today = todayIST();
  return <>
    <PageHead crumbs={false} title="Admissions" sub="Enquiries from the website and the desk, through trial to enrolment. Last 90 days." actions={<Btn kind="lime" icon="plus" onClick={() => setAdd(true)}>New enquiry</Btn>} />
    <div className="grid g4" style={{ marginBottom: 16 }}><Stat l="Enquiries" v={x.funnel.enquiries} /><Stat l="Enquiry → trial" v={pct(x.funnel.enquiryToTrial)} /><Stat l="Trial show rate" v={pct(x.funnel.showRate)} /><Stat l="Trial → enrolled" v={pct(x.funnel.trialToEnrol)} /></div>
    <Seg label="View" value={tab} onChange={setTab} options={[['pipeline', 'Pipeline'], ['report', 'Conversion report']]} />
    <div style={{ marginTop: 14 }}>{tab === 'pipeline' ? <div className="row top nowrap" style={{ overflowX: 'auto', gap: 12, paddingBottom: 8 }}>{STAGES.map(s => { const list = x.leads.filter(l => l.stage === s);
      return <section key={s} className="card flat col tight" style={{ minWidth: 220, flex: '1 0 220px' }} aria-label={human(s)}><div className="row between"><h3>{human(s)}</h3><Chip>{list.length}</Chip></div>
        {list.map(l => <button key={l.id} type="button" className="card col tight" style={{ textAlign: 'left', cursor: 'pointer', padding: 12 }} onClick={() => setOpen(l)}>
          <span className="bold">{l.athleteName} <span className="muted small">({l.age})</span></span><span className="xs muted">{SPORT_LABEL[l.sport]} · {human(l.source)} · {fmtDate(l.createdAt)}</span>
          {l.trial && <span className="xs">Trial {fmtDate(l.trial.date)}</span>}{l.followUp && l.followUp <= today && !['enrolled', 'lost'].includes(l.stage) && <Chip tone="money">Follow up today</Chip>}{l.lostReason && <span className="xs muted">{l.lostReason}</span>}</button>)}</section>; })}</div>
      : <div className="grid g2" style={{ alignItems: 'start' }}><section className="card col"><h3>By source</h3><div className="table-wrap"><table><thead><tr><th>Source</th><th className="num">Enquiries</th><th className="num">→ trial</th><th className="num">→ enrolled</th></tr></thead><tbody>
        {x.bySource.map(r => <tr key={r.source}><td className="bold">{human(r.source)}</td><td className="num">{r.enquiries}</td><td className="num">{pct(r.enquiryToTrial)}</td><td className="num">{pct(r.trialToEnrol)}</td></tr>)}</tbody></table></div></section>
        <section className="card col"><h3>Why people didn't join</h3>{x.lostReasons.map(([r, n]) => <div key={r} className="col tight"><div className="row between small"><span>{r}</span><span className="mono">{n}</span></div><Bar pct={n / Math.max(1, x.funnel.lost) * 100} label={r} /></div>)}</section></div>}</div>
    {open && <LeadDrawer l={open} batches={bs.data ?? []} onClose={() => setOpen(null)} />}
    {add && <NewLead org={org} onClose={() => setAdd(false)} />}
  </>;
}

function LeadDrawer({ l, batches, onClose }: { l: Lead; batches: Batch[]; onClose: () => void }) {
  const [act, setAct] = useState<Lead['stage'] | 'enrol' | null>(null);
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{l.athleteName} ({l.age})</h2><span className="small muted">{l.name} · {l.phone} · {SPORT_LABEL[l.sport]} · {human(l.source)}</span></div>}>
    <div className="row tight"><Chip tone="ink">{human(l.stage)}</Chip>{!l.consentWhatsapp && <Chip>No WhatsApp</Chip>}</div>
    <div className="row tight">{LEAD_MOVES[l.stage].map(s => <Btn key={s} size="sm" kind={s === 'lost' ? 'danger' : undefined} onClick={() => setAct(s)}>{s === 'lost' ? 'Mark lost' : `→ ${human(s)}`}</Btn>)}{l.stage === 'trial_attended' && <Btn size="sm" kind="primary" onClick={() => setAct('enrol')}>Enrol</Btn>}</div>
    {l.trial && <div className="card flat small">Trial: {batches.find(b => b.id === l.trial!.batchId)?.name} on {fmtDate(l.trial.date)}{l.trial.attended ? ' · attended' : ''}</div>}
    <section className="col tight"><h3>History</h3>{l.history.map((h, i) => <div key={i} className="small"><span className="mono muted">{fmtDT(h.at)}</span> · {human(h.stage)} · {h.by}</div>)}</section>
    {act && act !== 'enrol' && <Move l={l} to={act} batches={batches.filter(b => b.sport === l.sport)} onClose={() => { setAct(null); onClose(); }} />}
    {act === 'enrol' && <Enrol l={l} batches={batches.filter(b => b.sport === l.sport)} onClose={() => { setAct(null); onClose(); }} />}
  </Drawer>;
}
function Move({ l, to, batches, onClose }: { l: Lead; to: Lead['stage']; batches: Batch[]; onClose: () => void }) {
  const [f, setF] = useState({ batchId: batches[0]?.id ?? '', date: todayIST(), lostReason: '', followUp: '' }); const go = useAct((b: object) => api.post(`/leads/${l.id}/stage`, b), `Moved to ${human(to)}`);
  return <Modal title={to === 'lost' ? 'Mark as lost' : `Move to ${human(to)}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ stage: to, lostReason: f.lostReason, trial: { batchId: f.batchId, date: f.date }, followUp: f.followUp || undefined }, { onSuccess: onClose })}>Save</Btn></>}>
    {to === 'trial_scheduled' && <div className="grid g2"><Field label="Trial batch">{x => <Select {...x} value={f.batchId} onChange={e => setF({ ...f, batchId: e.target.value })} options={batches.map(b => [b.id, `${b.name} (${b.ageMin}–${b.ageMax})`])} />}</Field><Field label="Trial date" hint="Must be a training day">{x => <Input {...x} type="date" min={todayIST()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />}</Field></div>}
    {to === 'lost' && <Field label="Why didn't they join?">{x => <Select {...x} value={f.lostReason} onChange={e => setF({ ...f, lostReason: e.target.value })} options={[['', 'Choose…'], ['Fees too high', 'Fees too high'], ['Timing clash with school', 'Timing clash'], ['Chose another academy', 'Chose another academy'], ['Too far', 'Too far'], ['No response', 'No response']]} />}</Field>}
    {to !== 'lost' && <Field label="Next follow-up (optional)">{x => <Input {...x} type="date" value={f.followUp} onChange={e => setF({ ...f, followUp: e.target.value })} />}</Field>}</Modal>;
}
function Enrol({ l, batches, onClose }: { l: Lead; batches: Batch[]; onClose: () => void }) {
  const [f, setF] = useState({ batchId: l.trial?.batchId ?? batches[0]?.id ?? '', dob: `${new Date().getFullYear() - l.age}-01-01`, gender: 'm', consent: false });
  const go = useAct((b: object) => api.post(`/leads/${l.id}/enrol`, b), 'Enrolled. Athlete profile and admission invoice created.');
  return <Modal title={`Enrol ${l.athleteName}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={l.age < 18 && !f.consent} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Enrol</Btn></>}>
    <div className="grid g2"><Field label="Batch">{x => <Select {...x} value={f.batchId} onChange={e => setF({ ...f, batchId: e.target.value })} options={batches.map(b => [b.id, b.name])} />}</Field><Field label="Date of birth">{x => <Input {...x} type="date" value={f.dob} onChange={e => setF({ ...f, dob: e.target.value })} />}</Field></div>
    {l.age < 18 && <Check label={`${l.name} (guardian) consents to the academy storing and processing this child's data`} checked={f.consent} onChange={e => setF({ ...f, consent: e.target.checked })} />}</Modal>;
}
function NewLead({ org, onClose }: { org: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', athleteName: '', age: 10, sport: 'badminton' as Sport, source: 'walk_in', whatsapp: true, notes: '' }); const go = useAct((b: object) => api.post(`/orgs/${org}/leads`, b), 'Enquiry added');
  return <Modal title="New enquiry" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Add</Btn></>}>
    <div className="grid g2"><Field label="Parent / contact name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Mobile">{x => <Input {...x} inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field>
      <Field label="Athlete name">{x => <Input {...x} value={f.athleteName} onChange={e => setF({ ...f, athleteName: e.target.value })} />}</Field><Field label="Age">{x => <Input {...x} type="number" value={f.age} onChange={e => setF({ ...f, age: +e.target.value })} />}</Field>
      <Field label="Sport">{x => <Select {...x} value={f.sport} onChange={e => setF({ ...f, sport: e.target.value as Sport })} options={(['badminton', 'football', 'pickleball', 'box_cricket'] as Sport[]).map(s => [s, SPORT_LABEL[s]])} />}</Field>
      <Field label="Source">{x => <Select {...x} value={f.source} onChange={e => setF({ ...f, source: e.target.value })} options={[['walk_in', 'Walk-in'], ['phone', 'Phone'], ['online', 'Online'], ['referral', 'Referral']]} />}</Field></div>
    <Check label="OK to message on WhatsApp" checked={f.whatsapp} onChange={e => setF({ ...f, whatsapp: e.target.checked })} /><Field label="Notes">{x => <Textarea {...x} rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />}</Field></Modal>;
}
