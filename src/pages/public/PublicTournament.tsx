// Participant/spectator page. No login needed. Live scores refresh every 8 s; phones masked; minors' stats hidden.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePublicT, usePublicMatches, useStandings, useStats } from '@/api/hooks';
import { Btn, Chip, Empty, ErrorState, Icon, Loading, Status, Bar, fmtDate, fmtTime } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import { inr } from '@/domain/registration';
import { Bracket } from '@/pages/t/Standings';
import type { MatchView } from '@/mock/handlers';

const TABS = ['Overview', 'Fixtures', 'Live & results', 'Standings', 'Stats', 'Rules'] as const;

export function PublicTournament() {
  const { slug = '' } = useParams(); const t = usePublicT(slug); const ms = usePublicMatches(slug); const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  if (t.isLoading) return <div className="pub"><Loading rows={6} /></div>;
  if (t.error) return <div className="pub"><ErrorState error={t.error} /></div>;
  const x = t.data, live = (ms.data ?? []).filter(m => m.status === 'live' || m.status === 'paused');
  const open = Date.now() >= Date.parse(x.regOpensAt) && Date.now() <= Date.parse(x.regClosesAt);
  return <div className="pub">
    <section className="hero">
      <div className="row tight" style={{ position: 'relative', zIndex: 1 }}><span className="brand-mark" style={{ width: 28, height: 28, fontSize: 16 }}>D</span><span className="small" style={{ color: '#A3A3A3' }}>{x.organizerName}</span></div>
      <div className="row tight" style={{ position: 'relative', zIndex: 1 }}><Chip tone="ink">{SPORT_LABEL[x.sport as keyof typeof SPORT_LABEL]}</Chip>{live.length > 0 && <Chip tone="good" live>{live.length} live now</Chip>}</div>
      <h1 style={{ fontSize: 40, position: 'relative', zIndex: 1 }}>{x.name}</h1>
      <span style={{ color: '#D6D6D6', position: 'relative', zIndex: 1 }}>{fmtDate(x.startDate)}{x.endDate !== x.startDate ? ` – ${fmtDate(x.endDate)}` : ''} · {x.venue?.name ?? x.venueText}</span>
      <div className="row" style={{ position: 'relative', zIndex: 1 }}>{open ? <Link className="btn lime lg" to={`/t/${slug}/register`}>Register now</Link> : <Chip tone="neutral">{Date.now() < Date.parse(x.regOpensAt) ? `Registration opens ${fmtDate(x.regOpensAt)}` : 'Registration closed'}</Chip>}<span className="small" style={{ color: '#A3A3A3' }}>Closes {fmtDate(x.regClosesAt)}</span></div>
    </section>
    <nav className="tabs" role="tablist" aria-label="Tournament sections" style={{ marginTop: 18 }}>{TABS.map(k => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k}{k === 'Live & results' && live.length ? ` (${live.length})` : ''}</button>)}</nav>
    <div role="tabpanel">
      {tab === 'Overview' && <div className="col loose"><p style={{ margin: 0, fontSize: 17 }}>{x.description}</p>
        <div className="grid g3">{x.categories.map((c: any) => { const left = Math.max(0, c.capacity - c.taken); return <div key={c.id} className="card col tight"><span className="bold">{c.name}</span><span className="small muted">{c.eventType === 'team' ? `Teams of ${c.rosterMin}–${c.rosterMax}` : c.eventType === 'doubles' ? 'Pairs' : 'Singles'}{c.maxAge ? ` · under ${c.maxAge + 1}` : ''}{c.minAge ? ` · ${c.minAge}+` : ''}</span>
          <span className="display bold" style={{ fontSize: 22 }}>{c.feePaise ? inr(c.feePaise) : 'Free'}</span><Bar pct={c.taken / c.capacity * 100} label={`${c.name} places taken`} /><span className="xs">{left ? `${left} of ${c.capacity} places left` : `Full · ${c.waitlisted} on the waitlist`}</span></div>; })}</div>
        {x.prizes?.length > 0 && <section className="card col"><h2>Prizes</h2>{x.prizes.map((p: any) => <div key={p.place} className="row between"><span className="bold">{p.place}</span><span>{p.description}{p.amountPaise ? ` · ${inr(p.amountPaise)}` : ''}</span></div>)}</section>}
        <section className="card flat col tight"><h3>Contact</h3><span>{x.contact.name} · <a href={`tel:${x.contact.phone}`}>{x.contact.phone}</a> · <a href={`mailto:${x.contact.email}`}>{x.contact.email}</a></span><span className="small muted">{x.venue?.address}</span></section></div>}
      {tab === 'Fixtures' && <MatchList ms={(ms.data ?? []).filter(m => m.status === 'scheduled' || m.status === 'postponed')} empty="Fixtures will appear once the organizer publishes them." />}
      {tab === 'Live & results' && <MatchList ms={[...live, ...(ms.data ?? []).filter(m => m.result && m.status !== 'live')]} empty="No results yet." />}
      {tab === 'Standings' && <PublicStandings id={x.id} />}
      {tab === 'Stats' && <PublicStats id={x.id} />}
      {tab === 'Rules' && (x.rules ? <article className="col"><div className="row tight"><Chip tone="ink">Version {x.rules.version}</Chip><span className="small muted">Published {fmtDate(x.rules.publishedAt)}</span></div>
        {x.rules.sections.filter((s: any) => s.html).map((s: any) => <section key={s.key} className="card prose"><h3>{s.title}</h3><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}
        {x.rules.attachments.map((a: any) => <a key={a.id} className="btn" href={a.url}><Icon name="download" />{a.name}</a>)}</article> : <Empty title="Rules not published yet" />)}
    </div>
  </div>;
}

function MatchList({ ms, empty }: { ms: MatchView[]; empty: string }) {
  if (!ms.length) return <Empty icon="cal" title="Nothing here yet" body={empty} />;
  const days = [...new Set(ms.map(m => fmtDate(m.startAt)))];
  return <div className="col loose">{days.map(d => <section key={d} className="col"><h3>{d}</h3>{ms.filter(m => fmtDate(m.startAt) === d).map(m => <div key={m.id} className={`card row between ${m.status === 'live' ? 'ink' : ''}`}>
    <div className="col tight" style={{ gap: 0 }}><span className="xs muted">{fmtTime(m.startAt)} · {m.courtName} · {m.categoryName} · {m.roundName}{m.status === 'postponed' ? ' · postponed' : ''}</span><span className="bold">{m.homeName} <span className="muted">v</span> {m.awayName}</span></div>
    <div className="row tight">{m.live ? <span className="display bold" style={{ fontSize: 22, color: 'var(--lime)' }}>{m.live.headline}</span> : m.result ? <span className="mono bold">{m.result.detail}</span> : null}{m.status === 'live' ? <Chip tone="good" live>Live</Chip> : m.result ? <Status s={m.result.verification === 'verified' ? 'completed' : 'submitted'} /> : null}</div></div>)}</section>)}
    <span className="xs muted">Results marked "Submitted" are waiting for confirmation and may change.</span></div>;
}
function PublicStandings({ id }: { id: string }) {
  const s = useStandings(id); if (s.isLoading) return <Loading />;
  return <div className="col loose">{(s.data ?? []).map(c => { const groups = [...new Set(c.rows.map(r => r.group))]; return <section key={c.categoryId} className="col"><h2>{c.name}</h2>
    <div className="grid g2">{groups.map(g => <div key={g} className="table-wrap"><table><thead><tr><th>{g === 'League' ? 'Table' : `Group ${g}`}</th><th className="num">P</th><th className="num">W</th><th className="num">Pts</th></tr></thead><tbody>{c.rows.filter(r => r.group === g).map(r => <tr key={r.regId} className={r.qualified ? 'qual' : ''}><td>{r.rank}. {r.name}</td><td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num bold">{r.points}</td></tr>)}</tbody></table></div>)}</div>
    {c.bracket.length > 0 && <Bracket matches={c.bracket} />}{!groups.length && !c.bracket.length && <Empty title="No standings yet" />}</section>; })}</div>;
}
function PublicStats({ id }: { id: string }) {
  const s = useStats(id, '?public=true'); if (s.isLoading) return <Loading />;
  return !s.data?.leaderboard.length ? <Empty title="No stats yet" /> : <div className="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th className="num">Total</th></tr></thead><tbody>{s.data.leaderboard.slice(0, 20).map((r, i) => <tr key={r.playerId}><td>{i + 1}</td><td className={r.hidden ? 'muted' : 'bold'}>{r.name}</td><td className="small">{r.entry}</td><td className="num bold">{r.value}{!r.verified && ' *'}</td></tr>)}</tbody></table><p className="xs muted" style={{ padding: '0 14px' }}>* not yet verified. Under-18 players are hidden unless a guardian opts in.</p></div>;
}
void Btn;
