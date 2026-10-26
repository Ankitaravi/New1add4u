const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const ACCESS = 'add4u.hospital.access';
const REFRESH = 'add4u.hospital.refresh';

export const getToken = () => localStorage.getItem(ACCESS);
export const getRefreshToken = () => localStorage.getItem(REFRESH);
export function setTokens(t: { accessToken: string; refreshToken: string } | null) {
  if (t) {
    localStorage.setItem(ACCESS, t.accessToken);
    localStorage.setItem(REFRESH, t.refreshToken);
  } else {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  }
}

/** One in-flight refresh shared by parallel 401s: replaying a refresh token would end the session. */
let refreshing: Promise<boolean> | null = null;
function refreshTokens(): Promise<boolean> {
  return (refreshing ??= (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) setTokens(null);
        return false;
      }
      setTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })());
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retried = false): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && token && !retried && (await refreshTokens())) return api<T>(path, init, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data as any).message;
    throw new ApiError(res.status, Array.isArray(m) ? m.join(', ') : (m ?? res.statusText));
  }
  return data as T;
}

/** 2350 -> "₹23.50", 251000 -> "₹2510" */
export function rupees(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? `₹${r.toLocaleString('en-IN')}` : `₹${r.toLocaleString('en-IN')}.${String(p).padStart(2, '0')}`;
}

export interface User { id: string; phone: string; role: string; name: string | null }
export interface Hospital { id: string; name: string; city: string | null }
export interface Department { id: string; name: string }
export interface DoctorRow { id: string; name: string | null; specialization: string | null; medicalStream: string | null; feePaise: number }
export interface Stats { doctors: number; appointments: number; byStatus: Record<string, number>; revenuePaise: number }
export interface AppointmentRow {
  id: string; slot: string; status: string; totalPaise: number;
  doctor: { id: string; specialization: string | null; user: { name: string | null } };
  user: { name: string | null; phone: string };
}
