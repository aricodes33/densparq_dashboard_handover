// Batches: list, detail drawer with roster + attendance taking + sessions (cancel/reschedule), create/edit with clash check.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Banner, Bar, Btn, Chip, Drawer, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Status, Textarea, fmtDate, human } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { Batch, Session, AttStatus, SessionChange } from '@/domain/academy';
import type { Sport, Court } from '@/domain/types';
import { todayIST } from '@/pages/venue/shared';
import { useAcademy, pct, WD } from './shared';

type BView = Batch & { enrolled: number; seats: number; attendance30: number | null; next?: Session; courts: string[] };
type BDetail = BView & { roster: { id: string; name: string; age: number; fits: boolean; attendance30: number | null; mark?: AttStatus }[]; date: string; sessions: Session[]; changes: SessionChange[] };

export function Batches() {
  const { org, academy } = useAcademy(); const [sp, setSp] = useSearchParams(); const open = sp.get('id');
  const l = useGet<BView[]>(academy ? `/academies/${academy.id}/batches` : null); const [edit, setEdit] = useState<Partial<Batch> | null>(null);
  if (!l.data) return l.error ? <ErrorState error={l.error} /> : <Loading />;
  return <>
    <PageHead crumbs={false} title="Batches" sub="Classes by sport, age and level. Sessions hold their courts on the venue calendar, so bookings can't clash with them." actions={can(['org_admin', 'branch_manager']) && <Btn kind="lime" icon="plus" onClick={() => setEdit({})}>New batch</Btn>} />
    {!l.data.length ? <Empty icon="users" title="No batches yet" /> : <div className="grid g3">{l.data.map(b => <button key={b.id} type="button" className="card col tight" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSp({ id: b.id })}>
      <div className="row between"><Chip tone="ink">{SPORT_LABEL[b.sport]}</Chip><Chip>{human(b.level)}</Chip></div><h3>{b.name}</h3>
      <span className="small muted">Age {b.ageMin}–{b.ageMax} · {b.coach.name}</span><span className="small">{[...new Set(b.schedule.map(s => `${WD[s.weekday]} ${s.start}`))].join(', ')} · {b.courts.join(', ')}</span>
      <div className="col tight"><span className="xs muted">{b.enrolled}/{b.capacity} enrolled · {b.seats} seats free</span><Bar pct={b.enrolled / b.capacity * 100} label="Seats filled" /></div>
      <div className="row between small"><span>Attendance (30 d) <strong>{pct(b.attendance30)}</strong></span>{b.next && <span className="muted">Next {fmtDate(b.next.date)} {b.next.start}</span>}</div></button>)}</div>}
    {open && <BatchDrawer id={open} onClose={() => setSp({})} onEdit={b => setEdit(b)} />}
    {edit && academy && <BatchEditor academyId={academy.id} org={org} batch={edit} onClose={() => setEdit(null)} />}
  </>;
}

function BatchDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (b: Batch) => void }) {
  const [date, setDate] = useState(todayIST()); const d = useGet<BDetail>(`/batches/${id}?date=${date}`); const [marks, setMarks] = useState<Record<string, AttStatus>>({}); const [change, setChange] = useState<Session | null>(null); const [tab, setTab] = useState<'attendance' | 'sessions'>('attendance');
  const save = useAct((b: object) => api.put<{ saved: number; alerts: string[] }>(`/batches/${id}/attendance`, b), r => `Saved ${r.saved}${r.alerts.length ? ` · guardians alerted: ${r.alerts.join(', ')} (2 absences in a row)` : ''}`);
  if (!d.data) return <Drawer title="Batch" onClose={onClose}><Loading /></Drawer>;
  const b = d.data, cur = (aid: string) => marks[aid] ?? b.roster.find(r => r.id === aid)?.mark, isDay = b.sessions.some(s => s.date === date && (s.status === 'scheduled' || s.status === 'rescheduled'));
  return <Drawer onClose={onClose} title={<div className="col tight"><h2>{b.name}</h2><span className="small muted">{b.coach.name} · {b.coach.phone} · {b.enrolled}/{b.capacity}</span></div>}>
    <div className="row between"><Seg label="Section" value={tab} onChange={setTab} options={[['attendance', 'Attendance'], ['sessions', 'Sessions']]} />{can(['org_admin', 'branch_manager']) && <Btn size="sm" onClick={() => onEdit(b)}>Edit batch</Btn>}</div>
    {tab === 'attendance' ? <>
      <div className="row nowrap"><Field label="Session date">{x => <Input {...x} type="date" max={todayIST()} value={date} onChange={e => { setDate(e.target.value); setMarks({}); }} />}</Field>
        <Btn size="sm" onClick={() => setMarks(Object.fromEntries(b.roster.map(r => [r.id, 'present'])))} style={{ marginTop: 22 }}>All present</Btn></div>
      {!isDay && <Banner tone="money">No session on {fmtDate(date)}. Pick a training day.</Banner>}
      <div className="col tight">{b.roster.map(r => <div key={r.id} className="row between card flat" style={{ padding: '8px 12px' }}>
        <span className="col tight" style={{ gap: 0 }}><span className="bold">{r.name}</span><span className="xs muted">Age {r.age}{!r.fits && ' · outside age band'} · {pct(r.attendance30)} (30 d)</span></span>
        <div className="seg" role="radiogroup" aria-label={`${r.name} attendance`}>{(['present', 'late', 'absent', 'excused'] as AttStatus[]).map(s => <button key={s} type="button" role="radio" aria-checked={cur(r.id) === s} aria-pressed={cur(r.id) === s} disabled={!isDay} onClick={() => setMarks({ ...marks, [r.id]: s })}>{s[0].toUpperCase() + s.slice(1, s === 'excused' ? 3 : 7)}</button>)}</div></div>)}</div>
      <Btn kind="primary" disabled={!Object.keys(marks).length || !isDay} loading={save.isPending} onClick={() => save.mutate({ date, marks }, { onSuccess: () => setMarks({}) })}>Save attendance ({Object.keys(marks).length})</Btn>
    </> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Time · court</th><th>Status</th><th /></tr></thead><tbody>
      {b.sessions.filter((s, i, a) => a.findIndex(z => z.date === s.date) === i).map(s => <tr key={s.date + s.courtId}><td className="small mono">{fmtDate(s.date)}</td><td className="small">{s.start} · {s.minutes} min</td><td><Status s={s.status === 'scheduled' ? 'scheduled' : s.status === 'cancelled' ? 'abandoned' : s.status === 'holiday' ? 'postponed' : 'paused'} />{s.note && <span className="xs muted"> {s.note}</span>}</td>
        <td className="num">{s.status === 'scheduled' && s.date >= todayIST() && can(['org_admin', 'branch_manager']) && <Btn size="sm" onClick={() => setChange(s)}>Change</Btn>}</td></tr>)}</tbody></table></div>}
    {change && <SessionChangeDialog batchId={id} s={change} onClose={() => setChange(null)} />}
  </Drawer>;
}

function SessionChangeDialog({ batchId, s, onClose }: { batchId: string; s: Session; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'cancelled', newDate: s.date, newStart: s.start, reason: '' });
  const go = useAct((b: object) => api.post(`/batches/${batchId}/sessions/change`, b), 'Updated. Guardians and athletes are notified.');
  return <Modal title={`Session on ${fmtDate(s.date)}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.reason.trim()} loading={go.isPending} onClick={() => go.mutate({ date: s.date, kind: f.kind, ...(f.kind === 'rescheduled' ? { newDate: f.newDate, newStart: f.newStart } : {}), reason: f.reason }, { onSuccess: onClose })}>Save</Btn></>}>
    <Seg label="Change" value={f.kind} onChange={k => setF({ ...f, kind: k })} options={[['cancelled', 'Cancel'], ['rescheduled', 'Reschedule']]} />
    {f.kind === 'rescheduled' && <div className="grid g2"><Field label="New date">{x => <Input {...x} type="date" value={f.newDate} onChange={e => setF({ ...f, newDate: e.target.value })} />}</Field><Field label="New start">{x => <Input {...x} type="time" step={1800} value={f.newStart} onChange={e => setF({ ...f, newStart: e.target.value })} />}</Field></div>}
    <Field label="Reason (sent to families)">{x => <Textarea {...x} rows={2} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>
    <span className="small muted">Holidays come from Venue setup and skip sessions automatically.</span></Modal>;
}

function BatchEditor({ academyId, org, batch, onClose }: { academyId: string; org: string; batch: Partial<Batch>; onClose: () => void }) {
  const venues = useGet<{ courts: Court[] }[]>(`/orgs/${org}/venue-setup`); const courts = venues.data?.[0]?.courts ?? [];
  const [f, setF] = useState({ name: '', sport: 'badminton' as Sport, program: 'Junior', ageMin: 8, ageMax: 12, level: 'beginner' as Batch['level'], capacity: 12, coachName: batch.coach?.name ?? '', coachPhone: batch.coach?.phone ?? '', schedule: batch.schedule ?? [{ weekday: 1, start: '16:00', minutes: 60, courtId: '' }], ...batch });
  const [clashes, setClashes] = useState<{ date: string; start: string; with: string }[]>([]);
  const go = useAct((b: object) => batch.id ? api.patch(`/batches/${batch.id}`, b) : api.post(`/academies/${academyId}/batches`, b), batch.id ? 'Batch updated' : 'Batch created. Its sessions now hold courts on the venue calendar.');
  const up = (i: number, p: object) => setF({ ...f, schedule: f.schedule.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const submit = () => go.mutate({ ...f, coach: { name: f.coachName, phone: f.coachPhone, userId: batch.coach?.userId } }, { onSuccess: onClose, onError: e => setClashes(e.code === 'clashes' ? (e.details as typeof clashes) : []) });
  return <Modal title={batch.id ? `Edit ${batch.name}` : 'New batch'} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={submit}>Save</Btn></>}>
    <div className="grid g3"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label="Sport">{x => <Select {...x} value={f.sport} onChange={e => setF({ ...f, sport: e.target.value as Sport })} options={(Object.keys(SPORT_LABEL) as Sport[]).map(s => [s, SPORT_LABEL[s]])} />}</Field>
      <Field label="Program">{x => <Select {...x} value={f.program} onChange={e => setF({ ...f, program: e.target.value })} options={[['Junior', 'Junior'], ['Performance', 'Performance'], ['Adult', 'Adult']]} />}</Field>
      <Field label="Min age">{x => <Input {...x} type="number" value={f.ageMin} onChange={e => setF({ ...f, ageMin: +e.target.value })} />}</Field><Field label="Max age">{x => <Input {...x} type="number" value={f.ageMax} onChange={e => setF({ ...f, ageMax: +e.target.value })} />}</Field>
      <Field label="Level">{x => <Select {...x} value={f.level} onChange={e => setF({ ...f, level: e.target.value as Batch['level'] })} options={[['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced'], ['elite', 'Elite']]} />}</Field>
      <Field label="Capacity">{x => <Input {...x} type="number" value={f.capacity} onChange={e => setF({ ...f, capacity: +e.target.value })} />}</Field>
      <Field label="Coach name">{x => <Input {...x} value={f.coachName} onChange={e => setF({ ...f, coachName: e.target.value })} />}</Field><Field label="Coach mobile">{x => <Input {...x} value={f.coachPhone} onChange={e => setF({ ...f, coachPhone: e.target.value })} />}</Field></div>
    <fieldset className="col tight"><legend className="label">Weekly sessions</legend>{f.schedule.map((s, i) => <div key={i} className="row nowrap" style={{ alignItems: 'flex-end' }}>
      <Field label="Day">{x => <Select {...x} value={String(s.weekday)} onChange={e => up(i, { weekday: +e.target.value })} options={WD.map((d, n) => [String(n), d])} />}</Field>
      <Field label="Start">{x => <Input {...x} type="time" step={1800} value={s.start} onChange={e => up(i, { start: e.target.value })} />}</Field>
      <Field label="Minutes">{x => <Input {...x} type="number" step={30} value={s.minutes} onChange={e => up(i, { minutes: +e.target.value })} />}</Field>
      <Field label="Court">{x => <Select {...x} value={s.courtId} onChange={e => up(i, { courtId: e.target.value })} options={[['', 'Choose…'], ...courts.filter(c => c.sports.includes(f.sport)).map(c => [c.id, c.name] as [string, string])]} />}</Field>
      <Btn kind="ghost" icon="x" aria-label="Remove session" onClick={() => setF({ ...f, schedule: f.schedule.filter((_, j) => j !== i) })} /></div>)}
      <Btn size="sm" icon="plus" onClick={() => setF({ ...f, schedule: [...f.schedule, { ...f.schedule.at(-1)!, weekday: (f.schedule.at(-1)!.weekday + 2) % 7 }] })}>Add session</Btn></fieldset>
    {clashes.length > 0 && <Banner tone="danger">Clashes in the next 8 weeks: {clashes.slice(0, 4).map(c => `${fmtDate(c.date)} ${c.start} (${c.with})`).join('; ')}{clashes.length > 4 ? ` +${clashes.length - 4} more` : ''}. Pick another court or time.</Banner>}
  </Modal>;
}
