import { useState } from 'react';
import { useStats, useTournament, useAct, useMatches, useRegistrations } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { Banner, Btn, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Select, Textarea, Seg, human, download } from '@/ui/kit';

export function Stats() {
  const { tid } = useTid(); const t = useTournament(tid); const [key, setKey] = useState(''); const s = useStats(tid, key ? `?key=${key}` : ''); const [add, setAdd] = useState(false); const [view, setView] = useState<'players' | 'teams'>('players');
  if (s.isLoading) return <Loading />; if (s.error) return <ErrorState error={s.error} />;
  const d = s.data!;
  return <>
    <PageHead title="Player & team stats" sub="Built from match events. Unverified figures are labelled. Minors' stats stay private unless a guardian opts in. Profiles carry over to the academy module."
      actions={<><Btn icon="download" onClick={() => download(`${t.data?.slug}-stats.csv`, [['Player', 'Entry', 'Stat', 'Value', 'Matches', 'Verified'], ...d.leaderboard.map(r => [r.name, r.entry, key || 'all', r.value, r.matches, r.verified ? 'yes' : 'no'])])}>Export</Btn>{can([...ORGANIZER, 'referee']) && <Btn kind="primary" onClick={() => setAdd(true)}>Add stat manually</Btn>}</>} />
    <div className="row between" style={{ marginBottom: 14 }}><Seg label="View" value={view} onChange={setView} options={[['players', 'Players'], ['teams', 'Teams']]} />
      {view === 'players' && d.keys.length > 1 && <Select value={key} onChange={e => setKey(e.target.value)} options={[['', 'All stats'], ...d.keys.map(k => [k, human(k)] as [string, string])]} aria-label="Stat" />}</div>
    <Banner tone="info" icon="play">Camera and video analytics (distance, sprint speed, rally length) will feed these tables later. They aren't needed for launch.</Banner>
    <div style={{ marginTop: 14 }}>{view === 'players' ? (!d.leaderboard.length ? <Empty title="No stats yet" body="Stats appear as matches are scored." /> :
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Entry</th><th className="num">{key ? human(key) : 'Total'}</th><th className="num">Matches</th><th /></tr></thead><tbody>{d.leaderboard.map((r, i) => <tr key={r.playerId}><td className="mono">{i + 1}</td><td className="bold">{r.name}</td><td className="small">{r.entry}</td><td className="num bold">{r.value}</td><td className="num">{r.matches}</td><td>{!r.verified && <Chip tone="money">Unverified</Chip>}</td></tr>)}</tbody></table></div>)
      : <div className="table-wrap"><table><thead><tr><th>Team</th><th className="num">Played</th><th className="num">Won</th><th className="num">Scored</th><th className="num">Conceded</th><th /></tr></thead><tbody>{d.teams.map(r => <tr key={r.regId}><td className="bold">{r.name}</td><td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.scored}</td><td className="num">{r.conceded}</td><td>{r.unverified > 0 && <Chip tone="money">{r.unverified} unverified</Chip>}</td></tr>)}</tbody></table></div>}</div>
    {add && <AddStat tid={tid} keys={d.keys} onClose={() => setAdd(false)} />}
  </>;
}

function AddStat({ tid, keys, onClose }: { tid: string; keys: string[]; onClose: () => void }) {
  const ms = useMatches(tid); const regs = useRegistrations(tid, '?status=confirmed');
  const [f, setF] = useState({ matchId: '', regId: '', playerId: '', key: keys[0] ?? 'points', value: '1', reason: '' });
  const go = useAct((b: object) => api.post(`/tournaments/${tid}/stats`, b), 'Stat added and attributed to you');
  const done = (ms.data ?? []).filter(m => m.result), reg = regs.data?.find(r => r.id === f.regId);
  return <Modal title="Add a stat manually" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.matchId || !f.playerId || !f.reason.trim()} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Add</Btn></>}>
    <Field label="Match">{p => <Select {...p} value={f.matchId} onChange={e => setF({ ...f, matchId: e.target.value })} options={[['', 'Choose…'], ...done.map(m => [m.id, `${m.code} · ${m.homeName} v ${m.awayName}`] as [string, string])]} />}</Field>
    <div className="grid g2"><Field label="Entry">{p => <Select {...p} value={f.regId} onChange={e => setF({ ...f, regId: e.target.value, playerId: '' })} options={[['', 'Choose…'], ...(regs.data ?? []).map(r => [r.id, r.entryName] as [string, string])]} />}</Field>
      <Field label="Player">{p => <Select {...p} value={f.playerId} onChange={e => setF({ ...f, playerId: e.target.value })} options={[['', 'Choose…'], ...(reg?.players ?? []).map(x => [x.id, x.name] as [string, string])]} />}</Field>
      <Field label="Stat">{p => <Input {...p} value={f.key} onChange={e => setF({ ...f, key: e.target.value })} list="stat-keys" />}</Field><datalist id="stat-keys">{keys.map(k => <option key={k} value={k} />)}</datalist>
      <Field label="Value">{p => <Input {...p} type="number" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} />}</Field></div>
    <Field label="Reason" hint="e.g. Scorer missed a goal; confirmed from video">{p => <Textarea {...p} rows={2} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>
    <span className="small muted">Referee entries stay unverified until an organizer confirms them.</span></Modal>;
}
