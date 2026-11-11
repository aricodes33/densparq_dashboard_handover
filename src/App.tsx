import { createHashRouter, Navigate, NavLink, Outlet, RouterProvider, useLocation, useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Toasts, Btn, Select, ago } from '@/ui/kit';
import { PERSONAS, getSession, setSession } from '@/api/client';
import { useTournament, useMyNotifications, useDashboard } from '@/api/hooks';
import { resetDB } from '@/mock/db';
import { TournamentList } from '@/pages/org/TournamentList';
import { OrgStaff, OrgTemplates, OrgAudit } from '@/pages/org/OrgPages';
import { VenueCalendar } from '@/pages/venue/Calendar';
import { Customers } from '@/pages/venue/Customers';
import { Memberships } from '@/pages/venue/Memberships';
import { Pricing } from '@/pages/venue/Pricing';
import { Analytics } from '@/pages/venue/Analytics';
import { VenueSetup } from '@/pages/venue/Setup';
import { Wizard } from '@/pages/t/Wizard';
import { Overview } from '@/pages/t/Overview';
import { Rules } from '@/pages/t/Rules';
import { Registrations } from '@/pages/t/Registrations';
import { Fixtures } from '@/pages/t/Fixtures';
import { Matches, MatchReview } from '@/pages/t/Matches';
import { Standings } from '@/pages/t/Standings';
import { Stats } from '@/pages/t/Stats';
import { Reports } from '@/pages/t/Reports';
import { Messages, TSettings } from '@/pages/t/Messages';
import { RefereeHome, ScorePad } from '@/pages/score/ScorePad';
import { PublicTournament } from '@/pages/public/PublicTournament';
import { Register, EntryStatus } from '@/pages/public/Register';
import { AcademyOverview } from '@/pages/academy/Overview';
import { Batches } from '@/pages/academy/Batches';
import { Athletes } from '@/pages/academy/Athletes';
import { PlayerStats } from '@/pages/academy/Stats';
import { Payments } from '@/pages/academy/Payments';
import { Admissions } from '@/pages/academy/Admissions';
import { Home } from '@/pages/home/Home';
import { BookCourt } from '@/pages/home/BookCourt';
import { Trial } from '@/pages/home/Trial';
import { MyAthlete } from '@/pages/home/MyAthlete';
import { Tournaments } from '@/pages/home/Tournaments';

const T_NAV: [string, string, string, string[]?][] = [
  ['', 'Overview', 'home'], ['setup', 'Setup', 'cog', ['org_admin', 'branch_manager']], ['rules', 'Rules', 'rules'], ['registrations', 'Registrations', 'users', ['org_admin', 'branch_manager', 'registration_manager', 'front_desk']],
  ['fixtures', 'Fixtures', 'cal'], ['matches', 'Matches', 'play'], ['standings', 'Standings', 'table'], ['stats', 'Player stats', 'trophy'], ['reports', 'Reports', 'chart', ['org_admin', 'branch_manager', 'registration_manager', 'front_desk']],
  ['messages', 'Messages', 'bell', ['org_admin', 'branch_manager', 'registration_manager', 'front_desk']], ['settings', 'Settings', 'shield', ['org_admin', 'branch_manager']],
];

const V_NAV: [string, string, string, string[]][] = [
  ['calendar', 'Bookings calendar', 'cal', ['org_admin', 'branch_manager', 'front_desk']], ['customers', 'Customers', 'users', ['org_admin', 'branch_manager', 'front_desk']],
  ['memberships', 'Memberships', 'trophy', ['org_admin', 'branch_manager', 'front_desk']], ['pricing', 'Pricing & offers', 'chart', ['org_admin', 'branch_manager']],
  ['analytics', 'Analytics', 'chart', ['org_admin', 'branch_manager']], ['venues', 'Venue setup', 'cog', ['org_admin', 'branch_manager']],
];

const T_ALL = ['org_admin', 'branch_manager', 'front_desk', 'registration_manager', 'referee', 'captain'];
// Tournaments workspace menu (same shape as V_NAV/A_NAV). Paths starting with '/' are app-level routes.
const TW_NAV: [string, string, string, string[]][] = [
  ['', 'All tournaments', 'trophy', T_ALL], ['new', 'New tournament', 'plus', ['org_admin', 'branch_manager']],
  ['templates', 'Rule templates', 'copy', T_ALL], ['/score', 'Referee scoring', 'play', T_ALL],
];

const A_NAV: [string, string, string, string[]][] = [
  ['academy', 'Overview & reports', 'home', ['org_admin', 'branch_manager', 'front_desk']], ['academy/batches', 'Batches', 'cal', ['org_admin', 'branch_manager', 'front_desk', 'coach']],
  ['academy/athletes', 'Athletes', 'users', ['org_admin', 'branch_manager', 'front_desk', 'coach']], ['academy/player-stats', 'Player stats', 'chart', ['org_admin', 'branch_manager', 'front_desk', 'coach']],
  ['academy/payments', 'Fees & payments', 'trophy', ['org_admin', 'branch_manager', 'front_desk']], ['academy/admissions', 'Admissions', 'send', ['org_admin', 'branch_manager', 'front_desk']],
];
type WS = 'venue' | 'academy' | 'tournaments';
const WS_ROLES: Record<WS, string[]> = { venue: ['org_admin', 'branch_manager', 'front_desk'], academy: ['org_admin', 'branch_manager', 'front_desk', 'coach'], tournaments: T_ALL };
const WS_HOME: Record<WS, string> = { venue: 'calendar', academy: 'academy', tournaments: '' };
// Workspace = first path segment after /o/:org (tournament routes live under /t/ or the org root).
const wsOf = (path: string): WS => { const seg = path.split('/')[3] ?? ''; return seg === 'academy' ? 'academy' : ['calendar', 'customers', 'memberships', 'pricing', 'analytics', 'venues'].includes(seg) ? 'venue' : 'tournaments'; };

function Shell() {
  const { org = 'densparq', tid } = useParams(); const loc = useLocation();
  const [open, setOpen] = useState(false); useEffect(() => setOpen(false), [loc.pathname]);
  const s = getSession(); const t = useTournament(tid); const qc = useQueryClient();
  const dash = useDashboard(tid ?? ''); const attention = tid ? dash.data?.attention?.length ?? 0 : 0;
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const flip = () => { const n = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('dsq-theme', n); } catch { /* */ } setTheme(n); };
  const base = `/o/${org}/t/${tid}`, ws = wsOf(loc.pathname), wss = (Object.keys(WS_ROLES) as WS[]).filter(w => WS_ROLES[w].includes(s.role));
  const nav = (list: [string, string, string, string[]][]) => list.filter(([, , , r]) => r.includes(s.role)).map(([p, l, i]) => <NavLink key={p} end to={p.startsWith('/') ? p : `/o/${org}/${p}`} className="nav"><Icon name={i} />{l}</NavLink>);
  return <div className="shell">
    <div className="mobile-bar"><Btn kind="ghost" icon="menu" aria-label="Open menu" onClick={() => setOpen(true)} className="" /><span className="brand-mark" style={{ width: 28, height: 28, fontSize: 16 }}>D</span><span className="bold">{t.data?.name ?? `Densparq · ${ws[0].toUpperCase()}${ws.slice(1)}`}</span></div>
    <nav className={`side ${open ? 'open' : ''}`} aria-label="Main">
      <Link to="/" className="brand"><span className="brand-mark">D</span><span className="col tight" style={{ gap: 0 }}><span className="display bold" style={{ fontSize: 16 }}>Densparq</span><span className="xs" style={{ color: '#8F8F8F' }}>Home · choose a journey</span></span></Link>
      {wss.length > 1 && <div className="seg" role="group" aria-label="Workspace" style={{ background: '#1C1C1C', marginBottom: 8 }}>{wss.map(w => <Link key={w} to={`/o/${org}/${WS_HOME[w]}`} aria-current={ws === w ? 'page' : undefined} style={{ flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, textDecoration: 'none', color: ws === w ? '#0A0A0A' : '#A3A3A3', background: ws === w ? 'var(--lime)' : 'transparent' }}>{w[0].toUpperCase() + w.slice(1)}</Link>)}</div>}
      {ws === 'venue' && nav(V_NAV)}
      {ws === 'academy' && nav(A_NAV)}
      {ws === 'tournaments' && nav(TW_NAV)}
      {ws === 'tournaments' && tid && t.data && <>
        <div className="side-label" title={t.data.name}>{t.data.name.length > 26 ? t.data.name.slice(0, 25) + '…' : t.data.name}</div>
        {T_NAV.filter(([, , , roles]) => !roles || roles.includes(s.role)).map(([p, l, i]) => <NavLink key={p} end={!p} to={p ? `${base}/${p}` : base} className="nav"><Icon name={i} />{l}{!p && attention > 0 && <span className="count" aria-label={`${attention} need attention`}>{attention}</span>}</NavLink>)}
        <a className="nav" href={`#/t/${t.data.slug}`} target="_blank" rel="noreferrer"><Icon name="globe" />Public page ↗</a>
      </>}
      {s.role === 'org_admin' && <><div className="side-label">Organization</div>
        <NavLink to={`/o/${org}/staff`} className="nav"><Icon name="users" />Staff & roles</NavLink>
        <NavLink to={`/o/${org}/audit`} className="nav"><Icon name="history" />Audit log</NavLink></>}
      <div style={{ marginTop: 'auto', paddingTop: 16 }} className="col tight">
        <label className="xs" htmlFor="org-sel" style={{ color: '#8F8F8F', padding: '0 4px' }}>Organization</label>
        <Select id="org-sel" value={org} onChange={e => { location.hash = `/o/${e.target.value}`; }} options={[['densparq', 'Densparq Kannuru'], ['rvce', 'RVCE Sports Council']]} />
        <label className="xs" htmlFor="persona" style={{ color: '#8F8F8F', padding: '0 4px' }}>Viewing as (demo)</label>
        <Select id="persona" value={s.userId} onChange={e => { setSession(PERSONAS.find(p => p.userId === e.target.value)!); qc.invalidateQueries(); location.reload(); }} options={PERSONAS.map(p => [p.userId, p.label])} />
        <div className="row tight"><Btn size="sm" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={flip}>{theme === 'dark' ? 'Light' : 'Dark'}</Btn><Btn size="sm" kind="ghost" onClick={() => { resetDB(); location.reload(); }} style={{ color: '#8F8F8F' }}>Reset demo data</Btn></div>
      </div>
    </nav>
    <main className="main" id="main"><div className="surface"><Outlet /></div></main>
    <Toasts />
  </div>;
}

export function Bell() {
  const n = useMyNotifications(); const [open, setOpen] = useState(false);
  return <div style={{ position: 'relative' }}>
    <Btn icon="bell" aria-label={`Notifications (${n.data?.length ?? 0})`} aria-expanded={open} onClick={() => setOpen(!open)} />
    {open && <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 340, zIndex: 30, maxHeight: 420, overflow: 'auto', boxShadow: 'var(--shadow)' }}>
      <h3>Sent recently</h3>
      {(n.data ?? []).map(x => <div key={x.id} className="col tight" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}><span className="bold small">{x.title}</span><span className="xs muted">{x.recipientRegIds.length} recipients · {x.channels.join(' + ')} · {ago(x.createdAt)}</span></div>)}
    </div>}
  </div>;
}

const router = createHashRouter([
  { path: '/', element: <Home /> }, { path: '/book', element: <BookCourt /> }, { path: '/trial', element: <Trial /> }, { path: '/me', element: <MyAthlete /> }, { path: '/tournaments', element: <Tournaments /> },
  { path: '/o/:org', element: <Shell />, children: [
    { index: true, element: <TournamentList /> }, { path: 'new', element: <Wizard /> },
    { path: 'venues', element: <VenueSetup /> }, { path: 'calendar', element: <VenueCalendar /> }, { path: 'customers', element: <Customers /> }, { path: 'memberships', element: <Memberships /> }, { path: 'pricing', element: <Pricing /> }, { path: 'analytics', element: <Analytics /> },
    { path: 'academy', element: <AcademyOverview /> }, { path: 'academy/batches', element: <Batches /> }, { path: 'academy/athletes', element: <Athletes /> }, { path: 'academy/player-stats', element: <PlayerStats /> }, { path: 'academy/payments', element: <Payments /> }, { path: 'academy/admissions', element: <Admissions /> }, { path: 'staff', element: <OrgStaff /> }, { path: 'templates', element: <OrgTemplates /> }, { path: 'audit', element: <OrgAudit /> },
    { path: 't/:tid', children: [
      { index: true, element: <Overview /> }, { path: 'setup', element: <Wizard /> }, { path: 'rules', element: <Rules /> }, { path: 'registrations', element: <Registrations /> },
      { path: 'fixtures', element: <Fixtures /> }, { path: 'matches', element: <Matches /> }, { path: 'matches/:mid', element: <MatchReview /> }, { path: 'standings', element: <Standings /> },
      { path: 'stats', element: <Stats /> }, { path: 'reports', element: <Reports /> }, { path: 'messages', element: <Messages /> }, { path: 'settings', element: <TSettings /> },
    ] },
  ] },
  { path: '/score', element: <><RefereeHome /><Toasts /></> }, { path: '/score/:mid', element: <><ScorePad /><Toasts /></> },
  { path: '/t/:slug', element: <><PublicTournament /><Toasts /></> }, { path: '/t/:slug/register', element: <><Register /><Toasts /></> }, { path: '/t/:slug/entry/:rid', element: <><EntryStatus /><Toasts /></> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
export const App = () => <RouterProvider router={router} />;
