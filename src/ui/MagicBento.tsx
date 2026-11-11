// Bento grid with border glow, cursor spotlight and click ripple. CSS-variable driven, no animation library.
import { Children, useRef, type ReactNode, type PointerEvent } from 'react';

interface Props { children: ReactNode; columns?: number; rowHeight?: number; gap?: number; radius?: number; enableBorderGlow?: boolean; enableSpotlight?: boolean; spotlightRadius?: number; clickEffect?: boolean }
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MagicBento({ children, columns = 4, rowHeight = 200, gap = 12, radius = 20, enableBorderGlow = true, enableSpotlight = true, spotlightRadius = 300, clickEffect = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent) => {
    const g = ref.current; if (!g || still()) return;
    const b = g.getBoundingClientRect();
    g.style.setProperty('--sx', `${e.clientX - b.left}px`); g.style.setProperty('--sy', `${e.clientY - b.top}px`); g.style.setProperty('--son', enableSpotlight ? '1' : '0');
    if (enableBorderGlow) g.querySelectorAll<HTMLElement>('.mb-card').forEach(c => {
      const r = c.getBoundingClientRect(), dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      c.style.setProperty('--gx', `${e.clientX - r.left}px`); c.style.setProperty('--gy', `${e.clientY - r.top}px`);
      c.style.setProperty('--glow', String(Math.max(0, 1 - Math.hypot(dx, dy) / spotlightRadius)));
    });
  };
  const leave = () => { ref.current?.style.setProperty('--son', '0'); ref.current?.querySelectorAll<HTMLElement>('.mb-card').forEach(c => c.style.setProperty('--glow', '0')); };
  const ripple = (e: PointerEvent<HTMLDivElement>) => {
    if (!clickEffect || still()) return;
    const c = (e.target as HTMLElement).closest<HTMLElement>('.mb-card'); if (!c) return;
    const r = c.getBoundingClientRect(), s = document.createElement('span');
    s.className = 'mb-ripple'; s.style.left = `${e.clientX - r.left}px`; s.style.top = `${e.clientY - r.top}px`;
    c.append(s); s.addEventListener('animationend', () => s.remove());
  };
  return <div ref={ref} className="mb-grid" onPointerMove={move} onPointerLeave={leave} onPointerDown={ripple}
    style={{ '--cols': columns, '--gap': `${gap}px`, '--mb-r': `${radius}px`, '--sr': `${spotlightRadius}px`, gridAutoRows: `minmax(${rowHeight}px, auto)` } as React.CSSProperties}>
    {Children.map(children, c => <div className="mb-card">{c}</div>)}
  </div>;
}
