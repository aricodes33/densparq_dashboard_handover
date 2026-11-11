// Shared UI primitives. Everything is real <button>/<a>/<input>; icon-only buttons carry aria-label.
import { forwardRef, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z', trophy: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0Z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4',
  rules: 'M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M14 4v6h6 M7 13h10 M7 17h7', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  cal: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', play: 'M5 3l14 9-14 9V3Z', table: 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18',
  chart: 'M3 3v18h18 M7 16v-5 M12 16V8 M17 16v-9', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0', cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  plus: 'M12 5v14 M5 12h14', check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18 M6 6l12 12', chev: 'M9 18l6-6-6-6', back: 'M15 18l-6-6 6-6', down: 'M6 9l6 6 6-6', upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3', copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  archive: 'M21 8v13H3V8 M1 3h22v5H1Z M10 12h4', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z M12 9v4 M12 17h.01',
  menu: 'M3 6h18 M3 12h18 M3 18h18', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.35-4.35', undo: 'M3 7v6h6 M21 17a9 9 0 0 0-15-6.7L3 13', pause: 'M6 4h4v16H6Z M14 4h4v16h-4Z', wifi: 'M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01', wifiOff: 'M1 1l22 22 M16.72 11.06A10.94 10.94 0 0 1 19 12.55 M5 12.55a10.94 10.94 0 0 1 5.17-2.39 M10.71 5.05A16 16 0 0 1 22.58 9 M1.42 9a15.91 15.91 0 0 1 4.7-2.88 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7Z', moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2', link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', history: 'M3 3v5h5 M3.05 13A9 9 0 1 0 6 5.3L3 8 M12 7v5l4 2', whatsapp: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
  grip: 'M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01', globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
};
export type IconName = keyof typeof P;
export const Icon = ({ name, size = 18 }: { name: IconName | string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] ?? P.chev} /></svg>
);

type Tone = 'good' | 'money' | 'danger' | 'neutral' | 'info' | 'ink' | 'held';
export const Chip = ({ tone = 'neutral', children, dot, live }: { tone?: Tone; children: ReactNode; dot?: boolean; live?: boolean }) => (
  <span className={`chip ${tone} ${live ? 'live' : ''}`}>{(dot || live) && <span className="dot" />}{children}</span>
);

const STATUS_TONE: Record<string, Tone> = {
  confirmed: 'good', pending_payment: 'money', waitlisted: 'info', rejected: 'danger', withdrawn: 'neutral', draft: 'neutral',
  published: 'good', unpublished: 'money', archived: 'neutral', superseded: 'neutral',
  scheduled: 'neutral', live: 'good', paused: 'money', completed: 'held', abandoned: 'danger', walkover: 'info', postponed: 'money',
  verified: 'good', submitted: 'money', disputed: 'danger', paid: 'good', unpaid: 'money', refunded: 'neutral', partially_refunded: 'info', waived: 'info',
  pending: 'money', approved: 'good', setup: 'neutral', registration: 'info', block_todo: 'money', blocked: 'good', unblock_todo: 'money', unblocked: 'neutral',
};
export const human = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
export const Status = ({ s }: { s: string }) => <Chip tone={STATUS_TONE[s] ?? 'neutral'} live={s === 'live'}>{human(s)}</Chip>;

export function Btn({ kind, size, icon, children, loading, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'lime' | 'danger' | 'ghost'; size?: 'sm' | 'lg'; icon?: IconName | string; loading?: boolean }) {
  return <button type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={`btn ${kind ?? ''} ${size ?? ''} ${!children ? 'icon' : ''} ${rest.className ?? ''}`}>{icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}{loading ? 'Working…' : children}</button>;
}

let fid = 0;
export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; id?: string }) {
  const [auto] = useState(() => `f${++fid}`); const i = id ?? auto;
  return <div className="field"><label htmlFor={i}>{label}</label>{children({ id: i, 'aria-invalid': error ? true : undefined, 'aria-describedby': hint || error ? `${i}-d` : undefined })}
    {(error || hint) && <span id={`${i}-d`} className={error ? 'err' : 'hint'}>{error ?? hint}</span>}</div>;
}
// forwardRef so react-hook-form's register() can attach to the real element
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} {...p} className={`input ${p.className ?? ''}`} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options: [string, string][] }>(({ options, ...p }, ref) => <select ref={ref} {...p} className="input">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((p, ref) => <textarea ref={ref} {...p} className="input" />);
export const Check = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: string }>(({ label, hint, ...p }, ref) => <label className="check"><input ref={ref} type="checkbox" {...p} /><span><span className="bold">{label}</span>{hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}</span></label>);

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button type="button" key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

function useEsc(onClose: () => void) { useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]); }
function useTrap() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.close)')?.focus(); return () => prev?.focus(); }, []);
  return ref;
}
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEsc(onClose); const ref = useTrap();
  return createPortal(<div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dlg-t">
      <div className="row between nowrap"><h2 id="dlg-t">{title}</h2><Btn kind="ghost" icon="x" aria-label="Close" className="close" onClick={onClose} /></div>
      {children}{footer && <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
    </div></div>, document.body);
}
export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEsc(onClose); const ref = useTrap();
  return createPortal(<div className="overlay drawer-o" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
      <div className="row between nowrap top"><div className="grow">{typeof title === 'string' ? <h2>{title}</h2> : title}</div><Btn kind="ghost" icon="x" aria-label="Close" className="close" onClick={onClose} /></div>{children}
    </div></div>, document.body);
}

/** Confirm with an optional required reason (used for every audited action). */
export function Confirm({ title, body, confirm = 'Confirm', danger, reason, onClose, onConfirm, busy }: { title: string; body?: ReactNode; confirm?: string; danger?: boolean; reason?: string; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean }) {
  const [r, setR] = useState(''); const [tried, setTried] = useState(false);
  const go = () => { setTried(true); if (reason && !r.trim()) return; onConfirm(r.trim()); };
  return <Modal title={title} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>{confirm}</Btn></>}>
    {body && <div className="muted">{body}</div>}
    {reason && <Field label={reason} error={tried && !r.trim() ? 'A reason is required. It is saved in the audit log.' : undefined}>{p => <Textarea {...p} value={r} onChange={e => setR(e.target.value)} rows={3} />}</Field>}
  </Modal>;
}

// toasts (aria-live)
type T = { id: number; text: string; tone?: 'danger' };
let push: ((t: T) => void) | null = null; let tid = 0;
export const toast = (text: string, tone?: 'danger') => push?.({ id: ++tid, text, tone });
export function Toasts() {
  const [list, set] = useState<T[]>([]);
  useEffect(() => { push = t => { set(l => [...l, t]); setTimeout(() => set(l => l.filter(x => x.id !== t.id)), 4200); }; return () => { push = null; }; }, []);
  return <div className="toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}><Icon name={t.tone ? 'alert' : 'check'} size={16} />{t.text}</div>)}</div>;
}

export const Skeleton = ({ h = 18, w = '100%' }: { h?: number; w?: number | string }) => <div className="skel" style={{ height: h, width: w }} />;
export const Loading = ({ rows = 4 }: { rows?: number }) => <div className="col" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={i ? 18 : 30} w={i ? `${90 - i * 12}%` : '40%'} />)}</div>;
export const Empty = ({ icon = 'trophy', title, body, action }: { icon?: string; title: string; body?: ReactNode; action?: ReactNode }) => (
  <div className="empty"><span className="ico"><Icon name={icon} size={24} /></span><h3 style={{ color: 'var(--text)' }}>{title}</h3>{body && <p style={{ margin: 0, maxWidth: 420 }}>{body}</p>}{action}</div>
);
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error as { status?: number; message?: string };
  if (e?.status === 403) return <Empty icon="shield" title="You don’t have access" body={`${e.message}. Switch persona in the top bar, or ask an organizer for the right role.`} />;
  return <Empty icon="alert" title={e?.status === 404 ? 'Not found' : 'Something went wrong'} body={e?.message ?? 'Please try again.'} action={retry && <Btn onClick={retry}>Try again</Btn>} />;
}
export const Banner = ({ tone, icon = 'alert', children, action }: { tone?: 'money' | 'danger' | 'good' | 'info'; icon?: string; children: ReactNode; action?: ReactNode }) => (
  <div className={`banner ${tone ?? ''}`} role={tone === 'danger' ? 'alert' : undefined}><Icon name={icon} /><div className="grow">{children}</div>{action}</div>
);
export const Stat = ({ v, l, sub, tone }: { v: ReactNode; l: string; sub?: ReactNode; tone?: string }) => (
  <div className="card stat"><span className="l">{l}</span><span className="v" style={tone ? { color: `var(--${tone}-fg)` } : undefined}>{v}</span>{sub && <span className="small muted">{sub}</span>}</div>
);
export const Bar = ({ pct, label }: { pct: number; label: string }) => <div className="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;

// formatting (venue-local: Asia/Kolkata)
const TZ = 'Asia/Kolkata';
export const fmtDate = (s?: string) => (s ? new Date(s.length === 10 ? `${s}T12:00:00+05:30` : s).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }) : '—');
export const fmtTime = (s?: string) => (s ? new Date(s).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDT = (s?: string) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');
export const ago = (s: string) => { const m = Math.round((Date.now() - Date.parse(s)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const download = (name: string, rows: (string | number)[][]) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
};
