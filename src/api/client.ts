// Single entry point for every network call. VITE_API_MODE=http sends real requests to VITE_API_BASE;
// default "mock" routes the same method+path to src/mock/handlers.ts so the UI and the OpenAPI spec stay in lockstep.
import type { Role } from '@/domain/types';

export interface ApiErrorShape { status: number; code: string; message: string; details?: unknown }
export class ApiError extends Error implements ApiErrorShape {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

const MODE = (import.meta.env.VITE_API_MODE as string) ?? 'mock';
const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api/v1';

// Demo session. Real backend: JWT from OTP login; role comes from the membership for the active org.
export const PERSONAS: { userId: string; role: Role; label: string }[] = [
  { userId: 'u_niko', role: 'org_admin', label: 'Niko · Organizer' },
  { userId: 'u_meera', role: 'branch_manager', label: 'Meera · Branch manager (Kannuru)' },
  { userId: 'u_ravi', role: 'front_desk', label: 'Ravi · Front desk' },
  { userId: 'u_suresh', role: 'coach', label: 'Suresh · Academy coach' },
  { userId: 'u_lakshmi', role: 'guardian', label: 'Lakshmi · Parent' },
  { userId: 'u_asha', role: 'registration_manager', label: 'Asha · Registration manager' },
  { userId: 'u_kiran', role: 'referee', label: 'Kiran · Referee' },
  { userId: 'u_cap', role: 'captain', label: 'Rohan · Team captain' },
];
export function getSession() {
  try { const s = localStorage.getItem('dsq-session'); if (s) return JSON.parse(s) as (typeof PERSONAS)[number]; } catch { /* ignore */ }
  return PERSONAS[0];
}
export function setSession(p: (typeof PERSONAS)[number]) { try { localStorage.setItem('dsq-session', JSON.stringify(p)); } catch { /* ignore */ } }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = getSession();
  if (MODE === 'mock') {
    const { handle, ApiError: MockErr } = await import('@/mock/handlers');
    await new Promise(r => setTimeout(r, 120 + Math.random() * 180)); // realistic latency so loading states are visible
    if (!navigator.onLine) throw new ApiError(0, 'offline', 'You are offline');
    try { return (await handle(method, path, body, { userId: s.userId, role: s.role })) as T; }
    catch (e) { if (e instanceof MockErr) throw new ApiError(e.status, e.code, e.message, e.details); throw e; }
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('dsq-token') ?? ''}`, 'Idempotency-Key': method === 'GET' ? '' : crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError(0, 'offline', 'Network error. Check your connection.'); }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? res.statusText, json?.error?.details);
  return json as T;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T,>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T,>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T,>(p: string) => request<T>('DELETE', p),
};
