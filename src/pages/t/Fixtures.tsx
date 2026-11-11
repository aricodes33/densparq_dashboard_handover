// Fixtures & scheduling: generate -> review on a court/time calendar (drag to move) -> fix clashes -> publish (notifies + writes venue holds).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTournament, useMatches, useClashes, useHolds, useMembers, useAct, useVenues } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { Banner, Btn, Chip, Confirm, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Status, fmtDate, fmtTime, fmtDT, Icon, Textarea } from '@/ui/kit';
import type { MatchView } from '@/mock/handlers';
import type { Clash } from '@/domain/types';
import { Bracket } from './Standings';

const ROW = 22, STEP = 15;
const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);
const istMin = (iso: string) => { const d = new Date(Date.parse(iso) + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const isoAt = (day: string, min: number) => new Date(`${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+05:30`).toISOString();

export function Fixtures() {
  const { tid, org } = useTid(); const t = useTournament(tid); const admin = can(ORGANIZER);
  const [cat, setCat] = useState(''); const [view, setView] = useState<'calendar' | 'list' | 'bracket' | 'holds'>('calendar');
  const ms = useMatches(tid); const clashes = useClashes(tid); const venues = useVenues(org);
  const busy = useQuery({ queryKey: ['t', tid, 'avail'], queryFn: () => api.get<{ courtId: string; startAt: string; endAt: string; label: string }[]>(`/tournaments/${tid}/availability`) });
  const [gen, setGen] = useState(false); const [pub, setPub] = useState(false); const [edit, setEdit] = useState<MatchView | null>(null);
  const catId = cat || t.data?.categories[0]?.id || '';
  const generate = useAct(() => api.post<{ matches: MatchView[]; clashes: Clash[] }>(`/tournaments/${tid}/fixtures/generate`, { categoryId: catId }), r => `Generated ${r.matches.length} matches${r.clashes.length ? ` · ${r.clashes.length} clashes to review` : ', no clashes'}`);
  const advance = useAct(() => api.post(`/tournaments/${tid}/fixtures/advance`, { categoryId: catId }), 'Knockout slots filled from verified standings');
  if (t.isLoading || ms.isLoading) return <Loading rows={8} />; if (t.error) return <ErrorState error={t.error} />;
  const all = ms.data ?? [], mine = all.filter(m => m.categoryId === catId), unpublished = all.filter(m => !m.published || m.fixturesVersion > 1).length;
  const blocking = (clashes.data ?? []).filter(c => ['court_overlap', 'team_overlap', 'venue_busy'].includes(c.kind));
  const courts = venues.data?.flatMap(v => v.courts).filter(c => t.data!.courtIds.includes(c.id)) ?? [];
  const started = mine.some(m => m.status !== 'scheduled' || m.published);
  return <>
    <PageHead title="Fixtures & schedule" sub="Generate draws and brackets from confirmed entries, then check courts and times. Nothing is visible to players until you publish."
      actions={admin && <><Btn icon="cal" onClick={() => setGen(true)} disabled={started && mine.length > 0}>{mine.length ? 'Regenerate' : 'Generate fixtures'}</Btn><Btn kind="primary" icon="send" onClick={() => setPub(true)} disabled={!unpublished}>Publish{unpublished ? ` (${unpublished})` : ''}</Btn></>} />
    <div className="row between" style={{ marginBottom: 14 }}>
      <div className="row tight"><label><span className="sr">Category</span><Select value={catId} onChange={e => setCat(e.target.value)} options={t.data!.categories.map(c => [c.id, c.name])} /></label>
        {mine.some(m => m.stage === 'knockout') && admin && <Btn size="sm" onClick={() => advance.mutate(undefined)} loading={advance.isPending}>Fill knockout from standings</Btn>}</div>
      <Seg label="View" value={view} onChange={setView} options={[['calendar', 'Court calendar'], ['list', 'List'], ['bracket', 'Bracket'], ...(t.data!.schedule.createVenueHolds ? [['holds', 'Venue holds'] as ['holds', string]] : [])]} />
    </div>
    {(clashes.data ?? []).length > 0 && <Banner tone={blocking.length ? 'danger' : 'money'} action={<details><summary className="btn sm">See all</summary><ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{clashes.data!.map((c, i) => <li key={i}>{c.message}</li>)}</ul></details>}>
      <strong>{blocking.length ? `${blocking.length} clash${blocking.length > 1 ? 'es' : ''} block publishing.` : 'Warnings only.'}</strong> {clashes.data!.length - blocking.length > 0 && `${clashes.data!.length - blocking.length} warnings (rest gaps, unscheduled, outside hours).`} Drag matches on the calendar or edit them to fix.</Banner>}
    {!mine.length ? <Empty icon="cal" title="No fixtures yet" body="Generate fixtures once entries are confirmed. You can regenerate as many times as you like until you publish." action={admin && <Btn kind="primary" onClick={() => setGen(true)}>Generate fixtures</Btn>} /> : <div style={{ marginTop: 14 }}>
      {view === 'calendar' && <Calendar t={t.data!} matches={all} catId={catId} courts={courts} busy={busy.data ?? []} clashes={clashes.data ?? []} onEdit={setEdit} />}
      {view === 'list' && <div className="table-wrap"><table><thead><tr><th>Match</th><th>Round</th><th>When</th><th>Court</th><th>Teams</th><th>Referee</th><th>Status</th><th /></tr></thead><tbody>
        {mine.map(m => { const cl = (clashes.data ?? []).filter(c => c.matchId === m.id || c.otherId === m.id); return <tr key={m.id}><td className="bold mono">{m.code}</td><td className="small">{m.group ? `Group ${m.group} · ` : ''}{m.roundName}</td><td className="small mono">{fmtDT(m.startAt)}</td><td className="small">{m.courtName ?? '—'}</td>
          <td>{m.homeName} <span className="muted">v</span> {m.awayName}</td><td className="small">{m.referees.join(', ') || <span className="muted">Unassigned</span>}</td><td><div className="row tight"><Status s={m.status} />{!m.published && <Chip>Draft</Chip>}{m.published && m.fixturesVersion > 1 && <Chip tone="money">Revised</Chip>}{cl.length > 0 && <Chip tone="danger">{cl.length} clash</Chip>}</div></td>
          <td>{admin && <Btn size="sm" onClick={() => setEdit(m)}>Edit</Btn>}</td></tr>; })}</tbody></table></div>}
      {view === 'bracket' && (mine.some(m => m.stage === 'knockout') ? <Bracket matches={mine.filter(m => m.stage === 'knockout')} /> : <Empty title="No knockout stage" body="This category's format has no bracket." />)}
      {view === 'holds' && <Holds tid={tid} />}
    </div>}
    {gen && <Confirm title={mine.length ? 'Regenerate fixtures?' : 'Generate fixtures?'} body={<>Uses the <strong>{t.data!.categories.find(c => c.id === catId)?.format.type.replace('_', ' + ')}</strong> format and all confirmed entries. {mine.length ? 'This replaces the current unpublished draft.' : ''} Matches are placed on the earliest free court that respects buffers, rest gaps, play hours{t.data!.schedule.createVenueHolds ? ' and Densparq bookings and holds' : ''}.</>} confirm="Generate" busy={generate.isPending} onClose={() => setGen(false)} onConfirm={() => generate.mutate(undefined, { onSuccess: () => setGen(false) })} />}
    {pub && <PublishDialog tid={tid} count={unpublished} blocking={blocking.length} holds={t.data!.schedule.createVenueHolds} revised={all.some(m => m.published && m.fixturesVersion > 1)} onClose={() => setPub(false)} />}
    {edit && <EditMatch m={edit} courts={courts} org={org} onClose={() => setEdit(null)} />}
  </>;
}

function Calendar({ t, matches, catId, courts, busy, clashes, onEdit }: { t: { startDate: string; endDate: string; schedule: { dayStart: string; dayEnd: string } }; matches: MatchView[]; catId: string; courts: { id: string; name: string }[]; busy: { courtId: string; startAt: string; endAt: string; label: string }[]; clashes: Clash[]; onEdit: (m: MatchView) => void }) {
  const days = useMemo(() => { const out: string[] = []; for (let d = new Date(`${t.startDate}T12:00:00Z`); d <= new Date(`${t.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; }, [t.startDate, t.endDate]);
  const [day, setDay] = useState(days[0]); const [over, setOver] = useState<string | null>(null);
  const move = useAct((b: { id: string; courtId: string; startAt: string }) => api.patch<{ clashes: Clash[] }>(`/matches/${b.id}`, { courtId: b.courtId, startAt: b.startAt }), r => r.clashes.length ? `Moved, but: ${r.clashes[0].message}` : 'Moved. No clashes.');
  const s0 = toMin(t.schedule.dayStart), s1 = toMin(t.schedule.dayEnd), rows = (s1 - s0) / STEP;
  const onDay = matches.filter(m => m.startAt && istDay(m.startAt) === day), bz = busy.filter(b => istDay(b.startAt) === day);
  const clashIds = new Set(clashes.filter(c => c.kind !== 'rest_gap' && c.kind !== 'unscheduled').flatMap(c => [c.matchId, c.otherId]));
  const unsched = matches.filter(m => m.categoryId === catId && !m.startAt && m.status !== 'walkover');
  return <div className="col">
    {days.length > 1 && <Seg label="Day" value={day} onChange={setDay} options={days.map(d => [d, fmtDate(d)])} />}
    {unsched.length > 0 && <Banner tone="money">{unsched.length} match{unsched.length > 1 ? 'es' : ''} couldn't fit inside play hours: {unsched.map(m => m.code).join(', ')}. Add courts, extend hours or shorten matches.</Banner>}
    <p className="small muted" style={{ margin: 0 }}>Drag a match to another court or time. Or use its Edit button (keyboard friendly). Hatched blocks are booked at the venue. Other categories are greyed out.</p>
    <div className="cal" style={{ gridTemplateColumns: `60px repeat(${courts.length}, minmax(150px, 1fr))`, gridTemplateRows: `auto repeat(${rows}, ${ROW}px)` }} role="grid" aria-label={`Court calendar for ${fmtDate(day)}`}>
      <div className="cal-h" style={{ position: 'sticky', left: 0, zIndex: 3 }} />
      {courts.map(c => <div key={c.id} className="cal-h" role="columnheader">{c.name}</div>)}
      {Array.from({ length: rows }, (_, r) => { const min = s0 + r * STEP; return [
        <div key={`t${r}`} className="cal-t" style={{ gridRow: r + 2, gridColumn: 1 }}>{min % 60 === 0 ? `${((Math.floor(min / 60) + 11) % 12) + 1} ${min < 720 ? 'am' : 'pm'}` : ''}</div>,
        ...courts.map((c, ci) => { const key = `${c.id}|${min}`; return <div key={key} className={`cal-cell ${over === key ? 'drop' : ''}`} style={{ gridRow: r + 2, gridColumn: ci + 2, borderTopStyle: min % 60 ? 'dotted' : 'solid' }}
          onDragOver={e => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver(null)} onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move.mutate({ id, courtId: c.id, startAt: isoAt(day, min) }); }} />; }),
      ]; })}
      {bz.map((b, i) => { const ci = courts.findIndex(c => c.id === b.courtId); const st = Math.max(s0, istMin(b.startAt)), en = Math.min(s1, istMin(b.endAt)); if (ci < 0 || en <= st) return null;
        return <div key={`b${i}`} className="slotm busy" style={{ gridColumn: ci + 2, gridRow: `${(st - s0) / STEP + 2} / span ${(en - st) / STEP}`, position: 'relative', margin: 2, top: 0, left: 0, right: 0 }}>{b.label}</div>; })}
      {onDay.map(m => { const ci = courts.findIndex(c => c.id === m.courtId); if (ci < 0) return null; const st = istMin(m.startAt!), span = Math.max(1, Math.round(m.durationMin / STEP)), other = m.categoryId !== catId;
        const cls = ['completed', 'walkover'].includes(m.status) ? 'done' : m.status === 'live' ? 'live' : clashIds.has(m.id) ? 'clash' : '';
        return <div key={m.id} draggable={!other && m.status === 'scheduled'} onDragStart={e => e.dataTransfer.setData('text/plain', m.id)} className={`slotm ${cls}`} style={{ gridColumn: ci + 2, gridRow: `${(st - s0) / STEP + 2} / span ${span}`, position: 'relative', margin: 2, top: 0, left: 0, right: 0, opacity: other ? .45 : 1 }}>
          <div className="row between nowrap"><span className="bold mono">{m.code}</span>{!other && m.status === 'scheduled' && <button type="button" onClick={() => onEdit(m)} aria-label={`Edit ${m.code}`} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}>Edit</button>}</div>
          <div>{fmtTime(m.startAt)} · {m.homeName} v {m.awayName}</div></div>; })}
    </div>
  </div>;
}

function EditMatch({ m, courts, org, onClose }: { m: MatchView; courts: { id: string; name: string }[]; org: string; onClose: () => void }) {
  const members = useMembers(org);
  const [f, setF] = useState({ courtId: m.courtId ?? courts[0]?.id ?? '', startAt: m.startAt ? new Date(Date.parse(m.startAt) + 330 * 60000).toISOString().slice(0, 16) : '', referee: m.refereeIds[0] ?? '', postpone: false, reason: '' });
  const [res, setRes] = useState<Clash[] | null>(null);
  const save = useAct((b: object) => api.patch<{ clashes: Clash[] }>(`/matches/${m.id}`, b));
  const go = () => save.mutate({ courtId: f.courtId, startAt: f.startAt ? new Date(`${f.startAt}:00+05:30`).toISOString() : undefined, refereeIds: f.referee ? [f.referee] : [], ...(f.postpone ? { status: 'postponed', reason: f.reason } : {}) }, { onSuccess: r => r.clashes.length ? setRes(r.clashes) : onClose() });
  return <Modal title={`Edit ${m.code}`} onClose={onClose} footer={<><Btn onClick={onClose}>{res ? 'Close' : 'Cancel'}</Btn><Btn kind="primary" onClick={go} loading={save.isPending}>Save</Btn></>}>
    <p className="muted small" style={{ margin: 0 }}>{m.homeName} v {m.awayName} · {m.roundName}{m.published ? '. This match is published, so entrants are told about the change when you publish the revision.' : ''}</p>
    <div className="grid g2"><Field label="Court">{p => <Select {...p} value={f.courtId} onChange={e => setF({ ...f, courtId: e.target.value })} options={courts.map(c => [c.id, c.name])} />}</Field>
      <Field label="Start">{p => <Input {...p} type="datetime-local" step={900} value={f.startAt} onChange={e => setF({ ...f, startAt: e.target.value })} />}</Field></div>
    <Field label="Referee">{p => <Select {...p} value={f.referee} onChange={e => setF({ ...f, referee: e.target.value })} options={[['', 'Unassigned'], ...(members.data ?? []).filter(x => x.role === 'referee' || x.role === 'org_admin').map(x => [x.userId, x.user?.name ?? x.userId] as [string, string])]} />}</Field>
    <label className="check"><input type="checkbox" checked={f.postpone} onChange={e => setF({ ...f, postpone: e.target.checked })} /><span className="bold">Postpone this match</span></label>
    {f.postpone && <Field label="Reason (sent to both teams)">{p => <Textarea {...p} rows={2} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />}</Field>}
    {res && <Banner tone="danger">Saved, with clashes: {res.map(c => c.message).join('; ')}</Banner>}
  </Modal>;
}

function PublishDialog({ tid, count, blocking, holds, revised, onClose }: { tid: string; count: number; blocking: number; holds: boolean; revised: boolean; onClose: () => void }) {
  const [notify, setNotify] = useState(true);
  const pub = useAct((b: object) => api.post<{ published: number; notified: number }>(`/tournaments/${tid}/fixtures/publish`, b), r => `Published ${r.published} matches · ${r.notified} entries notified${holds ? ' · venue holds updated' : ''}`);
  return <Modal title={revised ? 'Publish revised fixtures' : 'Publish fixtures'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={blocking > 0} loading={pub.isPending} onClick={() => pub.mutate({ notify }, { onSuccess: onClose })}>Publish</Btn></>}>
    {blocking > 0 ? <Banner tone="danger">Fix {blocking} clash{blocking > 1 ? 'es' : ''} first. Two matches can't share a court or a team at the same time.</Banner> : <>
      <p style={{ margin: 0 }}>{count} match{count === 1 ? '' : 'es'} will appear on the public page.</p>
      <label className="check"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /><span><span className="bold">{revised ? 'Tell only the affected teams about their new times' : 'Tell every entrant'}</span><span className="small muted" style={{ display: 'block' }}>In-app notification plus WhatsApp for people who opted in.</span></span></label>
      {holds && <Banner tone="info" icon="home">Event holds go on the Densparq venue calendar. The desk gets a "Block on Playo" task for each new hold, and an "Unblock" task for each released one.</Banner>}</>}
  </Modal>;
}

function Holds({ tid }: { tid: string }) {
  const h = useHolds(tid);
  if (h.isLoading) return <Loading />;
  return !h.data?.length ? <Empty icon="home" title="No venue holds yet" body="Holds are created when you publish fixtures." /> : <div className="table-wrap"><table><thead><tr><th>Court</th><th>From</th><th>To</th><th>Playo</th><th>Note</th></tr></thead><tbody>
    {h.data.map(x => <tr key={x.id}><td className="bold">{x.courtId.toUpperCase()}</td><td className="mono small">{fmtDT(x.startAt)}</td><td className="mono small">{fmtTime(x.endAt)}</td><td><Status s={x.playoStatus} /></td><td className="small muted">{x.note}</td></tr>)}
  </tbody></table><p className="small muted" style={{ padding: '0 14px' }}><Icon name="alert" size={14} /> The venue desk marks these on the operator dashboard after blocking the slots in the Playo Partner app (Playo has no API).</p></div>;
}
