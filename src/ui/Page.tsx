import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTournament } from '@/api/hooks';
import { Bell } from '@/App';
import { Status } from './kit';
import { getSession } from '@/api/client';

/** Page header with breadcrumbs, title, status and actions. */
export function PageHead({ title, sub, actions, crumbs = true }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: boolean }) {
  const { org, tid } = useParams(); const t = useTournament(tid);
  return <header className="col" style={{ marginBottom: 22 }}>
    <div className="topbar" style={{ marginBottom: 0 }}>
      <nav className="crumbs" aria-label="Breadcrumb">{crumbs && <><Link to={`/o/${org}`}>Tournaments</Link>{t.data && <><span aria-hidden="true">/</span><Link to={`/o/${org}/t/${tid}`}>{t.data.name}</Link> <Status s={t.data.phase === 'setup' ? 'draft' : t.data.phase} /></>}</>}</nav>
      <div className="row tight"><Bell /></div>
    </div>
    <div className="row between top"><div className="col tight grow"><h1>{title}</h1>{sub && <p className="muted" style={{ margin: 0, maxWidth: 760 }}>{sub}</p>}</div>{actions && <div className="row tight">{actions}</div>}</div>
  </header>;
}
export const useTid = () => { const { tid = '', org = 'densparq' } = useParams(); return { tid, org, role: getSession().role }; };
export const can = (roles: string[]) => roles.includes(getSession().role);
/** Tournament roles: organizers run events end to end; desk roles handle entries and payments. Mirrors ADMIN/DESK in mock/handlers.ts. */
export const ORGANIZER = ['org_admin', 'branch_manager'], TDESK = [...ORGANIZER, 'registration_manager', 'front_desk'];
