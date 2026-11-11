// Referee scoring (phone-first, dark). Every tap is a ScoreEvent with a clientId; events queue in localStorage
// while offline and flush in order (POST /matches/:id/events is idempotent on clientId). State = shared reducers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMatch, useMyMatches, useAct } from '@/api/hooks';
import { api, getSession } from '@/api/client';
import { Btn, Chip, Confirm, Empty, ErrorState, Icon, Loading, Modal, Field, Input, fmtTime, Status, toast } from '@/ui/kit';
import { summarize, rally, football, cricket, frisbee, lagori, overs, SPORT_LABEL, type Side } from '@/domain/scoring';
import type { ScoreEvent, ScoringConfig } from '@/domain/types';

type Pending = { clientId: string; type: string; payload: Record<string, unknown>; at: string };
const qKey = (mid: string) => `dsq-queue-${mid}`;
const loadQ = (mid: string): Pending[] => { try { return JSON.parse(localStorage.getItem(qKey(mid)) ?? '[]'); } catch { return []; } };
const saveQ = (mid: string, q: Pending[]) => { try { localStorage.setItem(qKey(mid), JSON.stringify(q)); } catch { /* */ } };

export function RefereeHome() {
  const ms = useMyMatches(); const s = getSession();
  return <div className="pad"><div className="pad-top"><Link to="/" className="btn sm" aria-label="Back to dashboard"><Icon name="back" /></Link><span className="display bold grow" style={{ fontSize: 18 }}>My matches</span><span className="xs muted">{s.label}</span></div>
    <div className="pad-body">{ms.isLoading ? <Loading /> : ms.error ? <ErrorState error={ms.error} /> : !ms.data!.length ? <Empty icon="play" title="No matches assigned" body="When an organizer assigns you a match, it appears here." /> :
      ms.data!.map(m => <Link key={m.id} to={`/score/${m.id}`} className="card col tight" style={{ textDecoration: 'none' }}><div className="row between"><span className="xs muted">{SPORT_LABEL[m.sport]} · {m.code} · {m.courtName}</span><Status s={m.status} /></div>
        <span className="display bold" style={{ fontSize: 18 }}>{m.homeName} v {m.awayName}</span><span className="small muted">{fmtTime(m.startAt)}{m.live ? ` · ${m.live.headline}` : ''}</span></Link>)}</div></div>;
}

export function ScorePad() {
  const { mid = '' } = useParams(); const m = useMatch(mid); const qc = useQueryClient(); const nav = useNavigate();
  const [queue, setQueue] = useState<Pending[]>(() => loadQ(mid)); const [online, setOnline] = useState(navigator.onLine); const [syncing, setSyncing] = useState(false);
  const [finish, setFinish] = useState(false); const [endEarly, setEndEarly] = useState(false);
  const status = useAct((b: object) => api.post(`/matches/${mid}/status`, b));
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  const inFlight = useRef(false);
  const flush = useCallback(async () => {
    const q = loadQ(mid); if (!q.length || inFlight.current) return; inFlight.current = true; setSyncing(true);
    const drop = () => { const rest = loadQ(mid).filter(e => !q.some(x => x.clientId === e.clientId)); saveQ(mid, rest); setQueue(rest); }; // keep taps made during the request
    try { await api.post(`/matches/${mid}/events`, { events: q }); drop(); qc.invalidateQueries({ queryKey: ['match', mid] }); }
    catch (e: any) { if (e.status && e.status !== 0) { toast(e.message, 'danger'); if (e.status === 409 || e.status === 403) drop(); } }
    finally { inFlight.current = false; setSyncing(false); }
  }, [mid, qc]);
  useEffect(() => { if (online) flush(); const i = setInterval(() => online && flush(), 3000); return () => clearInterval(i); }, [online, flush]);
  const emit = (type: string, payload: Record<string, unknown> = {}) => {
    if (navigator.vibrate) navigator.vibrate(15);
    const e = { clientId: crypto.randomUUID(), type, payload, at: new Date().toISOString() }; const q = [...loadQ(mid), e]; saveQ(mid, q); setQueue(q); if (online) setTimeout(flush, 0);
  };
  // optimistic local stream: server events + queued, with voids applied
  const events = useMemo(() => {
    const base: ScoreEvent[] = (m.data?.events ?? []).map(e => ({ ...e }));
    let seq = Math.max(0, ...base.map(e => e.seq));
    for (const p of queue) { if (p.type === 'void') { const t = [...base].reverse().find(e => !e.voided); if (t) t.voided = true; } else base.push({ id: p.clientId, matchId: mid, seq: ++seq, clientId: p.clientId, type: p.type, payload: p.payload, by: 'me', at: p.at }); }
    return base.filter(e => !e.voided);
  }, [m.data?.events, queue, mid]);
  if (m.isLoading) return <div className="pad"><div className="pad-body"><Loading /></div></div>;
  if (m.error) return <div className="pad"><div className="pad-body"><ErrorState error={m.error} /></div></div>;
  const x = m.data!, cfg = x.tournament.scoring, sport = x.tournament.sport, sum = summarize(sport, events, cfg);
  const live = x.status === 'live' || x.status === 'paused', H = x.homeName ?? 'Home', A = x.awayName ?? 'Away';
  const canScore = live && cfg.autoScoring;
  return <div className="pad">
    <div className="pad-top"><Link to="/score" className="btn sm" aria-label="Back to my matches"><Icon name="back" /></Link>
      <div className="col tight grow" style={{ gap: 0 }}><span className="bold">{x.code} · {x.courtName}</span><span className="xs muted">{SPORT_LABEL[sport]} · {x.roundName}</span></div>
      <span className="pad-sync" role="status" aria-live="polite">{!online ? <><Icon name="wifiOff" size={14} /><span style={{ color: '#F08A3C' }}>Offline · {queue.length} saved on phone</span></> : queue.length ? <><Icon name="wifi" size={14} />Syncing {queue.length}…</> : <><Icon name="check" size={14} />Synced</>}</span></div>
    <div className="pad-body">
      <div className="card col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="row between nowrap" style={{ width: '100%' }}><span className="bold grow" style={{ textAlign: 'left' }}>{H}</span><Status s={x.status} /><span className="bold grow" style={{ textAlign: 'right' }}>{A}</span></div>
        <span className="big-score" aria-live="polite">{sport === 'box_cricket' ? sum.headline : sport === 'badminton' || sport === 'pickleball' ? (() => { const g = rally(events, cfg).games.at(-1)!; return `${g.home}–${g.away}`; })() : `${sum.home}–${sum.away}`}</span>
        <span className="small muted">{sport === 'badminton' || sport === 'pickleball' ? `Games ${sum.home}–${sum.away} · ${sum.detail || 'first game'}` : sum.detail || 'No score yet'}</span>
      </div>
      {x.result && <div className="card col"><span className="bold">Result submitted: {x.result.detail}</span><span className="small muted">Waiting for {x.result.verification === 'verified' ? '— verified ✓' : 'the opponent captain or organizer to verify.'}</span></div>}
      {x.status === 'scheduled' && <><Btn kind="lime" size="lg" icon="play" loading={status.isPending} onClick={() => status.mutate({ status: 'live' })} disabled={!x.homeId || !x.awayId}>Start match</Btn>{!cfg.autoScoring && <span className="small muted">This tournament uses manual result entry. Start the match, then enter the final score.</span>}</>}
      {canScore && (sport === 'badminton' || sport === 'pickleball') && <RallyPad ev={events} cfg={cfg} H={H} A={A} emit={emit} />}
      {canScore && sport === 'football' && <FootballPad ev={events} cfg={cfg} H={H} A={A} emit={emit} />}
      {canScore && sport === 'box_cricket' && <CricketPad ev={events} cfg={cfg} H={H} A={A} emit={emit} />}
      {canScore && sport === 'frisbee' && <FrisbeePad ev={events} cfg={cfg} H={H} A={A} emit={emit} />}
      {canScore && sport === 'lagori' && <LagoriPad ev={events} cfg={cfg} H={H} A={A} emit={emit} />}
      {live && <div className="row" style={{ marginTop: 'auto' }}>
        {cfg.autoScoring && <Btn icon="undo" onClick={() => emit('void')} disabled={!events.length}>Undo</Btn>}
        <Btn icon={x.status === 'paused' ? 'play' : 'pause'} onClick={() => status.mutate({ status: x.status === 'paused' ? 'live' : 'paused' })}>{x.status === 'paused' ? 'Resume' : 'Pause'}</Btn>
        <Btn kind="lime" className="grow" onClick={() => { if (queue.length) { toast('Wait until all taps are synced', 'danger'); return; } cfg.autoScoring && !sum.finished ? setEndEarly(true) : setFinish(true); }}>Finish match</Btn></div>}
    </div>
    {finish && <FinishDialog mid={mid} manual={!cfg.autoScoring} H={H} A={A} sum={sum} onClose={() => setFinish(false)} onDone={() => nav('/score')} />}
    {endEarly && <Confirm title="End the match early?" body={`By the scoring rules this match isn't finished (${sum.detail || 'no score'}). The current score is submitted as the result.`} reason="Why is it ending early?" confirm="End & submit" onClose={() => setEndEarly(false)} onConfirm={reason => api.post(`/matches/${mid}/submit`, { force: true, reason }).then(() => { toast('Submitted for verification'); nav('/score'); }, (e: any) => toast(e.message, 'danger'))} />}
  </div>;
}

type PadP = { ev: ScoreEvent[]; cfg: ScoringConfig; H: string; A: string; emit: (t: string, p?: Record<string, unknown>) => void };
const Tap = ({ side, label, sub, onClick }: { side: Side; label: string; sub?: string; onClick: () => void }) => <button type="button" className={`tap ${side}`} onClick={onClick}><span>{label}</span>{sub && <span className="small" style={{ fontWeight: 500 }}>{sub}</span>}</button>;

function RallyPad({ ev, cfg, H, A, emit }: PadP) {
  const s = rally(ev, cfg), g = s.games[s.games.length - 1];
  return <><div className="row between small muted"><span>Game {s.games.length} of up to {cfg.rally?.bestOf}</span><span>Serving: <strong style={{ color: '#fff' }}>{s.server === 'home' ? H : A}</strong></span></div>
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Tap side="home" label={`+1 ${H}`} sub={`${g.home} pts`} onClick={() => emit('point', { side: 'home' })} /><Tap side="away" label={`+1 ${A}`} sub={`${g.away} pts`} onClick={() => emit('point', { side: 'away' })} /></div>
    {s.winner && <Chip tone="good">{s.winner === 'home' ? H : A} wins. Tap Finish match.</Chip>}</>;
}

function useTick() { const [, set] = useState(0); useEffect(() => { const i = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(i); }, []); }
function FootballPad({ ev, cfg, H, A, emit }: PadP) {
  useTick(); const s = football(ev); const [scorer, setScorer] = useState<null | { side: Side; kind: 'goal' | 'yellow' | 'red' }>(null); const [name, setName] = useState('');
  const ms = s.elapsedMs + (s.clockRunningSince ? Date.now() - s.clockRunningSince : 0), minute = Math.floor(ms / 60000);
  const next: Record<string, [string, string][]> = { pre: [['H1', 'Kick off']], H1: [['HT', 'Half-time']], HT: [['H2', 'Start 2nd half']], H2: [['FT', 'Full-time']], FT: [['END', 'End match'], ['ET1', 'Extra time'], ['PEN', 'Penalties']], ET1: [['ET2', 'ET 2nd half']], ET2: [['END', 'End'], ['PEN', 'Penalties']], PEN: [['END', 'End shoot-out']], END: [] };
  const half = cfg.football?.halfMinutes ?? 20;
  return <>
    <div className="card row between"><span className="display bold" style={{ fontSize: 34 }} aria-label={`Clock ${minute} minutes`}>{String(minute).padStart(2, '0')}:{String(Math.floor(ms / 1000) % 60).padStart(2, '0')}</span><span className="col tight" style={{ alignItems: 'flex-end' }}><Chip tone="ink">{s.period === 'pre' ? 'Not started' : s.period}</Chip><span className="xs muted">{half} min halves</span></span></div>
    <div className="row">{next[s.period].map(([p, l]) => <Btn key={p} onClick={() => emit('period', { period: p })}>{l}</Btn>)}{['H1', 'H2', 'ET1', 'ET2'].includes(s.period) && <Btn onClick={() => emit('clock', { run: !s.clockRunningSince })}>{s.clockRunningSince ? 'Stop clock' : 'Restart clock'}</Btn>}</div>
    {s.period !== 'PEN' ? <><div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Tap side="home" label={`Goal ${H}`} onClick={() => setScorer({ side: 'home', kind: 'goal' })} /><Tap side="away" label={`Goal ${A}`} onClick={() => setScorer({ side: 'away', kind: 'goal' })} /></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>{(['home', 'away'] as Side[]).map(sd => <div key={sd} className="row tight"><Btn size="sm" onClick={() => setScorer({ side: sd, kind: 'yellow' })}>Yellow card</Btn><Btn size="sm" kind="danger" onClick={() => setScorer({ side: sd, kind: 'red' })}>Red card</Btn></div>)}</div></>
      : <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>{(['home', 'away'] as Side[]).map(sd => <div key={sd} className="card col tight"><span className="bold">{sd === 'home' ? H : A}: {s.pens[sd].map(x => (x ? '●' : '○')).join(' ')}</span><div className="row tight"><Btn kind="lime" size="sm" onClick={() => emit('pen', { side: sd, scored: true })}>Scored</Btn><Btn size="sm" onClick={() => emit('pen', { side: sd, scored: false })}>Missed</Btn></div></div>)}</div>}
    {s.scorers.length + s.cards.length > 0 && <div className="card col tight small">{[...s.scorers.map(g => `Goal ${g.minute}' ${g.player ?? ''} (${g.side === 'home' ? H : A})`), ...s.cards.map(c => `${c.color === 'red' ? 'Red' : 'Yellow'} card ${c.minute}' ${c.player ?? ''} (${c.side === 'home' ? H : A})`)].map((l, i) => <span key={i}>{l}</span>)}</div>}
    {scorer && <Modal title={scorer.kind === 'goal' ? `Goal for ${scorer.side === 'home' ? H : A}` : `${scorer.kind === 'red' ? 'Red' : 'Yellow'} card`} onClose={() => setScorer(null)} footer={<Btn kind="primary" onClick={() => { emit(scorer.kind === 'goal' ? 'goal' : 'card', { side: scorer.side, minute, player: name || undefined, ...(scorer.kind !== 'goal' ? { color: scorer.kind } : {}) }); setScorer(null); setName(''); }}>Save ({minute}')</Btn>}>
      <Field label="Player (optional)" hint="Name or shirt number. Used for player stats.">{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field></Modal>}
  </>;
}

function CricketPad({ ev, cfg, H, A, emit }: PadP) {
  const s = cricket(ev, cfg), tossed = ev.some(e => e.type === 'toss'), inn = s.innings[s.innings.length - 1], bpo = cfg.cricket?.ballsPerOver ?? 6;
  const [extra, setExtra] = useState<string | null>(null);
  if (!tossed) return <div className="card col"><h3>Who bats first?</h3><div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Tap side="home" label={H} onClick={() => emit('toss', { batting: 'home' })} /><Tap side="away" label={A} onClick={() => emit('toss', { batting: 'away' })} /></div></div>;
  const thisOver = inn.balls.slice(-Math.max(1, (inn.legalBalls % bpo) || bpo));
  const ball = (runs: number, wicket = false) => { emit('ball', { runs, ...(extra ? { extra } : {}), ...(wicket ? { wicket: true } : {}) }); setExtra(null); };
  return <>
    <div className="card col tight"><div className="row between"><span className="bold">{inn.batting === 'home' ? H : A} batting</span><span className="mono">{overs(inn.legalBalls, bpo)} / {cfg.cricket?.overs} ov</span></div>
      <span className="display bold" style={{ fontSize: 30 }}>{inn.runs}/{inn.wickets}</span>{s.target && <span className="small">Need {Math.max(0, s.target - inn.runs)} from {cfg.cricket!.overs * bpo - inn.legalBalls} balls</span>}
      <span className="small muted">This over: {thisOver.join(' ') || '—'}</span></div>
    {!s.done && <><div className="row tight" role="group" aria-label="Extras">{[['wd', 'Wide'], ['nb', 'No ball'], ['b', 'Bye'], ['lb', 'Leg bye']].map(([k, l]) => <Btn key={k} size="sm" kind={extra === k ? 'lime' : undefined} aria-pressed={extra === k} onClick={() => setExtra(extra === k ? null : k)}>{l}</Btn>)}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>{[0, 1, 2, 3, 4, 6].map(r => <button key={r} type="button" className="tap away" style={{ minHeight: 72 }} onClick={() => ball(r)}>{r}{extra ? ` +${extra}` : ''}</button>)}</div>
      <div className="row"><Btn kind="danger" className="grow" onClick={() => ball(0, true)}>Wicket</Btn><Btn onClick={() => emit('innings_end')}>End innings</Btn></div></>}
    {s.done && <Chip tone="good">{s.isTie ? 'Tie' : `${s.winner === 'home' ? H : A} win`}. Tap Finish match.</Chip>}
  </>;
}

function FrisbeePad({ ev, cfg, H, A, emit }: PadP) {
  const s = frisbee(ev, cfg), p = cfg.frisbee!; const [spirit, setSpirit] = useState(false); const [sp, setSp] = useState({ home: '10', away: '10' });
  return <><div className="row between small muted"><span>{s.half === 1 ? `1st half · half-time at ${p.halftimeAt}` : '2nd half'}</span><span>Game to {p.pointsToWin} · cap {p.cap}</span></div>
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Tap side="home" label={`Point ${H}`} onClick={() => emit('point', { side: 'home' })} /><Tap side="away" label={`Point ${A}`} onClick={() => emit('point', { side: 'away' })} /></div>
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>{(['home', 'away'] as Side[]).map(sd => <Btn key={sd} size="sm" disabled={s.timeouts[sd] >= p.timeoutsPerHalf} onClick={() => emit('timeout', { side: sd })}>Timeout {sd === 'home' ? H : A} ({p.timeoutsPerHalf - s.timeouts[sd]} left)</Btn>)}</div>
    <div className="row"><Btn size="sm" onClick={() => emit('cap')}>Time cap reached</Btn>{p.spiritScoring && <Btn size="sm" onClick={() => setSpirit(true)}>{s.spirit ? `Spirit ${s.spirit.home}/${s.spirit.away}` : 'Enter spirit scores'}</Btn>}</div>
    {s.winner && <Chip tone="good">{s.winner === 'home' ? H : A} win{s.capped ? ' on cap' : ''}. Tap Finish match.</Chip>}
    {spirit && <Modal title="Spirit of the Game" onClose={() => setSpirit(false)} footer={<Btn kind="primary" onClick={() => { emit('spirit', { home: +sp.home, away: +sp.away }); setSpirit(false); }}>Save</Btn>}>
      <p className="small muted" style={{ margin: 0 }}>The score each team received from its opponent (0–20).</p><div className="grid g2">{(['home', 'away'] as Side[]).map(sd => <Field key={sd} label={sd === 'home' ? H : A}>{pp => <Input {...pp} type="number" min={0} max={20} value={sp[sd]} onChange={e => setSp({ ...sp, [sd]: e.target.value })} />}</Field>)}</div></Modal>}
  </>;
}

function LagoriPad({ ev, cfg, H, A, emit }: PadP) {
  useTick(); const s = lagori(ev, cfg), p = cfg.lagori!;
  const left = s.inRound && s.roundStartedAt ? Math.max(0, p.roundSeconds - Math.floor((Date.now() - s.roundStartedAt) / 1000)) : p.roundSeconds;
  return <>
    <div className="card row between"><span className="col tight"><span className="bold">Round {Math.max(1, s.round)} of {p.rounds}</span><span className="xs muted">{s.inRound ? 'In play' : s.done ? 'All rounds done' : 'Between rounds'}</span></span>
      <span className="display bold" style={{ fontSize: 30, color: left < 20 && s.inRound ? '#F08A3C' : undefined }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></div>
    {!s.done && (s.inRound ? <Btn onClick={() => emit('round_end')}>End round {s.round}</Btn> : <Btn kind="lime" onClick={() => emit('round_start')}>Start round {s.round + 1}</Btn>)}
    {s.inRound && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>{(['home', 'away'] as Side[]).map(sd => <div key={sd} className="col tight"><span className="bold small">{sd === 'home' ? H : A}</span>
      {p.actions.map(a => <button key={a.key} type="button" className={`tap ${sd}`} style={{ minHeight: 64, fontSize: 15 }} onClick={() => emit('action', { side: sd, key: a.key })}>{a.label}<span className="xs">{a.side === 'self' ? '+' : 'opp +'}{a.points}</span></button>)}</div>)}</div>}
    {s.log.length > 0 && <div className="card col tight small" style={{ maxHeight: 160, overflow: 'auto' }}>{[...s.log].reverse().map((l, i) => <span key={i}>R{l.round} · {l.side === 'home' ? H : A}: {l.label} ({l.points})</span>)}</div>}
    {s.done && <Chip tone="good">All rounds played. Tap Finish match.</Chip>}
  </>;
}

function FinishDialog({ mid, manual, H, A, sum, onClose, onDone }: { mid: string; manual: boolean; H: string; A: string; sum: ReturnType<typeof summarize>; onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(''); const [a, setA] = useState(''); const [detail, setDetail] = useState('');
  const go = useAct((b: object) => api.post(`/matches/${mid}/submit`, b), 'Result submitted. The other side gets a link to verify it.');
  return <Modal title="Submit the result?" onClose={onClose} footer={<><Btn onClick={onClose}>Keep scoring</Btn><Btn kind="primary" loading={go.isPending} disabled={manual && (h === '' || a === '')} onClick={() => go.mutate(manual ? { manual: true, homeScore: +h, awayScore: +a, detail } : {}, { onSuccess: onDone })}>Submit result</Btn></>}>
    {manual ? <><div className="grid g2"><Field label={H}>{p => <Input {...p} type="number" inputMode="numeric" value={h} onChange={e => setH(e.target.value)} />}</Field><Field label={A}>{p => <Input {...p} type="number" inputMode="numeric" value={a} onChange={e => setA(e.target.value)} />}</Field></div><Field label="Detail (optional)">{p => <Input {...p} value={detail} onChange={e => setDetail(e.target.value)} />}</Field></>
      : <div className="card flat col" style={{ textAlign: 'center' }}><span className="display bold" style={{ fontSize: 34 }}>{sum.home}–{sum.away}</span><span className="small muted">{sum.detail}</span><span className="bold">{sum.winner ? `${sum.winner === 'home' ? H : A} win` : 'Draw'}</span></div>}
    <p className="small muted" style={{ margin: 0 }}>After you submit, you can't change it. Corrections go through the organizer and are logged.</p>
  </Modal>;
}
