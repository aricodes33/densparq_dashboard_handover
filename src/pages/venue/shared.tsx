// Shared bits for the venue screens: venue picker (URL ?v=), venue list, tiny bar chart.
import { useSearchParams } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { useTid } from '@/ui/Page';
import { Select } from '@/ui/kit';
import type { Court, Venue } from '@/domain/types';
import type { VenueProfile, CourtMeta } from '@/domain/venue';

export type VenueFull = Venue & { profile: VenueProfile; courts: (Court & CourtMeta)[] };
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const ampm = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}${min % 60 ? `:${String(min % 60).padStart(2, '0')}` : ''} ${min < 720 ? 'am' : 'pm'}`;

export function useVenue() {
  const { org } = useTid(); const [sp, setSp] = useSearchParams(); const list = useGet<VenueFull[]>(`/orgs/${org}/venue-setup`);
  const id = sp.get('v') ?? list.data?.[0]?.id ?? '';
  const set = (k: string, val: string) => { const n = new URLSearchParams(sp); val ? n.set(k, val) : n.delete(k); setSp(n, { replace: true }); };
  return { org, list, id, venue: list.data?.find(v => v.id === id), set, sp };
}
export const VenuePicker = ({ v }: { v: ReturnType<typeof useVenue> }) => (v.list.data?.length ?? 0) > 1
  ? <label><span className="sr">Venue</span><Select value={v.id} onChange={e => v.set('v', e.target.value)} options={v.list.data!.map(x => [x.id, x.name])} /></label> : null;

/** Minimal bar chart: one series, value labels on hover via <title>, tokens for colour. */
export function Bars({ data, fmt, label, height = 140 }: { data: { k: string; v: number }[]; fmt: (n: number) => string; label: string; height?: number }) {
  const max = Math.max(1, ...data.map(d => d.v)), w = 100 / Math.max(1, data.length);
  return <figure style={{ margin: 0 }} aria-label={label}><svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
    {data.map((d, i) => <rect key={d.k} x={i * w + w * 0.15} width={w * 0.7} y={height / 2 - (d.v / max) * (height / 2 - 2)} height={(d.v / max) * (height / 2 - 2)} rx={0.6} fill="var(--lime)" stroke="var(--text)" strokeWidth={0.15}><title>{`${d.k}: ${fmt(d.v)}`}</title></rect>)}
  </svg><figcaption className="row between xs muted"><span>{data[0]?.k}</span><span>max {fmt(max)}</span><span>{data.at(-1)?.k}</span></figcaption></figure>;
}
