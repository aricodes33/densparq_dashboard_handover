// Player stats: per-athlete assessment timeline + progress charts, match record (manual + tournaments), cohort rank, batch rankings, metric templates.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Banner, Btn, Check, Chip, Empty, ErrorState, Field, Input, Loading, Modal, Seg, Select, Textarea, fmtDate, human } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { Assessment, AthleteMatch, MetricTemplate, Progress, Batch, Metric } from '@/domain/academy';
import type { Sport } from '@/domain/types';
import { todayIST } from '@/pages/venue/shared';
import { useAcademy, Trend, fmtVal } from './shared';

export type StatsView = { athlete: { id: string; name: string; level: string; age: number; sports: Sport[]; statsVisibility: string }; sports: { sport: Sport; template?: MetricTemplate; assessments: Assessment[]; progress: Progress[]; rank: { rank: number; of: number; percentile: number } | null; cohortSize: number; cohortRule: string }[];
  matches: AthleteMatch[]; record: { played: number; won: number; lost: number }; tournament: { stats: { key: string; value: number }[]; matches: { code: string; date?: string; result: string; verified: boolean }[] } | null };

export function PlayerStats() {
  const { org, academy } = useAcademy(); const [sp, setSp] = useSearchParams(); const [tab, setTab] = useState<'athlete' | 'rankings' | 'templates'>('athlete');
  const athletes = useGet<{ id: string; name: string; batches: string[] }[]>(`/orgs/${org}/athletes?status=active`); const id = sp.get('athlete') ?? athletes.data?.[0]?.id;
  return <>
    <PageHead crumbs={false} title="Player stats" sub="Dated assessments with defined test methods, match records and progress over time. Compared only within the same sport, age band and level." />
    <Seg label="Section" value={tab} onChange={setTab} options={[['athlete', 'Athlete'], ['rankings', 'Batch rankings'], ['templates', 'Metrics & methods']]} />
    <div style={{ marginTop: 16 }}>
      {tab === 'athlete' && <><label style={{ display: 'block', maxWidth: 360, marginBottom: 14 }}><span className="label">Athlete</span><Select value={id ?? ''} onChange={e => setSp({ athlete: e.target.value })} options={(athletes.data ?? []).map(a => [a.id, `${a.name} · ${a.batches.join(', ')}`])} /></label>
        {id && <AthleteStats id={id} editable />}</>}
      {tab === 'rankings' && academy && <Rankings academyId={academy.id} />}
      {tab === 'templates' && <Templates org={org} />}
    </div>
  </>;
}

/** Shared with the parent/athlete report (editable=false). */
export function AthleteStats({ id, editable }: { id: string; editable?: boolean }) {
  const s = useGet<StatsView>(`/athletes/${id}/stats`); const [add, setAdd] = useState<Sport | null>(null); const [match, setMatch] = useState(false);
  if (!s.data) return s.error ? <ErrorState error={s.error} /> : <Loading />;
  const x = s.data, canEdit = editable && can(['org_admin', 'branch_manager', 'coach']);
  return <div className="col loose">
    <div className="grid g4"><div className="card stat"><span className="l">Matches</span><span className="v">{x.record.played}</span><span className="small muted">{x.record.won} W · {x.record.lost} L</span></div>
      {x.sports.map(sp => <div key={sp.sport} className="card stat"><span className="l">{SPORT_LABEL[sp.sport]} assessments</span><span className="v">{sp.assessments.length}</span><span className="small muted">{sp.assessments[0] ? `Last ${fmtDate(sp.assessments[0].date)}` : 'None yet'}</span></div>)}
      {x.sports.map(sp => sp.rank && <div key={`r${sp.sport}`} className="card stat"><span className="l">Cohort position</span><span className="v">{sp.rank.rank}/{sp.rank.of}</span><span className="xs muted">{sp.cohortRule}</span></div>)}</div>
    {x.sports.map(sp => <section key={sp.sport} className="card col">
      <div className="row between"><h2>{SPORT_LABEL[sp.sport]} progress</h2>{canEdit && sp.template && <Btn kind="primary" size="sm" onClick={() => setAdd(sp.sport)}>Record assessment</Btn>}</div>
      {!sp.progress.length ? <Empty title="No template for this sport" /> : <div className="grid g3">{sp.progress.map(p => <div key={p.key} className="card flat col tight">
        <div className="row between"><span className="bold small">{p.label}</span>{p.improved != null && <Chip tone={p.improved ? 'good' : 'money'}>{p.change! > 0 ? '+' : ''}{Math.round(p.change! * 10) / 10}{p.unit === '%' ? ' pts' : ''}</Chip>}</div>
        <Trend p={p} /><span className="xs muted">{fmtVal(p.first, p.unit)} → {fmtVal(p.last, p.unit)} · {sp.template?.metrics.find(m => m.key === p.key)?.method}</span></div>)}</div>}
      <details><summary className="small bold" style={{ cursor: 'pointer' }}>Assessment records ({sp.assessments.length})</summary><div className="table-wrap" style={{ marginTop: 8 }}><table><thead><tr><th>Date</th><th>Type</th>{sp.template?.metrics.map(m => <th key={m.key} className="num">{m.label}</th>)}<th>By</th></tr></thead><tbody>
        {sp.assessments.map(a => <tr key={a.id}><td className="small mono">{fmtDate(a.date)}</td><td><Chip>{human(a.kind)}</Chip>{a.history.length > 0 && <Chip tone="info">Corrected</Chip>}</td>{sp.template?.metrics.map(m => <td key={m.key} className="num small">{a.values[m.key] ? <>{fmtVal(a.values[m.key].value, m.unit)}{!a.values[m.key].measured && <span title="Estimated (rubric)"> ~</span>}</> : '—'}</td>)}<td className="small">{a.byName}</td></tr>)}</tbody></table></div><span className="xs muted">~ = estimated (coach rubric); other values are measured with the stated test.</span></details>
    </section>)}
    <section className="card col"><div className="row between"><h2>Matches & competitions</h2>{canEdit && <Btn size="sm" onClick={() => setMatch(true)}>Add match</Btn>}</div>
      {!x.matches.length && !x.tournament?.matches.length ? <span className="muted small">No matches recorded.</span> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Event</th><th>Opponent</th><th>Result</th><th>Source</th></tr></thead><tbody>
        {x.tournament?.matches.map(m => <tr key={m.code}><td className="small mono">{fmtDate(m.date)}</td><td className="small">Densparq tournament {m.code}</td><td>—</td><td className="small">{m.result}</td><td><Chip tone={m.verified ? 'good' : 'money'}>{m.verified ? 'Tournament · verified' : 'Tournament · unverified'}</Chip></td></tr>)}
        {x.matches.map(m => <tr key={m.id}><td className="small mono">{fmtDate(m.date)}</td><td className="small">{m.event}</td><td className="small">{m.opponent}</td><td><Chip tone={m.result === 'W' ? 'good' : m.result === 'L' ? 'danger' : 'neutral'}>{m.result}</Chip> <span className="small mono">{m.score}</span></td><td><Chip>Manual</Chip></td></tr>)}</tbody></table></div>}</section>
    <Banner tone="info" icon="play">Video and camera analytics will add measured values later, with consent. Manual entry for now.</Banner>
    {add && <AssessmentForm athleteId={id} sport={add} template={x.sports.find(z => z.sport === add)!.template!} onClose={() => setAdd(null)} />}
    {match && <MatchForm athleteId={id} onClose={() => setMatch(false)} />}
  </div>;
}

function AssessmentForm({ athleteId, sport, template, onClose }: { athleteId: string; sport: Sport; template: MetricTemplate; onClose: () => void }) {
  const [date, setDate] = useState(todayIST()); const [notes, setNotes] = useState(''); const [v, setV] = useState<Record<string, { value: string; measured: boolean }>>(Object.fromEntries(template.metrics.map(m => [m.key, { value: '', measured: m.unit !== 'score' }])));
  const go = useAct((b: object) => api.post(`/athletes/${athleteId}/assessments`, b), 'Assessment saved. The family is notified the report is ready.');
  return <Modal title={`${SPORT_LABEL[sport]} assessment · template v${template.version}`} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ sport, date, notes, values: v }, { onSuccess: onClose })}>Save</Btn></>}>
    <Field label="Date">{x => <Input {...x} type="date" max={todayIST()} value={date} onChange={e => setDate(e.target.value)} />}</Field>
    {template.metrics.map(m => <div key={m.key} className="row nowrap" style={{ alignItems: 'flex-end' }}>
      <Field label={`${m.label} (${m.unit === 'score' ? '1–5' : m.unit})`} hint={`${m.method} · validated by ${human(m.validator)}`}>{x => <Input {...x} type="number" step="0.1" value={v[m.key].value} onChange={e => setV({ ...v, [m.key]: { ...v[m.key], value: e.target.value } })} />}</Field>
      {m.unit !== 'score' && <Check label="Measured" checked={v[m.key].measured} onChange={e => setV({ ...v, [m.key]: { ...v[m.key], measured: e.target.checked } })} />}</div>)}
    <Field label="Coach notes">{x => <Textarea {...x} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
    <span className="xs muted">Leave a metric blank to skip it. Unticked "Measured" marks the value as estimated in every chart and report.</span></Modal>;
}
function MatchForm({ athleteId, onClose }: { athleteId: string; onClose: () => void }) {
  const [f, setF] = useState({ date: todayIST(), event: '', opponent: '', result: 'W', score: '' }); const go = useAct((b: object) => api.post(`/athletes/${athleteId}/matches`, b), 'Match added');
  return <Modal title="Add match" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.event} loading={go.isPending} onClick={() => go.mutate(f, { onSuccess: onClose })}>Add</Btn></>}>
    <div className="grid g2"><Field label="Date">{x => <Input {...x} type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />}</Field><Field label="Event">{x => <Input {...x} value={f.event} onChange={e => setF({ ...f, event: e.target.value })} />}</Field>
      <Field label="Opponent">{x => <Input {...x} value={f.opponent} onChange={e => setF({ ...f, opponent: e.target.value })} />}</Field><Field label="Result">{x => <Select {...x} value={f.result} onChange={e => setF({ ...f, result: e.target.value })} options={[['W', 'Won'], ['L', 'Lost'], ['D', 'Draw']]} />}</Field>
      <Field label="Score">{x => <Input {...x} value={f.score} onChange={e => setF({ ...f, score: e.target.value })} />}</Field></div></Modal>;
}
function Rankings({ academyId }: { academyId: string }) {
  const bs = useGet<Batch[]>(`/academies/${academyId}/batches`); const [bid, setBid] = useState(''); const id = bid || bs.data?.[0]?.id;
  const r = useGet<{ rule: string; rows: { id: string; name: string; rank: number; of: number; percentile: number }[] }>(id ? `/batches/${id}/rankings` : null);
  return <div className="col"><label style={{ maxWidth: 320 }}><span className="label">Batch</span><Select value={id ?? ''} onChange={e => setBid(e.target.value)} options={(bs.data ?? []).map(b => [b.id, b.name])} /></label>
    {r.data && <><Banner tone="info" icon="rules">{r.data.rule}</Banner>{!r.data.rows.length ? <Empty title="Not enough assessed athletes" body="Rankings show once 5 or more athletes in the batch have an assessment." /> :
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Athlete</th><th className="num">Percentile</th></tr></thead><tbody>{r.data.rows.map(x => <tr key={x.id}><td className="mono">{x.rank}</td><td className="bold">{x.name}</td><td className="num">{x.percentile}</td></tr>)}</tbody></table></div>}</>}</div>;
}
function Templates({ org }: { org: string }) {
  const t = useGet<MetricTemplate[]>(`/orgs/${org}/metric-templates`); const [edit, setEdit] = useState<MetricTemplate | null>(null);
  return <div className="col"><Banner tone="info" icon="rules">Starting metric sets come from coaching research (docs/research/academy-assessment-and-kpis.md). They are internal benchmarks, not federation standards, so edit them to match your coaches' tests. Editing creates a new version; old assessments keep theirs.</Banner>
    {t.data?.map(x => <section key={x.id} className="card col"><div className="row between"><h3>{SPORT_LABEL[x.sport]} · v{x.version}</h3>{can(['org_admin', 'branch_manager']) && <Btn size="sm" onClick={() => setEdit(x)}>Edit</Btn>}</div>
      <div className="table-wrap"><table><thead><tr><th>Metric</th><th>Unit</th><th>Test method</th><th>Better when</th><th>Validated by</th></tr></thead><tbody>{x.metrics.map(m => <tr key={m.key}><td className="bold">{m.label}</td><td>{m.unit}</td><td className="small">{m.method}</td><td>{m.higherIsBetter ? 'Higher' : 'Lower'}</td><td className="small">{human(m.validator)}</td></tr>)}</tbody></table></div></section>)}
    {edit && <TemplateEditor t={edit} onClose={() => setEdit(null)} />}</div>;
}
function TemplateEditor({ t, onClose }: { t: MetricTemplate; onClose: () => void }) {
  const [ms, setMs] = useState<Metric[]>(t.metrics); const go = useAct((b: object) => api.put(`/metric-templates/${t.id}`, b), `Saved as v${t.version + 1}`);
  const up = (i: number, p: Partial<Metric>) => setMs(ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return <Modal title={`${SPORT_LABEL[t.sport]} metrics`} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={go.isPending} onClick={() => go.mutate({ metrics: ms }, { onSuccess: onClose })}>Save new version</Btn></>}>
    {ms.map((m, i) => <div key={i} className="row nowrap" style={{ alignItems: 'flex-end' }}>
      <Field label="Label">{x => <Input {...x} value={m.label} onChange={e => up(i, { label: e.target.value, key: m.key || e.target.value.toLowerCase().replace(/\W+/g, '_') })} />}</Field>
      <Field label="Unit">{x => <Select {...x} value={m.unit} onChange={e => up(i, { unit: e.target.value as Metric['unit'] })} options={[['%', '%'], ['count', 'count'], ['sec', 'seconds'], ['m', 'metres'], ['kmh', 'km/h'], ['score', 'rubric 1–5']]} />}</Field>
      <Field label="Test method">{x => <Input {...x} value={m.method} onChange={e => up(i, { method: e.target.value })} />}</Field>
      <Field label="Better">{x => <Select {...x} value={m.higherIsBetter ? 'h' : 'l'} onChange={e => up(i, { higherIsBetter: e.target.value === 'h' })} options={[['h', 'Higher'], ['l', 'Lower']]} />}</Field>
      <Btn kind="ghost" icon="x" aria-label="Remove metric" onClick={() => setMs(ms.filter((_, j) => j !== i))} /></div>)}
    <Btn size="sm" icon="plus" onClick={() => setMs([...ms, { key: '', label: '', unit: 'count', method: '', higherIsBetter: true, validator: 'coach' }])}>Add metric</Btn></Modal>;
}
