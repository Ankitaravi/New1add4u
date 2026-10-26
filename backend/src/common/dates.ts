import { BadRequestException } from '@nestjs/common';

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** "2026-11-02" -> UTC midnight Date. */
export function parseDay(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) throw new BadRequestException('date must be YYYY-MM-DD');
  const d = new Date(`${s}T00:00:00.000Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BadRequestException('invalid date');
  return d;
}

/** Today's calendar date in India, as UTC midnight. */
export function todayIST(): Date {
  return new Date(Math.floor((Date.now() + IST_OFFSET_MS) / 86400000) * 86400000);
}

export const toMins = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);
export const fromMins = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** An unpaid booking holds its slot for this long. */
export const PAYMENT_HOLD_MS = 10 * 60 * 1000;
