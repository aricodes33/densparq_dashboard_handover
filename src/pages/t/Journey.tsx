// Organizer journey tracker: 7 stages from GET /tournaments/:id/journey, one action for the current stage.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { can, ORGANIZER } from '@/ui/Page';
import { Btn, Confirm, Icon } from '@/ui/kit';
import type { Stage } from '@/domain/journey';

export function Journey({ tid, org }: { tid: string; org: string }) {
  const j = useGet<Stage[]>(`/tournaments/${tid}/journey`); const [finish, setFinish] = useState(false); const [archive, setArchive] = useState(false);
  const fin = useAct(() => api.post(`/tournaments/${tid}/finish`), 'Tournament finished. Final results are published and entrants are messaged.');
  const arc = useAct(() => api.post(`/tournaments/${tid}/archive`), 'Archived. The tournament is now read-only.');
  if (!j.data) return null;
  const done = j.data.filter(s => s.status === 'done').length, cur = j.data.find(s => s.status === 'now'), organizer = can(ORGANIZER), base = `/o/${org}/t/${tid}`;
  return <section className="card col" aria-labelledby="jt">
    <div className="row between"><h2 id="jt">Tournament journey</h2><span className="small muted">{done} of {j.data.length} stages done</span></div>
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
      {j.data.map((s, i) => <li key={s.key} aria-current={s.status === 'now' ? 'step' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 14, border: `1.5px solid ${s.status === 'now' ? 'var(--text)' : 'var(--line)'}`, background: s.status === 'done' ? 'var(--lime-soft)' : 'var(--card)', opacity: s.status === 'later' ? 0.6 : 1 }}>
        <span className="row tight nowrap"><span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none', background: s.status === 'done' ? 'var(--lime)' : s.status === 'now' ? '#0A0A0A' : 'var(--soft)', color: s.status === 'now' ? '#fff' : '#0A0A0A' }}>{s.status === 'done' ? <Icon name="check" size={13} /> : i + 1}</span>
          <span className="small bold">{s.label}</span></span>
        {s.status === 'done' && s.key !== 'finish' && <Link to={`${base}/${s.cta.to}`} className="xs">Open</Link>}</li>)}
    </ol>
    {cur ? <div className="row between top" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><span className="col tight" style={{ gap: 2 }}><span className="xs muted bold" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Next</span><span className="bold">{cur.label}</span><span className="small muted">{cur.detail}</span></span>
      {organizer || !['setup', 'rules', 'publish', 'fixtures', 'finish'].includes(cur.key) ? (cur.key === 'finish' ? <Btn kind="primary" onClick={() => setFinish(true)}>Finish tournament</Btn> : <Link className="btn primary" to={`${base}/${cur.cta.to}`}>{cur.cta.label}</Link>) : <span className="small muted">An organizer does this step.</span>}</div>
      : <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><span className="small">{j.data.at(-1)!.detail}</span>{organizer && !j.data.at(-1)!.detail.includes('archived') && <Btn onClick={() => setArchive(true)} icon="archive">Archive</Btn>}</div>}
    {finish && <Confirm title="Finish this tournament?" body="This publishes the final results and winners, and messages every confirmed entrant. Results can still be corrected later; corrections are logged." confirm="Finish tournament" busy={fin.isPending} onClose={() => setFinish(false)} onConfirm={() => fin.mutate(undefined, { onSettled: () => setFinish(false) })} />}
    {archive && <Confirm title="Archive this tournament?" body="It becomes read-only and leaves the public list. Results and reports stay available." confirm="Archive" danger busy={arc.isPending} onClose={() => setArchive(false)} onConfirm={() => arc.mutate(undefined, { onSettled: () => setArchive(false) })} />}
  </section>;
}
