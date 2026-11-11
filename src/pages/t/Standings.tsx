import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStandings, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { Banner, Btn, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Select, Textarea, Status, Check } from '@/ui/kit';
import type { MatchView } from '@/mock/handlers';
import type { StandingRow } from '@/domain/types';

export function Standings() {
  const { tid } = useTid(); const s = useStandings(tid); const [ov, setOv] = useState<{ categoryId: string; group: string; rows: StandingRow[] } | null>(null);
  const decide = useAct((b: { id: string; decision: string; selfApprove?: boolean }) => api.post(`/standings-overrides/${b.id}/decide`, b), 'Override decided. Tables updated.');
  const [self, setSelf] = useState(false);
  if (s.isLoading) return <Loading rows={8} />; if (s.error) return <ErrorState error={s.error} />;
  return <>
    <PageHead title="Standings" sub="Calculated from verified results with this tournament's points and tie-breakers. A lime bar marks entries currently going through." />
    {!s.data!.length ? <Empty title="No categories" /> : s.data!.map(c => { const groups = [...new Set(c.rows.map(r => r.group))]; const pending = c.overrides.filter(o => o.status === 'pending');
      return <section key={c.categoryId} className="col loose" style={{ marginBottom: 32 }}>
        <h2>{c.name}</h2>
        {pending.map(o => <Banner key={o.id} tone="money" action={can(ORGANIZER) && <div className="row tight"><Check label="Approve my own request (demo)" checked={self} onChange={e => setSelf(e.target.checked)} /><Btn size="sm" kind="primary" onClick={() => decide.mutate({ id: o.id, decision: 'approved', selfApprove: self })}>Approve</Btn><Btn size="sm" onClick={() => decide.mutate({ id: o.id, decision: 'rejected' })}>Reject</Btn></div>}>
          Override requested: move <strong>{c.rows.find(r => r.regId === o.regId)?.name}</strong> to rank {o.rank} in {o.group}. Reason: {o.reason}</Banner>)}
        {!groups.length && c.format !== 'knockout' && <Empty title="No results yet" body="Tables fill in as results are verified." />}
        <div className="grid g2" style={{ alignItems: 'start' }}>{groups.map(g => { const rows = c.rows.filter(r => r.group === g); return <div key={g} className="col tight">
          <div className="row between"><h3>{g === 'League' ? 'Table' : `Group ${g}`}</h3><div className="row tight">{rows[0]?.provisional && <Chip tone="money">Provisional: unverified results</Chip>}{can(ORGANIZER) && <Btn size="sm" kind="ghost" onClick={() => setOv({ categoryId: c.categoryId, group: g, rows })}>Override</Btn>}</div></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Entry</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">+/−</th><th className="num">Pts</th></tr></thead><tbody>
            {rows.map(r => <tr key={r.regId} className={r.qualified ? 'qual' : ''}><td className="mono">{r.rank}</td><td className="bold">{r.name}{r.overridden && <Chip tone="info">Override</Chip>}</td><td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.drawn}</td><td className="num">{r.lost}</td><td className="num">{r.diff > 0 ? `+${r.diff}` : r.diff}</td><td className="num bold">{r.points}</td></tr>)}</tbody></table></div></div>; })}</div>
        {c.bracket.length > 0 && <><h3>Knockout</h3><Bracket matches={c.bracket} /></>}
      </section>; })}
    {ov && <OverrideDialog tid={tid} {...ov} onClose={() => setOv(null)} />}
  </>;
}

function OverrideDialog({ tid, categoryId, group, rows, onClose }: { tid: string; categoryId: string; group: string; rows: StandingRow[]; onClose: () => void }) {
  const [regId, setReg] = useState(rows[0]?.regId ?? ''); const [rank, setRank] = useState('1'); const [reason, setReason] = useState('');
  const go = useAct((b: object) => api.post(`/tournaments/${tid}/standings/overrides`, b), 'Override requested. A second organizer must approve it.');
  return <Modal title={`Override ${group === 'League' ? 'table' : `Group ${group}`}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!reason.trim()} loading={go.isPending} onClick={() => go.mutate({ categoryId, group, regId, rank, reason }, { onSuccess: onClose })}>Request override</Btn></>}>
    <p className="muted small" style={{ margin: 0 }}>For decisions the rules engine can't make, such as a protest upheld or a disciplinary deduction. Needs approval and is logged.</p>
    <div className="grid g2"><Field label="Entry">{p => <Select {...p} value={regId} onChange={e => setReg(e.target.value)} options={rows.map(r => [r.regId, `${r.rank}. ${r.name}`])} />}</Field><Field label="New rank">{p => <Input {...p} type="number" min={1} max={rows.length} value={rank} onChange={e => setRank(e.target.value)} />}</Field></div>
    <Field label="Reason">{p => <Textarea {...p} rows={3} value={reason} onChange={e => setReason(e.target.value)} />}</Field></Modal>;
}

export function Bracket({ matches }: { matches: MatchView[] }) {
  const { tid, org } = useTid(); const rounds = [...new Set(matches.filter(m => m.roundName !== 'Third place').map(m => m.round))].sort((a, b) => a - b);
  return <div className="bracket" role="list" aria-label="Knockout bracket">{rounds.map(r => { const ms = matches.filter(m => m.round === r && m.roundName !== 'Third place'); return <div key={r} className="bcol" role="listitem"><span className="xs muted bold">{ms[0]?.roundName}</span>
    {ms.map(m => { const w = m.result?.verification === 'verified' ? m.result.winnerId : undefined; return <Link key={m.id} to={`/o/${org}/t/${tid}/matches/${m.id}`} className="bm" aria-label={`${m.code}: ${m.homeName} v ${m.awayName}`}>
      <div className={`s ${w && w === m.homeId ? 'w' : ''}`}><span>{m.homeName}</span><span className="mono">{m.result?.homeScore ?? ''}</span></div>
      <div className={`s ${w && w === m.awayId ? 'w' : ''}`}><span>{m.awayName}</span><span className="mono">{m.result?.awayScore ?? ''}</span></div>
      <div className="s xs muted"><span>{m.code}</span><Status s={m.result?.verification === 'submitted' ? 'submitted' : m.status} /></div></Link>; })}</div>; })}</div>;
}
