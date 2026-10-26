export const MDR_PERCENT = 2;
export const MAX_UNIT_PRICE_PAISE = 5_000_000;

export function mdrPaise(feePaise: number): number {
  return Math.round((feePaise * MDR_PERCENT) / 100);
}

export function priceOf(feePaise: number) {
  const mdr = mdrPaise(feePaise);
  return { feePaise, mdrPaise: mdr, totalPaise: feePaise + mdr };
}

/** 2350 -> "₹23.50", 251000 -> "₹2510" */
export function rupees(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? `₹${r}` : `₹${r}.${String(p).padStart(2, '0')}`;
}
