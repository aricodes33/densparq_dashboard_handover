import { useReports, useDashboard, useTournament, useRegistrations, useMatches } from '@/api/hooks';
import { PageHead, useTid } from '@/ui/Page';
import { Bar, Btn, Chip, ErrorState, Loading, Stat, download, fmtDT } from '@/ui/kit';
import { inr } from '@/domain/registration';

export function Reports() {
  const { tid } = useTid(); const r = useReports(tid); const d = useDashboard(tid); const t = useTournament(tid); const regs = useRegistrations(tid); const ms = useMatches(tid);
  if (r.isLoading || d.isLoading) return <Loading rows={8} />; if (r.error) return <ErrorState error={r.error} />;
  const x = r.data, m = d.data.money, slug = t.data?.slug ?? 'tournament';
  const funnel: [string, number][] = [['Started', x.funnel.started], ['Submitted', x.funnel.submitted], ['Paid / confirmed', x.funnel.paid]];
  return <>
    <PageHead title="Analytics & reports" sub="Money shows what was actually collected, separate from fees still expected. Match figures count verified results only; anything else is marked unverified."
      actions={<>
        <Btn icon="download" onClick={() => download(`${slug}-registrations.csv`, [['Entry', 'Status', 'Payment', 'Paid ₹', 'Created'], ...(regs.data ?? []).map(z => [z.entryName, z.status, z.payStatus, z.paidPaise / 100, z.createdAt])])}>Entries CSV</Btn>
        <Btn icon="download" onClick={() => download(`${slug}-results.csv`, [['Match', 'Category', 'Start', 'Court', 'Home', 'Away', 'Score', 'Verification'], ...(ms.data ?? []).map(z => [z.code, z.categoryName ?? '', fmtDT(z.startAt), z.courtName ?? '', z.homeName ?? '', z.awayName ?? '', z.result?.detail ?? '', z.result?.verification ?? 'not played'])])}>Results CSV</Btn>
        <Btn icon="download" onClick={() => window.print()}>PDF (print)</Btn></>} />
    <div className="col loose">
      <div className="grid g4">
        <Stat l="Collected (actual)" v={inr(m.collectedPaise)} sub="Captured payments minus refunds" />
        <Stat l="Projected (unpaid)" v={inr(m.projectedPaise)} sub={<Chip tone="money">Not yet collected</Chip>} />
        <Stat l="Refunded" v={inr(m.refundedPaise)} />
        <Stat l="Registration conversion" v={`${Math.round(x.funnel.conversion * 100)}%`} sub="Started → paid or confirmed" />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card col"><h2>Registration funnel</h2>{funnel.map(([l, v]) => <div key={l} className="col tight"><div className="row between small"><span>{l}</span><span className="mono bold">{v}</span></div><Bar pct={x.funnel.started ? v / x.funnel.started * 100 : 0} label={l} /></div>)}</section>
        <section className="card col"><h2>Match progress</h2><div className="grid g3">
          <div className="stat"><span className="l">Completed</span><span className="v">{x.completion.completed}/{x.completion.scheduled}</span></div>
          <div className="stat"><span className="l">Avg start delay</span><span className="v">{Math.round(x.completion.avgDelayMin)}m</span></div>
          <div className="stat"><span className="l">Abandoned</span><span className="v">{x.completion.abandoned}</span></div></div>
          {x.completion.unverified > 0 && <Chip tone="money">{x.completion.unverified} results unverified, not counted</Chip>}</section>
      </div>
      <section className="col"><h2>By category</h2><div className="table-wrap"><table><thead><tr><th>Category</th><th className="num">Confirmed</th><th className="num">Capacity</th><th>Fill</th><th className="num">Withdrawn</th><th className="num">Revenue (actual)</th></tr></thead><tbody>
        {x.byCategory.map((c: any) => <tr key={c.name}><td className="bold">{c.name}</td><td className="num">{c.confirmed}</td><td className="num">{c.capacity}</td><td style={{ minWidth: 120 }}><Bar pct={c.confirmed / c.capacity * 100} label={`${c.name} fill`} /></td><td className="num">{c.withdrawn}</td><td className="num mono">{inr(c.revenuePaise)}</td></tr>)}</tbody></table></div></section>
      <section className="col"><h2>Court use</h2><div className="table-wrap"><table><thead><tr><th>Court</th><th className="num">Scheduled minutes</th><th>Share of play window</th></tr></thead><tbody>
        {x.courts.map((c: any) => <tr key={c.court}><td className="bold">{c.court}</td><td className="num">{c.minutes}</td><td style={{ minWidth: 160 }}><div className="row tight nowrap"><div className="grow"><Bar pct={c.utilisation * 100} label={`${c.court} use`} /></div><span className="small mono">{Math.round(c.utilisation * 100)}%</span></div></td></tr>)}</tbody></table></div></section>
    </div>
  </>;
}
