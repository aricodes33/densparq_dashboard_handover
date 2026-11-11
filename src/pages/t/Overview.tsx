import { Link } from 'react-router-dom';
import { useDashboard, useTournament } from '@/api/hooks';
import { PageHead, useTid, can, TDESK } from '@/ui/Page';
import { Bar, Chip, Empty, ErrorState, Icon, Loading, Stat, fmtTime, fmtDate, Btn } from '@/ui/kit';
import { inr } from '@/domain/registration';
import type { MatchView } from '@/mock/handlers';
import { Journey } from './Journey';

export function Overview() {
  const { tid, org } = useTid(); const t = useTournament(tid); const d = useDashboard(tid);
  if (t.isLoading || d.isLoading) return <Loading rows={6} />;
  if (t.error || d.error) return <ErrorState error={t.error ?? d.error} retry={d.refetch} />;
  const x = d.data, base = `/o/${org}/t/${tid}`, money = can(TDESK);
  return <>
    <PageHead title={t.data!.name} sub={`${fmtDate(t.data!.startDate)}${t.data!.endDate !== t.data!.startDate ? ` – ${fmtDate(t.data!.endDate)}` : ''} · ${t.data!.categories.length} categor${t.data!.categories.length === 1 ? 'y' : 'ies'} · refreshes every 15 s`}
      actions={<><Link className="btn" to={`${base}/matches`}><Icon name="play" />Matches</Link></>} />
    <div className="col loose">
      <Journey tid={tid} org={org} />
      <div className="grid g4">
        <Stat l="Confirmed entries" v={`${x.entries.confirmed}`} sub={<><Bar pct={x.entries.capacity ? x.entries.confirmed / x.entries.capacity * 100 : 0} label="Capacity filled" /> of {x.entries.capacity} places</>} />
        <Stat l="Waiting on payment" v={x.entries.pending} tone={x.entries.pending ? 'money' : undefined} sub={`${x.entries.waitlisted} on the waitlist`} />
        {money && <Stat l="Collected (actual)" v={inr(x.money.collectedPaise)} sub={<>Net of {inr(x.money.refundedPaise)} refunds · <span title="Fees from entries still pending payment. Not money in the bank.">{inr(x.money.projectedPaise)} projected</span></>} />}
        <Stat l="Matches played" v={`${x.matches.completed}/${x.matches.total}`} sub={<Bar pct={x.matches.total ? x.matches.completed / x.matches.total * 100 : 0} label="Matches completed" />} />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card col" aria-labelledby="att"><div className="row between"><h2 id="att">Needs you now</h2><Chip tone={x.attention.length ? 'money' : 'good'}>{x.attention.length || 'All clear'}</Chip></div>
          {!x.attention.length ? <p className="muted" style={{ margin: 0 }}>Nothing waiting. New payments, disputes and late starts show up here.</p> :
            x.attention.map((a: { kind: string; text: string; to: string }, i: number) => <Link key={i} to={`${base}/${a.to}`} className={`banner ${a.kind === 'neutral' ? '' : a.kind}`} style={{ textDecoration: 'none' }}><Icon name={a.kind === 'danger' ? 'alert' : a.kind === 'money' ? 'bell' : 'check'} /><span className="grow bold">{a.text}</span><Icon name="chev" /></Link>)}</section>
        <section className="card ink col" aria-labelledby="live"><div className="row between"><h2 id="live">Live now</h2><Chip tone="ink" live>{x.matches.live.length} live</Chip></div>
          {!x.matches.live.length ? <p className="muted" style={{ margin: 0 }}>No match is live.</p> : x.matches.live.map((m: MatchView) => <Link key={m.id} to={`${base}/matches/${m.id}`} className="row between" style={{ textDecoration: 'none', padding: '8px 0', borderTop: '1px solid #262626' }}>
            <span className="col tight"><span className="bold">{m.homeName} v {m.awayName}</span><span className="xs muted">{m.code} · {m.courtName}</span></span><span className="display bold" style={{ fontSize: 22, color: 'var(--lime)' }}>{m.live?.headline ?? '—'}</span></Link>)}
          {x.matches.next.length > 0 && <><h3 style={{ marginTop: 10 }}>Up next</h3>{x.matches.next.map((m: MatchView) => <div key={m.id} className="row between small" style={{ padding: '6px 0', borderTop: '1px solid #262626' }}><span>{fmtTime(m.startAt)} · {m.courtName}</span><span className="bold">{m.homeName} v {m.awayName}</span></div>)}</>}
        </section>
      </div>
      <section className="col"><h2>Categories</h2>{!x.categories.length ? <Empty title="No categories" action={<Link className="btn" to={`${base}/setup?step=2`}>Add categories</Link>} /> :
        <div className="grid g3">{x.categories.map((c: any) => <div key={c.id} className="card col tight"><div className="row between"><span className="bold">{c.name}</span><span className="small mono">{c.confirmed}/{c.capacity}</span></div><Bar pct={c.confirmed / c.capacity * 100} label={`${c.name} filled`} />
          <span className="xs muted">{c.pending} pending payment · {c.waitlisted} waitlisted</span><Link className="small" to={`${base}/registrations?categoryId=${c.id}`}>See entries</Link></div>)}</div>}</section>
    </div>
  </>;
}
