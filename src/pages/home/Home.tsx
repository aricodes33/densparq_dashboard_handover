// Public landing for players and parents: three journeys (book a court, play a tournament, train at the academy).
// One visual system: same card, same lime line-art panel, one sentence, one detail line, one pill CTA. Staff use the header link.
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '@/api/hooks';
import { PERSONAS, getSession, setSession } from '@/api/client';
import { Icon, Select, Toasts, fmtDate } from '@/ui/kit';
import type { Sport } from '@/domain/types';

export type PublicHome = { tournaments: { slug: string; name: string; sport: Sport; startDate: string; endDate: string; open: boolean }[]; academies: { id: string; name: string; batches: { id: string; name: string; sport: Sport; ageMin: number; ageMax: number; level: string; seats: number }[] }[]; venues: { id: string; name: string; address: string; sports: Sport[] }[] };
// Staff entry per role; organizers land on the tournament list (the sidebar switches workspace).
const WORKSPACES: [string, string[]][] = [['', ['org_admin', 'registration_manager', 'referee']], ['calendar', ['branch_manager', 'front_desk']], ['academy/batches', ['coach']]];

const CSS = `
.lp{max-width:1120px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left,0px)) 64px}
.lp-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.lp-links{display:flex;align-items:center;gap:14px;font-size:14px}.lp-links a{color:var(--text);font-weight:600;text-decoration:none}.lp-links a:hover{text-decoration:underline}
.lp-hero{padding:56px 0 36px;max-width:720px}
.lp-hero h1{font:700 clamp(36px,5vw,60px)/1.02 var(--display);letter-spacing:-.035em;margin:0;text-wrap:balance}
.lp-hero p{margin:16px 0 0;color:var(--muted);font-size:17px;max-width:52ch}
.lp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.lp-card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:32px;overflow:hidden}
.lp-art{height:210px;background:var(--lime);position:relative}.lp-art svg{display:block;width:100%;height:100%}
.lp-art::after{content:'';position:absolute;inset:auto 0 0;height:40%;background:linear-gradient(transparent,var(--card))}
.lp-body{display:flex;flex-direction:column;gap:10px;padding:4px 24px 24px;flex:1}
.lp-body h2{font:700 28px/1.1 var(--display);letter-spacing:-.025em;margin:0}
.lp-body p{margin:0;color:var(--muted);font-size:15px}
.lp-meta{font-size:13px;font-weight:600;color:var(--text);margin-top:auto;padding:8px 0 4px}
.lp-cta{display:flex;align-items:center;gap:12px;padding:6px;border-radius:999px;background:#0A0A0A;color:#fff;text-decoration:none;font-weight:600;font-size:15px}
:root[data-theme="dark"] .lp-cta{box-shadow:inset 0 0 0 1px var(--line-2)}
.lp-cta .s{width:44px;height:44px;border-radius:50%;background:var(--lime);color:#0A0A0A;display:grid;place-items:center;flex:none}
.lp-cta .l{flex:1;text-align:center}
.lp-cta .g{width:44px;height:44px;border-radius:50%;background:#fff;color:#0A0A0A;display:grid;place-items:center;flex:none;transition:transform .2s ease}
.lp-cta:hover .g{transform:translateX(3px)}
.lp-foot{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:13px}
.lp-demo{display:flex;align-items:center;gap:8px;white-space:nowrap}.lp-demo select{min-height:34px;padding:4px 10px;font-size:13px}
@media (max-width:860px){.lp-grid{grid-template-columns:1fr}.lp-hero{padding:36px 0 24px}}
@media (prefers-reduced-motion:reduce){.lp-cta .g{transition:none}}
`;

// One line-art system for all three panels: ink strokes on lime, same stroke weight and scale.
const S = { stroke: '#0A0A0A', strokeWidth: 2.5, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const Court = () => <svg viewBox="0 0 360 210" aria-hidden="true"><g {...S}><rect x="70" y="28" width="220" height="150" rx="2" /><path d="M70 50h220M70 156h220M180 28v150M120 28v150M240 28v150" /><path d="M180 18v170" strokeWidth="5" /></g><g transform="translate(232 92) rotate(30)"><path d="M0 0l9 15H-9Z" fill="#0A0A0A" /><circle cy="-3" r="4.5" fill="#0A0A0A" /></g></svg>;
const Bracket = () => <svg viewBox="0 0 360 210" aria-hidden="true"><g {...S}>{[36, 66, 106, 136].map(y => <path key={y} d={`M60 ${y}h50`} />)}<path d="M110 36v30h40M110 106v30h40M150 51h0M110 51h40M110 121h40M150 51v70h40M190 86h50" /></g>
  <g {...S}><circle cx="268" cy="86" r="24" /><path d="M258 76h20v8a10 10 0 0 1-20 0Z M268 94v8M261 104h14" /></g><g fill="#0A0A0A">{[36, 66, 106, 136].map(y => <circle key={y} cx="60" cy={y} r="4" />)}</g></svg>;
const Drill = () => <svg viewBox="0 0 360 210" aria-hidden="true"><g {...S}><path d="M60 180V40h240v140" /><path d="M60 110h240" strokeDasharray="2 8" /></g>
  <path d="M100 160 C140 120 140 120 180 140 S240 90 260 70" {...S} strokeDasharray="6 7" />{[[100, 160], [180, 140], [260, 70], [140, 80]].map(([x, y]) => <path key={x} d={`M${x - 9} ${y + 7}L${x} ${y - 9}L${x + 9} ${y + 7}Z`} fill="#0A0A0A" />)}<circle cx="100" cy="160" r="9" fill="#fff" stroke="#0A0A0A" strokeWidth="2.5" /></svg>;

const Cta = ({ to, label }: { to: string; label: string }) => <Link to={to} className="lp-cta"><span className="s"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg></span><span className="l">{label}</span><span className="g"><Icon name="chev" /></span></Link>;

export function Home() {
  const h = useGet<PublicHome>('/public/home'); const s = getSession(); const qc = useQueryClient();
  const seats = h.data?.academies.flatMap(a => a.batches).reduce((n, b) => n + Math.max(0, b.seats), 0);
  const next = h.data?.tournaments.find(t => t.open) ?? h.data?.tournaments[0], ws = WORKSPACES.find(([, r]) => r.includes(s.role));
  return <div className="lp">
    <style>{CSS}</style>
    <header className="lp-top"><span className="row tight"><span className="brand-mark">D</span><span className="display bold" style={{ fontSize: 20 }}>Densparq</span></span>
      <nav className="lp-links" aria-label="Account"><Link to="/tournaments">Tournaments</Link>{s.role === 'guardian' && <Link to="/me">My child's progress</Link>}{ws && <Link to={`/o/densparq/${ws[0]}`}>Staff workspace →</Link>}</nav></header>
    <section className="lp-hero"><h1>Play, train and compete in Kannuru.</h1><p>Turfs, badminton and pickleball courts on Yelahanka Main Road. Open 6 am to 11 pm, every day.</p></section>
    <div className="lp-grid">
      <article className="lp-card"><div className="lp-art"><Court /></div><div className="lp-body"><h2>Book courts instantly</h2><p>Quickly find and reserve a court for the next 7 days. No calls, no waiting.</p><span className="lp-meta">Badminton, pickleball, football and box cricket</span><Cta to="/book" label="Book a court" /></div></article>
      <article className="lp-card"><div className="lp-art"><Bracket /></div><div className="lp-body"><h2>Join the tournaments</h2><p>Compete in local tournaments and friendly matches. Track your progress and climb the ranks.</p><span className="lp-meta">{next ? `Next: ${next.name} · ${fmtDate(next.startDate)}` : 'New tournaments every month'}</span><Cta to="/tournaments" label="See tournaments" /></div></article>
      <article className="lp-card"><div className="lp-art"><Drill /></div><div className="lp-body"><h2>Train at the academy</h2><p>Coached batches for ages 6 to 16. The first session is a free trial.</p><span className="lp-meta">{seats != null ? `${seats} seats open this term` : ' '}</span><Cta to="/trial" label="Book a free trial" /></div></article>
    </div>
    <footer className="lp-foot"><span>Densparq Kannuru · Yelahanka Main Rd, Bengaluru</span>
      <label className="lp-demo"><span>Demo login</span><Select value={s.userId} onChange={e => { setSession(PERSONAS.find(p => p.userId === e.target.value)!); qc.invalidateQueries(); location.reload(); }} options={PERSONAS.map(p => [p.userId, p.label])} /></label></footer>
    <Toasts />
  </div>;
}
