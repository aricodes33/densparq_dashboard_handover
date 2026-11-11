// Venue & court configuration: branches, hours, slots, buffers, refund policy, holidays, facility profile, courts.
import { useEffect, useState } from 'react';
import { useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Btn, Check, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Select, Textarea } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { VenueProfile } from '@/domain/venue';
import type { Sport } from '@/domain/types';
import { useVenue, type VenueFull } from './shared';

export function VenueSetup() {
  const v = useVenue(); const [branch, setBranch] = useState(false); const [court, setCourt] = useState<Partial<VenueFull['courts'][number]> | null>(null);
  if (v.list.isLoading) return <Loading rows={6} />; if (v.list.error) return <ErrorState error={v.list.error} />;
  return <>
    <PageHead crumbs={false} title="Venue setup" sub="Branches, courts, hours and policies. Bookings, pricing and tournaments all read from here." actions={can(['org_admin']) && <Btn icon="plus" onClick={() => setBranch(true)}>Add branch</Btn>} />
    <div className="row tight" style={{ marginBottom: 16 }} role="tablist" aria-label="Branches">{v.list.data!.map(x => <button key={x.id} type="button" role="tab" aria-selected={x.id === v.id} className={`btn ${x.id === v.id ? 'primary' : ''}`} onClick={() => v.set('v', x.id)}>{x.name}</button>)}</div>
    {!v.venue ? <Empty icon="home" title="No branch selected" /> : <div className="col loose">
      <Profile key={v.venue.id} venue={v.venue} />
      <section className="col"><div className="row between"><h2>Courts & surfaces</h2><Btn icon="plus" onClick={() => setCourt({})}>Add court</Btn></div>
        <div className="table-wrap"><table><thead><tr><th>Court</th><th>Sports</th><th>Surface</th><th>Indoor</th><th>Status</th><th /></tr></thead><tbody>
          {v.venue.courts.map(c => <tr key={c.id}><td className="bold">{c.name}</td><td className="small">{c.sports.map(s => SPORT_LABEL[s]).join(', ')}</td><td className="small">{c.surface}</td><td>{c.indoor ? 'Yes' : 'No'}</td><td>{c.active ? <Chip tone="good">Bookable</Chip> : <Chip>Off</Chip>}</td><td className="num"><Btn size="sm" onClick={() => setCourt(c)}>Edit</Btn></td></tr>)}</tbody></table></div></section>
    </div>}
    {branch && <Branch org={v.org} onClose={() => setBranch(false)} />}
    {court && v.venue && <CourtDialog venueId={v.venue.id} court={court} onClose={() => setCourt(null)} />}
  </>;
}

function Profile({ venue }: { venue: VenueFull }) {
  const [f, setF] = useState({ ...venue.profile, name: venue.name, address: venue.address, amenitiesText: venue.profile.amenities.join(', '), photosText: venue.profile.photos.join('\n'), hDate: '', hName: '' });
  useEffect(() => setF(x => ({ ...x, ...venue.profile, amenitiesText: venue.profile.amenities.join(', ') })), [venue.profile]);
  const save = useAct((b: object) => api.put(`/venues/${venue.id}/profile`, b), 'Saved. New bookings use these settings.');
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p })), rf = (k: keyof VenueProfile['refund'], val: number) => set({ refund: { ...f.refund, [k]: val } });
  const submit = () => save.mutate({ name: f.name, address: f.address, open: f.open, close: f.close, slotMinutes: +f.slotMinutes, bufferMinutes: +f.bufferMinutes, description: f.description, refund: f.refund, holidays: f.holidays,
    amenities: f.amenitiesText.split(',').map(s => s.trim()).filter(Boolean), photos: f.photosText.split('\n').map(s => s.trim()).filter(Boolean) });
  return <form className="col loose" onSubmit={e => { e.preventDefault(); submit(); }}>
    <section className="card col"><h2>Facility profile</h2><div className="grid g2">
      <Field label="Branch name">{x => <Input {...x} value={f.name} onChange={e => set({ name: e.target.value })} />}</Field><Field label="Address">{x => <Input {...x} value={f.address} onChange={e => set({ address: e.target.value })} />}</Field></div>
      <Field label="Description" hint="Shown on customer-facing listings">{x => <Textarea {...x} rows={3} value={f.description} onChange={e => set({ description: e.target.value })} />}</Field>
      <Field label="Amenities" hint="Comma-separated">{x => <Input {...x} value={f.amenitiesText} onChange={e => set({ amenitiesText: e.target.value })} />}</Field>
      <Field label="Photo URLs" hint="One per line. Production uploads via presigned URLs.">{x => <Textarea {...x} rows={2} value={f.photosText} onChange={e => set({ photosText: e.target.value })} />}</Field></section>
    <section className="card col"><h2>Hours & slots</h2><div className="grid g4">
      <Field label="Opens">{x => <Input {...x} type="time" step={1800} value={f.open} onChange={e => set({ open: e.target.value })} />}</Field><Field label="Closes">{x => <Input {...x} type="time" step={1800} value={f.close} onChange={e => set({ close: e.target.value })} />}</Field>
      <Field label="Slot length">{x => <Select {...x} value={String(f.slotMinutes)} onChange={e => set({ slotMinutes: +e.target.value })} options={[['30', '30 min'], ['60', '60 min'], ['90', '90 min']]} />}</Field>
      <Field label="Changeover buffer (min)">{x => <Input {...x} type="number" min={0} step={5} value={f.bufferMinutes} onChange={e => set({ bufferMinutes: +e.target.value })} />}</Field></div></section>
    <section className="card col"><h2>Cancellation & refunds</h2><div className="grid g3">
      <Field label="Full refund if cancelled at least (h) before">{x => <Input {...x} type="number" value={f.refund.fullBeforeHours} onChange={e => rf('fullBeforeHours', +e.target.value)} />}</Field>
      <Field label="Part refund if at least (h) before">{x => <Input {...x} type="number" value={f.refund.partialBeforeHours} onChange={e => rf('partialBeforeHours', +e.target.value)} />}</Field>
      <Field label="Part refund %">{x => <Input {...x} type="number" value={f.refund.partialPct} onChange={e => rf('partialPct', +e.target.value)} />}</Field></div>
      <span className="small muted">Later than that: no refund. Managers can override with a reason (audited).</span></section>
    <section className="card col"><h2>Holidays</h2><span className="small muted">Holiday rates apply on these dates.</span>
      {f.holidays.map(h => <div key={h.date} className="row between small"><span>{h.date} · {h.name}</span><Btn size="sm" kind="ghost" onClick={() => set({ holidays: f.holidays.filter(x => x !== h) })}>Remove</Btn></div>)}
      <div className="row nowrap" style={{ alignItems: 'flex-end' }}><Field label="Date">{x => <Input {...x} type="date" value={f.hDate} onChange={e => set({ hDate: e.target.value })} />}</Field><Field label="Name">{x => <Input {...x} value={f.hName} onChange={e => set({ hName: e.target.value })} />}</Field>
        <Btn disabled={!f.hDate || !f.hName} onClick={() => set({ holidays: [...f.holidays, { date: f.hDate, name: f.hName }].sort((a, b) => a.date.localeCompare(b.date)), hDate: '', hName: '' })}>Add</Btn></div></section>
    <div className="wiz-foot"><span /><Btn kind="primary" type="submit" loading={save.isPending}>Save venue settings</Btn></div>
  </form>;
}
function CourtDialog({ venueId, court, onClose }: { venueId: string; court: Partial<VenueFull['courts'][number]>; onClose: () => void }) {
  const [f, setF] = useState({ name: court.name ?? '', sports: (court.sports ?? []) as Sport[], surface: court.surface ?? '', indoor: court.indoor ?? false, active: court.active ?? true });
  const go = useAct((b: object) => court.id ? api.patch(`/courts/${court.id}`, b) : api.post(`/venues/${venueId}/courts`, b), 'Court saved');
  return <Modal title={court.id ? `Edit ${court.name}` : 'Add court'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.name || !f.sports.length} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g2"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Surface">{x => <Input {...x} value={f.surface} onChange={e => setF({ ...f, surface: e.target.value })} />}</Field></div>
    <fieldset className="row tight"><legend className="label">Sports played here</legend>{(Object.keys(SPORT_LABEL) as Sport[]).map(s => <label key={s} className="check" style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10 }}><input type="checkbox" checked={f.sports.includes(s)} onChange={e => setF({ ...f, sports: e.target.checked ? [...f.sports, s] : f.sports.filter(x => x !== s) })} />{SPORT_LABEL[s]}</label>)}</fieldset>
    <Check label="Indoor" checked={f.indoor} onChange={e => setF({ ...f, indoor: e.target.checked })} />{court.id && <Check label="Bookable" hint="Turn off for long closures; existing bookings stay." checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />}</Modal>;
}
function Branch({ org, onClose }: { org: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', address: '' }); const go = useAct((b: object) => api.post(`/orgs/${org}/venues`, b), 'Branch added. Add its courts and rates next.');
  return <Modal title="Add branch" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.name} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Add</Btn></>}>
    <Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Address">{x => <Input {...x} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />}</Field></Modal>;
}
