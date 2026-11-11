import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useTournaments, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can, ORGANIZER } from '@/ui/Page';
import { Btn, Chip, Empty, ErrorState, Loading, Status, Seg, Bar, fmtDate, Input, Confirm } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { TView } from '@/api/hooks';
import MagicBento from '@/ui/MagicBento';

export function TournamentList() {
  const { org = 'densparq' } = useParams(); const nav = useNavigate();
  const [filter, setFilter] = useState<'active' | 'draft' | 'archived'>('active'); const [q, setQ] = useState('');
  const list = useTournaments(org, filter === 'archived' ? 'archived' : undefined);
  const [arch, setArch] = useState<TView | null>(null);
  const dup = useAct((id: string) => api.post<TView>(`/tournaments/${id}/duplicate`), 'Duplicated as a draft. Rules were copied, not shared.');
  const archive = useAct((id: string) => api.post(`/tournaments/${id}/archive`), 'Archived. It is now read-only.');
  const rows = (list.data ?? []).filter(t => (filter === 'active' ? t.status === 'published' || t.status === 'unpublished' : t.status === filter) && t.name.toLowerCase().includes(q.toLowerCase()));
  return <>
    <PageHead crumbs={false} title="Tournaments" sub="Every tournament your organization runs. Each one has its own rules, registrations, fixtures and results."
      actions={can(ORGANIZER) && <Btn kind="lime" icon="plus" onClick={() => nav(`/o/${org}/new`)}>New tournament</Btn>} />
    <div className="row between" style={{ marginBottom: 16 }}>
      <Seg label="Filter" value={filter} onChange={setFilter} options={[['active', 'Live & upcoming'], ['draft', 'Drafts'], ['archived', 'Archived']]} />
      <label className="row tight" style={{ minWidth: 240 }}><span className="sr">Search tournaments</span><Input placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} /></label>
    </div>
    {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} retry={list.refetch} /> : !rows.length ? (
      <Empty title={filter === 'draft' ? 'No drafts' : 'Nothing here yet'} body="Create a tournament to set up categories, rules, registration and fixtures." action={can(ORGANIZER) && <Btn kind="primary" icon="plus" onClick={() => nav(`/o/${org}/new`)}>New tournament</Btn>} />
    ) : <MagicBento columns={4} rowHeight={200} gap={12} radius={20} enableBorderGlow enableSpotlight spotlightRadius={300} clickEffect>{rows.map(t => (
      <article key={t.id} className="card col" style={{ gap: 14 }}>
        <div className="row between top nowrap"><div className="col tight grow">
          <div className="row tight"><Chip tone="ink">{SPORT_LABEL[t.sport]}</Chip><Status s={t.phase === 'setup' ? t.status : t.phase} />{t.counts?.live ? <Chip tone="good" live>{t.counts.live} live</Chip> : null}</div>
          <h2 style={{ fontSize: 20 }}><Link to={`/o/${org}/t/${t.id}`} style={{ textDecoration: 'none' }}>{t.name}</Link></h2>
          <span className="small muted">{t.startDate ? `${fmtDate(t.startDate)}${t.endDate !== t.startDate ? ` – ${fmtDate(t.endDate)}` : ''}` : 'Dates not set'} · {t.categories.length} categor{t.categories.length === 1 ? 'y' : 'ies'}</span>
        </div></div>
        {t.counts && <div className="col tight">
          <div className="col tight"><span className="xs muted">Entries {t.counts.entries}/{t.counts.capacity}</span><Bar pct={t.counts.capacity ? t.counts.entries / t.counts.capacity * 100 : 0} label="Entries filled" /></div>
          <div className="col tight"><span className="xs muted">Matches {t.counts.done}/{t.counts.matches}</span><Bar pct={t.counts.matches ? t.counts.done / t.counts.matches * 100 : 0} label="Matches played" /></div>
        </div>}
        <div className="row tight">
          <Link className="btn sm primary" to={`/o/${org}/t/${t.id}`}>Open</Link>
          {can(ORGANIZER) && t.status !== 'archived' && <><Btn size="sm" icon="copy" loading={dup.isPending && dup.variables === t.id} onClick={() => dup.mutate(t.id, { onSuccess: n => nav(`/o/${org}/t/${n.id}/setup`) })}>Duplicate</Btn>
            <Btn size="sm" kind="ghost" icon="archive" onClick={() => setArch(t)}>Archive</Btn></>}
        </div>
      </article>))}</MagicBento>}
    {arch && <Confirm title={`Archive ${arch.name}?`} body="Archived tournaments become read-only and leave the public listing. Results and reports stay available." confirm="Archive" danger busy={archive.isPending} onClose={() => setArch(null)} onConfirm={() => archive.mutate(arch.id, { onSuccess: () => setArch(null) })} />}
  </>;
}
