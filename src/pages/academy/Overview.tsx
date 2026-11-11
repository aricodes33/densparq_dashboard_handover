// Coaching overview + reports: KPIs, alerts, trial funnel, most improved, per-batch table with export.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { PageHead } from '@/ui/Page';
import { Bar, Btn, Chip, ErrorState, Icon, Input, Loading, Seg, Stat, download } from '@/ui/kit';
import { inr } from '@/domain/registration';
import { addDays } from '@/domain/venue';
import { todayIST } from '@/pages/venue/shared';
import { useAcademy, pct } from './shared';
import type { funnel } from '@/domain/academy';

type O = { activeAthletes: number; batches: number; seats: number; attendance: number | null; retention: number | null; collectedPaise: number; outstandingPaise: number; assessmentCompletion: number; funnel: ReturnType<typeof funnel>;
  mostImproved: { id: string; name: string; gains: number }[]; alerts: { kind: string; text: string; to: string }[];
  byBatch: { id: string; name: string; sport: string; enrolled: number; capacity: number; attendance: number | null; retention: number | null; assessed: number; collectedPaise: number; outstandingPaise: number }[] };

export function AcademyOverview() {
  const { org, academy } = useAcademy(); const [range, setRange] = useState<'30' | '90' | 'custom'>('30'); const [c, setC] = useState({ from: addDays(todayIST(), -29), to: todayIST() });
  const r = range === 'custom' ? c : { from: addDays(todayIST(), -(+range - 1)), to: todayIST() };
  const o = useGet<O>(academy ? `/orgs/${org}/academy/overview?${new URLSearchParams({ academyId: academy.id, ...r })}` : null);
  if (!o.data) return o.error ? <ErrorState error={o.error} /> : <Loading rows={8} />;
  const x = o.data, f = x.funnel;
  return <>
    <PageHead crumbs={false} title="Coaching overview" sub={`${academy?.name} · ${r.from} to ${r.to}. Attendance counts late as present and leaves out excused absences.`}
      actions={<Btn icon="download" onClick={() => download(`academy-report-${r.from}-${r.to}.csv`, [['Batch', 'Sport', 'Enrolled', 'Capacity', 'Attendance %', 'Retention %', 'Assessed (60d)', 'Collected ₹', 'Outstanding ₹'], ...x.byBatch.map(b => [b.name, b.sport, b.enrolled, b.capacity, pct(b.attendance), pct(b.retention), b.assessed, b.collectedPaise / 100, b.outstandingPaise / 100])])}>Export report</Btn>} />
    <div className="row" style={{ marginBottom: 16 }}><Seg label="Range" value={range} onChange={setRange} options={[['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']]} />
      {range === 'custom' && <><label><span className="sr">From</span><Input type="date" value={c.from} onChange={e => setC({ ...c, from: e.target.value })} /></label><label><span className="sr">To</span><Input type="date" value={c.to} onChange={e => setC({ ...c, to: e.target.value })} /></label></>}</div>
    <div className="col loose">
      {x.alerts.length > 0 && <section className="col tight">{x.alerts.map((a, i) => <Link key={i} to={`/o/${org}/academy/${a.to}`} className={`banner ${a.kind === 'neutral' ? '' : a.kind}`} style={{ textDecoration: 'none' }}><Icon name="alert" /><span className="grow bold">{a.text}</span><Icon name="chev" /></Link>)}</section>}
      <div className="grid g4">
        <Stat l="Active athletes" v={x.activeAthletes} sub={`${x.batches} batches · ${x.seats} seats`} /><Stat l="Attendance" v={pct(x.attendance)} sub={<Bar pct={(x.attendance ?? 0) * 100} label="Attendance" />} />
        <Stat l="Fees collected" v={inr(x.collectedPaise)} sub={<>{inr(x.outstandingPaise)} outstanding</>} /><Stat l="Retention" v={pct(x.retention)} sub="Active at start, still active at end" />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card col"><div className="row between"><h2>Trial funnel</h2><Link className="small" to={`/o/${org}/academy/admissions`}>Open admissions →</Link></div>
          {([['Enquiries', f.enquiries], ['Trial booked', f.trialsBooked], ['Trial attended', f.trialsAttended], ['Enrolled', f.enrolled]] as [string, number][]).map(([l, v]) => <div key={l} className="col tight"><div className="row between small"><span>{l}</span><span className="mono bold">{v}</span></div><Bar pct={f.enquiries ? v / f.enquiries * 100 : 0} label={l} /></div>)}
          <div className="row tight"><Chip tone="info">Enquiry → trial {pct(f.enquiryToTrial)}</Chip><Chip tone="good">Trial → enrol {pct(f.trialToEnrol)}</Chip><Chip>Show rate {pct(f.showRate)}</Chip></div></section>
        <section className="card col"><div className="row between"><h2>Performance</h2><Chip tone={x.assessmentCompletion >= 0.8 ? 'good' : 'money'}>{pct(x.assessmentCompletion)} assessed in 60 days</Chip></div>
          <h3>Most improved</h3>{x.mostImproved.filter(m => m.gains).map(m => <Link key={m.id} to={`/o/${org}/academy/player-stats?athlete=${m.id}`} className="row between small" style={{ textDecoration: 'none', padding: '4px 0', borderTop: '1px solid var(--line)' }}><span className="bold">{m.name}</span><span>{m.gains} metrics up since baseline</span></Link>)}
          <span className="xs muted">Within each athlete's own sport and history. No cross-sport ranking.</span></section>
      </div>
      <section className="col"><h2>By batch</h2><div className="table-wrap"><table><thead><tr><th>Batch</th><th className="num">Seats</th><th>Attendance</th><th className="num">Retention</th><th className="num">Assessed</th><th className="num">Collected</th><th className="num">Outstanding</th></tr></thead><tbody>
        {x.byBatch.map(b => <tr key={b.id}><td><Link className="bold" to={`/o/${org}/academy/batches?id=${b.id}`}>{b.name}</Link></td><td className="num">{b.enrolled}/{b.capacity}</td><td style={{ minWidth: 120 }}><div className="row tight nowrap"><div className="grow"><Bar pct={(b.attendance ?? 0) * 100} label="attendance" /></div><span className="small mono">{pct(b.attendance)}</span></div></td>
          <td className="num">{pct(b.retention)}</td><td className="num">{b.assessed}/{b.enrolled}</td><td className="num mono">{inr(b.collectedPaise)}</td><td className="num mono">{b.outstandingPaise ? <Chip tone="money">{inr(b.outstandingPaise)}</Chip> : '—'}</td></tr>)}</tbody></table></div></section>
    </div>
  </>;
}
