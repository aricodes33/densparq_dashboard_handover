// Owner analytics: KPIs vs previous period, alerts, occupancy heatmap (drill-down), revenue trend, breakdowns, export.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { PageHead } from '@/ui/Page';
import { Bar, Btn, Chip, ErrorState, Icon, Input, Loading, Modal, Seg, Status, Select, download, fmtDT, human } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { addDays, type Booking, type kpis } from '@/domain/venue';
import { useVenue, todayIST, ampm, Bars } from './shared';

type K = ReturnType<typeof kpis>;
type G = { key: string; hours: number; revenuePaise: number; bookings: number }[];
type A = { range: { from: string; to: string }; kpis: K; prevKpis: K; trend: { date: string; revenuePaise: number; hours: number }[]; heatmap: number[][]; open: number; bySport: G; byCourt: G; byBand: G; byWeekday: G; sources: G;
  lead: { label: string; bookings: number }[]; offers: { name: string; code?: string; uses: number; discountPaise: number; revenuePaise: number }[]; alerts: { kind: string; text: string; to: string }[];
  customers: { active: number; new: number; returning: number; repeatRate: number; retention: number }; memberships: { active: number; grace: number; expiring: number; renewalRate: number; revenuePaise: number; utilisation: number } };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Analytics() {
  const v = useVenue(); const [preset, setPreset] = useState<'7' | '30' | '90' | 'custom'>('30'); const [custom, setCustom] = useState({ from: addDays(todayIST(), -29), to: todayIST() });
  const r = preset === 'custom' ? custom : { from: addDays(todayIST(), -(+preset - 1)), to: todayIST() };
  const venueId = v.sp.get('v') ?? '';
  const a = useGet<A>(`/orgs/${v.org}/analytics?${new URLSearchParams({ ...r, ...(venueId ? { venueId } : {}) })}`);
  const [drill, setDrill] = useState<Record<string, string> | null>(null);
  if (a.isLoading) return <Loading rows={8} />; if (a.error) return <ErrorState error={a.error} />;
  const x = a.data!, k = x.kpis, p = x.prevKpis;
  const tiles: [string, string, number, number, boolean?][] = [
    ['Revenue (net of refunds)', inr(k.revenuePaise), k.revenuePaise, p.revenuePaise], ['Occupancy', pct(k.occupancy), k.occupancy, p.occupancy], ['Bookings', String(k.bookings), k.bookings, p.bookings],
    ['Revenue per available court-hour', inr(k.revPACH), k.revPACH, p.revPACH], ['Avg realised hourly rate', inr(k.arr), k.arr, p.arr], ['Unsold court-hours', String(Math.round(k.freeHours)), k.freeHours, p.freeHours, true],
    ['Cancellation rate', pct(k.cancelRate), k.cancelRate, p.cancelRate, true], ['Median booking lead time', `${Math.round(k.leadTimeHrs)} h`, k.leadTimeHrs, p.leadTimeHrs],
  ];
  const exportAll = () => download(`venue-analytics-${r.from}-${r.to}.csv`, [['Metric', 'This period', 'Previous period'], ...tiles.map(t => [t[0], t[2], t[3]]), [], ['Sport', 'Bookings', 'Hours', 'Revenue ₹'], ...x.bySport.map(g => [g.key, g.bookings, g.hours, g.revenuePaise / 100]), [], ['Court', 'Bookings', 'Hours', 'Revenue ₹'], ...x.byCourt.map(g => [g.key, g.bookings, g.hours, g.revenuePaise / 100]), [], ['Date', 'Revenue ₹', 'Hours'], ...x.trend.map(t => [t.date, t.revenuePaise / 100, t.hours])]);
  return <>
    <PageHead crumbs={false} title="Venue analytics" sub={`${r.from} to ${r.to}, compared with the ${x.trend.length} days before. Occupancy = booked ÷ sellable court-hours (blocked hours excluded, no-shows count as booked).`}
      actions={<Btn icon="download" onClick={exportAll}>Export CSV</Btn>} />
    <div className="row between" style={{ marginBottom: 16 }}>
      <div className="row tight"><label><span className="sr">Venue</span><Select value={venueId} onChange={e => v.set('v', e.target.value)} options={[['', 'All venues'], ...(v.list.data ?? []).map(z => [z.id, z.name] as [string, string])]} /></label>
        <Seg label="Range" value={preset} onChange={setPreset} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']]} /></div>
      {preset === 'custom' && <div className="row tight"><label><span className="sr">From</span><Input type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} /></label><label><span className="sr">To</span><Input type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} /></label></div>}
    </div>
    <div className="col loose">
      {x.alerts.length > 0 && <section className="col tight" aria-label="Alerts">{x.alerts.map((al, i) => <Link key={i} to={`/o/${v.org}/${al.to}`} className={`banner ${al.kind === 'neutral' ? '' : al.kind}`} style={{ textDecoration: 'none' }}><Icon name="alert" /><span className="grow bold">{al.text}</span><Icon name="chev" /></Link>)}</section>}
      <div className="grid g4">{tiles.map(([l, val, now, prev, lowerBetter]) => { const d = prev ? (now - prev) / prev : 0, good = lowerBetter ? d < 0 : d > 0;
        return <div key={l} className="card stat"><span className="l">{l}</span><span className="v">{val}</span><span className="small" style={{ color: Math.abs(d) < 0.005 ? 'var(--muted)' : good ? 'var(--lime-ink)' : 'var(--danger-fg)' }}>{Math.abs(d) < 0.005 ? 'No change' : `${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs previous`}</span></div>; })}</div>
      <section className="card col"><div className="row between"><h2>Revenue by day</h2><span className="small muted">{inr(k.revenuePaise)} total</span></div><Bars label="Revenue by day" data={x.trend.map(t => ({ k: t.date.slice(5), v: t.revenuePaise }))} fmt={n => inr(n)} /></section>
      <section className="card col"><div className="row between"><h2>When the courts are full</h2><span className="small muted">Click a cell to see its bookings</span></div>
        <div className="table-wrap" style={{ border: 0 }}><table aria-label="Occupancy heatmap by weekday and hour"><thead><tr><th />{x.heatmap[0].map((_, h) => <th key={h} className="num" style={{ fontSize: 11, padding: '6px 2px' }}>{ampm((x.open + h) * 60)}</th>)}</tr></thead><tbody>
          {[1, 2, 3, 4, 5, 6, 0].map(wd => <tr key={wd}><td className="bold small">{WD[wd]}</td>{x.heatmap[wd].map((val, h) => <td key={h} style={{ padding: 2 }}>
            <button type="button" onClick={() => setDrill({ weekday: String(wd), hour: String(x.open + h), ...r, ...(venueId ? { venueId } : {}) })} title={`${WD[wd]} ${ampm((x.open + h) * 60)}: ${pct(val)}`} aria-label={`${WD[wd]} ${ampm((x.open + h) * 60)} ${pct(val)} full`}
              style={{ width: '100%', minWidth: 30, height: 30, border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontSize: 10, color: val > 0.55 ? '#0A0A0A' : 'var(--muted)', background: `color-mix(in srgb, var(--lime) ${Math.round(val * 100)}%, var(--card))` }}>{Math.round(val * 100)}</button></td>)}</tr>)}</tbody></table></div>
        <span className="xs muted">% of court time booked. 3–6 pm weekdays is the academy block.</span></section>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Breakdown title="By sport" rows={x.bySport} onDrill={key => setDrill({ sport: key, ...r, ...(venueId ? { venueId } : {}) })} />
        <Breakdown title="By court" rows={x.byCourt} />
        <Breakdown title="Peak vs off-peak" rows={x.byBand.map(g => ({ ...g, key: human(g.key) }))} />
        <Breakdown title="Booking source" rows={x.sources.map(g => ({ ...g, key: human(g.key) }))} onDrill={key => setDrill({ source: key.toLowerCase().replace('-', '_').replace(' ', '_'), ...r, ...(venueId ? { venueId } : {}) })} />
        <section className="card col"><h3>How far ahead people book</h3>{x.lead.map(l => <div key={l.label} className="col tight"><div className="row between small"><span>{l.label}</span><span className="mono">{l.bookings}</span></div><Bar pct={l.bookings / Math.max(1, ...x.lead.map(z => z.bookings)) * 100} label={l.label} /></div>)}</section>
        <section className="card col"><h3>Customers</h3><div className="grid g2">
          <div className="stat"><span className="l">Active</span><span className="v">{x.customers.active}</span></div><div className="stat"><span className="l">New</span><span className="v">{x.customers.new}</span></div>
          <div className="stat"><span className="l">Repeat rate</span><span className="v">{pct(x.customers.repeatRate)}</span><span className="xs muted">2+ bookings this period</span></div><div className="stat"><span className="l">Retention</span><span className="v">{pct(x.customers.retention)}</span><span className="xs muted">Last period's players who came back</span></div></div>
          <Link className="small" to={`/o/${v.org}/customers?segment=inactive`}>See inactive customers →</Link></section>
        <section className="card col"><h3>Memberships</h3><div className="grid g2">
          <div className="stat"><span className="l">Active</span><span className="v">{x.memberships.active}</span><span className="xs muted">{x.memberships.grace} in grace</span></div><div className="stat"><span className="l">Sold this period</span><span className="v" style={{ fontSize: 22 }}>{inr(x.memberships.revenuePaise)}</span><span className="xs muted">Cash basis</span></div>
          <div className="stat"><span className="l">Hours used</span><span className="v">{pct(x.memberships.utilisation)}</span></div><div className="stat"><span className="l">Renewal rate</span><span className="v">{pct(x.memberships.renewalRate)}</span><span className="xs muted">{x.memberships.expiring} expire within 7 days</span></div></div></section>
        <section className="card col"><h3>Offers</h3>{!x.offers.length ? <span className="muted small">No offers used in this period.</span> : <div className="table-wrap"><table><thead><tr><th>Offer</th><th className="num">Uses</th><th className="num">Discount given</th><th className="num">Revenue</th></tr></thead><tbody>
          {x.offers.map(o => <tr key={o.name}><td className="small bold">{o.name}{o.code && <span className="xs mono muted"> {o.code}</span>}</td><td className="num">{o.uses}</td><td className="num mono">{inr(o.discountPaise)}</td><td className="num mono">{inr(o.revenuePaise)}</td></tr>)}</tbody></table></div>}</section>
      </div>
    </div>
    {drill && <Drill q={drill} org={v.org} onClose={() => setDrill(null)} />}
  </>;
}

function Breakdown({ title, rows, onDrill }: { title: string; rows: G; onDrill?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map(r => r.revenuePaise));
  return <section className="card col"><h3>{title}</h3>{rows.map(r => <div key={r.key} className="col tight">
    <div className="row between small">{onDrill ? <button type="button" onClick={() => onDrill(r.key)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>{human(r.key)}</button> : <span>{human(r.key)}</span>}<span className="mono">{inr(r.revenuePaise)} · {Math.round(r.hours)} h</span></div>
    <Bar pct={r.revenuePaise / max * 100} label={r.key} /></div>)}</section>;
}
function Drill({ q, org, onClose }: { q: Record<string, string>; org: string; onClose: () => void }) {
  const d = useGet<Booking[]>(`/orgs/${org}/analytics/bookings?${new URLSearchParams(q)}`);
  return <Modal title="Bookings behind this number" wide onClose={onClose} footer={<Btn icon="download" disabled={!d.data?.length} onClick={() => download('bookings.csv', [['Start', 'Customer', 'Sport', 'Source', 'Status', 'Total ₹', 'Paid ₹'], ...d.data!.map(b => [b.startAt, b.customerName, b.sport, b.source, b.status, b.quote.totalPaise / 100, b.paidPaise / 100])])}>Export</Btn>}>
    {!d.data ? <Loading /> : <><Chip>{d.data.length} bookings</Chip><div className="table-wrap" style={{ maxHeight: 420 }}><table><thead><tr><th>When</th><th>Customer</th><th>Source</th><th>Status</th><th className="num">Total</th></tr></thead><tbody>
      {d.data.map(b => <tr key={b.id}><td className="small mono">{fmtDT(b.startAt)}</td><td>{b.customerName}</td><td className="small">{human(b.source)}</td><td><Status s={b.status} /></td><td className="num mono">{inr(b.quote.totalPaise)}</td></tr>)}</tbody></table></div></>}</Modal>;
}
