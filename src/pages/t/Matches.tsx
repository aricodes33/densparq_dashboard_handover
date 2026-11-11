import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMatches, useMatch, useAudit, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { Banner, Btn, Chip, Confirm, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Status, fmtDT, fmtTime, Textarea, Icon, human, Select } from '@/ui/kit';
import type { MatchView } from '@/mock/handlers';

export function Matches() {
  const { tid, org } = useTid(); const ms = useMatches(tid, '?published=true'); const [f, setF] = useState<'now' | 'verify' | 'upcoming' | 'done'>('now');
  if (ms.isLoading) return <Loading />; if (ms.error) return <ErrorState error={ms.error} />;
  const all = ms.data!.filter(m => m.homeId || m.awayId);
  const groups = { now: all.filter(m => ['live', 'paused'].includes(m.status)), verify: all.filter(m => m.result && m.result.verification !== 'verified'), upcoming: all.filter(m => ['scheduled', 'postponed'].includes(m.status)), done: all.filter(m => m.result?.verification === 'verified' || m.status === 'abandoned') };
  const list = groups[f];
  return <>
    <PageHead title="Matches" sub="Live match control and result verification. Only verified results count in standings and stats." actions={<Link className="btn" to="/score"><Icon name="play" />Open referee scoring</Link>} />
    <Seg label="Show" value={f} onChange={setF} options={[['now', `Live (${groups.now.length})`], ['verify', `To verify (${groups.verify.length})`], ['upcoming', `Upcoming (${groups.upcoming.length})`], ['done', `Verified (${groups.done.length})`]]} />
    <div style={{ marginTop: 14 }}>{!list.length ? <Empty icon="play" title={f === 'verify' ? 'Nothing to verify' : 'No matches here'} body={f === 'now' ? 'Matches go live when a referee starts them on the scoring pad.' : undefined} /> :
      <div className="table-wrap"><table><thead><tr><th>Match</th><th>Time · court</th><th>Teams</th><th>Score</th><th>Status</th><th /></tr></thead><tbody>{list.map(m => <tr key={m.id} className="click">
        <td className="bold mono">{m.code}<div className="xs muted" style={{ fontFamily: 'var(--font)' }}>{m.categoryName}</div></td><td className="small">{fmtTime(m.startAt)} · {m.courtName}</td><td>{m.homeName} <span className="muted">v</span> {m.awayName}</td>
        <td className="mono bold">{m.result?.detail ?? m.live?.headline ?? '—'}</td><td><div className="row tight"><Status s={m.status} />{m.result && <Status s={m.result.verification} />}</div></td>
        <td className="num"><Link className="btn sm" to={`/o/${org}/t/${tid}/matches/${m.id}`}>{m.result && m.result.verification !== 'verified' ? 'Review' : 'Open'}</Link></td></tr>)}</tbody></table></div>}</div>
  </>;
}

export function MatchReview() {
  const { mid } = useParams(); const { tid, org } = useTid(); const m = useMatch(mid); const audit = useAudit(org, tid);
  const [dlg, setDlg] = useState<null | 'dispute' | 'correct' | 'manual' | 'walkover' | 'abandon'>(null);
  const verify = useAct(() => api.post(`/matches/${mid}/verify`), 'Verified. Standings and stats updated, both teams notified.');
  const status = useAct((b: object) => api.post(`/matches/${mid}/status`, b), 'Match updated');
  if (m.isLoading) return <Loading rows={6} />; if (m.error) return <ErrorState error={m.error} />;
  const x = m.data!, admin = can(ORGANIZER), r = x.result, history = (audit.data ?? []).filter(a => a.entityId === x.id);
  return <>
    <PageHead title={`${x.homeName} v ${x.awayName}`} sub={`${x.code} · ${x.categoryName} · ${x.roundName}${x.group ? ` · Group ${x.group}` : ''} · ${fmtDT(x.startAt)} · ${x.courtName ?? 'No court'}`}
      actions={<><Link className="btn" to={`/score/${x.id}`}><Icon name="play" />Scoring pad</Link>{admin && x.status === 'scheduled' && <><Btn onClick={() => setDlg('walkover')}>Walkover</Btn><Btn onClick={() => setDlg('manual')}>Enter result</Btn></>}{admin && ['live', 'paused', 'scheduled'].includes(x.status) && <Btn kind="danger" onClick={() => setDlg('abandon')}>Abandon</Btn>}</>} />
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <section className="card ink col"><div className="row between"><Status s={x.status} />{r && <Status s={r.verification} />}</div>
        <div className="row between nowrap" style={{ gap: 20 }}><span className="display bold grow" style={{ fontSize: 20 }}>{x.homeName}</span><span className="big-score" style={{ fontSize: 56 }}>{r ? `${r.homeScore}–${r.awayScore}` : x.live?.headline ?? '0–0'}</span><span className="display bold grow" style={{ fontSize: 20, textAlign: 'right' }}>{x.awayName}</span></div>
        <span className="muted">{r?.detail ?? x.live?.detail}</span>
        {r && <span className="small muted">Submitted by {r.submittedBy} · {fmtDT(r.submittedAt)} · {human(r.source)} entry{r.verifiedAt && ` · verified ${fmtDT(r.verifiedAt)}`}</span>}
      </section>
      <section className="col">
        {r?.verification === 'disputed' && <Banner tone="danger">Disputed: {r.disputeReason}</Banner>}
        {r && r.verification !== 'verified' && <div className="card col"><h3>Check this result</h3><p className="small muted" style={{ margin: 0 }}>Someone other than the scorer confirms it. Once verified it counts in standings, advances the bracket and notifies both teams.</p>
          <div className="row tight">{(admin || can(['captain'])) && <Btn kind="lime" icon="check" loading={verify.isPending} onClick={() => verify.mutate(undefined)}>Verify result</Btn>}{admin && <Btn onClick={() => setDlg('correct')}>Correct it</Btn>}<Btn kind="ghost" onClick={() => setDlg('dispute')}>Raise a dispute</Btn></div></div>}
        {r?.verification === 'verified' && admin && <div className="card col"><h3>Need to change it?</h3><p className="small muted" style={{ margin: 0 }}>Corrections keep the original in history and recalculate standings.</p><Btn onClick={() => setDlg('correct')}>Correct result</Btn></div>}
        <div className="card col tight"><h3>Edit history</h3>{history.length ? history.map(a => <div key={a.id} className="small"><span className="mono muted">{fmtDT(a.at)}</span> · {a.byName}: <strong>{a.action}</strong>{a.reason && ` (${a.reason})`}</div>) : <span className="small muted">No edits.</span>}</div>
      </section>
    </div>
    <section className="col" style={{ marginTop: 20 }}><h2>Score log</h2>{!x.events.length ? <Empty title="No scoring yet" /> : <div className="table-wrap" style={{ maxHeight: 360 }}><table><thead><tr><th>#</th><th>Time</th><th>Event</th><th>Detail</th></tr></thead><tbody>
      {x.events.map(e => <tr key={e.id} style={e.voided ? { opacity: .45, textDecoration: 'line-through' } : undefined}><td className="mono">{e.seq}</td><td className="mono small">{fmtTime(e.at)}</td><td className="bold">{human(e.type)}</td><td className="small">{Object.entries(e.payload).map(([k, v]) => `${k}: ${v === 'home' ? x.homeName : v === 'away' ? x.awayName : v}`).join(' · ')}{e.voided && ' (undone)'}</td></tr>)}</tbody></table></div>}</section>
    {dlg === 'dispute' && <ReasonAct title="Raise a dispute" label="What's wrong?" url={`/matches/${mid}/dispute`} msg="Dispute raised. The organizer is notified." onClose={() => setDlg(null)} />}
    {dlg === 'abandon' && <Confirm title="Abandon this match?" body="It won't count in standings. You can reschedule it afterwards." reason="Reason" danger confirm="Abandon" onClose={() => setDlg(null)} onConfirm={reason => status.mutate({ status: 'abandoned', reason }, { onSuccess: () => setDlg(null) })} />}
    {dlg === 'walkover' && <Walkover m={x} onClose={() => setDlg(null)} />}
    {(dlg === 'correct' || dlg === 'manual') && <ScoreEntry m={x} mode={dlg} onClose={() => setDlg(null)} />}
  </>;
}

function ReasonAct({ title, label, url, msg, onClose }: { title: string; label: string; url: string; msg: string; onClose: () => void }) {
  const go = useAct((reason: string) => api.post(url, { reason }), msg);
  return <Confirm title={title} reason={label} confirm="Submit" busy={go.isPending} onClose={onClose} onConfirm={r => go.mutate(r, { onSuccess: onClose })} />;
}
function Walkover({ m, onClose }: { m: MatchView; onClose: () => void }) {
  const [w, setW] = useState('home'); const [reason, setReason] = useState('');
  const go = useAct((b: object) => api.post(`/matches/${m.id}/status`, b), 'Walkover recorded. Verify it to update standings.');
  return <Modal title="Record a walkover" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!reason.trim()} loading={go.isPending} onClick={() => go.mutate({ status: 'walkover', winner: w, reason }, { onSuccess: onClose })}>Record walkover</Btn></>}>
    <Field label="Winner">{p => <Select {...p} value={w} onChange={e => setW(e.target.value)} options={[['home', m.homeName ?? 'Home'], ['away', m.awayName ?? 'Away']]} />}</Field>
    <Field label="Reason" hint="e.g. Team did not turn up 10 minutes after the start">{p => <Textarea {...p} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}</Field></Modal>;
}
function ScoreEntry({ m, mode, onClose }: { m: MatchView; mode: 'correct' | 'manual'; onClose: () => void }) {
  const [h, setH] = useState(String(m.result?.homeScore ?? '')); const [a, setA] = useState(String(m.result?.awayScore ?? '')); const [detail, setDetail] = useState(m.result?.detail ?? ''); const [reason, setReason] = useState(''); const [tried, setTried] = useState(false);
  const go = useAct((b: object) => api.post(mode === 'correct' ? `/matches/${m.id}/correct` : `/matches/${m.id}/submit`, b), mode === 'correct' ? 'Corrected and verified. Standings recalculated.' : 'Result submitted for verification');
  const err = h === '' || a === '' ? 'Enter both scores' : mode === 'correct' && !reason.trim() ? 'A reason is required' : '';
  return <Modal title={mode === 'correct' ? 'Correct result' : 'Enter result manually'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => { setTried(true); if (!err) go.mutate({ homeScore: +h, awayScore: +a, detail, reason, manual: true }, { onSuccess: onClose }); }}>Save</Btn></>}>
    <div className="grid g2"><Field label={m.homeName ?? 'Home'}>{p => <Input {...p} type="number" inputMode="numeric" value={h} onChange={e => setH(e.target.value)} />}</Field><Field label={m.awayName ?? 'Away'}>{p => <Input {...p} type="number" inputMode="numeric" value={a} onChange={e => setA(e.target.value)} />}</Field></div>
    <Field label="Score detail (optional)" hint="e.g. 21-18, 19-21, 21-15 or 84/3 v 80/6">{p => <Input {...p} value={detail} onChange={e => setDetail(e.target.value)} />}</Field>
    {mode === 'correct' && <Field label="Why the correction" error={tried && !reason.trim() ? err : undefined}>{p => <Textarea {...p} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}</Field>}
    {tried && err && mode !== 'correct' && <span className="err small">{err}</span>}
    <Chip tone="money">Manual entry · counts once verified</Chip>
  </Modal>;
}
