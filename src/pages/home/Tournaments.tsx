// Public tournament list: every published tournament, open ones first. Each row opens the tournament page (rules, fixtures, entry).
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { Chip, Empty, Icon, Loading, Toasts, fmtDate } from '@/ui/kit';
import { SPORT_LABEL } from '@/domain/scoring';
import type { PublicHome } from './Home';

export function Tournaments() {
  const h = useGet<PublicHome>('/public/home'); const list = [...(h.data?.tournaments ?? [])].sort((a, b) => Number(b.open) - Number(a.open) || a.startDate.localeCompare(b.startDate));
  return <div className="pub" style={{ maxWidth: 820 }}><Link to="/" className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />Home</Link>
    <h1 style={{ margin: '10px 0 4px' }}>Tournaments</h1><p className="muted" style={{ marginTop: 0 }}>Compete in local tournaments and friendly matches. Track your progress and climb the ranks.</p>
    {!h.data ? <Loading /> : !list.length ? <Empty icon="trophy" title="No tournaments right now" body="New tournaments are added every month. Check back soon." action={<Link className="btn" to="/">Back to Home</Link>} /> :
      <div className="col">{list.map(t => <Link key={t.slug} to={`/t/${t.slug}`} className="card row between" style={{ textDecoration: 'none' }}>
        <span className="col tight" style={{ gap: 2 }}><span className="bold">{t.name}</span><span className="small muted">{SPORT_LABEL[t.sport]} · {fmtDate(t.startDate)}{t.endDate !== t.startDate ? ` – ${fmtDate(t.endDate)}` : ''}</span></span>
        <span className="row tight">{t.open ? <Chip tone="good">Entries open</Chip> : <Chip>Entries closed</Chip>}<Icon name="chev" /></span></Link>)}</div>}<Toasts /></div>;
}
