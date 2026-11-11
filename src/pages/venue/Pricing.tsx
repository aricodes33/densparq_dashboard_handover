// Pricing & offers: rate rules on a day-type × hour calendar, offer builder, agreed customer rates, suggestions, history.
import { useState } from 'react';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead } from '@/ui/Page';
import { Banner, Btn, Check, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, fmtDT, fmtDate, human } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { SPORT_LABEL } from '@/domain/scoring';
import { toMin, type RateRule, type Offer, type CustomerRate, type Customer, type Band } from '@/domain/venue';
import type { AuditEntry, Sport } from '@/domain/types';
import { useVenue, VenuePicker, todayIST, ampm } from './shared';

type Pricing = { rules: RateRule[]; offers: Offer[]; contracts: (CustomerRate & { customerName: string })[]; holidays: { date: string; name: string }[]; history: AuditEntry[] };
type Rec = { ruleId: string; pct: number; current: number; suggested: number; occ: number; why: string; rule: RateRule };
const BAND_TONE: Record<Band, string> = { off_peak: 'var(--soft)', standard: 'var(--lime-soft)', peak: 'var(--lime)' };

export function Pricing() {
  const v = useVenue(); const [tab, setTab] = useState<'rates' | 'offers' | 'contracts' | 'suggest' | 'history'>('rates');
  const d = useGet<Pricing>(v.id ? `/orgs/${v.org}/pricing?venueId=${v.id}` : null);
  if (v.list.isLoading || d.isLoading) return <Loading rows={6} />; if (d.error) return <ErrorState error={d.error} />;
  return <>
    <PageHead crumbs={false} title="Pricing & offers" sub="Peak, off-peak, weekend and holiday rates; offers with clear stacking; agreed rates for regulars. Confirmed bookings keep the price they were sold at." actions={<VenuePicker v={v} />} />
    <Seg label="Section" value={tab} onChange={setTab} options={[['rates', 'Rates'], ['offers', 'Offers'], ['contracts', 'Agreed rates'], ['suggest', 'Price suggestions'], ['history', 'Change history']]} />
    <div style={{ marginTop: 16 }}>
      {tab === 'rates' && v.venue && <Rates rules={d.data!.rules} venueId={v.id} open={v.venue.profile.open} close={v.venue.profile.close} holidays={d.data!.holidays} />}
      {tab === 'offers' && <Offers offers={d.data!.offers} org={v.org} />}
      {tab === 'contracts' && <Contracts list={d.data!.contracts} org={v.org} venueId={v.id} />}
      {tab === 'suggest' && <Suggestions venueId={v.id} />}
      {tab === 'history' && (!d.data!.history.length ? <Empty icon="history" title="No price changes yet" /> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Change</th><th>Reason</th></tr></thead><tbody>
        {d.data!.history.map(a => <tr key={a.id}><td className="small mono">{fmtDT(a.at)}</td><td className="small">{a.byName}</td><td className="small bold">{a.action}</td><td className="small muted">{a.reason ?? '—'}</td></tr>)}</tbody></table></div>)}
    </div>
  </>;
}

function Rates({ rules, venueId, open, close, holidays }: { rules: RateRule[]; venueId: string; open: string; close: string; holidays: { date: string; name: string }[] }) {
  const sports = [...new Set(rules.map(r => r.sport))]; const [sport, setSport] = useState<Sport>(sports[0] ?? 'badminton'); const [edit, setEdit] = useState<Partial<RateRule> | null>(null);
  const mine = rules.filter(r => r.sport === sport), hours = Array.from({ length: (toMin(close) - toMin(open)) / 60 }, (_, i) => toMin(open) + i * 60);
  return <div className="col">
    <div className="row between"><Seg label="Sport" value={sport} onChange={setSport} options={sports.map(s => [s, SPORT_LABEL[s]])} /><Btn icon="plus" onClick={() => setEdit({ sport, dayType: 'weekday', band: 'standard', from: '06:00', to: '10:00' })}>Add rate</Btn></div>
    <div className="table-wrap"><table aria-label="Price calendar"><thead><tr><th>Day</th>{hours.map(h => <th key={h} className="num" style={{ fontSize: 11 }}>{ampm(h)}</th>)}</tr></thead><tbody>
      {(['weekday', 'weekend', 'holiday'] as const).map(dt => <tr key={dt}><td className="bold">{human(dt)}</td>{hours.map(h => { const r = mine.find(x => x.dayType === dt && h >= toMin(x.from) && h < toMin(x.to));
        return <td key={h} style={{ padding: 2 }}>{r ? <button type="button" onClick={() => setEdit(r)} title={`${human(r.band)} · ${r.from}–${r.to}`} style={{ width: '100%', minHeight: 36, border: 0, borderRadius: 8, background: BAND_TONE[r.band], color: '#0A0A0A', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{r.pricePaise / 100}</button> : <span className="xs muted">—</span>}</td>; })}</tr>)}
    </tbody></table></div>
    <div className="row tight xs"><Chip>Off-peak</Chip><Chip tone="good">Standard</Chip><Chip tone="ink">Peak</Chip><span className="muted">₹ per hour. Click a cell to edit its rule. Holidays: {holidays.map(h => `${fmtDate(h.date)} ${h.name}`).join(', ') || 'none set (Venue setup)'}</span></div>
    {edit && <RuleEditor rule={edit} venueId={venueId} onClose={() => setEdit(null)} />}
  </div>;
}
function RuleEditor({ rule, venueId, onClose }: { rule: Partial<RateRule>; venueId: string; onClose: () => void }) {
  const r = (n?: number) => (n ?? 0) / 100;
  const [f, setF] = useState({ sport: rule.sport!, dayType: rule.dayType!, band: rule.band!, from: rule.from!, to: rule.to!, price: r(rule.pricePaise), min: r(rule.minPaise), max: r(rule.maxPaise), reason: '' });
  const save = useAct((b: object) => rule.id ? api.put(`/rate-rules/${rule.id}`, b) : api.post(`/venues/${venueId}/rate-rules`, b), 'Rate saved. New bookings use it; confirmed ones keep their price.');
  const del = useAct(() => api.del(`/rate-rules/${rule.id}`), 'Rate removed');
  const body = { ...f, pricePaise: f.price * 100, minPaise: (f.min || f.price * 0.7) * 100, maxPaise: (f.max || f.price * 1.3) * 100 };
  return <Modal title={rule.id ? 'Edit rate' : 'Add rate'} onClose={onClose} footer={<>{rule.id && <Btn kind="danger" onClick={() => del.mutate(undefined, { onSuccess: onClose })}>Remove</Btn>}<Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={save.isPending} onClick={() => save.mutate(body, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g3">
      <Field label="Days">{x => <Select {...x} value={f.dayType} onChange={e => setF({ ...f, dayType: e.target.value as RateRule['dayType'] })} options={[['weekday', 'Weekday'], ['weekend', 'Weekend'], ['holiday', 'Holiday']]} />}</Field>
      <Field label="From">{x => <Input {...x} type="time" step={1800} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />}</Field><Field label="To">{x => <Input {...x} type="time" step={1800} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />}</Field>
      <Field label="Band">{x => <Select {...x} value={f.band} onChange={e => setF({ ...f, band: e.target.value as Band })} options={[['off_peak', 'Off-peak'], ['standard', 'Standard'], ['peak', 'Peak']]} />}</Field>
      <Field label="₹ per hour">{x => <Input {...x} type="number" value={f.price} onChange={e => setF({ ...f, price: +e.target.value })} />}</Field><span />
      <Field label="Guardrail min ₹" hint="Suggestions never go below">{x => <Input {...x} type="number" value={f.min} onChange={e => setF({ ...f, min: +e.target.value })} />}</Field>
      <Field label="Guardrail max ₹" hint="…or above">{x => <Input {...x} type="number" value={f.max} onChange={e => setF({ ...f, max: +e.target.value })} />}</Field></div>
    {rule.id && <Field label="Reason for change (shown in history)">{x => <Input {...x} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>}</Modal>;
}

function Offers({ offers, org }: { offers: Offer[]; org: string }) {
  const [edit, setEdit] = useState<Partial<Offer> | null>(null); const toggle = useAct((o: Offer) => api.patch(`/offers/${o.id}`, { active: !o.active }), 'Offer updated');
  return <><Banner tone="info" icon="rules">Stacking: a booking gets the single best regular offer plus any offers marked “stacks”. Members and agreed-rate customers only get offers that stack.</Banner>
    <div className="row" style={{ justifyContent: 'flex-end', margin: '12px 0' }}><Btn kind="primary" icon="plus" onClick={() => setEdit({})}>New offer</Btn></div>
    <div className="table-wrap"><table><thead><tr><th>Offer</th><th>Discount</th><th>Who / when</th><th>Valid</th><th className="num">Used</th><th /></tr></thead><tbody>
      {offers.map(o => { const expired = o.validTo < todayIST(); return <tr key={o.id}><td><span className="bold">{o.name}</span>{o.code && <div className="xs mono">{o.code}</div>}</td><td>{o.kind === 'percent' ? `${o.value}%` : inr(o.value)}{o.stackable && <Chip tone="info">Stacks</Chip>}</td>
        <td className="small">{[o.newCustomersOnly && 'New customers', o.bands?.map(human).join('/'), o.sports?.map(s => SPORT_LABEL[s]).join('/'), o.minHours ? `${o.minHours} h+` : ''].filter(Boolean).join(' · ') || 'Everyone'}</td>
        <td className="small mono">{fmtDate(o.validFrom)} – {fmtDate(o.validTo)}</td><td className="num">{o.uses}{o.maxUses ? `/${o.maxUses}` : ''}</td>
        <td className="num"><div className="row tight" style={{ justifyContent: 'flex-end' }}>{expired ? <Chip>Expired</Chip> : <Btn size="sm" onClick={() => toggle.mutate(o)}>{o.active ? 'Pause' : 'Resume'}</Btn>}<Btn size="sm" kind="ghost" onClick={() => setEdit(o)}>Edit</Btn></div></td></tr>; })}</tbody></table></div>
    {edit && <OfferBuilder org={org} offer={edit} onClose={() => setEdit(null)} />}</>;
}
function OfferBuilder({ org, offer, onClose }: { org: string; offer: Partial<Offer>; onClose: () => void }) {
  const [f, setF] = useState({ name: '', code: '', kind: 'percent' as Offer['kind'], value: 10, stackable: false, validFrom: todayIST(), validTo: todayIST(), bands: [] as Band[], newCustomersOnly: false, minHours: 0, maxUses: '' as string | number, ...offer, ...(offer.kind === 'flat' ? { value: (offer.value ?? 0) / 100 } : {}) });
  const go = useAct((b: object) => offer.id ? api.patch(`/offers/${offer.id}`, b) : api.post(`/orgs/${org}/offers`, b), 'Offer saved');
  return <Modal title={offer.id ? 'Edit offer' : 'New offer'} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ ...f, value: f.kind === 'flat' ? f.value * 100 : f.value, maxUses: f.maxUses || undefined }, { onSuccess: onClose })}>Save</Btn></>}>
    <div className="grid g3"><Field label="Name">{x => <Input {...x} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field><Field label="Code (blank = automatic)">{x => <Input {...x} value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
      <Field label="Type">{x => <Select {...x} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Offer['kind'] })} options={[['percent', '% off'], ['flat', '₹ off']]} />}</Field>
      <Field label={f.kind === 'percent' ? '% off' : '₹ off'}>{x => <Input {...x} type="number" value={f.value} onChange={e => setF({ ...f, value: +e.target.value })} />}</Field>
      <Field label="Starts">{x => <Input {...x} type="date" value={f.validFrom} onChange={e => setF({ ...f, validFrom: e.target.value })} />}</Field><Field label="Ends">{x => <Input {...x} type="date" value={f.validTo} onChange={e => setF({ ...f, validTo: e.target.value })} />}</Field>
      <Field label="Min booking (h)">{x => <Input {...x} type="number" value={f.minHours} onChange={e => setF({ ...f, minHours: +e.target.value })} />}</Field><Field label="Max uses (blank = unlimited)">{x => <Input {...x} type="number" value={f.maxUses} onChange={e => setF({ ...f, maxUses: e.target.value })} />}</Field></div>
    <fieldset className="row tight"><legend className="label">Only in these bands (none = all)</legend>{(['off_peak', 'standard', 'peak'] as Band[]).map(b => <label key={b} className="check" style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 10 }}><input type="checkbox" checked={f.bands?.includes(b)} onChange={e => setF({ ...f, bands: e.target.checked ? [...(f.bands ?? []), b] : (f.bands ?? []).filter(x => x !== b) })} />{human(b)}</label>)}</fieldset>
    <Check label="New customers only" checked={f.newCustomersOnly} onChange={e => setF({ ...f, newCustomersOnly: e.target.checked })} /><Check label="Stacks with other offers and member pricing" checked={f.stackable} onChange={e => setF({ ...f, stackable: e.target.checked })} /></Modal>;
}

function Contracts({ list, org, venueId }: { list: Pricing['contracts']; org: string; venueId: string }) {
  const [add, setAdd] = useState(false); const del = useAct((id: string) => api.del(`/customer-rates/${id}`), 'Removed');
  return <><div className="row between" style={{ marginBottom: 12 }}><span className="small muted">Negotiated rates for corporates and regulars. Protected from offers and future price suggestions.</span><Btn kind="primary" icon="plus" onClick={() => setAdd(true)}>Add agreed rate</Btn></div>
    {!list.length ? <Empty icon="shield" title="No agreed rates" /> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Rate</th><th>Scope</th><th>Until</th><th /></tr></thead><tbody>{list.map(c => <tr key={c.id}><td className="bold">{c.customerName}<div className="xs muted">{c.note}</div></td><td>{c.kind === 'fixed' ? `${inr(c.value)}/h` : `${c.value}% off`}</td><td className="small">{c.venueId ? 'This venue' : 'All venues'}</td><td className="small mono">{c.validTo ? fmtDate(c.validTo) : 'Open-ended'}</td><td className="num"><Btn size="sm" kind="ghost" onClick={() => del.mutate(c.id)}>Remove</Btn></td></tr>)}</tbody></table></div>}
    {add && <ContractDialog org={org} venueId={venueId} onClose={() => setAdd(false)} />}</>;
}
function ContractDialog({ org, venueId, onClose }: { org: string; venueId: string; onClose: () => void }) {
  const cs = useGet<Customer[]>(`/orgs/${org}/customers`); const [f, setF] = useState({ customerId: '', kind: 'fixed', value: 1000, note: '', validTo: '', thisVenue: true });
  const go = useAct((b: object) => api.post('/customer-rates', b), 'Agreed rate saved');
  return <Modal title="Agreed rate" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.customerId} loading={go.isPending} onClick={() => go.mutate({ customerId: f.customerId, kind: f.kind, value: f.kind === 'fixed' ? f.value * 100 : f.value, note: f.note, validTo: f.validTo, venueId: f.thisVenue ? venueId : undefined }, { onSuccess: onClose })}>Save</Btn></>}>
    <Field label="Customer">{x => <Select {...x} value={f.customerId} onChange={e => setF({ ...f, customerId: e.target.value })} options={[['', 'Choose…'], ...(cs.data ?? []).map(c => [c.id, `${c.name}${c.corporate ? ` (${c.corporate})` : ''}`] as [string, string])]} />}</Field>
    <div className="grid g2"><Field label="Type">{x => <Select {...x} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} options={[['fixed', '₹ per hour'], ['percent', '% off list price']]} />}</Field><Field label={f.kind === 'fixed' ? '₹ per hour' : '% off'}>{x => <Input {...x} type="number" value={f.value} onChange={e => setF({ ...f, value: +e.target.value })} />}</Field>
      <Field label="Until (optional)">{x => <Input {...x} type="date" value={f.validTo} onChange={e => setF({ ...f, validTo: e.target.value })} />}</Field><Field label="What it's for">{x => <Input {...x} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />}</Field></div>
    <Check label="Only at this venue" checked={f.thisVenue} onChange={e => setF({ ...f, thisVenue: e.target.checked })} /></Modal>;
}

function Suggestions({ venueId }: { venueId: string }) {
  const r = useGet<Rec[]>(`/venues/${venueId}/recommendations`); const apply = useAct((x: Rec) => api.put(`/rate-rules/${x.ruleId}`, { pricePaise: x.suggested, reason: `Applied suggestion: ${x.why}` }), 'Applied. Logged in change history.');
  return <><Banner tone="info" icon="chart">Suggestions only. Nothing changes until you apply it. Based on the last 4 weeks of occupancy and booking lead time, kept inside each rate's min/max. Agreed rates, member prices and confirmed bookings are never touched.</Banner>
    <div style={{ marginTop: 12 }}>{r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} /> : !r.data!.length ? <Empty icon="check" title="No changes suggested" body="Every rate is inside its target occupancy band." /> :
      <div className="table-wrap"><table><thead><tr><th>Rate</th><th>Why</th><th className="num">Now</th><th className="num">Suggested</th><th /></tr></thead><tbody>{r.data!.map(x => <tr key={x.ruleId}>
        <td><span className="bold">{SPORT_LABEL[x.rule.sport]}</span><div className="xs muted">{human(x.rule.dayType)} {x.rule.from}–{x.rule.to}</div></td><td className="small">{x.why}</td><td className="num mono">{inr(x.current)}</td>
        <td className="num"><span className="mono bold">{inr(x.suggested)}</span> <Chip tone={x.pct > 0 ? 'good' : 'money'}>{x.pct > 0 ? '+' : ''}{x.pct}%</Chip></td><td className="num"><Btn size="sm" kind="primary" onClick={() => apply.mutate(x)}>Apply</Btn></td></tr>)}</tbody></table></div>}</div></>;
}
