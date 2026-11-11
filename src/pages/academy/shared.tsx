import { useGet } from '@/api/hooks';
import { useTid } from '@/ui/Page';
import type { Academy, Progress } from '@/domain/academy';

export const useAcademy = () => { const { org } = useTid(); const l = useGet<Academy[]>(`/orgs/${org}/academies`); return { org, academy: l.data?.[0], loading: l.isLoading }; };
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT: Record<string, string> = { '%': '%', sec: ' s', count: '', m: ' m', kmh: ' km/h', score: '/5' };
export const fmtVal = (v: number | undefined, unit: string) => (v == null ? '—' : `${v}${UNIT[unit] ?? ''}`);

/** One metric over time. Hollow dots = estimated (rubric) values, filled = measured. */
export function Trend({ p }: { p: Progress }) {
  const pts = p.points; if (!pts.length) return <span className="xs muted">No data</span>;
  const vals = pts.map(x => x.value), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, W = 220, H = 64, x = (i: number) => 30 + (i * (W - 38)) / Math.max(1, pts.length - 1), y = (v: number) => H - 10 - ((v - lo) / span) * (H - 22);
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${p.label}: ${pts.map(q => `${q.date} ${q.value}`).join(', ')}`}>
    <polyline points={pts.map((q, i) => `${x(i)},${y(q.value)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth={1.5} />
    {pts.map((q, i) => <circle key={i} cx={x(i)} cy={y(q.value)} r={3.5} fill={q.measured ? 'var(--lime)' : 'var(--card)'} stroke="var(--text)" strokeWidth={1.2}><title>{`${q.date}: ${q.value}${q.measured ? '' : ' (estimated)'}`}</title></circle>)}
    <text x={4} y={10} fontSize={9} fill="var(--muted)">{hi}</text><text x={4} y={H - 1} fontSize={9} fill="var(--muted)">{lo}</text>
  </svg>;
}
