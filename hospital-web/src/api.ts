const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const KEY = 'add4u.hospital.token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
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
